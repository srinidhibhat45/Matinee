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
