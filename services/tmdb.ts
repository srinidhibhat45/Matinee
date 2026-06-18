// ============================================================
// Matinee — TMDB API v3 Service
// Comprehensive wrapper with caching, normalization, and
// graceful error handling.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOVIE_GENRES, TV_GENRES } from '../constants/genres';

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

async function getApiProxy(): Promise<string | null> {
  try {
    const proxy = await AsyncStorage.getItem(API_PROXY_STORAGE);
    return proxy?.trim() || null;
  } catch {
    return null;
  }
}

/** Cache TTLs in milliseconds */
const CACHE_TTL = {
  list: 30 * 60 * 1000,       // 30 minutes for list endpoints
  details: 24 * 60 * 60 * 1000, // 24 hours for detail endpoints
  genres: 7 * 24 * 60 * 60 * 1000, // 7 days for genre lists
};

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
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;

    const entry: { data: T; expiresAt: number } = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      // Expired — remove and treat as cache miss
      await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

async function setCache<T>(key: string, data: T, ttl: number): Promise<void> {
  try {
    const entry = JSON.stringify({ data, expiresAt: Date.now() + ttl });
    await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, entry);
  } catch {
    // Non-critical — silently ignore cache write failures
  }
}

async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    console.warn('[TMDB] Failed to clear cache');
  }
}

// ─── Core Fetch ─────────────────────────────────────────────

const DEFAULT_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmYjQ2YzBlNDk0MmM5MGIyZGE3Y2E5M2VkYTNiZDA5OCIsIm5iZiI6MTc4MTUzMjM2NS44MTcsInN1YiI6IjZhMzAwNmNkNzk3MjVmZmQ3MGM3OGNmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.bMzqq3dFpra9u87aeQEDkQ7C1JMaGV-XsotPQmw4YhA';

/**
 * Retrieve the stored TMDB v3 API key or Bearer token.
 * Returns the default token if no key has been configured yet.
 */
async function getApiKey(): Promise<string | null> {
  try {
    const key = await AsyncStorage.getItem(API_KEY_STORAGE);
    if (key?.trim()) {
      return key.trim();
    }
    return DEFAULT_API_KEY;
  } catch {
    return DEFAULT_API_KEY;
  }
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
): Promise<T | null> {
  // Check cache first
  if (cacheKey) {
    const cached = await getCached<T>(cacheKey);
    if (cached) return cached;
  }

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
          console.warn('[TMDB] 429 Rate limit exceeded. Backing off…');
          await new Promise((r) => setTimeout(r, 1000));
          return tmdbFetch<T>(path, params, cacheKey, cacheTtl);
        }
        if (response.status === 401) {
          console.warn('[TMDB] 401 Unauthorized — check your API Bearer token.');
          return null;
        }
        if (response.status === 404) {
          console.warn(`[TMDB] 404 Not Found — ${path}`);
          return null;
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
    await AsyncStorage.setItem(API_KEY_STORAGE, key.trim());
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
    await AsyncStorage.removeItem(API_KEY_STORAGE);
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
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `trending:${mediaType}:${timeWindow}:${page}`;
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
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `popular:${mediaType}:${page}`;
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
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const cacheKey = `top_rated:${mediaType}:${page}`;
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
  ): Promise<TMDBMediaDetails | null> {
    const cacheKey = `details:${mediaType}:${id}`;
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

    const director =
      crew.find((c: any) => c.job === 'Director')?.name ??
      (raw.created_by?.[0]?.name ?? null);

    // Watch providers — pull the US region by default, fall back to first available
    const providerData = raw['watch/providers']?.results;
    let watchProviders = null;
    if (providerData) {
      watchProviders = providerData.US ?? providerData.IN ?? Object.values(providerData)[0] ?? null;
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
      runtime: mediaType === 'movie' ? (raw.runtime ?? null) : (raw.episode_run_time?.[0] ?? null),
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
    };
  },

  // ── Search ──────────────────────────────────────────────

  /**
   * Search across movies, TV, or both (multi).
   */
  async search(
    query: string,
    mediaType?: MediaType,
    page = 1,
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    if (!query.trim()) {
      return { page: 1, results: [], totalPages: 0, totalResults: 0 };
    }

    const trimmedQuery = query.trim().toLowerCase();

    // Check if query matches a genre name
    const allGenres = { ...MOVIE_GENRES, ...TV_GENRES };
    const matchingGenreEntry = Object.entries(allGenres).find(
      ([, name]) => name.toLowerCase() === trimmedQuery
    );

    let genreResults: TMDBMediaItem[] = [];
    if (matchingGenreEntry) {
      const genreId = matchingGenreEntry[0];
      try {
        if (mediaType === 'movie') {
          const movieRes = await this.discover('movie', { genres: genreId, sortBy: 'popularity.desc' }, page);
          genreResults = movieRes.results;
        } else if (mediaType === 'tv') {
          const tvRes = await this.discover('tv', { genres: genreId, sortBy: 'popularity.desc' }, page);
          genreResults = tvRes.results;
        } else {
          const [movieRes, tvRes] = await Promise.all([
            this.discover('movie', { genres: genreId, sortBy: 'popularity.desc' }, page),
            this.discover('tv', { genres: genreId, sortBy: 'popularity.desc' }, page),
          ]);
          const maxLen = Math.max(movieRes.results.length, tvRes.results.length);
          for (let i = 0; i < maxLen; i++) {
            if (movieRes.results[i]) genreResults.push(movieRes.results[i]);
            if (tvRes.results[i]) genreResults.push(tvRes.results[i]);
          }
        }
      } catch (err) {
        console.warn('[TMDB] Genre search discover failed:', err);
      }
    }

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

    // No caching for search — results change frequently
    const raw = await tmdbFetch<RawPage>(endpoint, {
      query: query.trim(),
      page,
      include_adult: 'false',
    });

    const results: TMDBMediaItem[] = [];

    // Prepend genre results
    results.push(...genreResults);

    if (raw && raw.results) {
      // Find top person results (limit to first 2 to prevent rate limiting / massive search bloating)
      const personResults = raw.results.filter((item: any) => item.media_type === 'person').slice(0, 2);

      // Fetch combined credits for these top person results
      const personCreditsPromises = personResults.map(async (person: any) => {
        try {
          const details = await this.getPersonDetails(person.id);
          return details?.combinedCredits || [];
        } catch (err) {
          console.warn(`[TMDB] Failed to fetch credits for person ${person.id}:`, err);
          return [];
        }
      });

      const personCreditsLists = await Promise.all(personCreditsPromises);
      const allPersonCredits = personCreditsLists.flat();

      // Normalize other media results (movies and tv)
      for (const item of raw.results) {
        if (item.media_type !== 'person') {
          const normalized = normalizer(item);
          if (normalized) {
            results.push(normalized);
          }
        }
      }

      // Add the person credits to the results
      for (const credit of allPersonCredits) {
        if (mediaType && credit.mediaType !== mediaType) continue;
        results.push(credit);
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueResults = results.filter((r) => {
      const key = `${r.mediaType}:${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      page: raw?.page ?? 1,
      results: uniqueResults,
      totalPages: Math.max(raw?.total_pages ?? 1, matchingGenreEntry ? page : 1),
      totalResults: uniqueResults.length,
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
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const endpoint =
      mediaType === 'movie' ? '/discover/movie' : '/discover/tv';

    const params: Record<string, string | number | undefined> = {
      page,
      sort_by: filters.sortBy ?? 'popularity.desc',
      with_genres: filters.genres,
      with_original_language: filters.withOriginalLanguage ?? filters.language,
      primary_release_year: filters.year,
      'vote_average.gte': filters.voteAverageGte,
      with_cast: filters.withCast,
      with_crew: filters.withCrew,
      'primary_release_date.gte': filters.releaseDateGte,
      'primary_release_date.lte': filters.releaseDateLte,
      // TV uses first_air_date instead
      ...(mediaType === 'tv' && filters.releaseDateGte
        ? { 'first_air_date.gte': filters.releaseDateGte }
        : {}),
      ...(mediaType === 'tv' && filters.releaseDateLte
        ? { 'first_air_date.lte': filters.releaseDateLte }
        : {}),
    };

    const cacheKey = `discover:${mediaType}:${page}:${JSON.stringify(filters)}`;
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
  ): Promise<PaginatedResponse<TMDBMediaItem>> {
    const today = new Date().toISOString().slice(0, 10);

    // 6 months in the future
    const future = new Date();
    future.setMonth(future.getMonth() + 6);
    const futureDate = future.toISOString().slice(0, 10);

    const allResults: TMDBMediaItem[] = [];
    let maxPages = 0;
    let maxResults = 0;

    // Fetch each language in parallel
    const fetches = languages.map(async (lang) => {
      const result = await this.discover('movie', {
        withOriginalLanguage: lang,
        releaseDateGte: today,
        releaseDateLte: futureDate,
        sortBy: 'primary_release_date.asc',
      }, page);
      return result;
    });

    const results = await Promise.all(fetches);

    for (const result of results) {
      allResults.push(...result.results);
      maxPages = Math.max(maxPages, result.totalPages);
      maxResults += result.totalResults;
    }

    // Deduplicate by ID
    const seen = new Set<number>();
    const unique = allResults.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // Sort by release date ascending
    unique.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

    return {
      page,
      results: unique,
      totalPages: maxPages,
      totalResults: maxResults,
    };
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
