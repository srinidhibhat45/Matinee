import { toggleBookmark, localDay } from './libraryActivity';
import { notificationService } from './notifications';
import type { TMDBMediaItem } from '../types';
/** All entry points use the same bookmark and reminder behavior. */
export async function bookmarkTitle(item: TMDBMediaItem): Promise<boolean> {
  const saved = await toggleBookmark(item);
  await notificationService.cancelReminder(item.id, item.mediaType);
  if (saved && item.releaseDate > localDay()) await notificationService.scheduleReleaseReminder(item.title, item.releaseDate, item.id, item.mediaType, item.posterPath);
  return saved;
}

/** Fill only missing metadata when an existing poster or quick-action sheet saves a title. */
export function normalizeCard(item: Pick<TMDBMediaItem, 'id' | 'title' | 'posterPath' | 'voteAverage' | 'releaseDate'> & Partial<TMDBMediaItem>): TMDBMediaItem {
  return {
    overview: '',
    backdropPath: null,
    genreIds: [],
    originalLanguage: '',
    popularity: 0,
    voteCount: 0,
    ...item,
    mediaType: item.mediaType ?? 'movie'
  };
}
