import { getSecret, setSecret, removeSecret } from './secrets';
// ============================================================
// Matinee — TMDB API v3 Service
// Comprehensive wrapper with caching, normalization, and
// graceful error handling.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOVIE_GENRES, TV_GENRES } from '../constants/genres';
import {
  getPreference,
  getCache as getSqliteCache,
  setCache as setSqliteCache,
  deleteCache as deleteSqliteCache,
  clearTmdbCache,
} from './database';

import type {
  MediaType,
  TMDBMovie,
  TMDBTVShow,
  TMDBMediaItem,
  TMDBMediaDetails,
  PersonDetails,
  PaginatedResponse,
  DiscoverFilters,
  Genre,
  ImageSize,
  SearchMatchSource,
} from '../types';

// ─── Constants ──────────────────────────────────────────────

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/';

const CACHE_PREFIX = '@matinee_cache:';
const API_KEY_STORAGE = '@matinee_api_key';
const API_PROXY_STORAGE = '@matinee_api_proxy';

const TMDB_HOSTS = [
  'https://api.themoviedb.org/3',
  'https://api.tmdb.org/3',
  'https://tmdb.cub.red/3',
  'https://tmdb-proxy.vercel.app/3',
];

let activeBaseUrl = 'https://api.themoviedb.org/3';

/**
 * Settings memo.
 *
 * The API key, the proxy override and the adult-content flag are read on every
 * single request, and each one is a storage round trip — three of them in
 * front of a search that the user is watching a spinner for. They change only
 * from the Settings screen, so they are held in memory and the whole memo is
 * dropped when anything writes to them.
 */
const settingsMemo: {
  apiKey?: string | null;
  apiProxy?: string | null;
  includeAdult?: boolean;
} = {};

/** Called after any write that the memo above would otherwise go stale on. */
export function invalidateTmdbSettingsCache(): void {
  delete settingsMemo.apiKey;
  delete settingsMemo.apiProxy;
  delete settingsMemo.includeAdult;
}

/**
 * Whether the user has opted into adult results.
 *
 * The Settings toggle wrote this preference but nothing ever read it, so the
 * switch had no effect on any request. Both search and discover now honour it.
 */
async function getIncludeAdult(): Promise<boolean> {
  if (settingsMemo.includeAdult !== undefined) return settingsMemo.includeAdult;
  try {
    settingsMemo.includeAdult = (await getPreference('PREF_ADULT_CONTENT')) === 'true';
  } catch {
    settingsMemo.includeAdult = false;
  }
  return settingsMemo.includeAdult;
}

async function getApiProxy(): Promise<string | null> {
  if (settingsMemo.apiProxy !== undefined) return settingsMemo.apiProxy;
  try {
    const proxy = await AsyncStorage.getItem(API_PROXY_STORAGE);
    settingsMemo.apiProxy = proxy?.trim() || null;
  } catch {
    settingsMemo.apiProxy = null;
  }
  return settingsMemo.apiProxy;
}

/** Cache TTLs in milliseconds */
const CACHE_TTL = {
  list: 30 * 60 * 1000,       // 30 minutes for list endpoints
  details: 24 * 60 * 60 * 1000, // 24 hours for detail endpoints
  genres: 7 * 24 * 60 * 60 * 1000, // 7 days for genre lists
  // Long enough to make retyping, back-navigation and paging feel instant;
  // short enough that a newly added title shows up the same session.
  search: 10 * 60 * 1000, // 10 minutes for search results
};

/**
 * How many titles a single person's filmography may contribute to a search.
 * A prolific actor has hundreds of credits; past this the expansion stops
 * being a helpful shortcut and starts being the whole result list.
 */
const MAX_PERSON_CREDITS = 12;

// ─── Image URL Helper ───────────────────────────────────────

/**
 * Build a full TMDB image URL.
 *
 * @param path  The image path from the API (e.g. `/abc123.jpg`)
 * @param size  One of the TMDB image size tokens
 * @returns     Full URL or `null` if path is falsy
 */
export function getImageUrl(
  path: string | null | undefined,
  size: ImageSize = 'w500',
): string | null {
  if (!path) return null;
  // Route TMDB images via a global Cloudflare-backed proxy to bypass regional ISP/DNS blocks (like Jio) in India.
  const tmdbUrl = `${IMAGE_BASE_URL}${size}${path}`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(tmdbUrl)}`;
}

// ─── Normalization ──────────────────────────────────────────

/**
 * Normalize a raw TMDB movie object into our internal format.
 */
export function normalizeMovie(movie: TMDBMovie): TMDBMediaItem {
  return {
    id: movie.id,
    title: movie.title,
    overview: movie.overview ?? '',
    posterPath: movie.poster_path,
    backdropPath: movie.backdrop_path,
    releaseDate: movie.release_date ?? '',
    genreIds: movie.genre_ids ?? [],
    originalLanguage: movie.original_language ?? '',
    popularity: movie.popularity ?? 0,
    voteAverage: movie.vote_average ?? 0,
    voteCount: movie.vote_count ?? 0,
    mediaType: 'movie',
  };
}

/**
 * Normalize a raw TMDB TV show object into our internal format.
 */
export function normalizeTVShow(show: TMDBTVShow): TMDBMediaItem {
  return {
    id: show.id,
    title: show.name,
    overview: show.overview ?? '',
    posterPath: show.poster_path,
    backdropPath: show.backdrop_path,
    releaseDate: show.first_air_date ?? '',
    genreIds: show.genre_ids ?? [],
    originalLanguage: show.original_language ?? '',
    popularity: show.popularity ?? 0,
    voteAverage: show.vote_average ?? 0,
    voteCount: show.vote_count ?? 0,
    mediaType: 'tv',
  };
}

/**
 * Normalize a mixed result (from trending/multi-search) that may
 * include a `media_type` field.
 */
function normalizeMediaResult(item: any): TMDBMediaItem | null {
  const type = item.media_type ?? (item.title ? 'movie' : item.name ? 'tv' : null);
  if (type === 'movie') return normalizeMovie(item as TMDBMovie);
  if (type === 'tv') return normalizeTVShow(item as TMDBTVShow);
  return null; // skip person results, etc.
}

// ─── Cache Layer ────────────────────────────────────────────

async function getCached<T>(key: string): Promise<T | null> {
  try {
    // 1. Try SQLite cache first
    const cached = await getSqliteCache<T>(key);
    if (cached) return cached;

    // 2. Fallback to AsyncStorage for backward compatibility
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (raw) {
      const entry: { data: T; expiresAt: number } = JSON.parse(raw);
      if (Date.now() <= entry.expiresAt) {
        // Migration: write it into SQLite so future queries are fast
        const ttl = entry.expiresAt - Date.now();
        const ttlMinutes = Math.max(1, Math.round(ttl / 60000));
        await setSqliteCache(key, entry.data, ttlMinutes);
        return entry.data;
      } else {
        await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function setCache<T>(key: string, data: T, ttl: number): Promise<void> {
  try {
    const ttlMinutes = Math.max(1, Math.round(ttl / 60000));
    await setSqliteCache(key, data, ttlMinutes);
  } catch {
    // Non-critical — silently ignore cache write failures
  }
}

/**
 * Invalidate one cached response across both the SQLite cache and the legacy
 * AsyncStorage cache, so a force-refresh actually reaches the network.
 */
async function invalidateCache(key: string): Promise<void> {
  try {
    await deleteSqliteCache(key);
  } catch {
    // Non-critical
  }
  try {
    await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // Non-critical
  }
}

async function clearAllCache(): Promise<void> {
  try {
    await clearTmdbCache();
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    console.warn('[TMDB] Failed to clear cache');
  }
}

/**
 * Run a mapping function over an array of items with a concurrency limit.
 */
export async function limitConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);

    const e: Promise<void> = p.then(() => {
      executing.delete(e);
    });
    executing.add(e);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// ─── Core Fetch ─────────────────────────────────────────────

const DEFAULT_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmYjQ2YzBlNDk0MmM5MGIyZGE3Y2E5M2VkYTNiZDA5OCIsIm5iZiI6MTc4MTUzMjM2NS44MTcsInN1YiI6IjZhMzAwNmNkNzk3MjVmZmQ3MGM3OGNmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.bMzqq3dFpra9u87aeQEDkQ7C1JMaGV-XsotPQmw4YhA';

/**
 * Retrieve the stored TMDB v3 API key or Bearer token.
 * Returns the default token if no key has been configured yet.
 */
async function getApiKey(): Promise<string | null> {
  if (settingsMemo.apiKey !== undefined) return settingsMemo.apiKey;
  try {
    const key = await getSecret(API_KEY_STORAGE);
    settingsMemo.apiKey = key?.trim() || DEFAULT_API_KEY;
  } catch {
    settingsMemo.apiKey = DEFAULT_API_KEY;
  }
  return settingsMemo.apiKey;
}

function isBearerToken(key: string): boolean {
  return key.startsWith('eyJ') || key.startsWith('Bearer ');
}

/**
 * Low-level fetch wrapper with auth, error handling, optional caching,
 * and automatic failover/proxy fallback to bypass DNS/ISP blocks.
 */
async function tmdbFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  cacheKey?: string,
  cacheTtl: number = CACHE_TTL.list,
  rateLimitRetries = 0,
): Promise<T | null> {
  // Check cache first
  if (cacheKey) {
    const cached = await getCached<T>(cacheKey);
    if (cached) return cached;
  }

  // ── Coalesce identical concurrent requests ──
  // The home screen alone asks for the same trending pages from several rails,
  // and the recommendation engine re-requests a popular title's credits once
  // per seed that pointed at it. Without this each duplicate is a separate
  // round trip that lands a moment before the first one populates the cache.
  if (cacheKey) {
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) return inFlight as Promise<T | null>;
  }

  const request = tmdbFetchUncoalesced<T>(path, params, cacheKey, cacheTtl, rateLimitRetries);

  if (cacheKey) {
    inFlightRequests.set(cacheKey, request as Promise<unknown>);
    request.finally(() => {
      // Only clear our own entry — a retry may already have replaced it.
      if (inFlightRequests.get(cacheKey) === (request as Promise<unknown>)) {
        inFlightRequests.delete(cacheKey);
      }
    });
  }

  return request;
}

/** In-flight requests keyed by cache key; see `tmdbFetch`. */
const inFlightRequests = new Map<string, Promise<unknown>>();

/** The actual network path. Callers should go through `tmdbFetch`. */
async function tmdbFetchUncoalesced<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  cacheKey?: string,
  cacheTtl: number = CACHE_TTL.list,
  rateLimitRetries = 0,
): Promise<T | null> {

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn('[TMDB] No API key configured. Please set your TMDB API key in Settings.');
    return null;
  }

  // Build query string, filtering out undefined values
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      query.set(k, String(v));
    }
  }

  const trimmedApiKey = apiKey.trim();
  const useBearerAuth = isBearerToken(trimmedApiKey);
  if (!useBearerAuth) {
    query.set('api_key', trimmedApiKey);
  }

  const separator = query.toString() ? '?' : '';
  const userProxy = await getApiProxy();

  // Construct host lists to try
  const hostsToTry: string[] = [];
  if (userProxy) {
    hostsToTry.push(userProxy);
  }
  if (!hostsToTry.includes(activeBaseUrl)) {
    hostsToTry.push(activeBaseUrl);
  }
  for (const host of TMDB_HOSTS) {
    if (!hostsToTry.includes(host)) {
      hostsToTry.push(host);
    }
  }

  for (let i = 0; i < hostsToTry.length; i++) {
    const currentHost = hostsToTry[i];
    const url = `${currentHost}${path}${separator}${query.toString()}`;

    try {
      // Set a 6-second timeout using AbortController to prevent long hangs on blocked DNS
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...(useBearerAuth
            ? {
                Authorization: trimmedApiKey.startsWith('Bearer ')
                  ? trimmedApiKey
                  : `Bearer ${trimmedApiKey}`,
              }
            : {}),
          'Content-Type': 'application/json;charset=utf-8',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          // Bounded exponential backoff. Retrying unconditionally (the previous
          // behaviour) could recurse forever against a sustained rate limit.
          const MAX_RATE_LIMIT_RETRIES = 3;
          if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
            console.warn('[TMDB] 429 Rate limit persists after retries. Giving up.');
            return null;
          }
          const delay = 1000 * Math.pow(2, rateLimitRetries);
          console.warn(`[TMDB] 429 Rate limit exceeded. Backing off ${delay}ms…`);
          await new Promise((r) => setTimeout(r, delay));
          // Deliberately *not* back through `tmdbFetch`: this call is itself
          // the in-flight entry for this cache key, so re-entering the
          // coalescer would hand us our own unresolved promise to await.
          return tmdbFetchUncoalesced<T>(path, params, cacheKey, cacheTtl, rateLimitRetries + 1);
        }
        if (response.status === 401) {
          console.warn('[TMDB] 401 Unauthorized — check your API Bearer token.');
          return null;
        }
        if (response.status === 404) {
          console.warn(`[TMDB] 404 Not Found on ${currentHost} — ${path}`);
          const isOfficial = currentHost.includes('themoviedb.org') || currentHost.includes('api.tmdb.org');
          if (isOfficial) {
            return null;
          }
          console.warn(`[TMDB] Proxy returned 404. Trying fallback...`);
          continue;
        }
        console.warn(`[TMDB] Host ${currentHost} returned HTTP ${response.status}. Trying fallback...`);
        continue;
      }

      const data = (await response.json()) as T;

      // Update activeBaseUrl so future requests use this working host immediately
      if (activeBaseUrl !== currentHost) {
        console.log(`[TMDB] Switched active base URL to working fallback host: ${currentHost}`);
        activeBaseUrl = currentHost;
      }

      // Write to cache
      if (cacheKey) {
        await setCache(cacheKey, data, cacheTtl);
      }

      return data;
    } catch (error: any) {
      console.warn(`[TMDB] Request failed for host ${currentHost}:`, error.message || error);
      // Continue to next host/mirror
    }
  }

  console.error('[TMDB] All hosts failed to connect. Please verify your network, VPN, or DNS proxy settings.');
  return null;
}

// ─── Search relevance ───────────────────────────────────────

/**
 * Fold a title or query down to a comparable form: lowercase, accents
 * stripped, punctuation dropped, whitespace collapsed. "WALL·E", "Wall-E" and
 * "wall e" all land on `wall e`.
 */
function normaliseForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ranked bands, spaced far enough apart that popularity can never cross one. */
const MATCH_BAND = {
  exact: 1000,
  prefix: 700,
  wordPrefix: 520,
  substring: 380,
  allTokens: 260,
  someTokens: 0,
} as const;

/** How far each expansion is held below a direct title match. */
const SOURCE_PENALTY: Record<SearchMatchSource, number> = {
  title: 0,
  // Both expansions are "related to what you typed" rather than "what you
  // typed", so they sit below every direct match no matter how popular they
  // are — a person's blockbuster must not outrank the film you named.
  genre: MATCH_BAND.exact,
  person: MATCH_BAND.exact,
};

/**
 * Score how well a title answers a query.
 *
 * TMDB's own ordering is popularity-weighted, which is why searching for a
 * specific, quiet film hands back a pile of famous ones first. This re-ranks
 * on what the user actually typed: the match band dominates, and popularity
 * only breaks ties *within* a band. A perfect title match therefore always
 * outranks a partial one, however obscure it is.
 */
export function scoreSearchRelevance(
  item: TMDBMediaItem,
  query: string,
  options: {
    /** The untranslated title, when the API supplied one. */
    originalTitle?: string | null;
    source?: SearchMatchSource;
  } = {},
): number {
  const q = normaliseForMatch(query);
  if (!q) return 0;

  const source = options.source ?? 'title';
  const candidates = [item.title, options.originalTitle]
    .filter((t): t is string => !!t)
    .map(normaliseForMatch);

  const queryTokens = q.split(' ').filter(Boolean);

  let band: number = MATCH_BAND.someTokens;
  for (const name of candidates) {
    if (!name) continue;
    if (name === q) {
      band = Math.max(band, MATCH_BAND.exact);
      continue;
    }
    if (name.startsWith(`${q} `)) {
      band = Math.max(band, MATCH_BAND.prefix);
      continue;
    }
    if (name.includes(` ${q} `) || name.endsWith(` ${q}`)) {
      band = Math.max(band, MATCH_BAND.wordPrefix);
      continue;
    }
    if (name.includes(q)) {
      band = Math.max(band, MATCH_BAND.substring);
      continue;
    }
    const nameTokens = name.split(' ').filter(Boolean);
    const hits = queryTokens.filter((t) =>
      nameTokens.some((n) => n.startsWith(t))
    ).length;
    if (hits === queryTokens.length && hits > 0) {
      band = Math.max(band, MATCH_BAND.allTokens);
    } else if (hits > 0) {
      // Partial token overlap, scaled by how much of the query was covered.
      band = Math.max(band, Math.round((hits / queryTokens.length) * 200));
    }
  }

  // Shorter titles are the better answer for the same band: typing "dune"
  // should reach "Dune" before "Dune: Part Two — Behind the Scenes".
  const shortestName = candidates.reduce(
    (best, name) => (name && name.length < best ? name.length : best),
    Number.MAX_SAFE_INTEGER,
  );
  const lengthBonus =
    shortestName === Number.MAX_SAFE_INTEGER
      ? 0
      : Math.max(0, 30 - Math.max(0, shortestName - q.length) * 0.6);

  // Tie-breakers, deliberately capped well under one band's width.
  const popularity = Math.min(60, Math.log10((item.popularity || 0) + 1) * 22);
  const acclaim = (item.voteAverage || 0) * 2;
  // Vote count separates a real release from a stub sharing its name.
  const corroboration = Math.min(30, Math.log10((item.voteCount || 0) + 1) * 9);
  // A title with no poster is almost always a fragment record.
  const completeness = item.posterPath ? 12 : 0;

  return (
    band -
    SOURCE_PENALTY[source] +
    lengthBonus +
    popularity +
    acclaim +
    corroboration +
    completeness
  );
}

// ─── Paginated helper ───────────────────────────────────────

interface RawPage {
  page: number;
  results: any[];
  total_pages: number;
  total_results: number;
}

function toPaginated(
  raw: RawPage | null,
  normalizer: (item: any) => TMDBMediaItem | null,
): PaginatedResponse<TMDBMediaItem> {
  if (!raw) {
    return { page: 1, results: [], totalPages: 0, totalResults: 0 };
  }
  return {
    page: raw.page,
    results: (raw.results ?? [])
      .map(normalizer)
      .filter((r): r is TMDBMediaItem => r !== null),
    totalPages: raw.total_pages,
    totalResults: raw.total_results,
  };
}

function mapToIndianCertification(cert: string): string {
  if (!cert) return '';
  const clean = cert.toUpperCase().trim();
  
  // Universal
  if (['G', 'TV-G', 'TV-Y', 'U', 'AL', '0', '6', 'APPROVED', 'PASSED'].includes(clean)) {
    return 'U';
  }
  
  // Adults Only
  if (['R', 'NC-17', 'TV-MA', '18', 'A', '16'].includes(clean)) {
    return 'A';
  }
  
  // Parental Guidance
  if (['PG', 'PG-13', 'TV-PG', 'TV-14', '12A', '12', '15', 'UA', '14', '13'].includes(clean) || clean.includes('12') || clean.includes('13') || clean.includes('14') || clean.includes('15') || clean.includes('PG')) {
    return 'UA';
  }
  
  return cert;
}

function extractCertification(raw: any, mediaType: MediaType): string | null {
  if (mediaType === 'movie') {
    const releaseDatesResults = raw.release_dates?.results ?? [];
    
    // 1. Try to find Indian certification ('IN')
    const indiaRelease = releaseDatesResults.find((r: any) => r.iso_3166_1 === 'IN');
    if (indiaRelease) {
      const dates = indiaRelease.release_dates ?? [];
      const certObj = dates.find((d: any) => d.certification && d.certification.trim() !== '');
      if (certObj) {
        return certObj.certification;
      }
    }

    // 2. Try to find US certification as fallback
    const usRelease = releaseDatesResults.find((r: any) => r.iso_3166_1 === 'US');
    if (usRelease) {
      const dates = usRelease.release_dates ?? [];
      const certObj = dates.find((d: any) => d.certification && d.certification.trim() !== '');
      if (certObj) {
        return mapToIndianCertification(certObj.certification);
      }
    }

    // 3. Fallback to any available certification
    for (const r of releaseDatesResults) {
      const dates = r.release_dates ?? [];
      const certObj = dates.find((d: any) => d.certification && d.certification.trim() !== '');
      if (certObj) {
        return mapToIndianCertification(certObj.certification);
      }
    }
  } else {
    const contentRatingsResults = raw.content_ratings?.results ?? [];
    
    // 1. Try to find Indian rating ('IN')
    const indiaRating = contentRatingsResults.find((r: any) => r.iso_3166_1 === 'IN');
    if (indiaRating && indiaRating.rating) {
      return indiaRating.rating;
    }

    // 2. Try to find US rating as fallback
    const usRating = contentRatingsResults.find((r: any) => r.iso_3166_1 === 'US');
    if (usRating && usRating.rating) {
      return mapToIndianCertification(usRating.rating);
    }

    // 3. Fallback to first available
    if (contentRatingsResults.length > 0) {
      const fallback = contentRatingsResults.find((r: any) => r.rating);
      if (fallback) {
        return mapToIndianCertification(fallback.rating);
      }
    }
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────

export const tmdbService = {
  // ── Configuration ───────────────────────────────────────

  /**
   * Save the TMDB v3 API key or Bearer token for future requests.
   */
  async setApiKey(key: string): Promise<void> {
    await setSecret(API_KEY_STORAGE, key.trim());
    invalidateTmdbSettingsCache();
  },

  /**
   * Check if an API key has been configured.
   */
  async hasApiKey(): Promise<boolean> {
    const key = await getApiKey();
    return !!key;
  },

  /**
   * Get the stored API key.
   */
  getApiKey,

  /**
   * Remove the stored API key.
   */
  async removeApiKey(): Promise<void> {
    await removeSecret(API_KEY_STORAGE);
    invalidateTmdbSettingsCache();
  },

  /**
   * Save a custom TMDB API proxy or mirror base URL.
   */
  async setProxy(proxy: string): Promise<void> {
    const trimmed = proxy.trim();
    if (trimmed) {
      let formatted = trimmed;
      if (formatted.endsWith('/')) {
        formatted = formatted.slice(0, -1);
      }
      await AsyncStorage.setItem(API_PROXY_STORAGE, formatted);
    } else {
      await AsyncStorage.removeItem(API_PROXY_STORAGE);
    }
    invalidateTmdbSettingsCache();
  },

  /**
   * Get the stored custom proxy base URL.
   */
  async getProxy(): Promise<string | null> {
    return getApiProxy();
  },

  /**
   * Remove the stored custom proxy base URL.
   */
  async removeProxy(): Promise<void> {
    await AsyncStorage.removeItem(API_PROXY_STORAGE);
    invalidateTmdbSettingsCache();
  },

  /**
   * Clear the entire response cache.
   */
  clearCache: clearAllCache,

  // ── Lists ───────────────────────────────────────────────

  /**
   * Get upcoming movies.
   */
  async getUpcoming(
    page = 1,
    language = 'en-US',
    region?: string,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `upcoming:${page}:${language}:${region ?? ''}`;
    const raw = await tmdbFetch<RawPage>(
      '/movie/upcoming',
      { page, language, region },
      cacheKey,
    );
    return toPaginated(raw, normalizeMovie);
  },

  /**
   * Get movies currently in theatres.
   */
  async getNowPlaying(page = 1): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `now_playing:${page}`;
    const raw = await tmdbFetch<RawPage>(
      '/movie/now_playing',
      { page },
      cacheKey,
    );
    return toPaginated(raw, normalizeMovie);
  },

  /**
   * Get trending movies, TV, or both.
   */
  async getTrending(
    mediaType: 'movie' | 'tv' | 'all' = 'all',
    timeWindow: 'day' | 'week' = 'week',
    page: number = 1,
    forceRefresh = false,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `trending:${mediaType}:${timeWindow}:${page}`;
    if (forceRefresh) await invalidateCache(cacheKey);
    const raw = await tmdbFetch<RawPage>(
      `/trending/${mediaType}/${timeWindow}`,
      { page: String(page) },
      cacheKey,
    );
    const normalizer =
      mediaType === 'movie'
        ? normalizeMovie
        : mediaType === 'tv'
          ? normalizeTVShow
          : normalizeMediaResult;
    return toPaginated(raw, normalizer);
  },

  /**
   * Get popular movies or TV shows.
   */
  async getPopular(
    mediaType: MediaType = 'movie',
    page = 1,
    forceRefresh = false,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `popular:${mediaType}:${page}`;
    if (forceRefresh) await invalidateCache(cacheKey);
    const endpoint = mediaType === 'movie' ? '/movie/popular' : '/tv/popular';
    const raw = await tmdbFetch<RawPage>(endpoint, { page }, cacheKey);
    return toPaginated(raw, mediaType === 'movie' ? normalizeMovie : normalizeTVShow);
  },

  /**
   * Get top-rated movies or TV shows.
   */
  async getTopRated(
    mediaType: MediaType = 'movie',
    page = 1,
    forceRefresh = false,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `top_rated:${mediaType}:${page}`;
    if (forceRefresh) await invalidateCache(cacheKey);
    const endpoint =
      mediaType === 'movie' ? '/movie/top_rated' : '/tv/top_rated';
    const raw = await tmdbFetch<RawPage>(endpoint, { page }, cacheKey);
    return toPaginated(raw, mediaType === 'movie' ? normalizeMovie : normalizeTVShow);
  },

  /**
   * Get TV shows airing this week.
   */
  async getTVAiringThisWeek(page = 1): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `tv_on_the_air:${page}`;
    const raw = await tmdbFetch<RawPage>('/tv/on_the_air', { page }, cacheKey);
    return toPaginated(raw, normalizeTVShow);
  },

  // ── Details ─────────────────────────────────────────────

  /**
   * Get full details for a movie or TV show, including credits,
   * recommendations, similar, keywords, videos, and watch providers.
   */
  async getDetails(
    id: number,
    mediaType: MediaType,
    forceRefresh = false,
  ): Promise<TMDBMediaDetails | null> {
    const cacheKey = `details:${mediaType}:${id}`;
    if (forceRefresh) {
      await invalidateCache(cacheKey);
    }
    const endpoint = mediaType === 'movie' ? `/movie/${id}` : `/tv/${id}`;
    
    const appendParts = [
      'credits',
      'recommendations',
      'similar',
      'keywords',
      'videos',
      'watch/providers'
    ];
    if (mediaType === 'movie') {
      appendParts.push('release_dates');
    } else {
      appendParts.push('content_ratings');
    }

    const raw = await tmdbFetch<any>(
      endpoint,
      { append_to_response: appendParts.join(',') },
      cacheKey,
      CACHE_TTL.details,
    );

    if (!raw) return null;

    const cast = (raw.credits?.cast ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      character: c.character ?? c.roles?.[0]?.character ?? '',
      profile_path: c.profile_path,
      order: c.order ?? 999,
    }));

    const crew = (raw.credits?.crew ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      job: c.job ?? '',
      department: c.department ?? '',
      profile_path: c.profile_path,
    }));

    const createdBy = (raw.created_by ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      profile_path: c.profile_path ?? null,
    }));

    const director =
      crew.find((c: any) => c.job === 'Director')?.name ??
      (createdBy[0]?.name ?? null);

    // Watch providers — pull user's preferred country, fallback to US/IN/first available
    const providerData = raw['watch/providers']?.results;
    let watchProviders = null;
    if (providerData) {
      const userCountry = (await getPreference('PREF_USER_COUNTRY')) || 'IN';
      watchProviders = providerData[userCountry] ?? null;
    }

    // Normalize recommendations and similar
    const normalizer = mediaType === 'movie' ? normalizeMovie : normalizeTVShow;
    const recommendations = (raw.recommendations?.results ?? []).map(normalizer);
    const similar = (raw.similar?.results ?? []).map(normalizer);

    // Keywords — movies use `keywords.keywords`, TV uses `keywords.results`
    const keywordList =
      raw.keywords?.keywords ?? raw.keywords?.results ?? [];

    return {
      id: raw.id,
      title: mediaType === 'movie' ? raw.title : raw.name,
      originalTitle: mediaType === 'movie' ? raw.original_title : raw.original_name,
      overview: raw.overview ?? '',
      posterPath: raw.poster_path,
      backdropPath: raw.backdrop_path,
      mediaType,
      releaseDate: mediaType === 'movie' ? (raw.release_date ?? '') : (raw.first_air_date ?? ''),
      voteAverage: raw.vote_average ?? 0,
      voteCount: raw.vote_count ?? 0,
      popularity: raw.popularity ?? 0,
      genreIds: (raw.genres ?? []).map((g: any) => g.id),
      originalLanguage: raw.original_language ?? '',
      adult: raw.adult ?? false,
      genres: raw.genres ?? [],
      // For a series this is one episode's length, not the whole run — see
      // `deriveTotalRuntime` in services/database.ts for the total.
      //
      // TMDB increasingly returns an empty `episode_run_time` for streaming
      // series (Game of Thrones among them), which used to leave the runtime
      // null and drop the whole show out of watch-time statistics. The most
      // recent episode's own runtime is a far better estimate than any
      // constant, so it stands in when the series-level array is empty.
      runtime:
        mediaType === 'movie'
          ? (raw.runtime ?? null)
          : (raw.episode_run_time?.[0] ??
             raw.last_episode_to_air?.runtime ??
             raw.next_episode_to_air?.runtime ??
             null),
      episodeRunTimeMinutes:
        mediaType === 'movie' ? null : (raw.episode_run_time?.[0] ?? null),
      numberOfSeasons: raw.number_of_seasons ?? null,
      numberOfEpisodes: raw.number_of_episodes ?? null,
      status: raw.status ?? '',
      tagline: raw.tagline ?? '',
      budget: raw.budget ?? null,
      revenue: raw.revenue ?? null,
      homepage: raw.homepage ?? null,
      imdbId: raw.imdb_id ?? null,
      productionCompanies: (raw.production_companies ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        logo_path: c.logo_path,
      })),
      cast,
      crew,
      director,
      createdBy,
      recommendations,
      similar,
      keywords: keywordList,
      videos: (raw.videos?.results ?? []).map((v: any) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        site: v.site,
        size: v.size ?? 0,
        type: v.type,
        official: v.official ?? false,
        published_at: v.published_at ?? '',
      })),
      watchProviders,
      seasons: raw.seasons ?? [],
      certification: extractCertification(raw, mediaType),
      nextEpisodeToAir: raw.next_episode_to_air
        ? {
            id: raw.next_episode_to_air.id,
            name: raw.next_episode_to_air.name,
            air_date: raw.next_episode_to_air.air_date,
            episode_number: raw.next_episode_to_air.episode_number,
            season_number: raw.next_episode_to_air.season_number,
          }
        : null,
    };
  },

  // ── Search ──────────────────────────────────────────────

  /**
   * Search across movies, TV, or both (multi).
   *
   * Results come back ranked by how well they answer the query, not by how
   * famous they are — see `scoreSearchRelevance`. The genre-name and
   * filmography expansions are layered underneath the direct matches so they
   * can enrich a search without ever displacing the title you named.
   */
  async search(
    query: string,
    mediaType?: MediaType,
    page = 1,
    includeAdult?: boolean,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    if (!query.trim()) {
      return { page: 1, results: [], totalPages: 0, totalResults: 0 };
    }

    const allowAdult = includeAdult ?? (await getIncludeAdult());
    const trimmed = query.trim();
    const trimmedQuery = trimmed.toLowerCase();

    // Expansions are one-off enrichments of the *first* page. Re-running them
    // for every page (as an earlier version did) meant page 2 returned the
    // same extra titles as page 1, so scrolling produced duplicates and
    // pagination effectively stalled.
    const isFirstPage = page <= 1;

    let endpoint: string;
    let normalizer: (item: any) => TMDBMediaItem | null;

    if (mediaType === 'movie') {
      endpoint = '/search/movie';
      normalizer = normalizeMovie;
    } else if (mediaType === 'tv') {
      endpoint = '/search/tv';
      normalizer = normalizeTVShow;
    } else {
      endpoint = '/search/multi';
      normalizer = normalizeMediaResult;
    }

    // ── Genre-name query expansion ──
    // Kicked off in parallel with the search itself. Awaiting it first (the
    // previous behaviour) added a whole round trip to the front of *every*
    // query, including the overwhelming majority that name no genre at all.
    const allGenres = { ...MOVIE_GENRES, ...TV_GENRES };
    const matchingGenreEntry = Object.entries(allGenres).find(
      ([, name]) => name.toLowerCase() === trimmedQuery
    );

    const genrePromise: Promise<TMDBMediaItem[]> =
      matchingGenreEntry && isFirstPage
        ? (async () => {
            const genreId = matchingGenreEntry[0];
            try {
              if (mediaType === 'movie' || mediaType === 'tv') {
                const res = await this.discover(
                  mediaType,
                  { genres: genreId, sortBy: 'popularity.desc' },
                  1
                );
                return res.results;
              }
              const [movieRes, tvRes] = await Promise.all([
                this.discover('movie', { genres: genreId, sortBy: 'popularity.desc' }, 1),
                this.discover('tv', { genres: genreId, sortBy: 'popularity.desc' }, 1),
              ]);
              const interleaved: TMDBMediaItem[] = [];
              const maxLen = Math.max(movieRes.results.length, tvRes.results.length);
              for (let k = 0; k < maxLen; k++) {
                if (movieRes.results[k]) interleaved.push(movieRes.results[k]);
                if (tvRes.results[k]) interleaved.push(tvRes.results[k]);
              }
              return interleaved;
            } catch (err) {
              console.warn('[TMDB] Genre search discover failed:', err);
              return [];
            }
          })()
        : Promise.resolve([]);

    // Search responses are cached briefly. Results do drift, but not within
    // the seconds it takes to backspace a character and retype it, or to open
    // a title and come straight back — and those are the round trips the user
    // actually feels.
    const cacheKey = `search:${mediaType ?? 'multi'}:${allowAdult ? 'a' : 'n'}:${trimmedQuery}:${page}`;
    const raw = await tmdbFetch<RawPage>(
      endpoint,
      {
        query: trimmed,
        page,
        include_adult: allowAdult ? 'true' : 'false',
      },
      cacheKey,
      CACHE_TTL.search,
    );

    const scoredResults: TMDBMediaItem[] = [];

    if (raw?.results) {
      for (const item of raw.results) {
        if (item.media_type === 'person') continue;
        const normalized = normalizer(item);
        if (!normalized) continue;
        scoredResults.push({
          ...normalized,
          matchSource: 'title',
          relevance: scoreSearchRelevance(normalized, trimmed, {
            originalTitle: item.original_title ?? item.original_name ?? null,
            source: 'title',
          }),
        });
      }
    }

    // ── Person filmography expansion ──
    // Searching "Nolan" should surface his films, not just his person entry.
    // Only the single best-matching person is expanded: pulling two people's
    // full credit lists was the slowest part of every name search and buried
    // the direct matches under a hundred loosely-related titles.
    if (isFirstPage && raw?.results) {
      const person = raw.results
        .filter((item: any) => item.media_type === 'person')
        .sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];

      if (person) {
        try {
          const details = await this.getPersonDetails(person.id);
          // Talk shows, news and reality entries dominate a person's credit
          // list because of one-off guest appearances. Searching "Nolan"
          // should lead with his films, not every late-night couch visit.
          const CAMEO_GENRE_IDS = new Set([10767, 10763, 10764]);
          const credits = (details?.combinedCredits ?? [])
            .filter((credit) => !mediaType || credit.mediaType === mediaType)
            .filter((credit) => !(credit.genreIds ?? []).some((g) => CAMEO_GENRE_IDS.has(g)))
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, MAX_PERSON_CREDITS);

          for (const credit of credits) {
            scoredResults.push({
              ...credit,
              matchSource: 'person',
              relevance: scoreSearchRelevance(credit, trimmed, { source: 'person' }),
            });
          }
        } catch (err) {
          console.warn(`[TMDB] Failed to fetch credits for person ${person.id}:`, err);
        }
      }
    }

    for (const item of await genrePromise) {
      scoredResults.push({
        ...item,
        matchSource: 'genre',
        relevance: scoreSearchRelevance(item, trimmed, { source: 'genre' }),
      });
    }

    // Deduplicate by media type + id, keeping the highest-scoring copy — a
    // title can arrive both as a direct match and via a filmography.
    const bestByKey = new Map<string, TMDBMediaItem>();
    for (const item of scoredResults) {
      const key = `${item.mediaType}:${item.id}`;
      const existing = bestByKey.get(key);
      if (!existing || (item.relevance ?? 0) > (existing.relevance ?? 0)) {
        bestByKey.set(key, item);
      }
    }

    const uniqueResults = Array.from(bestByKey.values()).sort(
      (a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)
    );

    return {
      page: raw?.page ?? page,
      results: uniqueResults,
      totalPages: raw?.total_pages ?? 1,
      // The API's own count for the query; the expansions above are extras
      // layered on top of page 1 and shouldn't distort the reported total.
      totalResults: raw?.total_results ?? uniqueResults.length,
    };
  },

  // ── Discover ────────────────────────────────────────────

  /**
   * Discover movies or TV shows with flexible filters.
   */
  async discover(
    mediaType: MediaType,
    filters: DiscoverFilters = {},
    page = 1,
    forceRefresh = false,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const endpoint =
      mediaType === 'movie' ? '/discover/movie' : '/discover/tv';

    const allowAdult = await getIncludeAdult();

    const params: Record<string, string | number | undefined> = {
      page,
      include_adult: allowAdult ? 'true' : 'false',
      sort_by: filters.sortBy ?? 'popularity.desc',
      with_genres: filters.genres,
      with_original_language: filters.withOriginalLanguage ?? filters.language,
      primary_release_year: filters.year,
      'vote_average.gte': filters.voteAverageGte,
      'vote_count.gte': filters.voteCountGte,
      with_cast: filters.withCast,
      with_crew: filters.withCrew,
      'primary_release_date.gte': filters.releaseDateGte,
      'primary_release_date.lte': filters.releaseDateLte,
      // TV uses air_date to discover both new and returning seasons
      ...(mediaType === 'tv' && filters.releaseDateGte
        ? { 'air_date.gte': filters.releaseDateGte }
        : {}),
      ...(mediaType === 'tv' && filters.releaseDateLte
        ? { 'air_date.lte': filters.releaseDateLte }
        : {}),
    };

    // The adult flag is part of the key so flipping the setting doesn't serve
    // results cached under the opposite value.
    const cacheKey = `discover:${mediaType}:${page}:${allowAdult ? 'a' : 'n'}:${JSON.stringify(filters)}`;
    if (forceRefresh) {
      await invalidateCache(cacheKey);
    }
    const raw = await tmdbFetch<RawPage>(endpoint, params, cacheKey);
    return toPaginated(
      raw,
      mediaType === 'movie' ? normalizeMovie : normalizeTVShow,
    );
  },

  // ── Recommendations & Similar ─────────────────────────

  /**
   * Get recommendations based on a movie or TV show.
   */
  async getRecommendations(
    id: number,
    mediaType: MediaType,
    page = 1,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `recommendations:${mediaType}:${id}:${page}`;
    const endpoint =
      mediaType === 'movie'
        ? `/movie/${id}/recommendations`
        : `/tv/${id}/recommendations`;
    const raw = await tmdbFetch<RawPage>(endpoint, { page }, cacheKey);
    return toPaginated(
      raw,
      mediaType === 'movie' ? normalizeMovie : normalizeTVShow,
    );
  },

  /**
   * Get similar movies or TV shows.
   */
  async getSimilar(
    id: number,
    mediaType: MediaType,
    page = 1,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `similar:${mediaType}:${id}:${page}`;
    const endpoint =
      mediaType === 'movie'
        ? `/movie/${id}/similar`
        : `/tv/${id}/similar`;
    const raw = await tmdbFetch<RawPage>(endpoint, { page }, cacheKey);
    return toPaginated(
      raw,
      mediaType === 'movie' ? normalizeMovie : normalizeTVShow,
    );
  },

  // ── Person ────────────────────────────────────────────

  /**
   * Get person details with combined credits.
   */
  async getPersonDetails(personId: number): Promise<PersonDetails | null> {
    const cacheKey = `person:${personId}`;
    const raw = await tmdbFetch<any>(
      `/person/${personId}`,
      { append_to_response: 'combined_credits' },
      cacheKey,
      CACHE_TTL.details,
    );

    if (!raw) return null;

    // Normalize all credits (cast + crew appearances)
    const castCredits: TMDBMediaItem[] = (raw.combined_credits?.cast ?? [])
      .map(normalizeMediaResult)
      .filter((r: TMDBMediaItem | null): r is TMDBMediaItem => r !== null);

    const crewCredits: TMDBMediaItem[] = (raw.combined_credits?.crew ?? [])
      .map(normalizeMediaResult)
      .filter((r: TMDBMediaItem | null): r is TMDBMediaItem => r !== null);

    // Merge and deduplicate by id + mediaType
    const seen = new Set<string>();
    const combinedCredits: TMDBMediaItem[] = [];
    for (const item of [...castCredits, ...crewCredits]) {
      const key = `${item.mediaType}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        combinedCredits.push(item);
      }
    }

    // Sort by popularity descending
    combinedCredits.sort((a, b) => b.popularity - a.popularity);

    return {
      id: raw.id,
      name: raw.name ?? '',
      biography: raw.biography ?? '',
      birthday: raw.birthday ?? null,
      deathday: raw.deathday ?? null,
      placeOfBirth: raw.place_of_birth ?? null,
      profilePath: raw.profile_path ?? null,
      knownForDepartment: raw.known_for_department ?? '',
      combinedCredits,
    };
  },

  // ── Multi-Language Upcoming ───────────────────────────

  /**
   * Fetch upcoming movies across multiple languages using the discover
   * endpoint. Merges and deduplicates results, sorted by release date.
   */
  async getUpcomingByLanguages(
    languages: string[],
    page = 1,
    forceRefresh = false,
    showSeries = false,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const today = new Date().toISOString().slice(0, 10);

    // 6 months in the future
    const future = new Date();
    future.setMonth(future.getMonth() + 6);
    const futureDate = future.toISOString().slice(0, 10);

    let maxPages = 0;
    let maxResults = 0;

    // Fetch each language in parallel
    const fetches = languages.map(async (lang) => {
      try {
        // Ordering by date walked the release calendar strictly
        // chronologically, and TMDB's calendar is mostly festival shorts,
        // one-off uploads and untitled placeholders — so the feed filled up
        // with titles nobody is waiting for while the month's actual releases
        // sat pages deep. Ordering by popularity inside the same date window
        // asks the opposite question ("what is anticipated?") and the results
        // are re-sorted by date for display further down.
        const moviePromise = this.discover('movie', {
          withOriginalLanguage: lang,
          releaseDateGte: today,
          releaseDateLte: futureDate,
          sortBy: 'popularity.desc',
        }, page, forceRefresh);

        const tvPromise = showSeries
          ? this.discover('tv', {
              withOriginalLanguage: lang,
              releaseDateGte: today,
              releaseDateLte: futureDate,
              sortBy: 'popularity.desc',
            }, page, forceRefresh)
          : Promise.resolve(null);

        const [movieRes, tvRes] = await Promise.all([moviePromise, tvPromise]);

        const tvResults = tvRes?.results || [];

        // Decorate TV shows with their next air dates using limitConcurrency to avoid request storm
        const decoratedTv = showSeries && tvResults.length > 0
          ? await limitConcurrency(
              tvResults,
              5,
              async (item) => {
                try {
                  const details = await this.getDetails(item.id, 'tv', forceRefresh);
                  if (details) {
                    let upcomingDate: string | null = null;

                    // 1. Check nextEpisodeToAir
                    if (details.nextEpisodeToAir && details.nextEpisodeToAir.air_date >= today) {
                      upcomingDate = details.nextEpisodeToAir.air_date;
                    }

                    // 2. Otherwise, check seasons list
                    if (!upcomingDate && details.seasons) {
                      const futureSeasons = details.seasons
                        .filter((s: any) => s.season_number > 0 && s.air_date && s.air_date >= today)
                        .sort((a: any, b: any) => a.season_number - b.season_number);
                      if (futureSeasons.length > 0) {
                        upcomingDate = futureSeasons[0].air_date;
                      }
                    }

                    // 3. Otherwise, if first air date is in the future
                    if (!upcomingDate && item.releaseDate && item.releaseDate >= today) {
                      upcomingDate = item.releaseDate;
                    }

                    if (upcomingDate) {
                      return {
                        ...item,
                        releaseDate: upcomingDate,
                      };
                    }
                  }
                } catch (err) {
                  console.warn(`[TMDB] getUpcomingByLanguages failed to decorate TV item ${item.id}:`, err);
                }
                return item;
              }
            )
          : [];

        // Keep TV shows only if their releaseDate (updated next air date) is in the future
        const upcomingTv = decoratedTv.filter((item) => item.releaseDate && item.releaseDate >= today);

        return {
          results: [...(movieRes?.results || []), ...upcomingTv],
          totalPages: Math.max(movieRes?.totalPages || 0, tvRes?.totalPages || 0),
          totalResults: (movieRes?.totalResults || 0) + upcomingTv.length,
        };
      } catch (err) {
        console.error('getUpcomingByLanguages error for lang:', lang, err);
        return { results: [], totalPages: 0, totalResults: 0 };
      }
    });

    const results = await Promise.all(fetches);

    for (const result of results) {
      maxPages = Math.max(maxPages, result.totalPages);
      maxResults += result.totalResults;
    }

    // ── Language interleaving ──
    // Every language is asked for the same number of titles, but English has
    // an order of magnitude more releases than any regional language, so
    // concatenating the lists and sorting by date buried the regional picks
    // behind a wall of English. Taking one title from each language in turn
    // gives every selected language a proportional share of the page, which
    // is what the language chips are promising.
    const perLanguage = results.map((r) => [...r.results]);
    const seen = new Set<string>();
    const unique: TMDBMediaItem[] = [];

    for (let round = 0; ; round++) {
      let tookAny = false;
      for (const list of perLanguage) {
        const item = list[round];
        if (!item) continue;
        tookAny = true;
        const key = `${item.mediaType || 'movie'}-${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
      }
      if (!tookAny) break;
    }

    // Sort by release date ascending
    unique.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));

    return {
      page,
      results: unique,
      totalPages: maxPages,
      totalResults: maxResults,
    };
  },

  /**
   * Get episodes for a specific TV show season.
   */
  async getTVSeason(seriesId: number, seasonNumber: number): Promise<any> {
    const cacheKey = `tv:${seriesId}:season:${seasonNumber}`;
    const endpoint = `/tv/${seriesId}/season/${seasonNumber}`;
    const raw = await tmdbFetch<any>(endpoint, {}, cacheKey, CACHE_TTL.details);
    return raw;
  },

  // ── Genres ────────────────────────────────────────────

  /**
   * Get the full genre list for movies or TV.
   */
  async getGenreList(mediaType: MediaType): Promise<Genre[]> {
    const cacheKey = `genres:${mediaType}`;
    const endpoint =
      mediaType === 'movie' ? '/genre/movie/list' : '/genre/tv/list';
    const raw = await tmdbFetch<{ genres: Genre[] }>(
      endpoint,
      {},
      cacheKey,
      CACHE_TTL.genres,
    );
    return raw?.genres ?? [];
  },

  // ── Utilities ─────────────────────────────────────────

  /** Re-export for convenience */
  getImageUrl,
  normalizeMovie,
  normalizeTVShow,
};
