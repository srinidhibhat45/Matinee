// ─── Core Enums ──────────────────────────────────────────────

export type MediaType = 'movie' | 'tv';

export type ItemStatus = 'watched' | 'watchlist' | 'interested' | 'not_interested';

// ─── TMDB API Response Types ─────────────────────────────────

export interface TMDBMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  genre_ids: number[];
  original_language: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  video: boolean;
}

export interface TMDBTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  genre_ids: number[];
  original_language: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  origin_country: string[];
}

// ─── Normalized Media Item ───────────────────────────────────

export interface TMDBMediaItem {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string;
  genreIds: number[];
  originalLanguage: string;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  mediaType: MediaType;
  certification?: string | null;
  runtime?: number | null;
  watchProviders?: WatchProviderResult | null;
}

// ─── Detail Types ────────────────────────────────────────────

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface Video {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface MovieDetails extends TMDBMediaItem {
  runtime: number;
  tagline: string;
  status: string;
  budget: number;
  revenue: number;
  genres: { id: number; name: string }[];
  credits: {
    cast: CastMember[];
    crew: CrewMember[];
  };
  recommendations: { results: TMDBMediaItem[] };
  similar: { results: TMDBMediaItem[] };
  keywords: {
    keywords?: { id: number; name: string }[];
    results?: { id: number; name: string }[];
  };
  videos: { results: Video[] };
  watchProviders?: any;
}

// ─── Local Database Models ───────────────────────────────────

export interface WatchedItem {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  genres: string;
  originalLanguage: string;
  runtime: number;
  voteAverage: number;
  status: ItemStatus;
  watchedDate: string | null;
  createdAt: string;
  updatedAt: string;
  userRating?: number | null;
  certification?: string | null;
}

export interface Rating {
  id: number;
  itemId: number;
  overallRating: number;
  plotRating: number | null;
  actingRating: number | null;
  visualsRating: number | null;
  soundtrackRating: number | null;
  rewatchability: number | null;
  moodEmoji: string | null;
  reviewText: string | null;
  createdAt: string;
}

export interface EpisodeRating {
  id: number;
  itemId: number;
  seasonNumber: number;
  episodeNumber: number;
  rating: number;
  reviewText: string | null;
  createdAt: string;
}

// ─── Stats & Analytics ───────────────────────────────────────

export interface UserStats {
  totalWatched: number;
  totalMovies: number;
  totalSeries: number;
  totalHoursWatched: number;
  averageRating: number;
  favoriteGenres: { genre: string; count: number }[];
  topDirectors: { name: string; count: number }[];
  topActors: { name: string; count: number }[];
  longestStreak: number;
  currentStreak: number;
  monthlyBreakdown: { month: string; count: number }[];
  ratingDistribution: { rating: number; count: number }[];
  heatmapData: { date: string; count: number }[];
}

// ─── Recommendations ────────────────────────────────────────

export interface RecommendedItem extends TMDBMediaItem {
  score: number;
  reason: string;
}

// ─── Genre ──────────────────────────────────────────────────

export interface Genre {
  id: number;
  name: string;
}

// ─── Watch Provider ─────────────────────────────────────────

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
}

export interface WatchProviderResult {
  link?: string;
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

// ─── Season (TV) ────────────────────────────────────────────

export interface Season {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  season_number: number;
  episode_count: number;
  air_date: string | null;
}

// ─── Keyword ────────────────────────────────────────────────

export interface Keyword {
  id: number;
  name: string;
}

// ─── Full Media Details ─────────────────────────────────────

export interface TMDBMediaDetails extends TMDBMediaItem {
  originalTitle: string;
  adult: boolean;
  genres: Genre[];
  runtime: number | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  status: string;
  tagline: string;
  budget: number | null;
  revenue: number | null;
  homepage: string | null;
  imdbId: string | null;
  productionCompanies: { id: number; name: string; logo_path: string | null }[];
  cast: CastMember[];
  crew: CrewMember[];
  director: string | null;
  recommendations: TMDBMediaItem[];
  similar: TMDBMediaItem[];
  keywords: Keyword[];
  videos: Video[];
  watchProviders: WatchProviderResult | null;
  seasons: Season[];
}

// ─── Person Details ─────────────────────────────────────────

export interface PersonDetails {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profilePath: string | null;
  knownForDepartment: string;
  combinedCredits: TMDBMediaItem[];
}

// ─── Discover Filters ───────────────────────────────────────

export interface DiscoverFilters {
  genres?: string;
  language?: string;
  year?: number;
  sortBy?: string;
  voteAverageGte?: number;
  withCast?: string;
  withCrew?: string;
  releaseDateGte?: string;
  releaseDateLte?: string;
  withOriginalLanguage?: string;
}

// ─── Paginated Response ─────────────────────────────────────

export interface PaginatedResponse<T> {
  page: number;
  results: T[];
  totalPages: number;
  totalResults: number;
}

// ─── Image Sizes ────────────────────────────────────────────

export type PosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original';
export type BackdropSize = 'w300' | 'w780' | 'w1280' | 'original';
export type ProfileSize = 'w45' | 'w185' | 'h632' | 'original';
export type ImageSize = PosterSize | BackdropSize | ProfileSize;
