import type { WatchedItem, RecommendedItem } from '../types';
import type { ActivityRecord } from './libraryActivity';
export type LibrarySection = 'watchlist' | 'watched' | 'watching' | 'hidden' | 'diary';
export type LibrarySort = 'recent' | 'title' | 'rating' | 'runtime' | 'release';
export function selectLibrary(items: WatchedItem[], activity: ActivityRecord[], section: LibrarySection, query: string, type: string | null, sort: LibrarySort, collectionId?: string | null): WatchedItem[] {
  const keys = (kind: string) => new Set(activity.filter(r => r.kind === kind && !r.deleted).map(r => `${r.payload.mediaType}:${r.payload.tmdbId}`));
  const watching = keys('watching'),
    bookmarks = keys('bookmark');
  const members = new Set(activity.filter(r => r.kind === 'membership' && !r.deleted && r.payload.collectionId === collectionId).map(r => `${r.payload.mediaType}:${r.payload.tmdbId}`));
  const hiddenFeedback = activity.filter(r => r.kind === 'feedback' && !r.deleted && r.payload.feedback === 'hide');
  const source: WatchedItem[] = section === 'hidden' ? [...items, ...hiddenFeedback.filter(r => !items.some(i => i.tmdbId === r.payload.tmdbId && i.mediaType === r.payload.mediaType)).map(r => ({
    id: -(r.payload.tmdbId * 2 + (r.payload.mediaType === 'tv' ? 1 : 0)),
    tmdbId: r.payload.tmdbId,
    mediaType: r.payload.mediaType,
    title: r.payload.title ?? 'Hidden suggestion',
    posterPath: r.payload.posterPath ?? null,
    backdropPath: null,
    overview: '',
    releaseDate: r.payload.releaseDate ?? '',
    genres: JSON.stringify(r.payload.genres ?? []),
    originalLanguage: '',
    runtime: 0,
    voteAverage: 0,
    status: 'not_interested' as const,
    watchedDate: null,
    createdAt: r.updatedAt,
    updatedAt: r.updatedAt
  }))] : items;
  const hiddenKeys = new Set(hiddenFeedback.map(r => `${r.payload.mediaType}:${r.payload.tmdbId}`));
  const result = source.filter(i => {
    const key = `${i.mediaType}:${i.tmdbId}`;
    const matches = section === 'watched' ? i.status === 'watched' : section === 'watchlist' ? i.status !== 'not_interested' && (i.status === 'watchlist' || bookmarks.has(key)) : section === 'watching' ? watching.has(key) && i.status !== 'not_interested' : i.status === 'not_interested' || hiddenKeys.has(key);
    return matches && (!type || i.mediaType === type) && (!collectionId || members.has(key)) && i.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  return result.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'rating' ? (b.userRating ?? -1) - (a.userRating ?? -1) : sort === 'runtime' ? (a.runtime || Infinity) - (b.runtime || Infinity) : sort === 'release' ? (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') : b.createdAt.localeCompare(a.createdAt));
}
export function steerRecommendations(items: RecommendedItem[], records: ActivityRecord[], adventurous = false): RecommendedItem[] {
  const feedback = records.filter(r => r.kind === 'feedback' && !r.deleted);
  return items.filter(i => !feedback.some(r => r.payload.tmdbId === i.id && r.payload.mediaType === i.mediaType && (r.payload.feedback === 'hide' || r.payload.feedback === 'mood' && Date.now() - Date.parse(r.updatedAt) < 86400000))).map((item, index) => {
    let adjustment = 0;
    for (const r of feedback) {
      const overlap = (r.payload.genres ?? []).some((g: number) => item.genreIds.includes(g));
      if (overlap) adjustment += r.payload.feedback === 'more' ? 8 : r.payload.feedback === 'similar' ? -8 : 0;
    }
    const exploration = adventurous ? Math.max(0, 10 - Math.log10(Math.max(1, item.popularity)) * 3) : 0;
    return {
      ...item,
      score: item.score + adjustment + exploration,
      _index: index
    };
  }).sort((a, b) => b.score - a.score || a._index - b._index).map(({
    _index,
    ...item
  }) => item);
}
