import * as SQLite from 'expo-sqlite';
import type { SQLiteBindValue } from 'expo-sqlite';
import type {
  WatchedItem,
  Rating,
  EpisodeRating,
  ItemStatus,
  MediaType,
} from '../types';
import { cloudSync } from './cloudSync';
import type { CloudData } from './cloudSync';

export let dbChangeTimestamp = Date.now();

export function notifyDbChanged() {
  dbChangeTimestamp = Date.now();
}

// ─── Derived input / update types ───────────────────────────────────

export type NewWatchedItem = Omit<WatchedItem, 'id' | 'createdAt' | 'updatedAt'>;

export type WatchedItemUpdate = Partial<Omit<WatchedItem, 'id' | 'createdAt'>>;

export type NewRating = Omit<Rating, 'id' | 'createdAt'>;

export type RatingUpdate = Partial<Omit<Rating, 'id' | 'itemId' | 'createdAt'>>;

// ─── People (Directors / Actors) ────────────────────────────────────

export type PersonRole = 'director' | 'actor';

export interface PersonEntry {
  itemId: number;
  personId: number;
  personName: string;
  role: PersonRole;
  profilePath: string | null;
}

// ─── Stats return types ─────────────────────────────────────────────

export interface WatchStats {
  totalWatched: number;
  totalMovies: number;
  totalSeries: number;
  totalHours: number;
  averageRating: number;
}

export interface GenreCount {
  genre: string;
  count: number;
}

export interface RatingCount {
  rating: number;
  count: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface MonthCount {
  month: number;
  count: number;
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
}

export interface TopPerson {
  personId: number;
  personName: string;
  profilePath: string | null;
  count: number;
}

export interface MatineeBackup {
  app: 'Matinee';
  schemaVersion: 1;
  exportedAt: string;
  watchedItems: WatchedItem[];
  ratings: Rating[];
  episodeRatings: EpisodeRating[];
  people: PersonEntry[];
  preferences: Record<string, string>;
}

export interface ImportSummary {
  items: number;
  ratings: number;
  episodeRatings: number;
  people: number;
  preferences: number;
}

// ─── Singleton ──────────────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

const DB_NAME = 'matinee.db';
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_EXCLUDED_PREFERENCES = new Set(['API_KEY_STORAGE', '@matinee_api_key']);

function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error(
      'Database not initialised – call initDatabase() before using any DB method.'
    );
  }
  return db;
}

async function getDbAsync(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    await initDatabase();
  }
  return getDb();
}

// ─── Initialisation ─────────────────────────────────────────────────

export async function initDatabase(): Promise<void> {
  if (db) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      db = await SQLite.openDatabaseAsync(DB_NAME);

      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync('PRAGMA foreign_keys = ON;');

      await db.execAsync(`
      CREATE TABLE IF NOT EXISTS watched_items (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id           INTEGER NOT NULL UNIQUE,
        media_type        TEXT    NOT NULL CHECK (media_type IN ('movie', 'tv')),
        title             TEXT    NOT NULL,
        poster_path       TEXT,
        backdrop_path     TEXT,
        overview          TEXT,
        release_date      TEXT,
        genres            TEXT    DEFAULT '[]',
        original_language TEXT,
        runtime           INTEGER,
        vote_average      REAL,
        status            TEXT    NOT NULL DEFAULT 'watched'
                          CHECK (status IN ('watched', 'watchlist', 'interested', 'not_interested')),
        watched_date      TEXT,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        certification     TEXT
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id           INTEGER NOT NULL,
        overall_rating    REAL    NOT NULL,
        plot_rating       REAL,
        acting_rating     REAL,
        visuals_rating    REAL,
        soundtrack_rating REAL,
        rewatchability    REAL,
        mood_emoji        TEXT,
        review_text       TEXT,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (item_id) REFERENCES watched_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS episode_ratings (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id           INTEGER NOT NULL,
        season_number     INTEGER NOT NULL,
        episode_number    INTEGER NOT NULL,
        rating            REAL NOT NULL,
        review_text       TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (item_id) REFERENCES watched_items(id) ON DELETE CASCADE,
        UNIQUE(item_id, season_number, episode_number)
      );

      CREATE TABLE IF NOT EXISTS tmdb_cache (
        cache_key   TEXT PRIMARY KEY,
        data        TEXT    NOT NULL,
        cached_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS director_actor_cache (
        item_id       INTEGER NOT NULL,
        person_id     INTEGER NOT NULL,
        person_name   TEXT    NOT NULL,
        role          TEXT    NOT NULL CHECK (role IN ('director', 'actor')),
        profile_path  TEXT,
        FOREIGN KEY (item_id) REFERENCES watched_items(id) ON DELETE CASCADE,
        PRIMARY KEY (item_id, person_id, role)
      );

      CREATE INDEX IF NOT EXISTS idx_watched_status       ON watched_items(status);
      CREATE INDEX IF NOT EXISTS idx_watched_media_type    ON watched_items(media_type);
      CREATE INDEX IF NOT EXISTS idx_watched_watched_date  ON watched_items(watched_date);
      CREATE INDEX IF NOT EXISTS idx_ratings_item          ON ratings(item_id);
      CREATE INDEX IF NOT EXISTS idx_episode_ratings_item  ON episode_ratings(item_id);
      CREATE INDEX IF NOT EXISTS idx_cache_expires         ON tmdb_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_dac_person            ON director_actor_cache(person_id);
    `);

      // Migration: Add certification column to watched_items if it doesn't exist (for existing installs)
      try {
        await db.execAsync('ALTER TABLE watched_items ADD COLUMN certification TEXT;');
      } catch (err) {
        // Ignored if column already exists
      }

      // Check if we need to migrate status check constraint
      const tableSqlRow = await db.getFirstAsync<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='watched_items'"
      );
      if (tableSqlRow && !tableSqlRow.sql.includes('not_interested')) {
        console.log('[Matinee DB] Migrating watched_items to support not_interested status...');
        await db.execAsync('PRAGMA foreign_keys = OFF;');
        await db.execAsync('PRAGMA legacy_alter_table = ON;');
        await db.execAsync('BEGIN TRANSACTION;');
        try {
          await db.execAsync('ALTER TABLE watched_items RENAME TO watched_items_old;');
          await db.execAsync(`
            CREATE TABLE watched_items (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              tmdb_id           INTEGER NOT NULL UNIQUE,
              media_type        TEXT    NOT NULL CHECK (media_type IN ('movie', 'tv')),
              title             TEXT    NOT NULL,
              poster_path       TEXT,
              backdrop_path     TEXT,
              overview          TEXT,
              release_date      TEXT,
              genres            TEXT    DEFAULT '[]',
              original_language TEXT,
              runtime           INTEGER,
              vote_average      REAL,
              status            TEXT    NOT NULL DEFAULT 'watched'
                                CHECK (status IN ('watched', 'watchlist', 'interested', 'not_interested')),
              watched_date      TEXT,
              created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
              updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
              certification     TEXT
            );
          `);
          await db.execAsync(`
            INSERT INTO watched_items (
              id, tmdb_id, media_type, title, poster_path, backdrop_path, overview,
              release_date, genres, original_language, runtime, vote_average,
              status, watched_date, created_at, updated_at, certification
            )
            SELECT 
              id, tmdb_id, media_type, title, poster_path, backdrop_path, overview,
              release_date, genres, original_language, runtime, vote_average,
              status, watched_date, created_at, updated_at, certification
            FROM watched_items_old;
          `);
          await db.execAsync('DROP TABLE watched_items_old;');
          await db.execAsync('COMMIT;');
          console.log('[Matinee DB] Migration completed successfully.');
        } catch (migrationError) {
          await db.execAsync('ROLLBACK;');
          console.error('[Matinee DB] Migration failed:', migrationError);
        } finally {
          await db.execAsync('PRAGMA legacy_alter_table = OFF;');
          await db.execAsync('PRAGMA foreign_keys = ON;');
        }
      }

      // Repair foreign keys referencing watched_items_old if any exist (e.g. from previous broken migrations)
      try {
        const checkTables = ['ratings', 'episode_ratings', 'director_actor_cache'];
        for (const t of checkTables) {
          const row = await db.getFirstAsync<{ sql: string }>(
            `SELECT sql FROM sqlite_master WHERE type='table' AND name='${t}'`
          );
          if (row && row.sql.includes('watched_items_old')) {
            console.log(`[Matinee DB] Repairing foreign keys for table ${t}...`);
            await db.execAsync('PRAGMA foreign_keys = OFF;');
            await db.execAsync('BEGIN TRANSACTION;');
            try {
              if (t === 'ratings') {
                await db.execAsync('ALTER TABLE ratings RENAME TO ratings_old;');
                await db.execAsync(`
                  CREATE TABLE ratings (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_id           INTEGER NOT NULL,
                    overall_rating    REAL    NOT NULL,
                    plot_rating       REAL,
                    acting_rating     REAL,
                    visuals_rating    REAL,
                    soundtrack_rating REAL,
                    rewatchability    REAL,
                    mood_emoji        TEXT,
                    review_text       TEXT,
                    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (item_id) REFERENCES watched_items(id) ON DELETE CASCADE
                  );
                `);
                await db.execAsync(`
                  INSERT INTO ratings (
                    id, item_id, overall_rating, plot_rating, acting_rating,
                    visuals_rating, soundtrack_rating, rewatchability, mood_emoji, review_text, created_at
                  )
                  SELECT 
                    id, item_id, overall_rating, plot_rating, acting_rating,
                    visuals_rating, soundtrack_rating, rewatchability, mood_emoji, review_text, created_at
                  FROM ratings_old;
                `);
                await db.execAsync('DROP TABLE ratings_old;');
              } else if (t === 'episode_ratings') {
                await db.execAsync('ALTER TABLE episode_ratings RENAME TO episode_ratings_old;');
                await db.execAsync(`
                  CREATE TABLE episode_ratings (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_id           INTEGER NOT NULL,
                    season_number     INTEGER NOT NULL,
                    episode_number    INTEGER NOT NULL,
                    rating            REAL NOT NULL,
                    review_text       TEXT,
                    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (item_id) REFERENCES watched_items(id) ON DELETE CASCADE,
                    UNIQUE(item_id, season_number, episode_number)
                  );
                `);
                await db.execAsync(`
                  INSERT INTO episode_ratings (
                    id, item_id, season_number, episode_number, rating, review_text, created_at
                  )
                  SELECT 
                    id, item_id, season_number, episode_number, rating, review_text, created_at
                  FROM episode_ratings_old;
                `);
                await db.execAsync('DROP TABLE episode_ratings_old;');
              } else if (t === 'director_actor_cache') {
                await db.execAsync('ALTER TABLE director_actor_cache RENAME TO director_actor_cache_old;');
                await db.execAsync(`
                  CREATE TABLE director_actor_cache (
                    item_id       INTEGER NOT NULL,
                    person_id     INTEGER NOT NULL,
                    person_name   TEXT    NOT NULL,
                    role          TEXT    NOT NULL CHECK (role IN ('director', 'actor')),
                    profile_path  TEXT,
                    FOREIGN KEY (item_id) REFERENCES watched_items(id) ON DELETE CASCADE,
                    PRIMARY KEY (item_id, person_id, role)
                  );
                `);
                await db.execAsync(`
                  INSERT INTO director_actor_cache (
                    item_id, person_id, person_name, role, profile_path
                  )
                  SELECT 
                    item_id, person_id, person_name, role, profile_path
                  FROM director_actor_cache_old;
                `);
                await db.execAsync('DROP TABLE director_actor_cache_old;');
              }
              await db.execAsync('COMMIT;');
              console.log(`[Matinee DB] Table ${t} repaired successfully.`);
            } catch (repairErr) {
              await db.execAsync('ROLLBACK;');
              console.error(`[Matinee DB] Repair for table ${t} failed:`, repairErr);
            } finally {
              await db.execAsync('PRAGMA foreign_keys = ON;');
            }
          }
        }
      } catch (checkErr) {
        console.warn('[Matinee DB] FK repair check failed:', checkErr);
      }

      // Data Migration: transition rated items to watched status
      await db.execAsync(`
      UPDATE watched_items 
      SET status = 'watched'
      WHERE status != 'watched' 
        AND (
          id IN (SELECT item_id FROM ratings)
          OR id IN (SELECT item_id FROM episode_ratings)
        );
    `);

      // Data Migration: ensure all watched items have a valid watched_date
      await db.execAsync(`
      UPDATE watched_items 
      SET watched_date = COALESCE(watched_date, substr(created_at, 1, 10), date('now'))
      WHERE status = 'watched' 
        AND (watched_date IS NULL OR watched_date = '' OR watched_date = 'null');
    `);
    } catch (error) {
      db = null;
      console.error('[Matinee DB] Initialisation failed:', error);
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// ─── Row ↔ Model helpers ────────────────────────────────────────────
// The database uses snake_case columns but the app uses camelCase types.

interface WatchedItemRow {
  id: number;
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  release_date: string;
  genres: string;
  original_language: string;
  runtime: number;
  vote_average: number;
  status: string;
  watched_date: string | null;
  created_at: string;
  updated_at: string;
  user_rating?: number | null;
  certification?: string | null;
}

function rowToWatchedItem(row: WatchedItemRow): WatchedItem {
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    mediaType: row.media_type as MediaType,
    title: row.title,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    overview: row.overview,
    releaseDate: row.release_date,
    genres: row.genres,
    originalLanguage: row.original_language,
    runtime: row.runtime,
    voteAverage: row.vote_average,
    status: row.status as ItemStatus,
    watchedDate: row.watched_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userRating: row.user_rating,
    certification: row.certification,
  };
}

interface RatingRow {
  id: number;
  item_id: number;
  overall_rating: number;
  plot_rating: number | null;
  acting_rating: number | null;
  visuals_rating: number | null;
  soundtrack_rating: number | null;
  rewatchability: number | null;
  mood_emoji: string | null;
  review_text: string | null;
  created_at: string;
}

function rowToRating(row: RatingRow): Rating {
  return {
    id: row.id,
    itemId: row.item_id,
    overallRating: row.overall_rating,
    plotRating: row.plot_rating,
    actingRating: row.acting_rating,
    visualsRating: row.visuals_rating,
    soundtrackRating: row.soundtrack_rating,
    rewatchability: row.rewatchability,
    moodEmoji: row.mood_emoji,
    reviewText: row.review_text,
    createdAt: row.created_at,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  WATCHED ITEMS – CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function addItem(item: NewWatchedItem): Promise<number> {
  const database = await getDbAsync();
  try {
    const existing = await getItem(item.tmdbId);
    if (existing) {
      await updateItem(existing.id, {
        status: item.status,
        watchedDate: item.watchedDate,
        updatedAt: new Date().toISOString(),
      });
      return existing.id;
    }

    const result = await database.runAsync(
      `INSERT INTO watched_items
        (tmdb_id, media_type, title, poster_path, backdrop_path, overview,
         release_date, genres, original_language, runtime, vote_average,
         status, watched_date, certification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.tmdbId,
        item.mediaType,
        item.title,
        item.posterPath ?? null,
        item.backdropPath ?? null,
        item.overview ?? null,
        item.releaseDate ?? null,
        item.genres ?? '[]',
        item.originalLanguage ?? null,
        item.runtime ?? null,
        item.voteAverage ?? null,
        item.status,
        item.watchedDate ?? null,
        item.certification ?? null,
      ] as SQLiteBindValue[]
    );

    // ── Cloud sync (fire-and-forget) ──
    const saved = await getItem(item.tmdbId);
    if (saved) {
      cloudSync.pushItem(saved).catch(() => {});
    }

    notifyDbChanged();
    return result.lastInsertRowId;
  } catch (error) {
    console.error('[Matinee DB] addItem failed:', error);
    throw error;
  }
}

export async function updateItem(
  id: number,
  updates: WatchedItemUpdate
): Promise<void> {
  const database = await getDbAsync();

  // Map camelCase update keys → snake_case column names
  const columnMap: Record<string, string> = {
    tmdbId: 'tmdb_id',
    mediaType: 'media_type',
    title: 'title',
    posterPath: 'poster_path',
    backdropPath: 'backdrop_path',
    overview: 'overview',
    releaseDate: 'release_date',
    genres: 'genres',
    originalLanguage: 'original_language',
    runtime: 'runtime',
    voteAverage: 'vote_average',
    status: 'status',
    watchedDate: 'watched_date',
    updatedAt: 'updated_at',
    certification: 'certification',
  };

  const setClauses: string[] = [];
  const values: SQLiteBindValue[] = [];

  for (const [camel, column] of Object.entries(columnMap)) {
    if (camel in updates) {
      setClauses.push(`${column} = ?`);
      values.push((updates as Record<string, SQLiteBindValue>)[camel] ?? null);
    }
  }

  if (setClauses.length === 0) return;

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  try {
    await database.runAsync(
      `UPDATE watched_items SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    // ── Cloud sync (fire-and-forget) ──
    const row = await database.getFirstAsync<WatchedItemRow>(
      'SELECT * FROM watched_items WHERE id = ?',
      [id]
    );
    if (row) {
      cloudSync.pushItem(rowToWatchedItem(row)).catch(() => {});
    }
    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] updateItem failed:', error);
    throw error;
  }
}

export async function deleteItem(id: number): Promise<void> {
  const database = await getDbAsync();
  try {
    // Get tmdbId before deleting for cloud sync
    const row = await database.getFirstAsync<{ tmdb_id: number }>(
      'SELECT tmdb_id FROM watched_items WHERE id = ?',
      [id]
    );

    await database.runAsync('DELETE FROM watched_items WHERE id = ?', [id]);

    // ── Cloud sync (fire-and-forget) ──
    if (row) {
      cloudSync.deleteItemCloud(row.tmdb_id).catch(() => {});
    }
    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] deleteItem failed:', error);
    throw error;
  }
}

export async function getItem(tmdbId: number): Promise<WatchedItem | null> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<WatchedItemRow>(
      'SELECT * FROM watched_items WHERE tmdb_id = ?',
      [tmdbId]
    );
    return row ? rowToWatchedItem(row) : null;
  } catch (error) {
    console.error('[Matinee DB] getItem failed:', error);
    throw error;
  }
}

export async function getAllItems(
  status?: ItemStatus,
  mediaType?: MediaType
): Promise<WatchedItem[]> {
  const database = await getDbAsync();

  let query = `
    SELECT w.*, r.overall_rating AS user_rating 
    FROM watched_items w
    LEFT JOIN ratings r ON r.item_id = w.id
  `;
  const conditions: string[] = [];
  const params: SQLiteBindValue[] = [];

  if (status) {
    conditions.push('w.status = ?');
    params.push(status);
  }
  if (mediaType) {
    conditions.push('w.media_type = ?');
    params.push(mediaType);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY w.updated_at DESC';

  try {
    const rows = await database.getAllAsync<WatchedItemRow>(query, params);
    return rows.map(rowToWatchedItem);
  } catch (error) {
    console.error('[Matinee DB] getAllItems failed:', error);
    throw error;
  }
}

export async function getRecentItems(
  limit: number = 10
): Promise<WatchedItem[]> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<WatchedItemRow>(
      `SELECT * FROM watched_items
       WHERE status = 'watched'
       ORDER BY watched_date DESC, updated_at DESC
       LIMIT ?`,
      [limit]
    );
    return rows.map(rowToWatchedItem);
  } catch (error) {
    console.error('[Matinee DB] getRecentItems failed:', error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RATINGS – CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function addRating(rating: NewRating): Promise<number> {
  const database = await getDbAsync();
  try {
    const result = await database.runAsync(
      `INSERT INTO ratings
        (item_id, overall_rating, plot_rating, acting_rating, visuals_rating,
         soundtrack_rating, rewatchability, mood_emoji, review_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rating.itemId,
        rating.overallRating,
        rating.plotRating ?? null,
        rating.actingRating ?? null,
        rating.visualsRating ?? null,
        rating.soundtrackRating ?? null,
        rating.rewatchability ?? null,
        rating.moodEmoji ?? null,
        rating.reviewText ?? null,
      ] as SQLiteBindValue[]
    );

    // ── Cloud sync (fire-and-forget) ──
    const itemRow = await database.getFirstAsync<{ tmdb_id: number }>(
      'SELECT tmdb_id FROM watched_items WHERE id = ?',
      [rating.itemId]
    );
    if (itemRow) {
      const savedRating = await getRating(rating.itemId);
      if (savedRating) {
        cloudSync.pushRating(itemRow.tmdb_id, savedRating).catch(() => {});
      }
    }

    notifyDbChanged();
    return result.lastInsertRowId;
  } catch (error) {
    console.error('[Matinee DB] addRating failed:', error);
    throw error;
  }
}

export async function getRating(itemId: number): Promise<Rating | null> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<RatingRow>(
      'SELECT * FROM ratings WHERE item_id = ? ORDER BY created_at DESC LIMIT 1',
      [itemId]
    );
    return row ? rowToRating(row) : null;
  } catch (error) {
    console.error('[Matinee DB] getRating failed:', error);
    throw error;
  }
}

export async function updateRating(
  id: number,
  updates: RatingUpdate
): Promise<void> {
  const database = await getDbAsync();

  const columnMap: Record<string, string> = {
    overallRating: 'overall_rating',
    plotRating: 'plot_rating',
    actingRating: 'acting_rating',
    visualsRating: 'visuals_rating',
    soundtrackRating: 'soundtrack_rating',
    rewatchability: 'rewatchability',
    moodEmoji: 'mood_emoji',
    reviewText: 'review_text',
  };

  const setClauses: string[] = [];
  const values: SQLiteBindValue[] = [];

  for (const [camel, column] of Object.entries(columnMap)) {
    if (camel in updates) {
      setClauses.push(`${column} = ?`);
      values.push((updates as Record<string, SQLiteBindValue>)[camel] ?? null);
    }
  }

  if (setClauses.length === 0) return;

  values.push(id);

  try {
    await database.runAsync(
      `UPDATE ratings SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    // ── Cloud sync (fire-and-forget) ──
    const ratingRow = await database.getFirstAsync<RatingRow & { tmdb_id?: number }>(
      `SELECT r.*, w.tmdb_id FROM ratings r
       JOIN watched_items w ON w.id = r.item_id
       WHERE r.id = ?`,
      [id]
    );
    if (ratingRow?.tmdb_id) {
      cloudSync.pushRating(ratingRow.tmdb_id, rowToRating(ratingRow)).catch(() => {});
    }
    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] updateRating failed:', error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TMDB CACHE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getCache<T = unknown>(key: string): Promise<T | null> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<{ data: string }>(
      `SELECT data FROM tmdb_cache
       WHERE cache_key = ? AND expires_at > datetime('now')`,
      [key]
    );
    if (!row) return null;
    return JSON.parse(row.data) as T;
  } catch (error) {
    console.error('[Matinee DB] getCache failed:', error);
    return null;
  }
}

export async function setCache(
  key: string,
  data: unknown,
  ttlMinutes: number = 60
): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync(
      `INSERT OR REPLACE INTO tmdb_cache (cache_key, data, cached_at, expires_at)
       VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' minutes'))`,
      [key, JSON.stringify(data), ttlMinutes]
    );
  } catch (error) {
    console.error('[Matinee DB] setCache failed:', error);
  }
}

export async function clearExpiredCache(): Promise<number> {
  const database = await getDbAsync();
  try {
    const result = await database.runAsync(
      "DELETE FROM tmdb_cache WHERE expires_at <= datetime('now')"
    );
    return result.changes;
  } catch (error) {
    console.error('[Matinee DB] clearExpiredCache failed:', error);
    return 0;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PREFERENCES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getPreference(key: string): Promise<string | null> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM preferences WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  } catch (error) {
    console.error('[Matinee DB] getPreference failed:', error);
    return null;
  }
}

export async function setPreference(
  key: string,
  value: string
): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)',
      [key, value]
    );

    // ── Cloud sync (fire-and-forget) ──
    cloudSync.pushPreference(key, value).catch(() => {});
    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] setPreference failed:', error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BACKUP / RESTORE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isMatineeBackup(value: unknown): value is MatineeBackup {
  if (!value || typeof value !== 'object') return false;
  const backup = value as Partial<MatineeBackup>;
  return (
    backup.app === 'Matinee' &&
    backup.schemaVersion === BACKUP_SCHEMA_VERSION &&
    Array.isArray(backup.watchedItems) &&
    Array.isArray(backup.ratings) &&
    Array.isArray(backup.episodeRatings) &&
    Array.isArray(backup.people) &&
    !!backup.preferences &&
    typeof backup.preferences === 'object'
  );
}

export async function exportUserData(): Promise<MatineeBackup> {
  const database = await getDbAsync();

  const [items, ratings, episodeRatings, peopleRows, preferenceRows] =
    await Promise.all([
      database.getAllAsync<WatchedItemRow>('SELECT * FROM watched_items ORDER BY updated_at DESC'),
      database.getAllAsync<RatingRow>('SELECT * FROM ratings ORDER BY created_at DESC'),
      database.getAllAsync<EpisodeRatingRow>(
        'SELECT * FROM episode_ratings ORDER BY created_at DESC'
      ),
      database.getAllAsync<{
        item_id: number;
        person_id: number;
        person_name: string;
        role: PersonRole;
        profile_path: string | null;
      }>('SELECT * FROM director_actor_cache'),
      database.getAllAsync<{ key: string; value: string }>('SELECT * FROM preferences'),
    ]);

  const preferences = preferenceRows.reduce<Record<string, string>>((acc, row) => {
    if (!BACKUP_EXCLUDED_PREFERENCES.has(row.key)) {
      acc[row.key] = row.value;
    }
    return acc;
  }, {});

  return {
    app: 'Matinee',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    watchedItems: items.map(rowToWatchedItem),
    ratings: ratings.map(rowToRating),
    episodeRatings: episodeRatings.map(rowToEpisodeRating),
    people: peopleRows.map((row) => ({
      itemId: row.item_id,
      personId: row.person_id,
      personName: row.person_name,
      role: row.role,
      profilePath: row.profile_path,
    })),
    preferences,
  };
}

export async function importUserData(rawBackup: unknown): Promise<ImportSummary> {
  if (!isMatineeBackup(rawBackup)) {
    throw new Error('This is not a valid Matinee backup file.');
  }

  const database = await getDbAsync();
  const itemIdMap = new Map<number, number>();

  for (const item of rawBackup.watchedItems) {
    await database.runAsync(
      `INSERT INTO watched_items
        (tmdb_id, media_type, title, poster_path, backdrop_path, overview,
         release_date, genres, original_language, runtime, vote_average,
         status, watched_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET
         media_type = excluded.media_type,
         title = excluded.title,
         poster_path = excluded.poster_path,
         backdrop_path = excluded.backdrop_path,
         overview = excluded.overview,
         release_date = excluded.release_date,
         genres = excluded.genres,
         original_language = excluded.original_language,
         runtime = excluded.runtime,
         vote_average = excluded.vote_average,
         status = excluded.status,
         watched_date = excluded.watched_date,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
      [
        item.tmdbId,
        item.mediaType,
        item.title,
        item.posterPath ?? null,
        item.backdropPath ?? null,
        item.overview ?? null,
        item.releaseDate ?? null,
        item.genres ?? '[]',
        item.originalLanguage ?? null,
        item.runtime ?? null,
        item.voteAverage ?? null,
        item.status,
        item.watchedDate ?? null,
        item.createdAt,
        item.updatedAt,
      ] as SQLiteBindValue[]
    );

    const row = await database.getFirstAsync<{ id: number }>(
      'SELECT id FROM watched_items WHERE tmdb_id = ?',
      [item.tmdbId]
    );
    if (row) itemIdMap.set(item.id, row.id);
  }

  const importedItemIds = Array.from(new Set(itemIdMap.values()));
  for (const itemId of importedItemIds) {
    await database.runAsync('DELETE FROM ratings WHERE item_id = ?', [itemId]);
    await database.runAsync('DELETE FROM episode_ratings WHERE item_id = ?', [itemId]);
    await database.runAsync('DELETE FROM director_actor_cache WHERE item_id = ?', [itemId]);
  }

  let ratingCount = 0;
  for (const rating of rawBackup.ratings) {
    const itemId = itemIdMap.get(rating.itemId);
    if (!itemId) continue;
    await database.runAsync(
      `INSERT INTO ratings
        (item_id, overall_rating, plot_rating, acting_rating, visuals_rating,
         soundtrack_rating, rewatchability, mood_emoji, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        rating.overallRating,
        rating.plotRating ?? null,
        rating.actingRating ?? null,
        rating.visualsRating ?? null,
        rating.soundtrackRating ?? null,
        rating.rewatchability ?? null,
        rating.moodEmoji ?? null,
        rating.reviewText ?? null,
        rating.createdAt,
      ] as SQLiteBindValue[]
    );
    ratingCount += 1;
  }

  let episodeRatingCount = 0;
  for (const episodeRating of rawBackup.episodeRatings) {
    const itemId = itemIdMap.get(episodeRating.itemId);
    if (!itemId) continue;
    await database.runAsync(
      `INSERT OR REPLACE INTO episode_ratings
        (item_id, season_number, episode_number, rating, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        episodeRating.seasonNumber,
        episodeRating.episodeNumber,
        episodeRating.rating,
        episodeRating.reviewText ?? null,
        episodeRating.createdAt,
      ] as SQLiteBindValue[]
    );
    episodeRatingCount += 1;
  }

  let peopleCount = 0;
  for (const person of rawBackup.people) {
    const itemId = itemIdMap.get(person.itemId);
    if (!itemId) continue;
    await database.runAsync(
      `INSERT OR REPLACE INTO director_actor_cache
        (item_id, person_id, person_name, role, profile_path)
       VALUES (?, ?, ?, ?, ?)`,
      [
        itemId,
        person.personId,
        person.personName,
        person.role,
        person.profilePath ?? null,
      ] as SQLiteBindValue[]
    );
    peopleCount += 1;
  }

  let preferenceCount = 0;
  for (const [key, value] of Object.entries(rawBackup.preferences)) {
    if (!BACKUP_EXCLUDED_PREFERENCES.has(key)) {
      await setPreference(key, value);
      preferenceCount += 1;
    }
  }

  return {
    items: itemIdMap.size,
    ratings: ratingCount,
    episodeRatings: episodeRatingCount,
    people: peopleCount,
    preferences: preferenceCount,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DIRECTORS & ACTORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function saveDirectorsActors(
  itemId: number,
  people: PersonEntry[]
): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync(
      'DELETE FROM director_actor_cache WHERE item_id = ?',
      [itemId]
    );

    for (const p of people) {
      await database.runAsync(
        `INSERT OR IGNORE INTO director_actor_cache
          (item_id, person_id, person_name, role, profile_path)
         VALUES (?, ?, ?, ?, ?)`,
        [p.itemId, p.personId, p.personName, p.role, p.profilePath ?? null]
      );
    }

    // ── Cloud sync (fire-and-forget) ──
    const itemRow = await database.getFirstAsync<{ tmdb_id: number }>(
      'SELECT tmdb_id FROM watched_items WHERE id = ?',
      [itemId]
    );
    if (itemRow) {
      cloudSync.pushPeople(itemRow.tmdb_id, people).catch(() => {});
    }
  } catch (error) {
    console.error('[Matinee DB] saveDirectorsActors failed:', error);
    throw error;
  }
}

export async function getTopDirectors(
  limit: number = 10,
  year?: number
): Promise<TopPerson[]> {
  const database = await getDbAsync();
  try {
    let query = `
      SELECT
         d.person_id,
         d.person_name,
         d.profile_path,
         COUNT(DISTINCT d.item_id) AS count
      FROM director_actor_cache d
      INNER JOIN watched_items w ON w.id = d.item_id AND w.status = 'watched'
      WHERE d.role = 'director'
    `;
    const params: SQLiteBindValue[] = [];
    if (year) {
      query += ' AND substr(w.watched_date, 1, 10) >= ? AND substr(w.watched_date, 1, 10) < ?';
      params.push(`${year}-01-01`, `${year + 1}-01-01`);
    }
    query += ' GROUP BY d.person_id ORDER BY count DESC LIMIT ?';
    params.push(limit);

    const rows = await database.getAllAsync<{
      person_id: number;
      person_name: string;
      profile_path: string | null;
      count: number;
    }>(query, params);
    return rows.map((r) => ({
      personId: r.person_id,
      personName: r.person_name,
      profilePath: r.profile_path,
      count: r.count,
    }));
  } catch (error) {
    console.error('[Matinee DB] getTopDirectors failed:', error);
    return [];
  }
}

export async function getTopActors(
  limit: number = 10,
  year?: number
): Promise<TopPerson[]> {
  const database = await getDbAsync();
  try {
    let query = `
      SELECT
         d.person_id,
         d.person_name,
         d.profile_path,
         COUNT(DISTINCT d.item_id) AS count
      FROM director_actor_cache d
      INNER JOIN watched_items w ON w.id = d.item_id AND w.status = 'watched'
      WHERE d.role = 'actor'
    `;
    const params: SQLiteBindValue[] = [];
    if (year) {
      query += ' AND substr(w.watched_date, 1, 10) >= ? AND substr(w.watched_date, 1, 10) < ?';
      params.push(`${year}-01-01`, `${year + 1}-01-01`);
    }
    query += ' GROUP BY d.person_id ORDER BY count DESC LIMIT ?';
    params.push(limit);

    const rows = await database.getAllAsync<{
      person_id: number;
      person_name: string;
      profile_path: string | null;
      count: number;
    }>(query, params);
    return rows.map((r) => ({
      personId: r.person_id,
      personName: r.person_name,
      profilePath: r.profile_path,
      count: r.count,
    }));
  } catch (error) {
    console.error('[Matinee DB] getTopActors failed:', error);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STATS QUERIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getWatchStats(year?: number): Promise<WatchStats> {
  const database = await getDbAsync();
  try {
    let query = `
      SELECT
         COUNT(*)                                               AS totalWatched,
         SUM(CASE WHEN media_type = 'movie' THEN 1 ELSE 0 END) AS totalMovies,
         SUM(CASE WHEN media_type = 'tv'    THEN 1 ELSE 0 END) AS totalSeries,
         COALESCE(SUM(runtime), 0)                              AS totalMinutes
      FROM watched_items
      WHERE status = 'watched'
    `;
    const params: SQLiteBindValue[] = [];
    if (year) {
      query += ' AND substr(watched_date, 1, 10) >= ? AND substr(watched_date, 1, 10) < ?';
      params.push(`${year}-01-01`, `${year + 1}-01-01`);
    }
    const row = await database.getFirstAsync<{
      totalWatched: number;
      totalMovies: number;
      totalSeries: number;
      totalMinutes: number;
    }>(query, params);

    // Calculate average rating
    let avgQuery = `
      SELECT AVG(r.overall_rating) AS averageRating
      FROM ratings r
      JOIN watched_items w ON r.item_id = w.id
      WHERE w.status = 'watched'
    `;
    const avgParams: SQLiteBindValue[] = [];
    if (year) {
      avgQuery += ' AND substr(w.watched_date, 1, 10) >= ? AND substr(w.watched_date, 1, 10) < ?';
      avgParams.push(`${year}-01-01`, `${year + 1}-01-01`);
    }
    const avgRow = await database.getFirstAsync<{ averageRating: number | null }>(avgQuery, avgParams);
    console.log('[Matinee DB] getWatchStats averageRating result:', { avgRow, avgParams, year });

    return {
      totalWatched: row?.totalWatched ?? 0,
      totalMovies: row?.totalMovies ?? 0,
      totalSeries: row?.totalSeries ?? 0,
      totalHours: Math.round((row?.totalMinutes ?? 0) / 60),
      averageRating: avgRow?.averageRating ?? 0,
    };
  } catch (error) {
    console.error('[Matinee DB] getWatchStats failed:', error);
    return { totalWatched: 0, totalMovies: 0, totalSeries: 0, totalHours: 0, averageRating: 0 };
  }
}

export async function getGenreDistribution(year?: number): Promise<GenreCount[]> {
  const database = await getDbAsync();
  try {
    let query = `
      SELECT
         j.value AS genre,
         COUNT(*) AS count
      FROM watched_items w, json_each(w.genres) j
      WHERE w.status = 'watched'
    `;
    const params: SQLiteBindValue[] = [];
    if (year) {
      query += ' AND substr(w.watched_date, 1, 10) >= ? AND substr(w.watched_date, 1, 10) < ?';
      params.push(`${year}-01-01`, `${year + 1}-01-01`);
    }
    query += ' GROUP BY j.value ORDER BY count DESC';

    return await database.getAllAsync<GenreCount>(query, params);
  } catch (error) {
    console.error('[Matinee DB] getGenreDistribution failed:', error);
    return [];
  }
}

export async function getRatingDistribution(year?: number): Promise<RatingCount[]> {
  const database = await getDbAsync();
  try {
    let query = `
      SELECT
         CAST(ROUND(r.overall_rating) AS INTEGER) AS rating,
         COUNT(*) AS count
      FROM ratings r
      INNER JOIN watched_items w ON w.id = r.item_id AND w.status = 'watched'
    `;
    const params: SQLiteBindValue[] = [];
    if (year) {
      query += ' AND substr(w.watched_date, 1, 10) >= ? AND substr(w.watched_date, 1, 10) < ?';
      params.push(`${year}-01-01`, `${year + 1}-01-01`);
    }
    query += ' GROUP BY rating ORDER BY rating ASC';

    return await database.getAllAsync<RatingCount>(query, params);
  } catch (error) {
    console.error('[Matinee DB] getRatingDistribution failed:', error);
    return [];
  }
}

export async function getHeatmapData(year: number): Promise<HeatmapDay[]> {
  const database = await getDbAsync();
  try {
    return await database.getAllAsync<HeatmapDay>(
      `SELECT
         substr(watched_date, 1, 10) AS date,
         COUNT(*)     AS count
       FROM watched_items
       WHERE status = 'watched'
         AND watched_date IS NOT NULL
         AND substr(watched_date, 1, 10) >= ?
         AND substr(watched_date, 1, 10) < ?
       GROUP BY date
       ORDER BY date ASC`,
      [`${year}-01-01`, `${year + 1}-01-01`]
    );
  } catch (error) {
    console.error('[Matinee DB] getHeatmapData failed:', error);
    return [];
  }
}

export async function getMonthlyBreakdown(
  year: number
): Promise<MonthCount[]> {
  const database = await getDbAsync();
  try {
    return await database.getAllAsync<MonthCount>(
      `SELECT
         CAST(strftime('%m', watched_date) AS INTEGER) AS month,
         COUNT(*) AS count
       FROM watched_items
       WHERE status = 'watched'
         AND watched_date IS NOT NULL
         AND watched_date >= ?
         AND watched_date < ?
       GROUP BY month
       ORDER BY month ASC`,
      [`${year}-01-01`, `${year + 1}-01-01`]
    );
  } catch (error) {
    console.error('[Matinee DB] getMonthlyBreakdown failed:', error);
    return [];
  }
}

export async function getStreakInfo(): Promise<StreakInfo> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<{ d: string }>(
      `SELECT DISTINCT substr(watched_date, 1, 10) AS d
       FROM watched_items
       WHERE status = 'watched' AND watched_date IS NOT NULL
       ORDER BY d ASC`
    );

    if (rows.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    const dates = rows.map((r) => r.d);

    const toEpochDay = (iso: string): number => {
      const [y, m, d] = iso.split('-').map(Number);
      return Math.floor(new Date(y, m - 1, d).getTime() / 86_400_000);
    };

    // Compute longest streak
    let longestStreak = 1;
    let runStreak = 1;

    for (let i = 1; i < dates.length; i++) {
      const diff = toEpochDay(dates[i]) - toEpochDay(dates[i - 1]);
      if (diff === 1) {
        runStreak++;
        if (runStreak > longestStreak) longestStreak = runStreak;
      } else {
        runStreak = 1;
      }
    }

    // Compute current streak (must include today or yesterday)
    let currentStreak = 0;
    const today = new Date();
    const todayEpoch = Math.floor(
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      ).getTime() / 86_400_000
    );
    const lastDateEpoch = toEpochDay(dates[dates.length - 1]);

    if (todayEpoch - lastDateEpoch <= 1) {
      currentStreak = 1;
      for (let i = dates.length - 2; i >= 0; i--) {
        const diff = toEpochDay(dates[i + 1]) - toEpochDay(dates[i]);
        if (diff === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    return { currentStreak, longestStreak };
  } catch (error) {
    console.error('[Matinee DB] getStreakInfo failed:', error);
    return { currentStreak: 0, longestStreak: 0 };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EPISODE RATINGS – CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface EpisodeRatingRow {
  id: number;
  item_id: number;
  season_number: number;
  episode_number: number;
  rating: number;
  review_text: string | null;
  created_at: string;
}

function rowToEpisodeRating(row: EpisodeRatingRow): EpisodeRating {
  return {
    id: row.id,
    itemId: row.item_id,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    rating: row.rating,
    reviewText: row.review_text,
    createdAt: row.created_at,
  };
}

export async function addEpisodeRating(rating: {
  itemId: number;
  seasonNumber: number;
  episodeNumber: number;
  rating: number;
  reviewText?: string | null;
}): Promise<number> {
  const database = await getDbAsync();
  try {
    const result = await database.runAsync(
      `INSERT OR REPLACE INTO episode_ratings
        (item_id, season_number, episode_number, rating, review_text)
       VALUES (?, ?, ?, ?, ?)`,
      [
        rating.itemId,
        rating.seasonNumber,
        rating.episodeNumber,
        rating.rating,
        rating.reviewText ?? null,
      ] as SQLiteBindValue[]
    );

    // ── Cloud sync (fire-and-forget) ──
    const itemRow = await database.getFirstAsync<{ tmdb_id: number }>(
      'SELECT tmdb_id FROM watched_items WHERE id = ?',
      [rating.itemId]
    );
    if (itemRow) {
      const saved = await database.getFirstAsync<EpisodeRatingRow>(
        'SELECT * FROM episode_ratings WHERE id = ?',
        [result.lastInsertRowId]
      );
      if (saved) {
        cloudSync.pushEpisodeRating(itemRow.tmdb_id, rowToEpisodeRating(saved)).catch(() => {});
      }
    }

    notifyDbChanged();
    return result.lastInsertRowId;
  } catch (error) {
    console.error('[Matinee DB] addEpisodeRating failed:', error);
    throw error;
  }
}

export async function getEpisodeRatings(itemId: number): Promise<EpisodeRating[]> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<EpisodeRatingRow>(
      'SELECT * FROM episode_ratings WHERE item_id = ? ORDER BY season_number ASC, episode_number ASC',
      [itemId]
    );
    return rows.map(rowToEpisodeRating);
  } catch (error) {
    console.error('[Matinee DB] getEpisodeRatings failed:', error);
    throw error;
  }
}

export async function deleteEpisodeRating(id: number): Promise<void> {
  const database = await getDbAsync();
  try {
    // Get info before deleting for cloud sync
    const epRow = await database.getFirstAsync<EpisodeRatingRow & { tmdb_id?: number }>(
      `SELECT er.*, w.tmdb_id FROM episode_ratings er
       JOIN watched_items w ON w.id = er.item_id
       WHERE er.id = ?`,
      [id]
    );

    await database.runAsync('DELETE FROM episode_ratings WHERE id = ?', [id]);

    // ── Cloud sync (fire-and-forget) ──
    if (epRow?.tmdb_id) {
      cloudSync.deleteEpisodeRatingCloud(
        epRow.tmdb_id,
        epRow.season_number,
        epRow.episode_number
      ).catch(() => {});
    }
    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] deleteEpisodeRating failed:', error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CLOUD SYNC — Merge + Reset
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Merge data pulled from Firestore into the local SQLite database.
 * Uses "most recent updatedAt wins" for conflict resolution.
 */
export async function mergeCloudData(data: CloudData): Promise<void> {
  const database = await getDbAsync();

  // 1. Merge watched items
  for (const [, itemData] of Object.entries(data.watchedItems)) {
    const existing = await getItem(itemData.tmdbId as number);
    const cloudUpdated = itemData.updatedAt as string || '';

    if (existing) {
      // Cloud wins if it's newer
      if (cloudUpdated > (existing.updatedAt || '')) {
        await database.runAsync(
          `UPDATE watched_items SET
            media_type = ?, title = ?, poster_path = ?, backdrop_path = ?,
            overview = ?, release_date = ?, genres = ?, original_language = ?,
            runtime = ?, vote_average = ?, status = ?, watched_date = ?,
            updated_at = ?, certification = ?
           WHERE tmdb_id = ?`,
          [
            itemData.mediaType as string,
            itemData.title as string,
            (itemData.posterPath as string) ?? null,
            (itemData.backdropPath as string) ?? null,
            (itemData.overview as string) ?? null,
            (itemData.releaseDate as string) ?? null,
            (itemData.genres as string) ?? '[]',
            (itemData.originalLanguage as string) ?? null,
            (itemData.runtime as number) ?? 0,
            (itemData.voteAverage as number) ?? 0,
            itemData.status as string,
            (itemData.watchedDate as string) ?? null,
            cloudUpdated,
            (itemData.certification as string) ?? null,
            itemData.tmdbId as number,
          ] as SQLiteBindValue[]
        );
      }
    } else {
      // Item doesn't exist locally — insert it
      await database.runAsync(
        `INSERT INTO watched_items
          (tmdb_id, media_type, title, poster_path, backdrop_path, overview,
           release_date, genres, original_language, runtime, vote_average,
           status, watched_date, created_at, updated_at, certification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemData.tmdbId as number,
          itemData.mediaType as string,
          itemData.title as string,
          (itemData.posterPath as string) ?? null,
          (itemData.backdropPath as string) ?? null,
          (itemData.overview as string) ?? null,
          (itemData.releaseDate as string) ?? null,
          (itemData.genres as string) ?? '[]',
          (itemData.originalLanguage as string) ?? null,
          (itemData.runtime as number) ?? 0,
          (itemData.voteAverage as number) ?? 0,
          itemData.status as string,
          (itemData.watchedDate as string) ?? null,
          (itemData.createdAt as string) ?? new Date().toISOString(),
          cloudUpdated || new Date().toISOString(),
          (itemData.certification as string) ?? null,
        ] as SQLiteBindValue[]
      );
    }
  }

  // 2. Merge ratings
  for (const [tmdbIdStr, ratingData] of Object.entries(data.ratings)) {
    const tmdbId = parseInt(tmdbIdStr, 10);
    const localItem = await getItem(tmdbId);
    if (!localItem) continue;

    // Delete existing rating and insert the cloud one
    await database.runAsync('DELETE FROM ratings WHERE item_id = ?', [localItem.id]);
    await database.runAsync(
      `INSERT INTO ratings
        (item_id, overall_rating, plot_rating, acting_rating, visuals_rating,
         soundtrack_rating, rewatchability, mood_emoji, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localItem.id,
        (ratingData.overallRating as number) ?? 0,
        (ratingData.plotRating as number) ?? null,
        (ratingData.actingRating as number) ?? null,
        (ratingData.visualsRating as number) ?? null,
        (ratingData.soundtrackRating as number) ?? null,
        (ratingData.rewatchability as number) ?? null,
        (ratingData.moodEmoji as string) ?? null,
        (ratingData.reviewText as string) ?? null,
        (ratingData.createdAt as string) ?? new Date().toISOString(),
      ] as SQLiteBindValue[]
    );
  }

  // 3. Merge episode ratings
  for (const [, epData] of Object.entries(data.episodeRatings)) {
    const tmdbId = epData.tmdbId as number;
    const localItem = await getItem(tmdbId);
    if (!localItem) continue;

    await database.runAsync(
      `INSERT OR REPLACE INTO episode_ratings
        (item_id, season_number, episode_number, rating, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        localItem.id,
        epData.seasonNumber as number,
        epData.episodeNumber as number,
        epData.rating as number,
        (epData.reviewText as string) ?? null,
        (epData.createdAt as string) ?? new Date().toISOString(),
      ] as SQLiteBindValue[]
    );
  }

  // 4. Merge people
  for (const [, personData] of Object.entries(data.people)) {
    const tmdbId = personData.tmdbId as number;
    const localItem = await getItem(tmdbId);
    if (!localItem) continue;

    await database.runAsync(
      `INSERT OR IGNORE INTO director_actor_cache
        (item_id, person_id, person_name, role, profile_path)
       VALUES (?, ?, ?, ?, ?)`,
      [
        localItem.id,
        personData.personId as number,
        personData.personName as string,
        personData.role as string,
        (personData.profilePath as string) ?? null,
      ] as SQLiteBindValue[]
    );
  }

  // 5. Merge preferences (cloud wins)
  const EXCLUDED = new Set(['API_KEY_STORAGE', '@matinee_api_key']);
  for (const [key, value] of Object.entries(data.preferences)) {
    if (EXCLUDED.has(key)) continue;
    await database.runAsync(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)',
      [key, value]
    );
  }

  console.log('[Matinee DB] Cloud data merged into local database.');
  notifyDbChanged();
}

/**
 * Delete ALL user data from the local database.
 * Used by the Danger Zone "Reset App" feature.
 */
export async function clearAllData(): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.execAsync(`
      DELETE FROM ratings;
      DELETE FROM episode_ratings;
      DELETE FROM director_actor_cache;
      DELETE FROM watched_items;
      DELETE FROM preferences;
      DELETE FROM tmdb_cache;
    `);
    console.log('[Matinee DB] All local data cleared.');
    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] clearAllData failed:', error);
    throw error;
  }
}

/**
 * Perform a full cloud sync.  Convenience wrapper that wires up the
 * merge callback and local-data readers expected by cloudSync.fullSync().
 */
export async function performFullSync(): Promise<{ pulled: number; pushed: number }> {
  return cloudSync.fullSync(
    mergeCloudData,
    () => getAllItems(),
    getRating,
    getEpisodeRatings
  );
}

/**
 * Fetch all directors and actors from director_actor_cache linked to watched items.
 */
export async function getWatchedPeople(): Promise<PersonEntry[]> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<{
      item_id: number;
      person_id: number;
      person_name: string;
      role: string;
      profile_path: string | null;
    }>(
      `SELECT d.item_id, d.person_id, d.person_name, d.role, d.profile_path
       FROM director_actor_cache d
       INNER JOIN watched_items w ON w.id = d.item_id AND w.status = 'watched'`
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      personId: r.person_id,
      personName: r.person_name,
      role: r.role as PersonRole,
      profilePath: r.profile_path,
    }));
  } catch (error) {
    console.error('[Matinee DB] getWatchedPeople failed:', error);
    return [];
  }
}

