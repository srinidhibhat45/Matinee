// ─── Cloud Sync Service ─────────────────────────────────────────────
// Mirrors local SQLite data to Firebase Firestore, keyed by a SHA-256
// hash of the user's TMDB API key.  All methods are fire-and-forget so
// they never block the UI.  Errors are logged, never thrown to callers.

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  type Firestore,
  type DocumentData,
} from 'firebase/firestore';
import * as Crypto from 'expo-crypto';
import { getFirestoreDb, isFirebaseConfigured } from './firebase';
import type {
  WatchedItem,
  Rating,
  EpisodeRating,
  MediaType,
  ItemStatus,
} from '../types';
import type { PersonEntry } from './database';

// ── State ───────────────────────────────────────────────────────────

let userDocPath: string | null = null;
let firestoreDb: Firestore | null = null;
let _lastSyncTime: string | null = null;
let _isSyncing = false;

// ── Helpers ─────────────────────────────────────────────────────────

async function hashApiKey(apiKey: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    apiKey.trim()
  );
  return digest;
}

function getDb(): Firestore | null {
  if (firestoreDb) return firestoreDb;
  if (!isFirebaseConfigured()) return null;
  try {
    firestoreDb = getFirestoreDb();
    return firestoreDb;
  } catch (err) {
    console.warn('[CloudSync] Firestore not available:', err);
    return null;
  }
}

function getUserPath(): string | null {
  return userDocPath;
}

function isReady(): boolean {
  return !!getUserPath() && !!getDb();
}

// ── Initialisation ──────────────────────────────────────────────────

/**
 * Initialise cloud sync by computing the user's document path from
 * the SHA-256 hash of their TMDB API key.
 */
async function initCloudSync(apiKey: string | null): Promise<boolean> {
  if (!apiKey?.trim()) {
    console.log('[CloudSync] No API key provided — cloud sync disabled.');
    userDocPath = null;
    return false;
  }

  if (!isFirebaseConfigured()) {
    console.log('[CloudSync] Firebase not configured — cloud sync disabled.');
    return false;
  }

  try {
    const hash = await hashApiKey(apiKey);
    userDocPath = hash;
    getDb(); // eagerly init Firestore
    console.log('[CloudSync] Initialised with user path:', hash.substring(0, 8) + '…');
    return true;
  } catch (err) {
    console.error('[CloudSync] Init failed:', err);
    userDocPath = null;
    return false;
  }
}

// ── Push Operations (Local → Cloud) ─────────────────────────────────

/**
 * Push a watched item to Firestore.
 * Uses tmdbId as the document ID for cross-device portability.
 */
async function pushItem(item: WatchedItem): Promise<void> {
  if (!isReady()) return;
  try {
    const db = getDb()!;
    const ref = doc(db, 'matinee_users', userDocPath!, 'watched_items', String(item.tmdbId));
    await setDoc(ref, {
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
      posterPath: item.posterPath ?? null,
      backdropPath: item.backdropPath ?? null,
      overview: item.overview ?? '',
      releaseDate: item.releaseDate ?? null,
      genres: item.genres ?? '[]',
      originalLanguage: item.originalLanguage ?? null,
      runtime: item.runtime ?? 0,
      voteAverage: item.voteAverage ?? 0,
      status: item.status,
      watchedDate: item.watchedDate ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? new Date().toISOString(),
      certification: item.certification ?? null,
      _syncedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[CloudSync] pushItem failed:', err);
  }
}

/**
 * Push a rating to Firestore.  Document ID = tmdbId of the rated item.
 */
async function pushRating(tmdbId: number, rating: Rating): Promise<void> {
  if (!isReady()) return;
  try {
    const db = getDb()!;
    const ref = doc(db, 'matinee_users', userDocPath!, 'ratings', String(tmdbId));
    await setDoc(ref, {
      tmdbId,
      overallRating: rating.overallRating,
      plotRating: rating.plotRating ?? null,
      actingRating: rating.actingRating ?? null,
      visualsRating: rating.visualsRating ?? null,
      soundtrackRating: rating.soundtrackRating ?? null,
      rewatchability: rating.rewatchability ?? null,
      moodEmoji: rating.moodEmoji ?? null,
      reviewText: rating.reviewText ?? null,
      createdAt: rating.createdAt,
      _syncedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[CloudSync] pushRating failed:', err);
  }
}

/**
 * Push an episode rating to Firestore.
 */
async function pushEpisodeRating(
  tmdbId: number,
  epRating: EpisodeRating
): Promise<void> {
  if (!isReady()) return;
  try {
    const db = getDb()!;
    const docId = `${tmdbId}_s${epRating.seasonNumber}_e${epRating.episodeNumber}`;
    const ref = doc(db, 'matinee_users', userDocPath!, 'episode_ratings', docId);
    await setDoc(ref, {
      tmdbId,
      seasonNumber: epRating.seasonNumber,
      episodeNumber: epRating.episodeNumber,
      rating: epRating.rating,
      reviewText: epRating.reviewText ?? null,
      createdAt: epRating.createdAt,
      _syncedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[CloudSync] pushEpisodeRating failed:', err);
  }
}

/**
 * Push director/actor associations for an item.
 */
async function pushPeople(
  tmdbId: number,
  people: PersonEntry[]
): Promise<void> {
  if (!isReady() || people.length === 0) return;
  try {
    const db = getDb()!;
    const batch = writeBatch(db);

    for (const person of people) {
      const docId = `${tmdbId}_${person.personId}_${person.role}`;
      const ref = doc(db, 'matinee_users', userDocPath!, 'people', docId);
      batch.set(ref, {
        tmdbId,
        personId: person.personId,
        personName: person.personName,
        role: person.role,
        profilePath: person.profilePath ?? null,
        _syncedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (err) {
    console.warn('[CloudSync] pushPeople failed:', err);
  }
}

/**
 * Push a single preference to Firestore.
 * All preferences are stored in a single document.
 */
async function pushPreference(key: string, value: string): Promise<void> {
  if (!isReady()) return;
  // Don't sync API key or sensitive data
  const EXCLUDED = new Set(['API_KEY_STORAGE', '@matinee_api_key']);
  if (EXCLUDED.has(key)) return;

  try {
    const db = getDb()!;
    const ref = doc(db, 'matinee_users', userDocPath!, 'meta', 'preferences');
    await setDoc(ref, { [key]: value, _syncedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('[CloudSync] pushPreference failed:', err);
  }
}

/**
 * Delete a watched item and its associated data from the cloud.
 */
async function deleteItemCloud(tmdbId: number): Promise<void> {
  if (!isReady()) return;
  try {
    const db = getDb()!;

    // Delete the watched item document
    await deleteDoc(doc(db, 'matinee_users', userDocPath!, 'watched_items', String(tmdbId)));

    // Delete associated rating
    await deleteDoc(doc(db, 'matinee_users', userDocPath!, 'ratings', String(tmdbId)));

    // Delete associated episode ratings — we need to query and delete
    const epSnap = await getDocs(
      collection(db, 'matinee_users', userDocPath!, 'episode_ratings')
    );
    const batch = writeBatch(db);
    let batchCount = 0;
    epSnap.forEach((epDoc) => {
      if (epDoc.id.startsWith(`${tmdbId}_`)) {
        batch.delete(epDoc.ref);
        batchCount++;
      }
    });
    if (batchCount > 0) await batch.commit();

    // Delete associated people
    const peopleSnap = await getDocs(
      collection(db, 'matinee_users', userDocPath!, 'people')
    );
    const peopleBatch = writeBatch(db);
    let peopleBatchCount = 0;
    peopleSnap.forEach((pDoc) => {
      if (pDoc.id.startsWith(`${tmdbId}_`)) {
        peopleBatch.delete(pDoc.ref);
        peopleBatchCount++;
      }
    });
    if (peopleBatchCount > 0) await peopleBatch.commit();
  } catch (err) {
    console.warn('[CloudSync] deleteItemCloud failed:', err);
  }
}

/**
 * Delete an episode rating from the cloud.
 */
async function deleteEpisodeRatingCloud(
  tmdbId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<void> {
  if (!isReady()) return;
  try {
    const db = getDb()!;
    const docId = `${tmdbId}_s${seasonNumber}_e${episodeNumber}`;
    await deleteDoc(doc(db, 'matinee_users', userDocPath!, 'episode_ratings', docId));
  } catch (err) {
    console.warn('[CloudSync] deleteEpisodeRatingCloud failed:', err);
  }
}

// ── Pull Operations (Cloud → Local) ─────────────────────────────────

interface CloudData {
  watchedItems: Record<string, DocumentData>;
  ratings: Record<string, DocumentData>;
  episodeRatings: Record<string, DocumentData>;
  people: Record<string, DocumentData>;
  preferences: Record<string, string>;
}

/**
 * Pull all user data from Firestore.
 */
async function pullAllData(): Promise<CloudData | null> {
  if (!isReady()) return null;

  try {
    const db = getDb()!;
    const basePath = `matinee_users/${userDocPath!}`;

    const [itemsSnap, ratingsSnap, epSnap, peopleSnap, prefsDoc] =
      await Promise.all([
        getDocs(collection(db, basePath, 'watched_items')),
        getDocs(collection(db, basePath, 'ratings')),
        getDocs(collection(db, basePath, 'episode_ratings')),
        getDocs(collection(db, basePath, 'people')),
        getDoc(doc(db, basePath, 'meta', 'preferences')),
      ]);

    const watchedItems: Record<string, DocumentData> = {};
    itemsSnap.forEach((d) => {
      watchedItems[d.id] = d.data();
    });

    const ratings: Record<string, DocumentData> = {};
    ratingsSnap.forEach((d) => {
      ratings[d.id] = d.data();
    });

    const episodeRatings: Record<string, DocumentData> = {};
    epSnap.forEach((d) => {
      episodeRatings[d.id] = d.data();
    });

    const people: Record<string, DocumentData> = {};
    peopleSnap.forEach((d) => {
      people[d.id] = d.data();
    });

    const preferences: Record<string, string> = {};
    if (prefsDoc.exists()) {
      const data = prefsDoc.data();
      for (const [k, v] of Object.entries(data)) {
        if (k !== '_syncedAt' && typeof v === 'string') {
          preferences[k] = v;
        }
      }
    }

    return { watchedItems, ratings, episodeRatings, people, preferences };
  } catch (err) {
    console.error('[CloudSync] pullAllData failed:', err);
    return null;
  }
}

// ── Full Sync ───────────────────────────────────────────────────────

/**
 * Perform a full bidirectional sync:
 * 1. Pull all cloud data
 * 2. Merge into local SQLite (cloud wins on conflict by updatedAt)
 * 3. Push any local-only items to cloud
 *
 * This function is imported and called by database.ts to avoid circular deps.
 * The merge logic is handled in database.ts via mergeCloudData().
 */
async function fullSync(
  mergeCloudToLocal: (data: CloudData) => Promise<void>,
  getLocalItems: () => Promise<WatchedItem[]>,
  getLocalRating: (itemId: number) => Promise<Rating | null>,
  getLocalEpisodeRatings: (itemId: number) => Promise<EpisodeRating[]>
): Promise<{ pulled: number; pushed: number }> {
  if (!isReady()) return { pulled: 0, pushed: 0 };
  if (_isSyncing) {
    console.log('[CloudSync] Sync already in progress — skipping.');
    return { pulled: 0, pushed: 0 };
  }

  _isSyncing = true;
  let pulled = 0;
  let pushed = 0;

  try {
    // Step 1: Pull from cloud and merge into local
    const cloudData = await pullAllData();
    if (cloudData) {
      pulled = Object.keys(cloudData.watchedItems).length;
      await mergeCloudToLocal(cloudData);
    }

    // Step 2: Push local items that aren't in the cloud yet
    const localItems = await getLocalItems();
    const cloudTmdbIds = new Set(
      cloudData ? Object.keys(cloudData.watchedItems) : []
    );

    for (const item of localItems) {
      if (!cloudTmdbIds.has(String(item.tmdbId))) {
        await pushItem(item);
        // Also push the rating if it exists
        const rating = await getLocalRating(item.id);
        if (rating) {
          await pushRating(item.tmdbId, rating);
        }
        // Push episode ratings
        const epRatings = await getLocalEpisodeRatings(item.id);
        for (const ep of epRatings) {
          await pushEpisodeRating(item.tmdbId, ep);
        }
        pushed++;
      }
    }

    _lastSyncTime = new Date().toISOString();
    console.log(`[CloudSync] Sync complete — pulled ${pulled}, pushed ${pushed}`);
  } catch (err) {
    console.error('[CloudSync] fullSync failed:', err);
  } finally {
    _isSyncing = false;
  }

  return { pulled, pushed };
}

// ── Destructive Operations ──────────────────────────────────────────

/**
 * Delete ALL user data from Firestore.  This is irreversible.
 */
async function deleteAllCloudData(): Promise<void> {
  if (!isReady()) return;

  try {
    const db = getDb()!;
    const basePath = `matinee_users/${userDocPath!}`;

    // Collect all subcollection names and delete their documents
    const subcollections = [
      'watched_items',
      'ratings',
      'episode_ratings',
      'people',
      'meta',
    ];

    for (const subcol of subcollections) {
      const snap = await getDocs(collection(db, basePath, subcol));
      if (snap.empty) continue;

      // Firestore batches support up to 500 operations
      const BATCH_SIZE = 450;
      let batch = writeBatch(db);
      let count = 0;

      snap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
        count++;
        if (count >= BATCH_SIZE) {
          batch.commit().catch((e) =>
            console.warn(`[CloudSync] Batch delete error in ${subcol}:`, e)
          );
          batch = writeBatch(db);
          count = 0;
        }
      });

      if (count > 0) await batch.commit();
    }

    // Delete the user root document itself (if it exists)
    await deleteDoc(doc(db, 'matinee_users', userDocPath!));

    console.log('[CloudSync] All cloud data deleted.');
  } catch (err) {
    console.error('[CloudSync] deleteAllCloudData failed:', err);
    throw err; // Re-throw so the UI can show an error
  }
}

// ── Status ──────────────────────────────────────────────────────────

function getLastSyncTime(): string | null {
  return _lastSyncTime;
}

function isSyncing(): boolean {
  return _isSyncing;
}

function isCloudEnabled(): boolean {
  return isFirebaseConfigured() && !!userDocPath;
}

// ── Exports ─────────────────────────────────────────────────────────

export const cloudSync = {
  initCloudSync,
  isCloudEnabled,
  isReady,
  isSyncing,
  getLastSyncTime,

  // Push (local → cloud)
  pushItem,
  pushRating,
  pushEpisodeRating,
  pushPeople,
  pushPreference,
  deleteItemCloud,
  deleteEpisodeRatingCloud,

  // Pull (cloud → local)
  pullAllData,

  // Full sync
  fullSync,

  // Destructive
  deleteAllCloudData,
};

export type { CloudData };
