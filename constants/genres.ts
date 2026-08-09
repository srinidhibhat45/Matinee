import type { MediaType } from '@/types';

/**
 * TMDB Movie Genre IDs → Names
 */
export const MOVIE_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

/**
 * TMDB TV Show Genre IDs → Names
 */
export const TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western',
};

/**
 * Emoji associated with each genre name for visual flair
 */
export const GENRE_EMOJI: Record<string, string> = {
  'Action': '💥',
  'Adventure': '🗺️',
  'Animation': '🎨',
  'Comedy': '😂',
  'Crime': '🔪',
  'Documentary': '🎥',
  'Drama': '🎭',
  'Family': '👨‍👩‍👧‍👦',
  'Fantasy': '🧙',
  'History': '📜',
  'Horror': '👻',
  'Music': '🎵',
  'Mystery': '🔍',
  'Romance': '💕',
  'Science Fiction': '🚀',
  'TV Movie': '📺',
  'Thriller': '😱',
  'War': '⚔️',
  'Western': '🤠',
  'Action & Adventure': '💥',
  'Kids': '🧒',
  'News': '📰',
  'Reality': '🌍',
  'Sci-Fi & Fantasy': '🚀',
  'Soap': '📺',
  'Talk': '🎙️',
  'War & Politics': '⚔️',
};

/**
 * Get the display name for a genre ID based on media type
 */
export function getGenreName(id: number, mediaType: MediaType): string {
  const genres = mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;
  return genres[id] ?? 'Unknown';
}

/**
 * TMDB splits the same creative genre across different IDs for movies and TV
 * (movie "Science Fiction" = 878, TV "Sci-Fi & Fantasy" = 10765). Taste
 * profiling has to treat those as the same thing, otherwise loving sci-fi
 * films teaches the engine nothing about sci-fi shows.
 *
 * Each genre ID resolves to one or more canonical tags. Compound TV genres
 * intentionally expand into both of their movie-side counterparts.
 */
const CANONICAL_GENRE_TAGS: Record<number, string[]> = {
  // ── Movie IDs ──
  28: ['Action'],
  12: ['Adventure'],
  16: ['Animation'],
  35: ['Comedy'],
  80: ['Crime'],
  99: ['Documentary'],
  18: ['Drama'],
  10751: ['Family'],
  14: ['Fantasy'],
  36: ['History'],
  27: ['Horror'],
  10402: ['Music'],
  9648: ['Mystery'],
  10749: ['Romance'],
  878: ['Science Fiction'],
  10770: ['TV Movie'],
  53: ['Thriller'],
  10752: ['War'],
  37: ['Western'],
  // ── TV-only IDs ──
  10759: ['Action', 'Adventure'],
  10762: ['Family'],
  10763: ['Documentary'],
  10764: ['Reality'],
  10765: ['Science Fiction', 'Fantasy'],
  10766: ['Drama'],
  10767: ['Talk'],
  10768: ['War'],
};

/** Reverse lookup so legacy rows that stored genre *names* still resolve. */
const NAME_TO_CANONICAL: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const [idStr, tags] of Object.entries(CANONICAL_GENRE_TAGS)) {
    const id = Number(idStr);
    const name = MOVIE_GENRES[id] ?? TV_GENRES[id];
    if (name) map[name.toLowerCase()] = tags;
  }
  // TV names that collide with a movie ID above need explicit entries.
  map['action & adventure'] = ['Action', 'Adventure'];
  map['sci-fi & fantasy'] = ['Science Fiction', 'Fantasy'];
  map['war & politics'] = ['War'];
  map['kids'] = ['Family'];
  map['news'] = ['Documentary'];
  map['soap'] = ['Drama'];
  return map;
})();

/**
 * Resolve a genre ID to its canonical tag names.
 */
export function getCanonicalGenres(id: number): string[] {
  return CANONICAL_GENRE_TAGS[id] ?? [];
}

/**
 * Translate genre IDs into the IDs that are valid for a given media type.
 *
 * The browse chips mix movie and TV genres, but TMDB's discover endpoints only
 * understand their own namespace: asking `/discover/tv` for genre 28 ("Action",
 * a movie ID) matches nothing, which is why selecting a genre used to blank out
 * the series half of the results. Here 28 becomes 10759 ("Action & Adventure")
 * for TV, and IDs with no counterpart are dropped rather than silently
 * poisoning the query.
 */
export function mapGenreIdsForMediaType(
  ids: number[],
  mediaType: MediaType
): number[] {
  const target = mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;
  const mapped = new Set<number>();

  for (const id of ids) {
    // Already valid for this media type.
    if (target[id] !== undefined) {
      mapped.add(id);
      continue;
    }

    const wanted = getCanonicalGenres(id);
    if (wanted.length === 0) continue;

    for (const candidateIdStr of Object.keys(target)) {
      const candidateId = Number(candidateIdStr);
      const candidateTags = getCanonicalGenres(candidateId);
      if (candidateTags.some((tag) => wanted.includes(tag))) {
        mapped.add(candidateId);
      }
    }
  }

  return Array.from(mapped);
}

/**
 * Parse the `genres` column of a stored watched item into canonical tags.
 *
 * The column holds a JSON array of TMDB genre IDs, but has also carried
 * comma-separated IDs and (in very old rows) genre names — all three are
 * accepted here so a user's history never silently stops counting.
 */
export function parseStoredGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];

  let values: unknown[] = [];
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    values = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const tags = new Set<string>();
  for (const value of values) {
    if (value === null || value === undefined) continue;

    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && String(value).trim() !== '') {
      for (const tag of getCanonicalGenres(asNumber)) tags.add(tag);
      continue;
    }

    const byName = NAME_TO_CANONICAL[String(value).trim().toLowerCase()];
    if (byName) {
      for (const tag of byName) tags.add(tag);
    }
  }

  return Array.from(tags);
}
