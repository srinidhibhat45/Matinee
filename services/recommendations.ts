import { TMDBMediaItem, RecommendedItem, MediaType } from '../types';
import {
  getAllItems,
  getTopDirectors,
  getTopActors,
  getPreference,
  getGenreDistribution,
  getWatchedPeople,
} from './database';
import { tmdbService } from './tmdb';
import { MOVIE_GENRES, TV_GENRES } from '../constants/genres';

class RecommendationService {
  /**
   * Get personalized recommendations combining multiple signals.
   */
  async getPersonalizedRecommendations(limit: number = 60, mediaType?: MediaType): Promise<RecommendedItem[]> {
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

      // Build genre profile based on ratings
      const genreProfile = new Map<string, number>();
      for (const wItem of watchedItems) {
        let genreNames: string[] = [];
        try {
          genreNames = JSON.parse(wItem.genres) || [];
        } catch {
          genreNames = wItem.genres ? wItem.genres.split(',').map(s => s.trim()) : [];
        }

        const r = wItem.userRating;
        let weight = 1.0; // neutral default
        if (r !== null && r !== undefined) {
          if (r >= 8) weight = 3.5;
          else if (r <= 5) weight = -5.0;
          else weight = 1.0;
        }

        for (const gName of genreNames) {
          genreProfile.set(gName, (genreProfile.get(gName) || 0) + weight);
        }
      }

      // Cap individual genre weight to prevent runaways
      for (const [gName, val] of genreProfile.entries()) {
        genreProfile.set(gName, Math.max(-10, Math.min(10, val)));
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

      // DB TMDB IDs for deduplication (excludes watched, watchlist, and not_interested items)
      const allDbItems = await getAllItems();
      const dbTmdbIds = new Set(allDbItems.map((i) => i.tmdbId));

      const candidateMap = new Map<number, { item: TMDBMediaItem; sources: string[] }>();

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

      // Process loved people results (filmography ingestion)
      for (const { person, details } of lovedPeopleResults) {
        if (details && details.combinedCredits) {
          for (const credit of details.combinedCredits) {
            if (mediaType && credit.mediaType !== mediaType) continue;
            if (dbTmdbIds.has(credit.id)) continue;

            const existing = candidateMap.get(credit.id);
            const sourceTag = `loved-person-${person.id}`;
            if (existing) {
              if (!existing.sources.includes(sourceTag)) {
                existing.sources.push(sourceTag);
              }
            } else {
              candidateMap.set(credit.id, {
                item: credit,
                sources: [sourceTag],
              });
            }
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
            if (!dbTmdbIds.has(rec.id)) {
              const existing = candidateMap.get(rec.id);
              if (existing) {
                existing.sources.push(`seed-rec-${seed.tmdbId}`);
              } else {
                candidateMap.set(rec.id, {
                  item: rec,
                  sources: [`seed-rec-${seed.tmdbId}`],
                });
              }
            }
          }
        }

        if (sCast.status === 'fulfilled' && sCast.value?.results) {
          for (const sim of sCast.value.results) {
            if (mediaType && sim.mediaType !== mediaType) continue;
            if (!preferredLanguages.includes(sim.originalLanguage)) continue;
            if (!dbTmdbIds.has(sim.id)) {
              const existing = candidateMap.get(sim.id);
              if (existing) {
                existing.sources.push(`seed-sim-${seed.tmdbId}`);
              } else {
                candidateMap.set(sim.id, {
                  item: sim,
                  sources: [`seed-sim-${seed.tmdbId}`],
                });
              }
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
            if (!dbTmdbIds.has(item.id)) {
              const existing = candidateMap.get(item.id);
              if (existing) {
                if (!existing.sources.includes(`popular-${lang}`)) {
                  existing.sources.push(`popular-${lang}`);
                }
              } else {
                candidateMap.set(item.id, {
                  item: { ...item, mediaType: type },
                  sources: [`popular-${lang}`],
                });
              }
            }
          }
        }
      }

      // Add trending as diversity injection
      if (trendingResult && trendingResult.results) {
        for (const item of trendingResult.results) {
          if (mediaType && item.mediaType !== mediaType) continue;
          if (!preferredLanguages.includes(item.originalLanguage)) continue;
          if (!dbTmdbIds.has(item.id)) {
            const existing = candidateMap.get(item.id);
            if (existing) {
              if (!existing.sources.includes('trending')) {
                existing.sources.push('trending');
              }
            } else {
              candidateMap.set(item.id, {
                item,
                sources: ['trending'],
              });
            }
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
        let genreScoreVal = 0;
        for (const gid of itemGenres) {
          const genreName = MOVIE_GENRES[gid] || TV_GENRES[gid] || '';
          const weight = genreProfile.get(genreName) || 0;
          genreScoreVal += weight;
        }
        genreScoreVal = Math.max(-30, Math.min(45, genreScoreVal));
        score += genreScoreVal;

        if (genreScoreVal > 10) {
          const sortedGenres = [...itemGenres].sort((a, b) => {
            const aName = MOVIE_GENRES[a] || TV_GENRES[a] || '';
            const bName = MOVIE_GENRES[b] || TV_GENRES[b] || '';
            return (genreProfile.get(bName) || 0) - (genreProfile.get(aName) || 0);
          });
          const topGenreId = sortedGenres[0];
          const genreName = MOVIE_GENRES[topGenreId] || TV_GENRES[topGenreId] || '';
          if (genreName) reasons.push(`You enjoy ${genreName}`);
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

        // 7. Recency score (0-10)
        if (item.releaseDate) {
          const releaseYear = new Date(item.releaseDate).getFullYear();
          const currentYear = new Date().getFullYear();
          score += Math.max(0, 10 - (currentYear - releaseYear));
        }

        // 8. Loved director/actor boost (+25 points)
        const hasLovedPerson = sources.some(s => s.startsWith('loved-person-'));
        if (hasLovedPerson) {
          score += 25;
          const lpSource = sources.find(s => s.startsWith('loved-person-'));
          const pId = lpSource ? parseInt(lpSource.split('-')[2], 10) : 0;
          const pInfo = peopleScores.get(pId);
          if (pInfo) {
            reasons.push(pInfo.role === 'director' ? `Directed by ${pInfo.name}` : `Starring ${pInfo.name}`);
          }
        }

        // 9. Disliked director/actor penalty (-40 points)
        if (dislikedMediaSet.has(`${item.mediaType}:${item.id}`)) {
          score -= 40;
        }

        // 10. Diversity bonus (0-5)
        score += Math.random() * 5;

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

      const minFloor = Math.max(5, Math.floor(limit * 0.15)); // 9 slots for 60
      let remainingLimit = limit;

      // First, assign floor slots to preferred languages
      for (const lang of settingsLanguages) {
        if (candidatesByLang.has(lang)) {
          const available = candidatesByLang.get(lang)!.length;
          const floorSlots = Math.min(minFloor, available);
          targetSlotsMap.set(lang, floorSlots);
          remainingLimit -= floorSlots;
        }
      }

      // Distribute remaining slots proportionally
      if (remainingLimit > 0 && totalWeight > 0) {
        for (const lang of langWeights.keys()) {
          const weight = langWeights.get(lang) || 0;
          const proportional = Math.round((weight / totalWeight) * remainingLimit);
          const current = targetSlotsMap.get(lang) || 0;
          targetSlotsMap.set(lang, current + proportional);
        }
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
      const pointers = new Map<string, number>();
      const franchiseCounts = new Map<string, number>();
      const genreCounts = new Map<number, number>();

      for (const lang of candidatesByLang.keys()) {
        currentCounts.set(lang, 0);
        pointers.set(lang, 0);
      }

      while (finalRecs.length < limit) {
        let bestLang: string | null = null;
        let minRatio = Infinity;

        // Choose the next language to pull from based on the most under-represented ratio
        for (const [lang, candidates] of candidatesByLang.entries()) {
          const ptr = pointers.get(lang) || 0;
          if (ptr >= candidates.length) continue;

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
          // Fallback filler: pull from any remaining candidates with the highest effective score
          let bestCandidate: RecommendedItem | null = null;
          let bestCandidateEffectiveScore = -Infinity;
          let bestCandidateLang = '';

          for (const [lang, candidates] of candidatesByLang.entries()) {
            const ptr = pointers.get(lang) || 0;
            if (ptr < candidates.length) {
              const cand = candidates[ptr];
              
              let franchisePenalty = 0;
              const fk = getFranchiseKey(cand.title, cand.overview || '');
              if (fk && (franchiseCounts.get(fk) || 0) >= 2) {
                franchisePenalty = 25;
              }

              let genreCountPenalty = 0;
              for (const gid of cand.genreIds || []) {
                genreCountPenalty += (genreCounts.get(gid) || 0) * 0.5;
              }

              const effectiveScore = cand.score - franchisePenalty - genreCountPenalty;
              if (effectiveScore > bestCandidateEffectiveScore) {
                bestCandidateEffectiveScore = effectiveScore;
                bestCandidate = cand;
                bestCandidateLang = lang;
              }
            }
          }

          if (bestCandidate && bestCandidateLang) {
            finalRecs.push(bestCandidate);
            const ptr = pointers.get(bestCandidateLang) || 0;
            pointers.set(bestCandidateLang, ptr + 1);

            const fk = getFranchiseKey(bestCandidate.title, bestCandidate.overview || '');
            if (fk) {
              franchiseCounts.set(fk, (franchiseCounts.get(fk) || 0) + 1);
            }
            for (const gid of bestCandidate.genreIds || []) {
              genreCounts.set(gid, (genreCounts.get(gid) || 0) + 1);
            }
          } else {
            break;
          }
        } else {
          // Pull from bestLang group
          const ptr = pointers.get(bestLang) || 0;
          const cand = candidatesByLang.get(bestLang)![ptr];

          finalRecs.push(cand);
          pointers.set(bestLang, ptr + 1);
          currentCounts.set(bestLang, (currentCounts.get(bestLang) || 0) + 1);

          const fk = getFranchiseKey(cand.title, cand.overview || '');
          if (fk) {
            franchiseCounts.set(fk, (franchiseCounts.get(fk) || 0) + 1);
          }
          for (const gid of cand.genreIds || []) {
            genreCounts.set(gid, (genreCounts.get(gid) || 0) + 1);
          }
        }
      }

      console.log(`[Personalized Recs] Generated ${finalRecs.length} recommendations. Languages present: ${Array.from(new Set(finalRecs.map(r => r.originalLanguage))).join(', ')}`);
      return finalRecs;
    } catch (error) {
      console.error('Recommendation engine error:', error);
      return this.getRecommendationsForNewUser(limit, mediaType);
    }
  }

  /**
   * Cold start: trending and popular content tailored to user settings languages with multiplexing.
   */
  async getRecommendationsForNewUser(limit: number = 60, mediaType?: MediaType): Promise<RecommendedItem[]> {
    try {
      const langPref = await getPreference('PREF_LANGUAGES');
      const preferredLanguages: string[] = langPref
        ? langPref.split(',')
        : ['en', 'hi', 'kn', 'ta', 'te', 'ko', 'ja'];

      const trending = await tmdbService.getTrending(mediaType || 'all', 'week');
      const candidates = new Map<number, TMDBMediaItem>();

      for (const item of trending?.results || []) {
        if (mediaType && item.mediaType !== mediaType) continue;
        if (preferredLanguages.includes(item.originalLanguage)) {
          candidates.set(item.id, item);
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
              if (!candidates.has(item.id)) {
                candidates.set(item.id, { ...item, mediaType: type });
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

      const targetSlotsMap = new Map<string, number>();
      const minFloor = Math.max(5, Math.floor(limit * 0.15));
      let remainingLimit = limit;

      for (const lang of preferredLanguages) {
        if (candidatesByLang.has(lang)) {
          const available = candidatesByLang.get(lang)!.length;
          const floorSlots = Math.min(minFloor, available);
          targetSlotsMap.set(lang, floorSlots);
          remainingLimit -= floorSlots;
        }
      }

      if (remainingLimit > 0 && preferredLanguages.length > 0) {
        const share = Math.round(remainingLimit / preferredLanguages.length);
        for (const lang of preferredLanguages) {
          const current = targetSlotsMap.get(lang) || 0;
          targetSlotsMap.set(lang, current + share);
        }
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
}

export const recommendationService = new RecommendationService();

