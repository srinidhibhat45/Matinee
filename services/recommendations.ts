import { TMDBMediaItem, RecommendedItem, MediaType } from '../types';
import {
  getAllItems,
  getTopDirectors,
  getTopActors,
  getPreference,
  getGenreDistribution,
  getWatchedPeople,
  getWatchedItemsWithDetailedRatings,
} from './database';
import { tmdbService } from './tmdb';
import {
  MOVIE_GENRES,
  TV_GENRES,
  getCanonicalGenres,
  parseStoredGenres,
} from '../constants/genres';

/**
 * Candidate identity key. TMDB numbers movies and TV independently, so
 * `550` is both "Fight Club" and a completely unrelated series — keying
 * anything by bare ID silently drops or swaps titles.
 */
function mediaKey(mediaType: string | undefined, id: number): string {
  return `${mediaType ?? 'movie'}:${id}`;
}

class RecommendationService {
  /**
   * Get personalized recommendations combining multiple signals.
   */
  async getPersonalizedRecommendations(limit: number = 120, mediaType?: MediaType): Promise<RecommendedItem[]> {
    try {
      // Check if user has enough data
      const watchedItems = await getAllItems('watched');
      const watchedCount = watchedItems.length;

      if (watchedCount < 3) {
        return this.getRecommendationsForNewUser(limit, mediaType);
      }

      // Gather user preference signals
      const [watchedPeople, topDirectors, topActors] = await Promise.all([
        getWatchedPeople(),
        getTopDirectors(5),
        getTopActors(5),
      ]);

      // Map item.id to overallRating
      const itemRatings = new Map<number, number | null>();
      for (const wItem of watchedItems) {
        itemRatings.set(wItem.id, wItem.userRating ?? null);
      }

      // Build genre profile based on ratings.
      // Stored genres are TMDB IDs; they are resolved to canonical tags so a
      // movie's "Science Fiction" and a show's "Sci-Fi & Fantasy" reinforce
      // the same preference instead of being counted as unrelated genres.
      const genreProfile = new Map<string, number>();
      for (const wItem of watchedItems) {
        const genreTags = parseStoredGenres(wItem.genres);

        const r = wItem.userRating;
        let weight = 1.0; // neutral default
        if (r !== null && r !== undefined) {
          if (r >= 8) weight = 3.5;
          else if (r <= 5) weight = -5.0;
          else weight = 1.0;
        }

        for (const tag of genreTags) {
          genreProfile.set(tag, (genreProfile.get(tag) || 0) + weight);
        }
      }

      // Cap individual genre weight to prevent runaways
      for (const [tag, val] of genreProfile.entries()) {
        genreProfile.set(tag, Math.max(-10, Math.min(10, val)));
      }

      // Calculate scores for people (directors/actors)
      const peopleScores = new Map<number, { name: string; role: 'director' | 'actor'; score: number; count: number }>();
      for (const p of watchedPeople) {
        const r = itemRatings.get(p.itemId);
        let points = 1.0;
        if (r !== null && r !== undefined) {
          if (r >= 8) points = 10.0;
          else if (r <= 5) points = -15.0;
          else points = 2.0;
        }

        const existing = peopleScores.get(p.personId);
        if (existing) {
          existing.score += points;
          existing.count += 1;
        } else {
          peopleScores.set(p.personId, { name: p.personName, role: p.role, score: points, count: 1 });
        }
      }

      // Separate loved and disliked people
      const lovedDirectors: { id: number; name: string; score: number }[] = [];
      const lovedActors: { id: number; name: string; score: number }[] = [];
      const dislikedDirectors = new Set<number>();
      const dislikedActors = new Set<number>();

      for (const [personId, info] of peopleScores.entries()) {
        if (info.score >= 5) {
          if (info.role === 'director') {
            lovedDirectors.push({ id: personId, name: info.name, score: info.score });
          } else {
            lovedActors.push({ id: personId, name: info.name, score: info.score });
          }
        } else if (info.score <= -10) {
          if (info.role === 'director') {
            dislikedDirectors.add(personId);
          } else {
            dislikedActors.add(personId);
          }
        }
      }

      lovedDirectors.sort((a, b) => b.score - a.score);
      lovedActors.sort((a, b) => b.score - a.score);

      const topLovedDirectors = lovedDirectors.slice(0, 3);
      const topLovedActors = lovedActors.slice(0, 3);

      // Get user's preferred languages from settings
      const langPref = await getPreference('PREF_LANGUAGES');
      const settingsLanguages: string[] = langPref
        ? langPref.split(',')
        : ['en', 'hi', 'kn', 'ta', 'te', 'ko', 'ja'];

      // Extract languages of watched history
      const watchedLanguages = new Set(watchedItems.map((i) => i.originalLanguage).filter(Boolean));

      // Combine both lists of languages
      const preferredLanguages = Array.from(new Set([...settingsLanguages, ...watchedLanguages]));

      // Calculate language counts for affinity scoring
      const langCounts = new Map<string, number>();
      for (const wItem of watchedItems) {
        if (wItem.originalLanguage) {
          langCounts.set(wItem.originalLanguage, (langCounts.get(wItem.originalLanguage) || 0) + 1);
        }
      }
      const maxLangCount = Math.max(...Array.from(langCounts.values()), 1);

      // Library keys for deduplication (excludes watched, watchlist, and not_interested items)
      const allDbItems = await getAllItems();
      const dbKeys = new Set(allDbItems.map((i) => mediaKey(i.mediaType, i.tmdbId)));

      const candidateMap = new Map<string, { item: TMDBMediaItem; sources: string[] }>();

      // --- Smart Round-Robin Seed Selection ---
      const itemsByLanguage = new Map<string, typeof watchedItems>();
      for (const item of watchedItems) {
        if (!item.originalLanguage) continue;
        if (!itemsByLanguage.has(item.originalLanguage)) {
          itemsByLanguage.set(item.originalLanguage, []);
        }
        itemsByLanguage.get(item.originalLanguage)!.push(item);
      }

      for (const [lang, list] of itemsByLanguage.entries()) {
        list.sort((a, b) => {
          const ratingA = a.userRating ?? 0;
          const ratingB = b.userRating ?? 0;
          if (ratingB !== ratingA) {
            return ratingB - ratingA;
          }
          const dateA = a.watchedDate ? new Date(a.watchedDate).getTime() : 0;
          const dateB = b.watchedDate ? new Date(b.watchedDate).getTime() : 0;
          return dateB - dateA;
        });
      }

      const seeds: typeof watchedItems = [];
      const langGroups = Array.from(itemsByLanguage.values());
      const indices = new Array(langGroups.length).fill(0);
      let added = true;

      while (seeds.length < 10 && added) {
        added = false;
        for (let i = 0; i < langGroups.length; i++) {
          const group = langGroups[i];
          const idx = indices[i];
          if (idx < group.length) {
            seeds.push(group[idx]);
            indices[i] = idx + 1;
            added = true;
            if (seeds.length >= 10) {
              break;
            }
          }
        }
      }

      if (seeds.length < 10 && watchedItems.length > seeds.length) {
        const seedIds = new Set(seeds.map((s) => s.tmdbId));
        for (const item of watchedItems) {
          if (!seedIds.has(item.tmdbId)) {
            seeds.push(item);
            if (seeds.length >= 10) break;
          }
        }
      }

      console.log(`[Personalized Recs] Seeds selected: ${seeds.map(s => `${s.title} (${s.originalLanguage})`).join(', ')}`);
      console.log(`[Personalized Recs] Preferred Languages: ${preferredLanguages.join(', ')}`);

      // --- Candidate Fetching ---
      const seedPromises = seeds.map(async (seed) => {
        try {
          const [recs, similar] = await Promise.allSettled([
            tmdbService.getRecommendations(seed.tmdbId, seed.mediaType),
            tmdbService.getSimilar(seed.tmdbId, seed.mediaType),
          ]);
          return { seed, recs, similar };
        } catch {
          return { seed, recs: { status: 'rejected' as const }, similar: { status: 'rejected' as const } };
        }
      });

      const discoverPromises: Promise<any>[] = [];
      for (const lang of watchedLanguages) {
        if (!lang) continue;
        discoverPromises.push(
          tmdbService.discover(mediaType || 'movie', {
            withOriginalLanguage: lang,
            sortBy: 'popularity.desc',
          }).then((res) => ({ lang, res, type: mediaType || 'movie' }))
        );
        if (!mediaType) {
          discoverPromises.push(
            tmdbService.discover('tv', {
              withOriginalLanguage: lang,
              sortBy: 'popularity.desc',
            }).then((res) => ({ lang, res, type: 'tv' }))
          );
        }
      }

      const lovedPeoplePromises = [...topLovedDirectors, ...topLovedActors].map(async (p) => {
        try {
          const details = await tmdbService.getPersonDetails(p.id);
          return { person: p, details };
        } catch {
          return { person: p, details: null };
        }
      });

      const dislikedDirectorsList = Array.from(dislikedDirectors).slice(0, 5);
      const dislikedActorsList = Array.from(dislikedActors).slice(0, 5);
      const dislikedPeopleList = [...dislikedDirectorsList, ...dislikedActorsList];

      const dislikedPeoplePromises = dislikedPeopleList.map(async (pId) => {
        try {
          const details = await tmdbService.getPersonDetails(pId);
          return { personId: pId, details };
        } catch {
          return { personId: pId, details: null };
        }
      });

      const [
        seedResults,
        discoverResults,
        lovedPeopleResults,
        dislikedPeopleResults,
        trendingResult,
      ] = await Promise.all([
        Promise.all(seedPromises),
        Promise.allSettled(discoverPromises),
        Promise.all(lovedPeoplePromises),
        Promise.all(dislikedPeoplePromises),
        tmdbService.getTrending(mediaType || 'all', 'week').catch(() => null),
      ]);

      // Populate disliked media set
      const dislikedMediaSet = new Set<string>();
      for (const res of dislikedPeopleResults) {
        if (res.details && res.details.combinedCredits) {
          for (const credit of res.details.combinedCredits) {
            dislikedMediaSet.add(`${credit.mediaType}:${credit.id}`);
          }
        }
      }

      // Process loved people results (filmography ingestion).
      // A prolific actor can carry 300+ credits; ingesting all of them would
      // swamp every other signal, so each person contributes only their most
      // popular titles, and only in languages the user actually watches.
      const MAX_CREDITS_PER_LOVED_PERSON = 20;
      for (const { person, details } of lovedPeopleResults) {
        if (!details?.combinedCredits) continue;

        let taken = 0;
        for (const credit of details.combinedCredits) {
          if (taken >= MAX_CREDITS_PER_LOVED_PERSON) break;
          if (mediaType && credit.mediaType !== mediaType) continue;
          if (!preferredLanguages.includes(credit.originalLanguage)) continue;

          const key = mediaKey(credit.mediaType, credit.id);
          if (dbKeys.has(key)) continue;

          taken++;
          const sourceTag = `loved-person-${person.id}`;
          const existing = candidateMap.get(key);
          if (existing) {
            if (!existing.sources.includes(sourceTag)) {
              existing.sources.push(sourceTag);
            }
          } else {
            candidateMap.set(key, {
              item: credit,
              sources: [sourceTag],
            });
          }
        }
      }

      // Process seed recommendation results
      for (const { seed, recs, similar } of seedResults) {
        const rCast = recs as any;
        const sCast = similar as any;
        
        if (rCast.status === 'fulfilled' && rCast.value?.results) {
          for (const rec of rCast.value.results) {
            if (mediaType && rec.mediaType !== mediaType) continue;
            if (!preferredLanguages.includes(rec.originalLanguage)) continue;

            const key = mediaKey(rec.mediaType, rec.id);
            if (dbKeys.has(key)) continue;

            const sourceTag = `seed-rec-${seed.tmdbId}`;
            const existing = candidateMap.get(key);
            if (existing) {
              if (!existing.sources.includes(sourceTag)) existing.sources.push(sourceTag);
            } else {
              candidateMap.set(key, { item: rec, sources: [sourceTag] });
            }
          }
        }

        if (sCast.status === 'fulfilled' && sCast.value?.results) {
          for (const sim of sCast.value.results) {
            if (mediaType && sim.mediaType !== mediaType) continue;
            if (!preferredLanguages.includes(sim.originalLanguage)) continue;

            const key = mediaKey(sim.mediaType, sim.id);
            if (dbKeys.has(key)) continue;

            const sourceTag = `seed-sim-${seed.tmdbId}`;
            const existing = candidateMap.get(key);
            if (existing) {
              if (!existing.sources.includes(sourceTag)) existing.sources.push(sourceTag);
            } else {
              candidateMap.set(key, { item: sim, sources: [sourceTag] });
            }
          }
        }
      }

      // Process discover language-specific results
      for (const res of discoverResults) {
        if (res.status === 'fulfilled' && res.value?.res?.results) {
          const { lang, res: discoverRes, type } = res.value;
          for (const item of discoverRes.results) {
            if (mediaType && item.mediaType !== mediaType) continue;
            if (!preferredLanguages.includes(item.originalLanguage)) continue;

            const resolved = { ...item, mediaType: type };
            const key = mediaKey(resolved.mediaType, resolved.id);
            if (dbKeys.has(key)) continue;

            const sourceTag = `popular-${lang}`;
            const existing = candidateMap.get(key);
            if (existing) {
              if (!existing.sources.includes(sourceTag)) existing.sources.push(sourceTag);
            } else {
              candidateMap.set(key, { item: resolved, sources: [sourceTag] });
            }
          }
        }
      }

      // Add trending as diversity injection
      if (trendingResult && trendingResult.results) {
        for (const item of trendingResult.results) {
          if (mediaType && item.mediaType !== mediaType) continue;
          if (!preferredLanguages.includes(item.originalLanguage)) continue;

          const key = mediaKey(item.mediaType, item.id);
          if (dbKeys.has(key)) continue;

          const existing = candidateMap.get(key);
          if (existing) {
            if (!existing.sources.includes('trending')) existing.sources.push('trending');
          } else {
            candidateMap.set(key, { item, sources: ['trending'] });
          }
        }
      }

      console.log(`[Personalized Recs] Candidate pool size: ${candidateMap.size}`);

      // Score each candidate
      const scored: RecommendedItem[] = [];

      for (const [, { item, sources }] of candidateMap) {
        let score = 0;
        const reasons: string[] = [];

        // 1. Genre score (Up to 45 points, negative weights allowed)
        const itemGenres = item.genreIds || [];
        const itemGenreTags = new Set<string>();
        for (const gid of itemGenres) {
          for (const tag of getCanonicalGenres(gid)) itemGenreTags.add(tag);
        }

        let genreScoreVal = 0;
        for (const tag of itemGenreTags) {
          genreScoreVal += genreProfile.get(tag) || 0;
        }
        genreScoreVal = Math.max(-30, Math.min(45, genreScoreVal));
        score += genreScoreVal;

        if (genreScoreVal > 10) {
          const bestTag = Array.from(itemGenreTags).sort(
            (a, b) => (genreProfile.get(b) || 0) - (genreProfile.get(a) || 0)
          )[0];
          if (bestTag) reasons.push(`You enjoy ${bestTag}`);
        }

        // 2. Multi-source bonus (0-15)
        if (sources.length > 1) {
          score += Math.min(15, sources.length * 5);
          reasons.push('Multiple matches');
        }

        // 3. Quality score (0-15)
        score += ((item.voteAverage || 0) / 10) * 15;

        // 4. Community interest / Popularity score (0-15)
        const popularityScore = Math.min(15, Math.log10(item.popularity || 1) * 4);
        score += popularityScore;

        // 5. Language score (0-10)
        if (preferredLanguages.includes(item.originalLanguage)) {
          score += 10;
        }

        // 6. Language affinity score (0-15) based on watch frequency
        const langCount = langCounts.get(item.originalLanguage) || 0;
        score += (langCount / maxLangCount) * 15;

        // 7. Recency score (0-10).
        // Decays gently so an acclaimed older title still competes, and
        // unreleased titles don't outrank everything by scoring above 10.
        if (item.releaseDate) {
          const releaseYear = new Date(item.releaseDate).getFullYear();
          if (Number.isFinite(releaseYear)) {
            const currentYear = new Date().getFullYear();
            const age = Math.max(0, currentYear - releaseYear);
            score += Math.max(0, 10 - age * 0.4);
          }
        }

        // 8. Loved director/actor boost (+25 points)
        const hasLovedPerson = sources.some(s => s.startsWith('loved-person-'));
        if (hasLovedPerson) {
          score += 25;
          const lpSource = sources.find(s => s.startsWith('loved-person-'));
          // Source tag is `loved-person-<id>`; the id is everything after the
          // final dash so it survives any future prefix changes.
          const pId = lpSource ? Number(lpSource.slice(lpSource.lastIndexOf('-') + 1)) : 0;
          const pInfo = peopleScores.get(pId);
          if (pInfo) {
            reasons.push(pInfo.role === 'director' ? `Directed by ${pInfo.name}` : `Starring ${pInfo.name}`);
          }
        }

        // 9. Disliked director/actor penalty.
        // Must outweigh the strongest positive signals, otherwise a
        // well-reviewed title from a disliked actor still surfaces.
        if (dislikedMediaSet.has(mediaKey(item.mediaType, item.id))) {
          score -= 60;
        }

        // 10. Stable jitter (0-5) to keep the feed from looking frozen without
        // reshuffling it on every single refresh. Derived from the item id so
        // the same inputs always produce the same ordering.
        score += ((item.id * 2654435761) % 1000) / 200;

        if (reasons.length === 0) {
          if (sources.includes('trending')) {
            reasons.push('Trending now');
          } else if (sources.some(s => s.startsWith('popular-'))) {
            const langCode = sources.find(s => s.startsWith('popular-'))?.split('-')[1] || '';
            const langName = langCode === 'hi' ? 'Hindi' : langCode === 'kn' ? 'Kannada' : langCode === 'ta' ? 'Tamil' : langCode === 'te' ? 'Telugu' : langCode === 'ml' ? 'Malayalam' : '';
            reasons.push(langName ? `Popular in ${langName}` : 'Popular in your languages');
          } else {
            reasons.push('Recommended for you');
          }
        }

        scored.push({
          ...item,
          score: Math.round(score * 10) / 10,
          reason: reasons[0],
        });
      }

      // --- Optional AI re-ranking ---
      // Gemini is used as a re-ranker over the strongest heuristic candidates
      // rather than as a replacement pipeline. Handing it the raw candidate
      // pool would mean ranking an arbitrary slice of hundreds of titles, and
      // returning its output directly would skip language balancing and the
      // franchise/genre diversity rules below.
      const geminiKey = await getPreference('PREF_GEMINI_API_KEY');
      if (geminiKey && scored.length > 0) {
        try {
          const AI_RERANK_POOL = 60;
          const topForAi = [...scored]
            .sort((a, b) => b.score - a.score)
            .slice(0, AI_RERANK_POOL);

          const watchedDetailed = await getWatchedItemsWithDetailedRatings();
          // Top 15 and bottom 10 rated watched items for context efficiency
          const highRated = watchedDetailed.filter((w) => (w.overall_rating ?? 0) >= 7).slice(0, 15);
          const lowRated = watchedDetailed.filter((w) => (w.overall_rating ?? 0) <= 5).slice(0, 10);
          const userProfileSeed = [...highRated, ...lowRated];

          const aiRecs = await this.getAiRecommendations(
            geminiKey,
            userProfileSeed,
            topForAi,
            AI_RERANK_POOL
          );

          if (aiRecs && aiRecs.length > 0) {
            // Blend: the AI judgement dominates, but the heuristic score still
            // contributes so a hallucinated ranking can't fully invert the feed.
            const maxHeuristic = Math.max(...scored.map((s) => s.score), 1);
            const aiByKey = new Map(
              aiRecs.map((r) => [mediaKey(r.mediaType, r.id), r])
            );

            for (const cand of scored) {
              const ai = aiByKey.get(mediaKey(cand.mediaType, cand.id));
              if (!ai) continue;
              const normalisedHeuristic = (cand.score / maxHeuristic) * 100;
              cand.score = ai.score * 0.65 + normalisedHeuristic * 0.35;
              if (ai.reason) cand.reason = ai.reason;
            }
            console.log(`[Personalized Recs] Gemini re-ranked ${aiRecs.length} candidates`);
          }
        } catch (aiErr) {
          console.warn('[Recommendation Engine] AI re-ranking failed, using heuristics:', aiErr);
        }
      }

      // --- Proportional Language Interleaving (Multiplexer) ---
      const candidatesByLang = new Map<string, RecommendedItem[]>();
      for (const cand of scored) {
        if (!candidatesByLang.has(cand.originalLanguage)) {
          candidatesByLang.set(cand.originalLanguage, []);
        }
        candidatesByLang.get(cand.originalLanguage)!.push(cand);
      }

      for (const list of candidatesByLang.values()) {
        list.sort((a, b) => b.score - a.score);
      }

      const targetSlotsMap = new Map<string, number>();
      let totalWeight = 0;
      const langWeights = new Map<string, number>();

      for (const lang of candidatesByLang.keys()) {
        let weight = 0;
        if (settingsLanguages.includes(lang)) {
          weight += 1.0;
        }
        const watchCount = langCounts.get(lang) || 0;
        const watchRatio = watchCount / Math.max(1, watchedCount);
        weight += watchRatio * 2.0;

        if (weight > 0) {
          langWeights.set(lang, weight);
          totalWeight += weight;
        }
      }

      // --- Slot budgeting ---
      // The floor guarantees regional languages a presence, but it is a share
      // of the feed split across the represented languages — not a flat per
      // language quota. A flat quota (the previous behaviour) overspent the
      // budget as soon as more than a handful of languages were selected,
      // which starved the languages the user actually watches most.
      const representedPreferred = settingsLanguages.filter((lang) =>
        candidatesByLang.has(lang)
      );

      // Reserve at most 40% of the feed for floor guarantees so the
      // proportional pass still reflects real watch habits.
      const floorBudget = Math.floor(limit * 0.4);
      const perLanguageFloor = representedPreferred.length > 0
        ? Math.max(1, Math.floor(floorBudget / representedPreferred.length))
        : 0;

      let remainingLimit = limit;

      for (const lang of representedPreferred) {
        const available = candidatesByLang.get(lang)!.length;
        const floorSlots = Math.min(perLanguageFloor, available, remainingLimit);
        targetSlotsMap.set(lang, floorSlots);
        remainingLimit -= floorSlots;
      }

      // Distribute remaining slots proportionally to affinity weight
      if (remainingLimit > 0 && totalWeight > 0) {
        for (const lang of langWeights.keys()) {
          const weight = langWeights.get(lang) || 0;
          const proportional = Math.round((weight / totalWeight) * remainingLimit);
          const current = targetSlotsMap.get(lang) || 0;
          targetSlotsMap.set(lang, current + proportional);
        }
      }

      // Any language with candidates but no target would be unreachable in the
      // ratio pass below; give it a single slot so the filler stage can use it.
      for (const lang of candidatesByLang.keys()) {
        if (!targetSlotsMap.has(lang)) targetSlotsMap.set(lang, 1);
      }

      const FRANCHISE_KEYWORDS = [
        'marvel', 'avengers', 'spider-man', 'batman', 'star wars', 'harry potter', 
        'superhero', 'justice league', 'x-men', 'transformers', 'fast & furious', 'jurassic'
      ];
      function getFranchiseKey(title: string, overview: string): string | null {
        const text = `${title} ${overview}`.toLowerCase();
        for (const kw of FRANCHISE_KEYWORDS) {
          if (text.includes(kw)) {
            return kw;
          }
        }
        return null;
      }

      const finalRecs: RecommendedItem[] = [];
      const currentCounts = new Map<string, number>();
      const franchiseCounts = new Map<string, number>();
      const genreCounts = new Map<string, number>();

      // Candidates are consumed by removal, so the head of each language list
      // is always the next one available.
      for (const lang of candidatesByLang.keys()) {
        currentCounts.set(lang, 0);
      }

      /**
       * Score a candidate as it would appear *right now*, penalising franchises
       * and genres that already crowd the feed. Applied on every pick so the
       * diversity rules hold for quota picks as well as filler picks.
       */
      const effectiveScoreOf = (cand: RecommendedItem): number => {
        let penalty = 0;

        const fk = getFranchiseKey(cand.title, cand.overview || '');
        if (fk && (franchiseCounts.get(fk) || 0) >= 2) penalty += 25;

        for (const gid of cand.genreIds || []) {
          for (const tag of getCanonicalGenres(gid)) {
            penalty += (genreCounts.get(tag) || 0) * 0.5;
          }
        }

        return cand.score - penalty;
      };

      const recordPick = (cand: RecommendedItem) => {
        const fk = getFranchiseKey(cand.title, cand.overview || '');
        if (fk) franchiseCounts.set(fk, (franchiseCounts.get(fk) || 0) + 1);
        for (const gid of cand.genreIds || []) {
          for (const tag of getCanonicalGenres(gid)) {
            genreCounts.set(tag, (genreCounts.get(tag) || 0) + 1);
          }
        }
      };

      /**
       * Pick the best remaining candidate within a language, looking a short
       * way past the pointer so a franchise-capped title doesn't block the
       * whole language. Returns the chosen index, or -1 when exhausted.
       */
      const LOOKAHEAD = 8;
      const pickWithinLang = (lang: string): number => {
        const candidates = candidatesByLang.get(lang)!;
        if (candidates.length === 0) return -1;

        let bestIdx = -1;
        let bestScore = -Infinity;
        const end = Math.min(candidates.length, LOOKAHEAD);
        for (let i = 0; i < end; i++) {
          const s = effectiveScoreOf(candidates[i]);
          if (s > bestScore) {
            bestScore = s;
            bestIdx = i;
          }
        }
        return bestIdx;
      };

      /** Consume `index` from a language, keeping the pointer monotonic. */
      const consume = (lang: string, index: number) => {
        const candidates = candidatesByLang.get(lang)!;
        const [picked] = candidates.splice(index, 1);
        finalRecs.push(picked);
        recordPick(picked);
        return picked;
      };

      while (finalRecs.length < limit) {
        let bestLang: string | null = null;
        let minRatio = Infinity;

        // Choose the next language to pull from based on the most under-represented ratio
        for (const [lang, candidates] of candidatesByLang.entries()) {
          if (candidates.length === 0) continue;

          const target = targetSlotsMap.get(lang) || 0;
          if (target === 0) continue;

          const current = currentCounts.get(lang) || 0;
          if (current >= target) continue;

          const ratio = current / target;
          if (ratio < minRatio) {
            minRatio = ratio;
            bestLang = lang;
          }
        }

        if (bestLang) {
          const idx = pickWithinLang(bestLang);
          if (idx < 0) {
            // Language is exhausted; retarget it so the loop can't spin.
            targetSlotsMap.set(bestLang, 0);
            continue;
          }
          consume(bestLang, idx);
          currentCounts.set(bestLang, (currentCounts.get(bestLang) || 0) + 1);
          continue;
        }

        // Fallback filler: every quota is met, so take the globally best
        // remaining candidate regardless of language.
        let fillerLang: string | null = null;
        let fillerIdx = -1;
        let fillerScore = -Infinity;

        for (const lang of candidatesByLang.keys()) {
          const idx = pickWithinLang(lang);
          if (idx < 0) continue;
          const s = effectiveScoreOf(candidatesByLang.get(lang)![idx]);
          if (s > fillerScore) {
            fillerScore = s;
            fillerLang = lang;
            fillerIdx = idx;
          }
        }

        if (!fillerLang || fillerIdx < 0) break;
        consume(fillerLang, fillerIdx);
      }

      console.log(`[Personalized Recs] Generated ${finalRecs.length} recommendations. Languages present: ${Array.from(new Set(finalRecs.map(r => r.originalLanguage))).join(', ')}`);
      return finalRecs;
    } catch (error) {
      console.warn('Recommendation engine error:', error);
      return this.getRecommendationsForNewUser(limit, mediaType);
    }
  }

  /**
   * Cold start: trending and popular content tailored to user settings languages with multiplexing.
   */
  async getRecommendationsForNewUser(limit: number = 120, mediaType?: MediaType): Promise<RecommendedItem[]> {
    try {
      const langPref = await getPreference('PREF_LANGUAGES');
      const preferredLanguages: string[] = langPref
        ? langPref.split(',')
        : ['en', 'hi', 'kn', 'ta', 'te', 'ko', 'ja'];

      // Even a brand-new user may have a couple of logged or dismissed titles;
      // never recommend something already in their library.
      const libraryKeys = new Set(
        (await getAllItems()).map((i) => mediaKey(i.mediaType, i.tmdbId))
      );

      const trending = await tmdbService.getTrending(mediaType || 'all', 'week');
      const candidates = new Map<string, TMDBMediaItem>();

      for (const item of trending?.results || []) {
        if (mediaType && item.mediaType !== mediaType) continue;
        if (preferredLanguages.includes(item.originalLanguage)) {
          const key = mediaKey(item.mediaType, item.id);
          if (libraryKeys.has(key)) continue;
          candidates.set(key, item);
        }
      }

      // Discover popular items in each of the preferred languages
      const discoverPromises: Promise<any>[] = [];
      for (const lang of preferredLanguages) {
        if (lang === 'en') continue;
        discoverPromises.push(
          tmdbService.discover(mediaType || 'movie', {
            withOriginalLanguage: lang,
            sortBy: 'popularity.desc',
          }).then((res) => ({ res, type: mediaType || 'movie' }))
        );
        if (!mediaType) {
          discoverPromises.push(
            tmdbService.discover('tv', {
              withOriginalLanguage: lang,
              sortBy: 'popularity.desc',
            }).then((res) => ({ res, type: 'tv' }))
          );
        }
      }

      const discoverResults = await Promise.allSettled(discoverPromises);
      for (const res of discoverResults) {
        if (res.status === 'fulfilled' && res.value?.res?.results) {
          const { res: discoverRes, type } = res.value;
          for (const item of discoverRes.results) {
            if (mediaType && item.mediaType !== mediaType) continue;
            if (preferredLanguages.includes(item.originalLanguage)) {
              const resolved = { ...item, mediaType: type };
              const key = mediaKey(resolved.mediaType, resolved.id);
              if (libraryKeys.has(key)) continue;
              if (!candidates.has(key)) {
                candidates.set(key, resolved);
              }
            }
          }
        }
      }

      // Multiplex/interleave cold start candidates by original language
      const candidatesByLang = new Map<string, TMDBMediaItem[]>();
      for (const item of candidates.values()) {
        if (!candidatesByLang.has(item.originalLanguage)) {
          candidatesByLang.set(item.originalLanguage, []);
        }
        candidatesByLang.get(item.originalLanguage)!.push(item);
      }

      for (const list of candidatesByLang.values()) {
        list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      }

      // Split the floor across the languages that actually returned results,
      // rather than granting each one a flat quota that overspends the feed.
      const targetSlotsMap = new Map<string, number>();
      const represented = preferredLanguages.filter((l) => candidatesByLang.has(l));
      const floorBudget = Math.floor(limit * 0.4);
      const perLanguageFloor = represented.length > 0
        ? Math.max(1, Math.floor(floorBudget / represented.length))
        : 0;
      let remainingLimit = limit;

      for (const lang of represented) {
        const available = candidatesByLang.get(lang)!.length;
        const floorSlots = Math.min(perLanguageFloor, available, remainingLimit);
        targetSlotsMap.set(lang, floorSlots);
        remainingLimit -= floorSlots;
      }

      if (remainingLimit > 0 && represented.length > 0) {
        const share = Math.max(1, Math.round(remainingLimit / represented.length));
        for (const lang of represented) {
          const current = targetSlotsMap.get(lang) || 0;
          targetSlotsMap.set(lang, current + share);
        }
      }

      // Languages outside the preference list still hold candidates; give them
      // a slot so the filler stage can reach them.
      for (const lang of candidatesByLang.keys()) {
        if (!targetSlotsMap.has(lang)) targetSlotsMap.set(lang, 1);
      }

      const finalRecs: RecommendedItem[] = [];
      const currentCounts = new Map<string, number>();
      const pointers = new Map<string, number>();

      for (const lang of candidatesByLang.keys()) {
        currentCounts.set(lang, 0);
        pointers.set(lang, 0);
      }

      while (finalRecs.length < limit) {
        let bestLang: string | null = null;
        let minRatio = Infinity;

        for (const [lang, items] of candidatesByLang.entries()) {
          const ptr = pointers.get(lang) || 0;
          if (ptr >= items.length) continue;

          const target = targetSlotsMap.get(lang) || 0;
          if (target === 0) continue;

          const current = currentCounts.get(lang) || 0;
          if (current >= target) continue;

          const ratio = current / target;
          if (ratio < minRatio) {
            minRatio = ratio;
            bestLang = lang;
          }
        }

        if (!bestLang) {
          let bestCandidate: TMDBMediaItem | null = null;
          let bestCandidatePop = -1;
          let bestCandidateLang = '';

          for (const [lang, items] of candidatesByLang.entries()) {
            const ptr = pointers.get(lang) || 0;
            if (ptr < items.length) {
              const item = items[ptr];
              if ((item.popularity || 0) > bestCandidatePop) {
                bestCandidatePop = item.popularity || 0;
                bestCandidate = item;
                bestCandidateLang = lang;
              }
            }
          }

          if (bestCandidate && bestCandidateLang) {
            finalRecs.push({
              ...bestCandidate,
              score: bestCandidate.popularity || 0,
              reason: 'Trending now',
            });
            pointers.set(bestCandidateLang, (pointers.get(bestCandidateLang) || 0) + 1);
          } else {
            break;
          }
        } else {
          const ptr = pointers.get(bestLang) || 0;
          const item = candidatesByLang.get(bestLang)![ptr];
          finalRecs.push({
            ...item,
            score: item.popularity || 0,
            reason: 'Trending now',
          });
          pointers.set(bestLang, ptr + 1);
          currentCounts.set(bestLang, (currentCounts.get(bestLang) || 0) + 1);
        }
      }

      return finalRecs;
    } catch {
      return [];
    }
  }

  /**
   * Get similar content to a specific item.
   */
  async getSimilarToWatched(
    tmdbId: number,
    mediaType: MediaType
  ): Promise<TMDBMediaItem[]> {
    try {
      const similar = await tmdbService.getSimilar(tmdbId, mediaType);
      return similar?.results || [];
    } catch {
      return [];
    }
  }

  private async getAiRecommendations(
    geminiKey: string,
    watchedWithRatings: any[],
    candidates: TMDBMediaItem[],
    limit: number
  ): Promise<RecommendedItem[] | null> {
    try {
      // 1. Build history profile
      const historyProfile = watchedWithRatings.map((w) => ({
        title: w.title,
        mediaType: w.media_type,
        overallRating: w.overall_rating,
        plotRating: w.plot_rating ?? 'N/A',
        actingRating: w.acting_rating ?? 'N/A',
        visualsRating: w.visuals_rating ?? 'N/A',
        soundtrackRating: w.soundtrack_rating ?? 'N/A',
        rewatchability: w.rewatchability ?? 'N/A',
        review: w.review_text ?? ''
      }));

      // 2. Build candidates list. Overviews are truncated because a full pool
      // of them dominates the prompt without adding ranking signal.
      const candidateList = candidates.slice(0, limit).map((c) => ({
        tmdbId: c.id,
        title: c.title,
        mediaType: c.mediaType,
        genres: c.genreIds
          .map((id) => MOVIE_GENRES[id] || TV_GENRES[id] || '')
          .filter(Boolean),
        overview: (c.overview ?? '').slice(0, 300),
      }));

      if (candidateList.length === 0) return [];

      const systemInstruction = 
        "You are an expert movie and TV series recommendation engine. " +
        "You are given a list of movies/shows the user has watched along with their detailed ratings across fields: " +
        "overall rating, plot rating, acting rating, visuals rating, soundtrack rating, and rewatchability, plus short reviews. " +
        "Analyze these detailed ratings to understand what the user values (e.g. high visuals/soundtrack, tight plots, acting performance) and what they dislike. " +
        "Then, score and rank the provided list of candidate movies/shows from 0.0 to 100.0. " +
        "For each recommended candidate, provide a highly personalized, one-liner reason explaining exactly why it matches their specific taste. " +
        "CRITICAL: Keep each reason extremely short, concise, and punchy (strict maximum of 12 words). For example: 'For its intense plot, matching your high rating of Inception.' " +
        "Return the results in structured JSON format matching the schema.";

      const prompt = `
User Watched History and Detailed Ratings:
${JSON.stringify(historyProfile, null, 2)}

Candidate Movies to Rank:
${JSON.stringify(candidateList, null, 2)}
`;

      let response: Response | null = null;
      let attempt = 0;
      const maxAttempts = 3;
      const model = 'gemini-2.0-flash';

      while (attempt < maxAttempts) {
        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: prompt
                      }
                    ]
                  }
                ],
                systemInstruction: {
                  parts: [
                    {
                      text: systemInstruction
                    }
                  ]
                },
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: 'OBJECT',
                    properties: {
                      recommendations: {
                        type: 'ARRAY',
                        items: {
                          type: 'OBJECT',
                          properties: {
                            tmdbId: { type: 'INTEGER' },
                            mediaType: { type: 'STRING' },
                            score: { type: 'NUMBER' },
                            reason: { type: 'STRING' }
                          },
                          required: ['tmdbId', 'mediaType', 'score', 'reason']
                        }
                      }
                    },
                    required: ['recommendations']
                  }
                }
              })
            }
          );

          if (response.ok) {
            break; // Success!
          }

          const status = response.status;
          console.warn(`[Recommendation Engine] Gemini API attempt ${attempt + 1} returned status ${status}`);
          
          if (status === 503 || status === 429 || status === 504 || status >= 500) {
            attempt++;
            if (attempt < maxAttempts) {
              // Wait 1s, then 2s
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
              continue;
            }
          }
          throw new Error(`Gemini API returned status ${status}`);
        } catch (fetchErr) {
          attempt++;
          console.warn(`[Recommendation Engine] Gemini API attempt ${attempt} failed with network error:`, fetchErr);
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          throw fetchErr;
        }
      }

      if (!response || !response.ok) {
        throw new Error(`Gemini API call failed after ${maxAttempts} attempts`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Empty response from Gemini API');
      }

      const result = JSON.parse(text);
      const recsList: {
        tmdbId: number;
        mediaType?: string;
        score: number;
        reason: string;
      }[] = result.recommendations ?? [];

      // Map back to the original candidates. Keyed by media type as well as id
      // because a movie and a series can share a TMDB id.
      const candidatesMap = new Map(
        candidates.map((c) => [mediaKey(c.mediaType, c.id), c])
      );
      const finalRecs: RecommendedItem[] = [];
      const seen = new Set<string>();

      for (const rec of recsList) {
        // Fall back to trying both media types if the model omitted or
        // mislabelled it, so a good ranking isn't discarded over a typo.
        const keys = rec.mediaType
          ? [mediaKey(rec.mediaType, rec.tmdbId)]
          : [mediaKey('movie', rec.tmdbId), mediaKey('tv', rec.tmdbId)];

        for (const key of keys) {
          const item = candidatesMap.get(key);
          if (!item || seen.has(key)) continue;
          seen.add(key);
          finalRecs.push({
            ...item,
            score: Math.max(0, Math.min(100, Number(rec.score) || 0)),
            reason: rec.reason,
          });
          break;
        }
      }

      // Sort by score desc
      return finalRecs.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      console.warn('[Recommendation Engine] Gemini AI recommendations failed:', error);
      return null;
    }
  }

  async getMoodBasedRecommendations(prefs: MoodPreferences): Promise<MoodRecommendationResult[]> {
    const geminiKey = await getPreference('PREF_GEMINI_API_KEY');

    // Gather watch history context for taste-aware recommendations
    const watchedItems = await getAllItems('watched');
    const watchedDetailed = await getWatchedItemsWithDetailedRatings();
    const highRated = watchedDetailed.filter((w) => (w.overall_rating ?? 0) >= 7).slice(0, 10);
    const lowRated = watchedDetailed.filter((w) => (w.overall_rating ?? 0) <= 4).slice(0, 5);
    const userProfile = [...highRated, ...lowRated];

    // Get user's preferred languages
    const langPref = await getPreference('PREF_LANGUAGES');
    const preferredLanguages: string[] = langPref
      ? langPref.split(',')
      : ['en', 'hi', 'kn', 'ta', 'te', 'ko', 'ja'];

    // Personalization Metrics: Top directors & actors
    const [topDirs, topActs] = await Promise.all([
      getTopDirectors(3),
      getTopActors(3),
    ]);

    // Personalization Metrics: Genre affinity
    const genreScore: Record<string, number> = {};
    for (const w of watchedDetailed) {
      // Stored genres are TMDB IDs — resolve them to readable names so the
      // model receives "Thriller", not "53".
      const gNames = parseStoredGenres(w.genres);
      const rating = w.overall_rating ?? 6;
      const weight = rating >= 7 ? 2 : rating <= 4 ? -3 : 0;
      for (const g of gNames) {
        genreScore[g] = (genreScore[g] || 0) + weight;
      }
    }
    const favoriteGenres = Object.entries(genreScore)
      .filter(([_, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => g);

    const dislikedGenres = Object.entries(genreScore)
      .filter(([_, score]) => score < 0)
      .map(([g]) => g);

    if (geminiKey) {
      try {
        return await this.getMoodRecsFromGemini(
          geminiKey,
          prefs,
          userProfile,
          preferredLanguages,
          topDirs,
          topActs,
          favoriteGenres,
          dislikedGenres
        );
      } catch (err) {
        console.warn('[MoodRecs] Gemini failed, falling back to TMDB discover:', err);
      }
    }

    // Fallback: use TMDB discover with heuristic filters
    return this.getMoodRecsFromDiscover(prefs, preferredLanguages, new Set(watchedItems.map(i => i.tmdbId)));
  }

  private async getMoodRecsFromGemini(
    geminiKey: string,
    prefs: MoodPreferences,
    userProfile: any[],
    preferredLanguages: string[],
    topDirs: any[],
    topActs: any[],
    favoriteGenres: string[],
    dislikedGenres: string[],
  ): Promise<MoodRecommendationResult[]> {
    const historyContext = userProfile.map((w) => ({
      title: w.title,
      mediaType: w.media_type,
      overallRating: w.overall_rating,
      plotRating: w.plot_rating ?? 'N/A',
      actingRating: w.acting_rating ?? 'N/A',
      visualsRating: w.visuals_rating ?? 'N/A',
      soundtrackRating: w.soundtrack_rating ?? 'N/A',
      review: w.review_text ?? '',
    }));

    const genreNames = prefs.genres.map((id) => MOVIE_GENRES[id] || TV_GENRES[id] || '').filter(Boolean);

    const vibeLabels: Record<number, string> = {
      1: 'Cozy & Casual (Light/low effort)',
      2: 'Light Entertainment (Easygoing)',
      3: 'Balanced & Engaging (Standard/thoughtful)',
      4: 'Immersive & Thrilling (High focus/exciting)',
      5: 'Deep & Thoughtful (Immersive/philosophical/intense)'
    };
    const vibeLabel = vibeLabels[prefs.vibeIntensity] || `${prefs.vibeIntensity}/5`;

    const systemInstruction =
      "You are an expert movie and TV series recommendation engine. " +
      "Based on the user's current mood, desired vibe intensity, genre preferences, era preference, " +
      "duration preference, and their watch history with ratings, recommend exactly 3 movies or TV shows. " +
      "Each recommendation MUST include the exact TMDB ID (tmdb_id), title, media_type ('movie' or 'tv'), " +
      "release_year, and a short personalized reason (max 15 words) explaining why it fits their current mood. " +
      "Focus on accuracy: the recommendations should genuinely match the stated mood and preferences. " +
      "Prefer titles available in the user's preferred languages: " + preferredLanguages.join(', ') + ". " +
      "IMPORTANT: Align recommendations with the user's tastes (highly favor favorite genres/directors/actors, strictly avoid disliked genres). " +
      "Do NOT recommend titles the user has already watched (shown in their history). " +
      "Return results as structured JSON matching the schema.";

    const prompt = `
Current Mood: ${prefs.mood}
Vibe Intensity: ${prefs.vibeIntensity}/5 (${vibeLabel})
Preferred Genres: ${genreNames.length > 0 ? genreNames.join(', ') : 'Any'}
Media Type: ${prefs.mediaType === 'both' ? 'Movies or TV Shows' : prefs.mediaType === 'movie' ? 'Movies only' : 'TV Shows only'}
Era Preference: ${prefs.era}
Duration Preference: ${prefs.duration}

User Taste Profile (Personalization Metrics):
- Favorite Genres: ${favoriteGenres.join(', ') || 'None recorded yet'}
- Disliked Genres: ${dislikedGenres.join(', ') || 'None recorded yet'}
- Top Directors User Likes: ${topDirs.map((d) => d.personName).join(', ') || 'None'}
- Top Actors User Likes: ${topActs.map((a) => a.personName).join(', ') || 'None'}

User Watch History (Do NOT recommend any of these):
${JSON.stringify(historyContext, null, 2)}
`;

    let response: Response | null = null;
    let attempt = 0;
    const maxAttempts = 3;
    const model = 'gemini-2.0-flash';

    while (attempt < maxAttempts) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              systemInstruction: { parts: [{ text: systemInstruction }] },
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'OBJECT',
                  properties: {
                    recommendations: {
                      type: 'ARRAY',
                      items: {
                        type: 'OBJECT',
                        properties: {
                          tmdb_id: { type: 'INTEGER' },
                          title: { type: 'STRING' },
                          media_type: { type: 'STRING' },
                          release_year: { type: 'INTEGER' },
                          reason: { type: 'STRING' },
                        },
                        required: ['tmdb_id', 'title', 'media_type', 'release_year', 'reason'],
                      },
                    },
                  },
                  required: ['recommendations'],
                },
              },
            }),
          }
        );

        if (response.ok) break;

        const status = response.status;
        console.warn(`[MoodRecs] Gemini attempt ${attempt + 1} returned status ${status}`);
        if (status === 503 || status === 429 || status === 504 || status >= 500) {
          attempt++;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            continue;
          }
        }
        throw new Error(`Gemini API returned status ${status}`);
      } catch (fetchErr) {
        attempt++;
        console.warn(`[MoodRecs] Gemini attempt ${attempt} failed:`, fetchErr);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw fetchErr;
      }
    }

    if (!response || !response.ok) {
      throw new Error(`Gemini API failed after ${maxAttempts} attempts`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');

    const result = JSON.parse(text);
    const recs: { tmdb_id: number; title: string; media_type: string; release_year: number; reason: string }[] =
      result.recommendations ?? [];

    // Enrich each recommendation with full TMDB data
    const enriched: MoodRecommendationResult[] = [];
    for (const rec of recs.slice(0, 3)) {
      try {
        const mediaType: MediaType = rec.media_type === 'tv' ? 'tv' : 'movie';
        const details = await tmdbService.getDetails(rec.tmdb_id, mediaType);
        if (details) {
          enriched.push({
            id: details.id,
            title: details.title,
            overview: details.overview,
            posterPath: details.posterPath,
            backdropPath: details.backdropPath,
            releaseDate: details.releaseDate,
            genreIds: details.genreIds,
            originalLanguage: details.originalLanguage,
            popularity: details.popularity,
            voteAverage: details.voteAverage,
            voteCount: details.voteCount,
            mediaType,
            runtime: details.runtime,
            genres: details.genres,
            reason: rec.reason,
          });
        }
      } catch (detailErr) {
        console.warn(`[MoodRecs] Failed to fetch details for ${rec.title}:`, detailErr);
      }
    }

    return enriched;
  }

  private async getMoodRecsFromDiscover(
    prefs: MoodPreferences,
    preferredLanguages: string[],
    watchedTmdbIds: Set<number>,
  ): Promise<MoodRecommendationResult[]> {
    // Map mood to genres heuristically
    const moodGenreMap: Record<string, number[]> = {
      'Happy': [35, 10751, 16],       // Comedy, Family, Animation
      'Sad': [18, 10749],              // Drama, Romance
      'Intense': [28, 53, 80],         // Action, Thriller, Crime
      'Chill': [35, 16, 10751],        // Comedy, Animation, Family
      'Funny': [35],                    // Comedy
      'Thought-provoking': [18, 99, 9648], // Drama, Documentary, Mystery
      'Scary': [27, 53],               // Horror, Thriller
      'Romantic': [10749, 18],         // Romance, Drama
    };

    const moodGenres = moodGenreMap[prefs.mood] || [];
    const selectedGenres = prefs.genres.length > 0 ? prefs.genres : moodGenres;

    // Build era date filters
    let releaseDateGte: string | undefined;
    let releaseDateLte: string | undefined;
    if (prefs.era.includes('Pre-2000') || prefs.era.includes('Classic')) {
      releaseDateLte = '1999-12-31';
    } else if (prefs.era.includes('2000s') || prefs.era.includes('2000 - 2010')) {
      releaseDateGte = '2000-01-01';
      releaseDateLte = '2009-12-31';
    } else if (prefs.era.includes('2010s') || prefs.era.includes('2010 - 2020')) {
      releaseDateGte = '2010-01-01';
      releaseDateLte = '2019-12-31';
    } else if (prefs.era.includes('2020+')) {
      releaseDateGte = '2020-01-01';
    }

    const mediaTypes: MediaType[] =
      prefs.mediaType === 'both' ? ['movie', 'tv'] :
      [prefs.mediaType as MediaType];

    const candidates: MoodRecommendationResult[] = [];
    const lang = preferredLanguages[0] || 'en';

    for (const mt of mediaTypes) {
      try {
        const res = await tmdbService.discover(mt, {
          genres: selectedGenres.join(','),
          withOriginalLanguage: lang,
          sortBy: 'vote_average.desc',
          voteAverageGte: 6.5,
          releaseDateGte,
          releaseDateLte,
        });

        for (const item of res.results) {
          if (!watchedTmdbIds.has(item.id)) {
            candidates.push({
              ...item,
              reason: `Matches your ${prefs.mood.toLowerCase()} mood`,
            });
          }
        }
      } catch {}
    }

    // Shuffle and pick top 3
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  }

  async getAiTasteMatchInsight(
    geminiKey: string,
    tmdbId: number,
    mediaType: MediaType,
    title: string,
    overview: string,
    genres: string
  ): Promise<{ matchScore: number; reason: string } | null> {
    try {
      // Gather user profile ratings
      const watchedDetailed = await getWatchedItemsWithDetailedRatings();
      const highRated = watchedDetailed.filter((w) => (w.overall_rating ?? 0) >= 7).slice(0, 15);
      const lowRated = watchedDetailed.filter((w) => (w.overall_rating ?? 0) <= 4).slice(0, 8);
      const userProfile = [...highRated, ...lowRated];

      const [topDirs, topActs] = await Promise.all([
        getTopDirectors(3),
        getTopActors(3),
      ]);

      const genreScore: Record<string, number> = {};
      for (const w of watchedDetailed) {
        // Stored genres are TMDB IDs — resolve them to readable names.
        const gNames = parseStoredGenres(w.genres);
        const rating = w.overall_rating ?? 6;
        const weight = rating >= 7 ? 2 : rating <= 4 ? -3 : 0;
        for (const g of gNames) {
          genreScore[g] = (genreScore[g] || 0) + weight;
        }
      }
      const favoriteGenres = Object.entries(genreScore)
        .filter(([_, score]) => score > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([g]) => g);

      const dislikedGenres = Object.entries(genreScore)
        .filter(([_, score]) => score < 0)
        .map(([g]) => g);

      const historyContext = userProfile.map((w) => ({
        title: w.title,
        mediaType: w.media_type,
        overallRating: w.overall_rating,
        review: w.review_text ?? '',
      }));

      const model = 'gemini-2.0-flash';
      const systemInstruction = 
        "You are an expert movie and TV taste matching assistant. " +
        "You compare a specific movie or TV show against a user's taste profile (their watch history, liked/disliked genres, directors, and actors) " +
        "and calculate an AI Taste Match percentage score (integer 0 to 100) and provide a concise, personalized explanation (1-2 sentences, max 25 words) " +
        "highlighting specific aspects of the movie that align or conflict with their preferences. " +
        "Be honest and highly accurate: don't just give high scores; evaluate critically. " +
        "Output standard JSON only matching the schema.";

      const prompt = `
Target Media details:
- Title: ${title}
- Media Type: ${mediaType}
- Overview: ${overview}
- Genres: ${genres}

User Taste Profile:
- Favorite Genres: ${favoriteGenres.join(', ') || 'None recorded yet'}
- Disliked Genres: ${dislikedGenres.join(', ') || 'None recorded yet'}
- Top Directors User Likes: ${topDirs.map((d) => d.personName).join(', ') || 'None'}
- Top Actors User Likes: ${topActs.map((a) => a.personName).join(', ') || 'None'}

User Watch History (with ratings):
${JSON.stringify(historyContext, null, 2)}
`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  matchScore: { type: 'INTEGER' },
                  reason: { type: 'STRING' },
                },
                required: ['matchScore', 'reason'],
              },
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Taste match API returned status ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty taste match response');

      const result = JSON.parse(text);
      return {
        matchScore: Math.max(0, Math.min(100, Number(result.matchScore) || 50)),
        reason: result.reason || 'No explanation provided.',
      };
    } catch (error) {
      console.warn('[Recommendation Engine] Taste match insight failed:', error);
      return null;
    }
  }

  async generateAiReviewAssist(
    geminiKey: string,
    title: string,
    mediaType: MediaType,
    overallRating: number,
    detailRatings: { plot: number | null; acting: number | null; visuals: number | null; soundtrack: number | null; rewatchability: number | null },
    currentText: string
  ): Promise<string | null> {
    try {
      const model = 'gemini-2.0-flash';
      const detailsContext = [];
      if (detailRatings.plot !== null) detailsContext.push(`Plot: ${detailRatings.plot}/5 stars`);
      if (detailRatings.acting !== null) detailsContext.push(`Acting: ${detailRatings.acting}/5 stars`);
      if (detailRatings.visuals !== null) detailsContext.push(`Visuals: ${detailRatings.visuals}/5 stars`);
      if (detailRatings.soundtrack !== null) detailsContext.push(`Soundtrack: ${detailRatings.soundtrack}/5 stars`);
      if (detailRatings.rewatchability !== null) detailsContext.push(`Rewatchability: ${detailRatings.rewatchability}/5 stars`);

      const systemInstruction =
        "You are a helpful AI assistant that helps users draft movie and TV series log thoughts. " +
        "You will be given the media title, the user's rating (out of 10), detailed sub-ratings, and optionally some rough thoughts or a current draft. " +
        "Write a concise, polished one-liner or two-sentence review (strictly under 180 characters) that captures their feelings. " +
        "Avoid clichés and make it read like a genuine personal journal entry. Do not use quotes around the output, return the plain text directly.";

      const prompt = `
Media Title: ${title} (${mediaType})
User Rating: ${overallRating}/10
Detailed Sub-ratings: ${detailsContext.join(', ') || 'None provided'}
User's Draft / Input: ${currentText || 'No current draft'}
`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Review assist API returned status ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty review response');

      return text.trim().replace(/^"|"$/g, '');
    } catch (error) {
      console.warn('[Recommendation Engine] Review assist failed:', error);
      return null;
    }
  }
}

export interface MoodPreferences {
  mood: string;
  vibeIntensity: number;
  genres: number[];
  mediaType: 'movie' | 'tv' | 'both';
  era: string;
  duration: string;
}

export interface MoodRecommendationResult extends TMDBMediaItem {
  reason: string;
  genres?: { id: number; name: string }[];
  runtime?: number | null;
}

export const recommendationService = new RecommendationService();

