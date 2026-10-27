import { nextTimestamp } from './time';
import { getDbAsync, notifyDbChanged, getItem, addItem, getAllItems, updateItem } from './database';
import { cloudSync } from './cloudSync';
import type { MediaType, TMDBMediaItem, WatchedItem } from '../types';
export type ActivityKind = 'bookmark' | 'watching' | 'episode' | 'collection' | 'membership' | 'diary' | 'feedback';
export interface ActivityRecord {
  key: string;
  kind: ActivityKind;
  payload: Record<string, any>;
  updatedAt: string;
  deleted: boolean;
}
export const titleKey = (type: MediaType, id: number) => `${type}:${id}`;
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export async function readActivity(kind?: ActivityKind, includeDeleted = false): Promise<ActivityRecord[]> {
  const db = await getDbAsync();
  const clauses = [kind ? 'kind = ?' : '1=1', includeDeleted ? '1=1' : 'deleted = 0'];
  const rows = await db.getAllAsync<{
    activity_key: string;
    kind: ActivityKind;
    payload: string;
    updated_at: string;
    deleted: number;
  }>(`SELECT * FROM library_activity WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`, kind ? [kind] : []);
  return rows.map(r => ({
    key: r.activity_key,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    updatedAt: r.updated_at,
    deleted: !!r.deleted
  }));
}
export async function mergeActivity(records: ActivityRecord[]): Promise<void> {
  const db = await getDbAsync();
  for (const r of records) {
    if (!r.key || !['bookmark', 'watching', 'episode', 'collection', 'membership', 'diary', 'feedback'].includes(r.kind) || !r.payload || !r.updatedAt) continue;
    await db.runAsync(`INSERT INTO library_activity (activity_key, kind, payload, updated_at, deleted) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(activity_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at, deleted=excluded.deleted
      WHERE excluded.updated_at > library_activity.updated_at`, [r.key, r.kind, JSON.stringify(r.payload), r.updatedAt, r.deleted ? 1 : 0]);
  }
  notifyDbChanged();
}
export async function writeActivity(kind: ActivityKind, key: string, payload: Record<string, any>, deleted = false): Promise<void> {
  const record: ActivityRecord = {
    key: `${kind}:${key}`,
    kind,
    payload,
    deleted,
    updatedAt: nextTimestamp()
  };
  await mergeActivity([record]);
  await cloudSync.pushActivity(record);
}
export async function ensureLibraryItem(item: TMDBMediaItem, status: 'watchlist' | 'watched' = 'watchlist'): Promise<WatchedItem> {
  const existing = await getItem(item.id, item.mediaType);
  if (existing) {
    if (status === 'watched' && existing.status !== 'watched') await updateItem(existing.id, {
      status,
      watchedDate: localDay()
    });
    return (await getItem(item.id, item.mediaType))!;
  }
  await addItem({
    tmdbId: item.id,
    mediaType: item.mediaType,
    title: item.title,
    posterPath: item.posterPath,
    backdropPath: item.backdropPath,
    overview: item.overview,
    releaseDate: item.releaseDate,
    genres: JSON.stringify(item.genreIds ?? []),
    originalLanguage: item.originalLanguage,
    runtime: item.runtime ?? 0,
    voteAverage: item.voteAverage,
    status,
    watchedDate: status === 'watched' ? localDay() : null
  });
  return (await getItem(item.id, item.mediaType))!;
}
export async function setWatching(item: TMDBMediaItem, active: boolean): Promise<void> {
  if (active) await ensureLibraryItem(item);
  await writeActivity('watching', titleKey(item.mediaType, item.id), {
    tmdbId: item.id,
    mediaType: item.mediaType
  }, !active);
}
export async function getWatchingItems(): Promise<WatchedItem[]> {
  const [records, items] = await Promise.all([readActivity('watching'), getAllItems()]);
  const keys = new Set(records.map(r => titleKey(r.payload.mediaType, r.payload.tmdbId)));
  return items.filter(i => i.status !== 'not_interested' && keys.has(titleKey(i.mediaType, i.tmdbId)));
}
export async function markEpisode(item: TMDBMediaItem, season: number, episode: number, watched: boolean, runtime?: number): Promise<void> {
  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) throw new Error('Choose a valid season and episode.');
  if (watched) await setWatching(item, true);
  await writeActivity('episode', `${titleKey('tv', item.id)}:${season}:${episode}`, {
    tmdbId: item.id,
    mediaType: 'tv',
    season,
    episode,
    runtime: runtime ?? item.runtime ?? 0,
    date: localDay()
  }, !watched);
}
export async function addViewing(item: TMDBMediaItem, date = localDay(), note = ''): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDay() || !Number.isFinite(Date.parse(date)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid viewing date, today or earlier.');
  const saved = await ensureLibraryItem(item, 'watched');
  await updateItem(saved.id, {
    watchedDate: date
  });
  await writeActivity('diary', `${titleKey(item.mediaType, item.id)}:${Date.now()}:${Math.random().toString(36).slice(2)}`, {
    tmdbId: item.id,
    mediaType: item.mediaType,
    title: item.title,
    posterPath: item.posterPath,
    runtime: item.mediaType === 'movie' ? item.runtime ?? 0 : 0,
    date,
    note: note.trim().slice(0, 2000)
  });
  await setWatching(item, false);
}
export async function createCollection(name: string): Promise<string> {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error('Give your collection a name.');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeActivity('collection', id, {
    id,
    name: trimmed
  });
  return id;
}
export async function setCollectionMember(collectionId: string, item: WatchedItem, included: boolean): Promise<void> {
  await writeActivity('membership', `${collectionId}:${titleKey(item.mediaType, item.tmdbId)}`, {
    collectionId,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType
  }, !included);
}
export async function setRecommendationFeedback(item: TMDBMediaItem, feedback: 'more' | 'similar' | 'mood' | 'hide'): Promise<void> {
  await writeActivity('feedback', titleKey(item.mediaType, item.id), {
    tmdbId: item.id,
    mediaType: item.mediaType,
    title: item.title,
    posterPath: item.posterPath,
    releaseDate: item.releaseDate,
    genres: item.genreIds,
    feedback
  });
}
export async function toggleBookmark(item: TMDBMediaItem): Promise<boolean> {
  const existing = await getItem(item.id, item.mediaType);
  const records = await readActivity('bookmark');
  const saved = records.some(r => r.payload.tmdbId === item.id && r.payload.mediaType === item.mediaType) || existing?.status === 'watchlist';
  if (!existing) await ensureLibraryItem(item);
  if (!saved && existing?.status === 'interested') await updateItem(existing.id, {
    status: 'watchlist'
  });
  if (saved && existing?.status === 'watchlist') {
    // Keep the library record and its episode logs; removing a bookmark is not deleting history.
    const {
      updateItem
    } = await import('./database');
    await updateItem(existing.id, {
      status: 'interested'
    });
  }
  await writeActivity('bookmark', titleKey(item.mediaType, item.id), {
    tmdbId: item.id,
    mediaType: item.mediaType
  }, saved);
  return !saved;
}
export async function snapshotItem(item: WatchedItem): Promise<() => Promise<void>> {
  const {
    getRating,
    getEpisodeRatings,
    getDbAsync,
    addRating,
    addEpisodeRating,
    saveDirectorsActors
  } = await import('./database');
  const [rating, episodes, people] = await Promise.all([getRating(item.id), getEpisodeRatings(item.id), (await getDbAsync()).getAllAsync<{
    person_id: number;
    person_name: string;
    role: 'director' | 'actor';
    profile_path: string | null;
  }>('SELECT * FROM director_actor_cache WHERE item_id = ?', [item.id])]);
  return async () => {
    const id = await addItem(item);
    if (rating) await addRating({
      ...rating,
      itemId: id
    });
    for (const ep of episodes) await addEpisodeRating({
      ...ep,
      itemId: id
    });
    await saveDirectorsActors(id, people.map(p => ({
      itemId: id,
      personId: p.person_id,
      personName: p.person_name,
      role: p.role,
      profilePath: p.profile_path
    })));
  };
}
