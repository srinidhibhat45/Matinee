import { nextTimestamp } from './time';
import { Platform } from 'react-native';
/** Local writes are queued durably before network work. API keys are never synced. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, runTransaction, writeBatch, type DocumentData } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, initializeAuth } from 'firebase/auth';
import { getFirebaseApp, getFirestoreDb, isFirebaseConfigured } from './firebase';
import * as Crypto from 'expo-crypto';
import type { WatchedItem, Rating, EpisodeRating, MediaType } from '../types';
import type { PersonEntry } from './database';
import type { ActivityRecord } from './libraryActivity';
export interface CloudData {
  watchedItems: Record<string, DocumentData>;
  ratings: Record<string, DocumentData>;
  episodeRatings: Record<string, DocumentData>;
  people: Record<string, DocumentData>;
  preferences: Record<string, string>;
  activity?: Record<string, ActivityRecord>;
}
interface Pending {
  owner: string;
  bucket: string;
  id: string;
  data: DocumentData;
  revision: string;
}
const QUEUE_KEY = '@matinee_sync_queue_v2';
const EXCLUDED = new Set(['API_KEY_STORAGE', '@matinee_api_key', 'PREF_GEMINI_API_KEY', 'tmdbKey', 'geminiKey']);
let owner: string | null = null;
let legacyOwner: string | null = null;
let lastSync: string | null = null;
let syncing = false;
let flushPromise: Promise<void> | null = null;
let queueLock: Promise<unknown> = Promise.resolve();
let lastError: string | null = null;
let authInstance: ReturnType<typeof getAuth> | null = null;
const identity = (id: number, type: MediaType = 'movie') => `${type}:${id}`;
export function timestamp(value: unknown): number {
  const raw = String(value ?? '').replace(' ', 'T');
  const n = Date.parse(raw && !/Z$|[+-]\d{2}:\d{2}$/.test(raw) ? `${raw}Z` : raw);
  return Number.isFinite(n) ? n : 0;
}
function auth() {
  if (!authInstance) {
    if (Platform.OS !== 'web') {
      try {
        authInstance = initializeAuth(getFirebaseApp(), {
          persistence: require('firebase/auth').getReactNativePersistence(AsyncStorage)
        });
      } catch {
        authInstance = getAuth(getFirebaseApp());
      }
    } else authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}
async function readQueue(): Promise<Pending[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
function mutateQueue(fn: (q: Pending[]) => Pending[]): Promise<void> {
  const result = queueLock.then(async () => {
    const next = fn(await readQueue());
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  });
  queueLock = result.catch(() => {});
  return result;
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Cloud is unavailable. Changes are saved on this device and will retry.')), 12000);
  })]).finally(() => clearTimeout(timer));
}
async function enqueue(bucket: string, id: string, data: DocumentData): Promise<void> {
  const entry: Pending = {
    owner: owner ?? 'local',
    bucket,
    id,
    data: JSON.parse(JSON.stringify(data)),
    revision: `${Date.now()}-${Math.random()}`
  };
  await mutateQueue(q => [...q.filter(p => !(p.owner === entry.owner && p.bucket === bucket && p.id === id)), entry]);
  if (owner && !syncing) void flushQueue().catch(() => {});
}
async function flushQueue(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (!owner) return;
  const currentOwner = owner;
  flushPromise = (async () => {
    await queueLock;
    let pending = (await readQueue()).filter(p => p.owner === currentOwner || p.owner === 'local');
    while (pending.length && owner === currentOwner) {
      for (const p of pending) {
        if (owner !== currentOwner) break;
        const ref = doc(getFirestoreDb(), 'matinee_users', currentOwner, p.bucket, p.id);
        await bounded(runTransaction(getFirestoreDb(), async tx => {
          const remote = await tx.get(ref);
          if (!remote.exists() || timestamp(p.data.updatedAt) >= timestamp(remote.data().updatedAt)) tx.set(ref, p.data);
        }));
        await mutateQueue(q => q.filter(x => x.revision !== p.revision));
      }
      await queueLock;
      pending = (await readQueue()).filter(p => p.owner === currentOwner || p.owner === 'local');
    }
    lastError = null;
  })().catch(e => {
    lastError = e.message;
    throw e;
  }).finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}
async function initCloudSync(apiKey: string | null): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  await auth().authStateReady();
  legacyOwner = apiKey?.trim() ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, apiKey.trim()) : null;
  owner = auth().currentUser?.uid ?? ((await AsyncStorage.getItem('@matinee_sync_account_mode')) === 'true' ? null : legacyOwner);
  return !!owner;
}
async function connectAccount(email: string, password: string, create = false): Promise<void> {
  // Preserve the current library locally; the next sync migrates its records to the authenticated namespace.
  if (!email.trim() || password.length < 6) throw new Error('Enter your email and a password of at least 6 characters.');
  await bounded(create ? createUserWithEmailAndPassword(auth(), email.trim(), password) : signInWithEmailAndPassword(auth(), email.trim(), password));
  owner = auth().currentUser!.uid;
  await AsyncStorage.setItem('@matinee_sync_account_mode', 'true');
}
async function disconnectAccount(): Promise<void> {
  await signOut(auth());
  owner = null;
}
async function pushItem(item: WatchedItem): Promise<void> {
  const {
    getDbAsync
  } = await import('./database');
  const boundary = await (await getDbAsync()).getFirstAsync<{
    deleted_at: string;
  }>('SELECT deleted_at FROM sync_tombstones WHERE entity_key=?', [identity(item.tmdbId, item.mediaType)]);
  await enqueue('watched_items', identity(item.tmdbId, item.mediaType), {
    ...item,
    id: undefined,
    userRating: undefined,
    deleted: false,
    historyResetAt: boundary?.deleted_at ?? null,
    updatedAt: item.updatedAt || nextTimestamp()
  });
}
async function resolveType(tmdbId: number, localId: number): Promise<MediaType> {
  const {
    getDbAsync
  } = await import('./database');
  const row = await (await getDbAsync()).getFirstAsync<{
    media_type: MediaType;
  }>('SELECT media_type FROM watched_items WHERE id = ? AND tmdb_id = ?', [localId, tmdbId]);
  if (!row) throw new Error('The title no longer exists.');
  return row.media_type;
}
async function pushRating(tmdbId: number, rating: Rating, mediaType?: MediaType): Promise<void> {
  const type = mediaType ?? (await resolveType(tmdbId, rating.itemId));
  await enqueue('ratings', identity(tmdbId, type), {
    ...rating,
    tmdbId,
    mediaType: type,
    updatedAt: rating.createdAt
  });
}
async function pushEpisodeRating(tmdbId: number, rating: EpisodeRating): Promise<void> {
  await enqueue('episode_ratings', `${identity(tmdbId, 'tv')}:${rating.seasonNumber}:${rating.episodeNumber}`, {
    ...rating,
    tmdbId,
    mediaType: 'tv',
    deleted: false,
    updatedAt: rating.createdAt
  });
}
async function pushPeople(tmdbId: number, people: PersonEntry[]): Promise<void> {
  for (const p of people) {
    const type = await resolveType(tmdbId, p.itemId);
    await enqueue('people', `${identity(tmdbId, type)}:${p.personId}:${p.role}`, {
      ...p,
      tmdbId,
      mediaType: type,
      updatedAt: nextTimestamp()
    });
  }
}
async function pushPreference(key: string, value: string): Promise<void> {
  if (!EXCLUDED.has(key)) await enqueue('settings', key, {
    key,
    value,
    updatedAt: nextTimestamp()
  });
}
async function deleteItemCloud(tmdbId: number, mediaType: MediaType = 'movie'): Promise<void> {
  const {
    getDbAsync
  } = await import('./database');
  const boundary = await (await getDbAsync()).getFirstAsync<{
    deleted_at: string;
  }>('SELECT deleted_at FROM sync_tombstones WHERE entity_key=?', [identity(tmdbId, mediaType)]);
  await enqueue('watched_items', identity(tmdbId, mediaType), {
    tmdbId,
    mediaType,
    deleted: true,
    updatedAt: boundary?.deleted_at ?? nextTimestamp()
  });
}
async function deleteEpisodeRatingCloud(tmdbId: number, seasonNumber: number, episodeNumber: number): Promise<void> {
  await enqueue('episode_ratings', `${identity(tmdbId, 'tv')}:${seasonNumber}:${episodeNumber}`, {
    tmdbId,
    mediaType: 'tv',
    seasonNumber,
    episodeNumber,
    deleted: true,
    updatedAt: nextTimestamp()
  });
}
async function pushActivity(record: ActivityRecord): Promise<void> {
  await enqueue('activity', record.key, record);
}
async function pullAllData(): Promise<CloudData | null> {
  if (!owner) return null;
  const db = getFirestoreDb();
  const buckets = ['watched_items', 'ratings', 'episode_ratings', 'people', 'settings', 'activity'];
  const snaps = await bounded(Promise.all(buckets.map(b => getDocs(collection(db, 'matinee_users', owner!, b)))));
  const [watchedItems, ratings, episodeRatings, people, settings, activity] = snaps.map(s => Object.fromEntries(s.docs.map(d => [d.id, d.data()])));
  // Old backups used numeric IDs. Keep them as a fallback; typed IDs always take precedence.
  for (const [id, r] of Object.entries(watchedItems)) if (!id.includes(':')) {
    const key = identity(r.tmdbId, r.mediaType);
    if (!watchedItems[key]) watchedItems[key] = r;
    delete watchedItems[id];
  }
  for (const [bucket, fallback] of [[ratings, null], [episodeRatings, 'tv'], [people, null]] as const) {
    for (const [id, r] of Object.entries(bucket)) {
      if (id.includes(':')) continue;
      const tmdbId = r.tmdbId ?? Number(id.split('_')[0]);
      const parent = Object.values(watchedItems).find(i => i.tmdbId === tmdbId && !i.deleted);
      const mediaType = r.mediaType ?? fallback ?? parent?.mediaType;
      if (!mediaType) continue;
      const typed = bucket === ratings ? identity(tmdbId, mediaType) : bucket === episodeRatings ? `${identity(tmdbId, mediaType)}:${r.seasonNumber}:${r.episodeNumber}` : `${identity(tmdbId, mediaType)}:${r.personId}:${r.role}`;
      if (!bucket[typed]) bucket[typed] = {
        ...r,
        tmdbId,
        mediaType
      };
      delete bucket[id];
    }
  }
  const preferences: Record<string, string> = {};
  const old = await bounded(getDoc(doc(db, 'matinee_users', owner, 'meta', 'preferences')));
  if (old.exists()) for (const [k, v] of Object.entries(old.data())) if (!EXCLUDED.has(k) && typeof v === 'string' && !k.startsWith('_')) preferences[k] = v;
  for (const r of Object.values(settings)) if (!EXCLUDED.has(r.key)) preferences[r.key] = r.value;
  return {
    watchedItems,
    ratings,
    episodeRatings,
    people,
    preferences,
    activity: activity as Record<string, ActivityRecord>
  };
}
async function fullSync(merge: (data: CloudData) => Promise<void>, getItems: () => Promise<WatchedItem[]>, getRating: (id: number) => Promise<Rating | null>, getEpisodes: (id: number) => Promise<EpisodeRating[]>): Promise<{
  pulled: number;
  pushed: number;
}> {
  if (!owner || syncing) return {
    pulled: 0,
    pushed: 0
  };
  syncing = true;
  try {
    await flushQueue();
    const cloud = await pullAllData();
    if (!cloud) return {
      pulled: 0,
      pushed: 0
    };
    await merge(cloud);
    const items = await getItems();
    let pushed = 0;
    for (const item of items) {
      const remote = cloud.watchedItems[identity(item.tmdbId, item.mediaType)];
      if (!remote || timestamp(item.updatedAt) > timestamp(remote.updatedAt)) {
        await pushItem(item);
        pushed++;
      }
      const rating = await getRating(item.id);
      const remoteRating = cloud.ratings[identity(item.tmdbId, item.mediaType)];
      if (rating && (!remoteRating || timestamp(rating.createdAt) > timestamp(remoteRating.updatedAt ?? remoteRating.createdAt))) await pushRating(item.tmdbId, rating, item.mediaType);
      for (const ep of await getEpisodes(item.id)) {
        const remoteEp = cloud.episodeRatings[`${identity(item.tmdbId, 'tv')}:${ep.seasonNumber}:${ep.episodeNumber}`];
        if (!remoteEp || timestamp(ep.createdAt) > timestamp(remoteEp.updatedAt ?? remoteEp.createdAt)) await pushEpisodeRating(item.tmdbId, ep);
      }
    }
    const localDatabase = await (await import('./database')).getDbAsync();
    const preferences = await localDatabase.getAllAsync<{
      key: string;
      value: string;
    }>('SELECT key,value FROM preferences');
    for (const preference of preferences) if (!EXCLUDED.has(preference.key) && !(preference.key in cloud.preferences)) await pushPreference(preference.key, preference.value);
    const people = await localDatabase.getAllAsync<{
      item_id: number;
      tmdb_id: number;
      media_type: MediaType;
      person_id: number;
      person_name: string;
      role: 'director' | 'actor';
      profile_path: string | null;
    }>('SELECT p.*,w.tmdb_id,w.media_type FROM director_actor_cache p JOIN watched_items w ON w.id=p.item_id');
    for (const p of people) if (!cloud.people[`${identity(p.tmdb_id, p.media_type)}:${p.person_id}:${p.role}`]) await pushPeople(p.tmdb_id, [{
      itemId: p.item_id,
      personId: p.person_id,
      personName: p.person_name,
      role: p.role,
      profilePath: p.profile_path
    }]);
    const activity = await (await import('./libraryActivity')).readActivity(undefined, true);
    for (const record of activity) if (!cloud.activity?.[record.key] || timestamp(record.updatedAt) > timestamp(cloud.activity[record.key].updatedAt)) await pushActivity(record);
    await flushQueue();
    lastSync = nextTimestamp();
    return {
      pulled: Object.keys(cloud.watchedItems).length,
      pushed
    };
  } catch (e: any) {
    lastError = e.message;
    throw e;
  } finally {
    syncing = false;
  }
}
async function deleteAllCloudData(): Promise<void> {
  if (!owner) return;
  for (const bucket of ['watched_items', 'ratings', 'episode_ratings', 'people', 'meta', 'settings', 'activity']) {
    const snap = await bounded(getDocs(collection(getFirestoreDb(), 'matinee_users', owner, bucket)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(getFirestoreDb());
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await bounded(batch.commit());
    }
  }
  await mutateQueue(q => q.filter(p => p.owner !== owner && p.owner !== 'local'));
}
async function getSyncStatus() {
  await queueLock;
  return {
    pending: (await readQueue()).filter(p => p.owner === owner || p.owner === 'local').length,
    error: lastError,
    email: auth().currentUser?.email ?? null,
    authenticated: !!auth().currentUser,
    lastSync
  };
}
export const cloudSync = {
  initCloudSync,
  pushItem,
  pushRating,
  pushEpisodeRating,
  pushPeople,
  pushPreference,
  deleteItemCloud,
  deleteEpisodeRatingCloud,
  pushActivity,
  pullAllData,
  fullSync,
  deleteAllCloudData,
  connectAccount,
  disconnectAccount,
  getSyncStatus,
  flushQueue,
  getLastSyncTime: () => lastSync,
  isSyncing: () => syncing,
  isCloudEnabled: () => !!owner,
  getUserPath: () => owner
};
