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
