// ============================================================
// Matinee — Library enrichment
//
// Backfills the two facts the statistics and the recommendation
// engine depend on but that the app never reliably recorded:
// how long a title actually is, and who made it.
// ============================================================

import {
  getItemsNeedingEnrichment,
  countItemsNeedingEnrichment,
  updateItem,
  saveDirectorsActors,
  deriveTotalRuntime,
} from './database';
import { tmdbService, limitConcurrency } from './tmdb';
import type { TMDBMediaDetails, WatchedItem } from '../types';

/**
 * Titles enriched per pass.
 *
 * Each one is a details request, so this is a deliberate ceiling on how much
 * network a single visit to the stats screen may spend. A large library is
 * filled in over several visits rather than in one long stall, and every
 * result is written as it arrives, so an interrupted pass still makes
 * progress.
 */
const BATCH_SIZE = 24;

/** Parallel detail requests. Matches the ceiling used elsewhere in the app. */
const CONCURRENCY = 5;

/**
 * Last-resort episode length, in minutes, for a series whose length cannot be
 * established any other way.
 *
 * Only reached when TMDB publishes no `episode_run_time` *and* the season
 * sample below comes back without runtimes. Counting such a series as zero is
 * the worse error — it silently drops a whole show from the total and the user
 * sees a figure they know is too low with no clue why.
 */
const ASSUMED_EPISODE_MINUTES = 42;

/**
 * Episodes to sample when estimating a series' episode length.
 *
 * TMDB increasingly leaves `episode_run_time` empty, and the obvious
 * substitutes are both biased: `last_episode_to_air` is usually a finale, and
 * finales run long — for Game of Thrones it reports 80 minutes against a true
 * average nearer 57, which would have inflated that one series by nearly 30
 * hours. Taking the median of a real season is unbiased and costs one extra
 * request per series, once, since the result is stored.
 */
const RUNTIME_SAMPLE_MIN_EPISODES = 3;

export interface EnrichmentResult {
  /** Titles successfully updated in this pass. */
  enriched: number;
  /** Titles still missing data afterwards, across the whole library. */
  remaining: number;
}

let inFlight: Promise<EnrichmentResult> | null = null;

/**
 * Fill in missing runtimes and cast/crew for watched titles.
 *
 * Safe to call on every stats or profile visit: it only touches rows that are
 * actually incomplete, it is capped per pass, and concurrent callers share one
 * run rather than starting competing batches.
 */
export async function enrichLibrary(): Promise<EnrichmentResult> {
  if (inFlight) return inFlight;

  inFlight = runEnrichment().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runEnrichment(): Promise<EnrichmentResult> {
  let enriched = 0;

  try {
    const pending = await getItemsNeedingEnrichment(BATCH_SIZE);
    if (pending.length === 0) {
      return { enriched: 0, remaining: 0 };
    }

    await limitConcurrency(pending, CONCURRENCY, async (item) => {
      try {
        const applied = await enrichItem(item);
        if (applied) enriched += 1;
      } catch (err) {
        // One unreachable title must not abandon the rest of the batch.
        console.warn(`[Enrichment] Skipped "${item.title}":`, err);
      }
    });

    const remaining = await countItemsNeedingEnrichment();
    if (enriched > 0) {
      console.log(`[Enrichment] Filled in ${enriched} title(s); ${remaining} left.`);
    }
    return { enriched, remaining };
  } catch (err) {
    console.warn('[Enrichment] Pass failed:', err);
    return { enriched, remaining: 0 };
  }
}

async function enrichItem(item: WatchedItem): Promise<boolean> {
  const details = await tmdbService.getDetails(item.tmdbId, item.mediaType);
  if (!details) return false;

  // ── Length ──
  const episodeRuntime =
    item.mediaType === 'movie'
      ? (details.runtime && details.runtime > 0 ? details.runtime : null)
      : await resolveEpisodeRuntime(item.tmdbId, details);

  const episodeCount =
    item.mediaType === 'tv' ? (details.numberOfEpisodes ?? null) : null;
  const seasonCount =
    item.mediaType === 'tv' ? (details.numberOfSeasons ?? null) : null;

  const totalRuntime = deriveTotalRuntime({
    mediaType: item.mediaType,
    runtime: episodeRuntime,
    episodeCount,
  });

  const updates: Parameters<typeof updateItem>[1] = {};
  if (episodeRuntime && episodeRuntime !== item.runtime) updates.runtime = episodeRuntime;
  if (episodeCount !== null) updates.episodeCount = episodeCount;
  if (seasonCount !== null) updates.seasonCount = seasonCount;
  if (totalRuntime) updates.totalRuntime = totalRuntime;
  if (!item.certification && details.certification) {
    updates.certification = details.certification;
  }

  if (Object.keys(updates).length > 0) {
    await updateItem(item.id, updates);
  }

  // ── People ──
  const people = extractPeople(item.id, details);
  if (people.length > 0) {
    await saveDirectorsActors(item.id, people);
  }

  return Object.keys(updates).length > 0 || people.length > 0;
}

/**
 * How long one episode of a series runs.
 *
 * Prefers what TMDB states, then the median of a real season, then the
 * constant above. The median matters: a premiere or a finale is routinely half
 * again as long as a normal episode, so any single-episode sample skews the
 * whole series' total.
 */
async function resolveEpisodeRuntime(
  tmdbId: number,
  details: TMDBMediaDetails,
): Promise<number> {
  if (details.episodeRunTimeMinutes && details.episodeRunTimeMinutes > 0) {
    return details.episodeRunTimeMinutes;
  }

  // Skip specials (season 0) and near-empty seasons, which are rarely typical.
  const sampleSeason = (details.seasons ?? [])
    .filter((s) => s.season_number > 0 && s.episode_count >= RUNTIME_SAMPLE_MIN_EPISODES)
    .sort((a, b) => a.season_number - b.season_number)[0];

  if (sampleSeason) {
    try {
      const season = await tmdbService.getTVSeason(tmdbId, sampleSeason.season_number);
      const runtimes: number[] = (season?.episodes ?? [])
        .map((e: any) => e?.runtime)
        .filter((r: unknown): r is number => typeof r === 'number' && r > 0)
        .sort((a: number, b: number) => a - b);

      if (runtimes.length > 0) {
        return runtimes[Math.floor(runtimes.length / 2)];
      }
    } catch (err) {
      console.warn(`[Enrichment] Season sample failed for ${tmdbId}:`, err);
    }
  }

  // `runtime` here is already TMDB's own last/next-episode fallback.
  if (details.runtime && details.runtime > 0) return details.runtime;
  return ASSUMED_EPISODE_MINUTES;
}

/**
 * The directors and headline cast to credit a title with.
 *
 * A film's director is a crew member with the job "Director". A series usually
 * has no such credit at the series level — its equivalent is its creator, in
 * TMDB's `created_by`, which `getDetails` has already folded into `director`.
 * Only looking for the crew job is why series contributed no directors at all,
 * and why the top-directors list was drawn from films alone.
 */
export function extractPeople(
  itemId: number,
  details: TMDBMediaDetails | null,
): {
  itemId: number;
  personId: number;
  personName: string;
  role: 'director' | 'actor';
  profilePath: string | null;
}[] {
  if (!details) return [];

  const directors = (details.crew ?? [])
    .filter((c) => c.job === 'Director')
    .map((d) => ({
      itemId,
      personId: d.id,
      personName: d.name,
      role: 'director' as const,
      profilePath: d.profile_path ?? null,
    }));

  // A series' creators stand in when there is no Director credit, which is
  // the normal case for TV. Without this every series contributed nobody to
  // the top-directors list, so the list described the user's films only.
  if (directors.length === 0) {
    for (const creator of details.createdBy ?? []) {
      directors.push({
        itemId,
        personId: creator.id,
        personName: creator.name,
        role: 'director' as const,
        profilePath: creator.profile_path ?? null,
      });
    }
  }

  const cast = (details.cast ?? [])
    .slice(0, TOP_CAST_PER_TITLE)
    .map((a) => ({
      itemId,
      personId: a.id,
      personName: a.name,
      role: 'actor' as const,
      profilePath: a.profile_path ?? null,
    }));

  return [...directors, ...cast];
}

/**
 * How many billed actors count as "being in" a title.
 *
 * Deep enough that a co-lead is not dropped, shallow enough that a background
 * player in twenty films cannot out-rank someone the user genuinely follows.
 */
const TOP_CAST_PER_TITLE = 5;
