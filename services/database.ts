import { nextTimestamp } from './time';
import { getSecret, setSecret, removeSecret } from './secrets';
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
import { parseStoredGenres } from '../constants/genres';

const dbListeners = new Set<() => void>();
export const subscribeDatabase = (fn: () => void) => { dbListeners.add(fn); return () => { dbListeners.delete(fn); }; };
export let dbChangeTimestamp = Date.now();

export function notifyDbChanged() {
  dbChangeTimestamp = Date.now();
  dbListeners.forEach(fn => fn());
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
  /**
   * How many of the watched titles had a known length. Anything TMDB has not
   * been asked about yet contributes nothing to `totalHours`, so this is what
   * tells the difference between "you watched 12 hours" and "we only know
   * about 12 hours of what you watched".
   */
  titlesWithRuntime: number;
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
  activity?: import('./libraryActivity').ActivityRecord[];
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
const BACKUP_EXCLUDED_PREFERENCES = new Set(['API_KEY_STORAGE', '@matinee_api_key', 'PREF_GEMINI_API_KEY', 'tmdbKey', 'geminiKey']);

function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    throw new Error(
      'Database not initialised – call initDatabase() before using any DB method.'
    );
  }
  return db;
}

export async function getDbAsync(): Promise<SQLite.SQLiteDatabase> {
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
        tmdb_id           INTEGER NOT NULL,
        media_type        TEXT    NOT NULL CHECK (media_type IN ('movie', 'tv')),
        title             TEXT    NOT NULL,
        poster_path       TEXT,
        backdrop_path     TEXT,
        overview          TEXT,
        release_date      TEXT,
        genres            TEXT    DEFAULT '[]',
        original_language TEXT,
        runtime           INTEGER,
        -- For a series, runtime is one episode's length. episode_count and
        -- total_runtime carry the whole run; see getWatchStats().
        episode_count     INTEGER,
        season_count      INTEGER,
        total_runtime     INTEGER,
        vote_average      REAL,
        status            TEXT    NOT NULL DEFAULT 'watched'
                          CHECK (status IN ('watched', 'watchlist', 'interested', 'not_interested')),
        watched_date      TEXT,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        certification     TEXT,
        UNIQUE (tmdb_id, media_type)
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

      CREATE TABLE IF NOT EXISTS in_app_notifications (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id TEXT UNIQUE NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        type            TEXT NOT NULL DEFAULT 'new_release',
        tmdb_id         INTEGER,
        media_type      TEXT,
        poster_path     TEXT,
        provider_name   TEXT,
        is_read         INTEGER DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_read      ON in_app_notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created   ON in_app_notifications(created_at);
    `);

      await db.execAsync(`CREATE TABLE IF NOT EXISTS library_activity (
        activity_key TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
      ); CREATE INDEX IF NOT EXISTS idx_activity_kind ON library_activity(kind, deleted);
      CREATE TABLE IF NOT EXISTS sync_tombstones (entity_key TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);`);

      // Migration: Add certification column to watched_items if it doesn't exist (for existing installs)
      try {
        await db.execAsync('ALTER TABLE watched_items ADD COLUMN certification TEXT;');
      } catch (err) {
        // Ignored if column already exists
      }

      // Migration: carry a series' full length, not one episode's.
      //
      // `runtime` for a TV item is `episode_run_time[0]` — a single episode.
      // Summing that column called Game of Thrones an hour of viewing, so the
      // "hours watched" figure was short by a factor of however many episodes
      // the user's series actually have. These columns hold the real totals;
      // `services/enrichment.ts` fills them in for titles saved before this.
      for (const column of [
        'episode_count INTEGER',
        'season_count INTEGER',
        'total_runtime INTEGER',
      ]) {
        try {
          await db.execAsync(`ALTER TABLE watched_items ADD COLUMN ${column};`);
        } catch (err) {
          // Ignored if column already exists
        }
      }

      // Backfill the movies, which need no network call: a film's total
      // runtime is simply its runtime.
      try {
        await db.execAsync(
          `UPDATE watched_items
              SET total_runtime = runtime
            WHERE media_type = 'movie'
              AND total_runtime IS NULL
              AND runtime IS NOT NULL
              AND runtime > 0;`
        );
      } catch (err) {
        console.error('[Matinee DB] Failed to backfill movie runtimes:', err);
      }

      // Migration: Add is_dismissed column to in_app_notifications if it doesn't exist
      try {
        await db.execAsync('ALTER TABLE in_app_notifications ADD COLUMN is_dismissed INTEGER DEFAULT 0;');
      } catch (err) {
        // Ignored if column already exists
      }

      // Migration: Merge all 'interested' items into 'watchlist' status
      try {
        await db.execAsync("UPDATE watched_items SET status = 'watchlist' WHERE status = 'interested' AND NOT EXISTS (SELECT 1 FROM preferences WHERE key = 'MIGRATION_INTERESTED_V2'); INSERT OR IGNORE INTO preferences VALUES ('MIGRATION_INTERESTED_V2','done');");
      } catch (err) {
        console.error('Failed to merge interested status to watchlist:', err);
      }

      // Migration: collapse duplicate ratings to one row per item.
      // Ratings used to be inserted rather than upserted, so re-rating a title
      // stacked rows — duplicating it in every list that joins this table.
      // Keeping the newest row per item and enforcing uniqueness afterwards
      // makes the ON CONFLICT upsert in addRating() work.
      try {
        await db.execAsync(`
          DELETE FROM ratings
          WHERE id NOT IN (
            SELECT MAX(id) FROM ratings GROUP BY item_id
          );
        `);
        await db.execAsync(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_item_unique ON ratings(item_id);'
        );
      } catch (err) {
        console.error('[Matinee DB] Failed to de-duplicate ratings:', err);
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

      // Migration: scope uniqueness to (tmdb_id, media_type).
      // TMDB numbers movies and series in separate namespaces, so id 1399 is
      // both a film and "Game of Thrones". A globally UNIQUE tmdb_id meant
      // saving one silently overwrote the status of the other.
      const uniquenessRow = await db.getFirstAsync<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='watched_items'"
      );
      if (uniquenessRow && !uniquenessRow.sql.includes('UNIQUE (tmdb_id, media_type)')) {
        console.log('[Matinee DB] Migrating watched_items to per-media-type uniqueness...');
        await db.execAsync('PRAGMA foreign_keys = OFF;');
        await db.execAsync('PRAGMA legacy_alter_table = ON;');
        await db.execAsync('BEGIN TRANSACTION;');
        try {
          // Clear any leftover scratch table from a previously interrupted run,
          // otherwise the RENAME below fails and the migration can never finish.
          await db.execAsync('DROP TABLE IF EXISTS watched_items_pre_mt;');
          await db.execAsync('ALTER TABLE watched_items RENAME TO watched_items_pre_mt;');
          await db.execAsync(`
            CREATE TABLE watched_items (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              tmdb_id           INTEGER NOT NULL,
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
              certification     TEXT,
              UNIQUE (tmdb_id, media_type)
            );
          `);
          // Row ids are preserved so ratings / episode_ratings /
          // director_actor_cache foreign keys keep pointing at the right item.
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
            FROM watched_items_pre_mt;
          `);
          await db.execAsync('DROP TABLE watched_items_pre_mt;');
          await db.execAsync('COMMIT;');
          console.log('[Matinee DB] Uniqueness migration completed successfully.');
        } catch (migrationError) {
          await db.execAsync('ROLLBACK;');
          console.error('[Matinee DB] Uniqueness migration failed:', migrationError);
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
      WHERE status IN ('watchlist','interested')
        AND NOT EXISTS (SELECT 1 FROM preferences WHERE key = 'MIGRATION_RATINGS_WATCHED_V2')
        AND (
          id IN (SELECT item_id FROM ratings)

        );
    `);

      await db.runAsync("INSERT OR IGNORE INTO preferences (key, value) VALUES ('MIGRATION_RATINGS_WATCHED_V2','done')");

      // Earlier table rebuilds predate runtime metadata. Repair columns and indexes after every legacy migration.
      for (const column of ['episode_count INTEGER','season_count INTEGER','total_runtime INTEGER']) {
        try { await db.execAsync(`ALTER TABLE watched_items ADD COLUMN ${column}`); } catch {}
      }
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_watched_status ON watched_items(status);
        CREATE INDEX IF NOT EXISTS idx_watched_media_type ON watched_items(media_type);
        CREATE INDEX IF NOT EXISTS idx_watched_watched_date ON watched_items(watched_date);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_item_unique ON ratings(item_id);
        UPDATE watched_items SET total_runtime=runtime WHERE media_type='movie' AND total_runtime IS NULL AND runtime>0;`);

      // Data Migration: ensure all watched items have a valid watched_date
      await db.execAsync(`
      UPDATE watched_items 
      SET watched_date = COALESCE(watched_date, substr(created_at, 1, 10), date('now'))
      WHERE status = 'watched' 
        AND (watched_date IS NULL OR watched_date = '' OR watched_date = 'null');
    `);
      // Preserve episode logs from older versions as watched progress once, then allow independent unchecking.
      await db.execAsync(`INSERT OR IGNORE INTO library_activity (activity_key,kind,payload,updated_at,deleted)
        SELECT 'episode:tv:'||w.tmdb_id||':'||e.season_number||':'||e.episode_number, 'episode',
          json_object('tmdbId',w.tmdb_id,'mediaType','tv','season',e.season_number,'episode',e.episode_number,'runtime',COALESCE(w.runtime,0),'date',substr(e.created_at,1,10)),
          strftime('%Y-%m-%dT%H:%M:%fZ','now'),0
        FROM episode_ratings e JOIN watched_items w ON w.id=e.item_id
        WHERE w.media_type='tv' AND NOT EXISTS (SELECT 1 FROM preferences WHERE key='MIGRATION_EPISODE_PROGRESS_V1');
        INSERT OR IGNORE INTO preferences VALUES ('MIGRATION_EPISODE_PROGRESS_V1','done');`);
      // Credential migration is optional; library access must survive storage errors.
      for (const key of ['API_KEY_STORAGE', 'PREF_GEMINI_API_KEY']) {
        try { await getPreference(key); } catch { console.warn('[Matinee] Credential migration deferred'); }
      }
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
  episode_count?: number | null;
  season_count?: number | null;
  total_runtime?: number | null;
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
    episodeCount: row.episode_count ?? null,
    seasonCount: row.season_count ?? null,
    totalRuntime: row.total_runtime ?? null,
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

/**
 * How many minutes of viewing an item represents.
 *
 * A film is its runtime. A series is one episode's runtime times its episode
 * count — `runtime` alone is a single episode, which is why summing that
 * column reported a whole series as under an hour.
 *
 * Returns null rather than guessing when the episode count is unknown;
 * `services/enrichment.ts` fills those in from TMDB afterwards.
 */
export function deriveTotalRuntime(item: {
  mediaType: MediaType;
  runtime?: number | null;
  episodeCount?: number | null;
  totalRuntime?: number | null;
}): number | null {
  if (item.totalRuntime && item.totalRuntime > 0) return item.totalRuntime;
  if (!item.runtime || item.runtime <= 0) return null;
  if (item.mediaType === 'movie') return item.runtime;
  if (!item.episodeCount || item.episodeCount <= 0) return null;
  return item.runtime * item.episodeCount;
}

/**
 * The total runtime to store when a title is saved.
 *
 * A film's is simply its runtime. A series' is deliberately left null unless
 * the caller states one: establishing it needs a real episode length, and the
 * value a screen has to hand may be TMDB's last-aired-episode fallback, which
 * is usually a finale and so runs long. Writing that here would freeze a
 * skewed number in place — and because the enrichment pass only visits rows
 * with no total, it would never be corrected. Leaving it null hands the job to
 * `services/enrichment.ts`, which samples a season to get it right.
 */
function totalRuntimeOnSave(
  item: NewWatchedItem,
  existing?: WatchedItem,
): number | null {
  if (item.totalRuntime && item.totalRuntime > 0) return item.totalRuntime;
  if (item.mediaType !== 'movie') return null;
  return item.runtime || existing?.runtime || null;
}

export async function addItem(item: NewWatchedItem): Promise<number> {
  const database = await getDbAsync();
  try {
    const existing = await getItem(item.tmdbId, item.mediaType);
    if (existing) {
      // Only status and date were carried over before. Titles first saved
      // from a poster long-press arrive with `runtime: 0`, and re-saving them
      // as watched left that zero in place forever — so they contributed
      // nothing to watch time no matter how often they were re-logged.
      // Anything the caller now knows and the row does not is filled in.
      const upgrades: WatchedItemUpdate = {
        status: item.status,
        watchedDate: item.watchedDate,
        updatedAt: nextTimestamp(),
      };
      if (!existing.runtime && item.runtime) upgrades.runtime = item.runtime;
      if (!existing.episodeCount && item.episodeCount) upgrades.episodeCount = item.episodeCount;
      if (!existing.seasonCount && item.seasonCount) upgrades.seasonCount = item.seasonCount;

      const nextTotal = totalRuntimeOnSave(item, existing);
      if (!existing.totalRuntime && nextTotal) upgrades.totalRuntime = nextTotal;
      if (!existing.certification && item.certification) upgrades.certification = item.certification;

      await updateItem(existing.id, upgrades);
      return existing.id;
    }

    const result = await database.runAsync(
      `INSERT INTO watched_items
        (tmdb_id, media_type, title, poster_path, backdrop_path, overview,
         release_date, genres, original_language, runtime, episode_count,
         season_count, total_runtime, vote_average,
         status, watched_date, certification, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        item.episodeCount ?? null,
        item.seasonCount ?? null,
        totalRuntimeOnSave(item),
        item.voteAverage ?? null,
        item.status,
        item.watchedDate ?? null,
        item.certification ?? null, nextTimestamp(), nextTimestamp(),
      ] as SQLiteBindValue[]
    );

    // ── Cloud sync (fire-and-forget) ──
    const saved = await getItem(item.tmdbId, item.mediaType);
    if (saved) {
      await cloudSync.pushItem(saved);
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
    episodeCount: 'episode_count',
    seasonCount: 'season_count',
    totalRuntime: 'total_runtime',
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

  if (!('updatedAt' in updates)) { setClauses.push('updated_at = ?'); values.push(nextTimestamp()); }
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
      await cloudSync.pushItem(rowToWatchedItem(row));
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
    const row = await database.getFirstAsync<{ tmdb_id: number; media_type: MediaType }>(
      'SELECT tmdb_id, media_type FROM watched_items WHERE id = ?',
      [id]
    );

    if (row) {
      await database.runAsync('INSERT OR REPLACE INTO sync_tombstones (entity_key, deleted_at) VALUES (?, ?)', [`${row.media_type}:${row.tmdb_id}`, nextTimestamp()]);
      await cloudSync.deleteItemCloud(row.tmdb_id, row.media_type);
    }
    await database.runAsync('DELETE FROM watched_items WHERE id = ?', [id]);

    notifyDbChanged();
  } catch (error) {
    console.error('[Matinee DB] deleteItem failed:', error);
    throw error;
  }
}

/**
 * Look up a library entry.
 *
 * `mediaType` should be supplied whenever it is known: TMDB ids are only
 * unique within a media type, so omitting it can return the movie when the
 * caller meant the series of the same id.
 */
export async function getItem(
  tmdbId: number,
  mediaType?: MediaType
): Promise<WatchedItem | null> {
  const database = await getDbAsync();
  try {
    const row = mediaType
      ? await database.getFirstAsync<WatchedItemRow>(
          'SELECT * FROM watched_items WHERE tmdb_id = ? AND media_type = ?',
          [tmdbId, mediaType]
        )
      : await database.getFirstAsync<WatchedItemRow>(
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

export async function getWatchedItemsWithDetailedRatings(): Promise<any[]> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<any>(
      `SELECT w.*, r.overall_rating, r.plot_rating, r.acting_rating, r.visuals_rating, r.soundtrack_rating, r.rewatchability, r.mood_emoji, r.review_text
       FROM watched_items w
       LEFT JOIN ratings r ON w.id = r.item_id
       WHERE w.status = 'watched'
       ORDER BY w.updated_at DESC`
    );
    return rows;
  } catch (error) {
    console.error('[Matinee DB] getWatchedItemsWithDetailedRatings failed:', error);
    return [];
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

/**
 * Save the user's rating for an item, replacing any previous one.
 *
 * A watched item has exactly one rating. Blindly inserting (as an earlier
 * version did) left several rating rows per item, which duplicated every
 * affected title in the library lists that LEFT JOIN this table, and
 * double-counted them in the ratings distribution chart.
 */
export async function addRating(rating: NewRating): Promise<number> {
  const database = await getDbAsync();
  try {
    const result = await database.runAsync(
      `INSERT INTO ratings
        (item_id, overall_rating, plot_rating, acting_rating, visuals_rating,
         soundtrack_rating, rewatchability, mood_emoji, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         overall_rating    = excluded.overall_rating,
         plot_rating       = excluded.plot_rating,
         acting_rating     = excluded.acting_rating,
         visuals_rating    = excluded.visuals_rating,
         soundtrack_rating = excluded.soundtrack_rating,
         rewatchability    = excluded.rewatchability,
         mood_emoji        = excluded.mood_emoji,
         review_text       = excluded.review_text,
         created_at        = excluded.created_at`,
      [
        rating.itemId,
        rating.overallRating,
        rating.plotRating ?? null,
        rating.actingRating ?? null,
        rating.visualsRating ?? null,
        rating.soundtrackRating ?? null,
        rating.rewatchability ?? null,
        rating.moodEmoji ?? null,
        rating.reviewText ?? null, nextTimestamp(),
      ] as SQLiteBindValue[]
    );

    // ── Cloud sync (fire-and-forget) ──
    const itemRow = await database.getFirstAsync<{ tmdb_id: number; media_type: MediaType }>(
      'SELECT tmdb_id, media_type FROM watched_items WHERE id = ?',
      [rating.itemId]
    );
    if (itemRow) {
      const savedRating = await getRating(rating.itemId);
      if (savedRating) {
        await cloudSync.pushRating(itemRow.tmdb_id, savedRating);
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

  setClauses.push('created_at = ?');
  values.push(nextTimestamp());
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
      await cloudSync.pushRating(ratingRow.tmdb_id, rowToRating(ratingRow));
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

/**
 * Drop a single cache entry. Needed by force-refresh paths: pull-to-refresh
 * used to clear only the legacy AsyncStorage copy, so the SQLite entry was
 * still served and the refresh appeared to do nothing.
 */
export async function deleteCache(key: string): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync('DELETE FROM tmdb_cache WHERE cache_key = ?', [key]);
  } catch (error) {
    console.warn('[Matinee DB] deleteCache failed:', error);
  }
}

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
  if (key === 'PREF_GEMINI_API_KEY' || key === 'API_KEY_STORAGE') {
    const secretKey = key === 'API_KEY_STORAGE' ? '@matinee_api_key' : key;
    const database = await getDbAsync();
    const row = await database.getFirstAsync<{value:string}>('SELECT value FROM preferences WHERE key=?',[key]);
    let secret: string | null = null;
    try { secret = await getSecret(secretKey); } catch { /* SQLite remains readable. */ }
    const value = secret || row?.value || null;
    if (row?.value && value) {
      try {
        if (await setSecret(secretKey, value)) {
          await database.runAsync('DELETE FROM preferences WHERE key=?',[key]);
        }
      } catch { /* Retry migration later without removing the original. */ }
    }
    return value;
  }
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
  if (key === 'PREF_GEMINI_API_KEY' || key === 'API_KEY_STORAGE') {
    const secretKey = key === 'API_KEY_STORAGE' ? '@matinee_api_key' : key;
    if (value) await setSecret(secretKey, value); else await removeSecret(secretKey);
    // Explicit edits supersede any retained migration source, including removals.
    const database = await getDbAsync();
    await database.runAsync('DELETE FROM preferences WHERE key=?', [key]);
    notifyDbChanged();
    return;
  }
  const database = await getDbAsync();
  try {
    await database.runAsync(
      'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)',
      [key, value]
    );

    // ── Cloud sync (fire-and-forget) ──
    await cloudSync.pushPreference(key, value);
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
    exportedAt: nextTimestamp(),
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
    activity: await (await import('./libraryActivity')).readActivity(undefined, true),
  };
}

export async function importUserData(rawBackup: unknown): Promise<ImportSummary> {
  if (!isMatineeBackup(rawBackup)) {
    throw new Error('This is not a valid Matinee backup file.');
  }

  for (const item of rawBackup.watchedItems) {
    if (!Number.isInteger(item.id) || !Number.isInteger(item.tmdbId) || item.tmdbId < 1 || !['movie','tv'].includes(item.mediaType) || !['watched','watchlist','interested','not_interested'].includes(item.status) || typeof item.title !== 'string') throw new Error('The backup contains an invalid title. Nothing was restored.');
  }
  const database = await getDbAsync();
  let summary: ImportSummary | undefined;
  await database.withTransactionAsync(async () => {
  const itemIdMap = new Map<number, number>();

  for (const item of rawBackup.watchedItems) {
    await database.runAsync(
      `INSERT INTO watched_items
        (tmdb_id, media_type, title, poster_path, backdrop_path, overview,
         release_date, genres, original_language, runtime, vote_average,
         status, watched_date, created_at, updated_at, episode_count, season_count, total_runtime, certification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
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
         updated_at = excluded.updated_at,
         episode_count = excluded.episode_count, season_count = excluded.season_count,
         total_runtime = excluded.total_runtime, certification = excluded.certification`,
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
        item.updatedAt, item.episodeCount ?? null, item.seasonCount ?? null, item.totalRuntime ?? null, item.certification ?? null,
      ] as SQLiteBindValue[]
    );

    const row = await database.getFirstAsync<{ id: number }>(
      'SELECT id FROM watched_items WHERE tmdb_id = ? AND media_type = ?',
      [item.tmdbId, item.mediaType]
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
      if (typeof value !== 'string') throw new Error('The backup contains an invalid preference.');
      await database.runAsync('INSERT OR REPLACE INTO preferences (key,value) VALUES (?,?)', [key,value]);
      preferenceCount += 1;
    }
  }

  if (rawBackup.activity) await (await import('./libraryActivity')).mergeActivity(rawBackup.activity);
  notifyDbChanged();
  summary = {
    items: itemIdMap.size,
    ratings: ratingCount,
    episodeRatings: episodeRatingCount,
    people: peopleCount,
    preferences: preferenceCount,
  };
  });
  notifyDbChanged();
  return summary!;
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
    const itemRow = await database.getFirstAsync<{ tmdb_id: number; media_type: MediaType }>(
      'SELECT tmdb_id, media_type FROM watched_items WHERE id = ?',
      [itemId]
    );
    if (itemRow) {
      await cloudSync.pushPeople(itemRow.tmdb_id, people);
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
    // Watch time comes from `total_runtime`, which holds a film's runtime or a
    // series' episode runtime times its episode count. Summing `runtime`
    // directly (the previous behaviour) counted one episode per series, which
    // is how a library containing Game of Thrones and House of the Dragon
    // added up to fewer hours than those two shows alone.
    //
    // `total_runtime` is null for anything TMDB has not been asked about yet;
    // `countedTitles` reports how much of the library the figure covers so the
    // stats screen can say so rather than quietly under-reporting.
    let query = `
      SELECT
         COUNT(*)                                               AS totalWatched,
         SUM(CASE WHEN media_type = 'movie' THEN 1 ELSE 0 END) AS totalMovies,
         SUM(CASE WHEN media_type = 'tv'    THEN 1 ELSE 0 END) AS totalSeries,
         COALESCE(SUM(total_runtime), 0)                        AS totalMinutes,
         SUM(CASE WHEN total_runtime > 0 THEN 1 ELSE 0 END)     AS countedTitles
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
      countedTitles: number;
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

    return {
      totalWatched: row?.totalWatched ?? 0,
      totalMovies: row?.totalMovies ?? 0,
      totalSeries: row?.totalSeries ?? 0,
      totalHours: Math.round((row?.totalMinutes ?? 0) / 60),
      averageRating: avgRow?.averageRating ?? 0,
      titlesWithRuntime: row?.countedTitles ?? 0,
    };
  } catch (error) {
    console.error('[Matinee DB] getWatchStats failed:', error);
    return {
      totalWatched: 0,
      totalMovies: 0,
      totalSeries: 0,
      totalHours: 0,
      averageRating: 0,
      titlesWithRuntime: 0,
    };
  }
}

/**
 * Genre breakdown of watched titles, aggregated by canonical genre name.
 *
 * Counting raw TMDB ids would split the same genre in two — a sci-fi film is
 * 878 while a sci-fi series is 10765 — producing duplicate slices in the
 * chart. Resolving to canonical names merges them.
 */
export async function getGenreDistribution(year?: number): Promise<GenreCount[]> {
  const database = await getDbAsync();
  try {
    let query = `
      SELECT
         w.genres AS genres,
         w.media_type AS media_type
      FROM watched_items w
      WHERE w.status = 'watched'
    `;
    const params: SQLiteBindValue[] = [];
    if (year) {
      query += ' AND substr(w.watched_date, 1, 10) >= ? AND substr(w.watched_date, 1, 10) < ?';
      params.push(`${year}-01-01`, `${year + 1}-01-01`);
    }

    const rows = await database.getAllAsync<{ genres: string; media_type: string }>(
      query,
      params
    );

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of parseStoredGenres(row.genres)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count);
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
        (item_id, season_number, episode_number, rating, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rating.itemId,
        rating.seasonNumber,
        rating.episodeNumber,
        rating.rating,
        rating.reviewText ?? null, nextTimestamp(),
      ] as SQLiteBindValue[]
    );

    // ── Cloud sync (fire-and-forget) ──
    const itemRow = await database.getFirstAsync<{ tmdb_id: number; media_type: MediaType }>(
      'SELECT tmdb_id, media_type FROM watched_items WHERE id = ?',
      [rating.itemId]
    );
    if (itemRow) {
      const saved = await database.getFirstAsync<EpisodeRatingRow>(
        'SELECT * FROM episode_ratings WHERE id = ?',
        [result.lastInsertRowId]
      );
      if (saved) {
        await cloudSync.pushEpisodeRating(itemRow.tmdb_id, rowToEpisodeRating(saved));
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
      await cloudSync.deleteEpisodeRatingCloud(
        epRow.tmdb_id,
        epRow.season_number,
        epRow.episode_number
      );
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
  const { timestamp } = await import('./cloudSync');
  const legacyItem = (id: number) => Object.values(data.watchedItems).find(r => r.tmdbId === id && !r.deleted);
  const resolve = async (r: Record<string, any>, defaultType?: MediaType) => {
    const type = r.mediaType ?? defaultType ?? legacyItem(r.tmdbId)?.mediaType;
    // Never guess a movie's identity from a numeric ID that might be a series.
    return type ? getItem(r.tmdbId, type) : null;
  };
  await database.withTransactionAsync(async () => {
    for (const r of Object.values(data.watchedItems)) {
      if (!Number.isInteger(r.tmdbId) || !['movie','tv'].includes(r.mediaType)) continue;
      const key = `${r.mediaType}:${r.tmdbId}`;
      const tombstone = await database.getFirstAsync<{deleted_at:string}>('SELECT deleted_at FROM sync_tombstones WHERE entity_key = ?', [key]);
      const existing = await getItem(r.tmdbId, r.mediaType);
      if (r.deleted) {
        if (!existing || timestamp(r.updatedAt) >= timestamp(existing.updatedAt)) {
          await database.runAsync('DELETE FROM watched_items WHERE tmdb_id = ? AND media_type = ?', [r.tmdbId,r.mediaType]);
          await database.runAsync('INSERT OR REPLACE INTO sync_tombstones VALUES (?, ?)', [key,r.updatedAt]);
        }
        continue;
      }
      // Another device may have missed the delete and only see the later re-add.
      // Apply its history boundary even if this device has a newer parent edit.
      if (r.historyResetAt && (!tombstone || timestamp(r.historyResetAt) > timestamp(tombstone.deleted_at))) {
        await database.runAsync('INSERT INTO sync_tombstones VALUES (?,?) ON CONFLICT(entity_key) DO UPDATE SET deleted_at=excluded.deleted_at WHERE excluded.deleted_at > sync_tombstones.deleted_at',[key,r.historyResetAt]);
        if (existing) {
          await database.runAsync('DELETE FROM ratings WHERE item_id=? AND COALESCE(julianday(created_at),0)<=julianday(?)',[existing.id,r.historyResetAt]);
          await database.runAsync('DELETE FROM episode_ratings WHERE item_id=? AND COALESCE(julianday(created_at),0)<=julianday(?)',[existing.id,r.historyResetAt]);
          await database.runAsync('DELETE FROM director_actor_cache WHERE item_id=?',[existing.id]);
        }
      }
      if (tombstone && timestamp(tombstone.deleted_at) >= timestamp(r.updatedAt)) continue;
      if (existing && timestamp(existing.updatedAt) >= timestamp(r.updatedAt)) continue;
      if (!['watched','watchlist','interested','not_interested'].includes(r.status)) continue;
      await database.runAsync(`INSERT INTO watched_items
        (tmdb_id,media_type,title,poster_path,backdrop_path,overview,release_date,genres,original_language,runtime,vote_average,status,watched_date,created_at,updated_at,certification,episode_count,season_count,total_runtime)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tmdb_id,media_type) DO UPDATE SET
        title=excluded.title,poster_path=excluded.poster_path,backdrop_path=excluded.backdrop_path,overview=excluded.overview,
        release_date=excluded.release_date,genres=excluded.genres,original_language=excluded.original_language,runtime=excluded.runtime,
        vote_average=excluded.vote_average,status=excluded.status,watched_date=excluded.watched_date,updated_at=excluded.updated_at,
        certification=excluded.certification,episode_count=COALESCE(excluded.episode_count,watched_items.episode_count),
        season_count=COALESCE(excluded.season_count,watched_items.season_count),total_runtime=COALESCE(excluded.total_runtime,watched_items.total_runtime)`,
        [r.tmdbId,r.mediaType,r.title,r.posterPath??null,r.backdropPath??null,r.overview??'',r.releaseDate??'',r.genres??'[]',r.originalLanguage??'',r.runtime??0,r.voteAverage??0,r.status,r.watchedDate??null,r.createdAt??r.updatedAt,r.updatedAt??nextTimestamp(),r.certification??null,r.episodeCount??null,r.seasonCount??null,r.totalRuntime??null]);
      if (r.historyResetAt) await database.runAsync('INSERT INTO sync_tombstones VALUES (?,?) ON CONFLICT(entity_key) DO UPDATE SET deleted_at=excluded.deleted_at WHERE excluded.deleted_at > sync_tombstones.deleted_at',[key,r.historyResetAt]);
    }
    const childIsCurrent = async (item: WatchedItem, record: Record<string,any>) => {
      const boundary = await database.getFirstAsync<{deleted_at:string}>('SELECT deleted_at FROM sync_tombstones WHERE entity_key=?',[`${item.mediaType}:${item.tmdbId}`]);
      return !boundary || timestamp(record.updatedAt ?? record.createdAt) > timestamp(boundary.deleted_at);
    };
    for (const [key,r] of Object.entries(data.ratings)) {
      const id = r.tmdbId ?? Number(key.split(':').pop());
      const item = await resolve({...r,tmdbId:id}); if (!item || !(await childIsCurrent(item,r))) continue;
      const local = await getRating(item.id);
      if (local && timestamp(local.createdAt) >= timestamp(r.updatedAt ?? r.createdAt)) continue;
      await database.runAsync(`INSERT INTO ratings (item_id,overall_rating,plot_rating,acting_rating,visuals_rating,soundtrack_rating,rewatchability,mood_emoji,review_text,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET overall_rating=excluded.overall_rating,plot_rating=excluded.plot_rating,
        acting_rating=excluded.acting_rating,visuals_rating=excluded.visuals_rating,soundtrack_rating=excluded.soundtrack_rating,rewatchability=excluded.rewatchability,
        mood_emoji=excluded.mood_emoji,review_text=excluded.review_text,created_at=excluded.created_at`,
        [item.id,r.overallRating,r.plotRating??null,r.actingRating??null,r.visualsRating??null,r.soundtrackRating??null,r.rewatchability??null,r.moodEmoji??null,r.reviewText??null,r.updatedAt??r.createdAt]);
    }
    for (const r of Object.values(data.episodeRatings)) {
      const item = await resolve(r, 'tv'); if (!item || !(await childIsCurrent(item,r))) continue;
      const local = await database.getFirstAsync<{created_at:string}>('SELECT created_at FROM episode_ratings WHERE item_id=? AND season_number=? AND episode_number=?',[item.id,r.seasonNumber,r.episodeNumber]);
      if (local && timestamp(local.created_at) > timestamp(r.updatedAt??r.createdAt)) continue;
      if (r.deleted) await database.runAsync('DELETE FROM episode_ratings WHERE item_id=? AND season_number=? AND episode_number=?',[item.id,r.seasonNumber,r.episodeNumber]);
      else await database.runAsync('INSERT OR REPLACE INTO episode_ratings (item_id,season_number,episode_number,rating,review_text,created_at) VALUES (?,?,?,?,?,?)',[item.id,r.seasonNumber,r.episodeNumber,r.rating,r.reviewText??null,r.updatedAt??r.createdAt]);
    }
    for (const r of Object.values(data.people)) {
      const item = await resolve(r); if (!item || !(await childIsCurrent(item,r))) continue;
      await database.runAsync('INSERT OR REPLACE INTO director_actor_cache (item_id,person_id,person_name,role,profile_path) VALUES (?,?,?,?,?)',[item.id,r.personId,r.personName,r.role,r.profilePath??null]);
    }
    for (const [key,value] of Object.entries(data.preferences)) {
      if (BACKUP_EXCLUDED_PREFERENCES.has(key)) continue;
      // Device preferences are authoritative once chosen; new devices inherit cloud defaults.
      await database.runAsync('INSERT OR IGNORE INTO preferences (key,value) VALUES (?,?)',[key,value]);
    }
    if (data.activity) await (await import('./libraryActivity')).mergeActivity(Object.values(data.activity));
  });
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
      DELETE FROM library_activity;
      DELETE FROM sync_tombstones;
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

/**
 * Watched titles the stats screen cannot fully account for.
 *
 * Two things go missing. Length: anything saved from a poster long-press or a
 * CSV import arrives with `runtime: 0`, and every series ever saved recorded
 * one episode rather than its whole run. People: `director_actor_cache` was
 * only ever written from the detail screen, so a title marked watched from a
 * grid, from Upcoming, or from an import contributed nobody — which is why the
 * top directors and actors lists bore no resemblance to what the user watches.
 *
 * `services/enrichment.ts` walks this list and fills both in from TMDB.
 */
export async function getItemsNeedingEnrichment(limit = 40): Promise<WatchedItem[]> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<WatchedItemRow>(
      `SELECT w.*
         FROM watched_items w
        WHERE w.status = 'watched'
          AND (
                w.total_runtime IS NULL
             OR w.total_runtime <= 0
             OR NOT EXISTS (
                  SELECT 1 FROM director_actor_cache d WHERE d.item_id = w.id
                )
          )
        -- Most recently logged first: those are the titles the user is most
        -- likely looking at the stats for right now.
        ORDER BY COALESCE(w.watched_date, w.updated_at) DESC
        LIMIT ?`,
      [limit]
    );
    return rows.map(rowToWatchedItem);
  } catch (error) {
    console.error('[Matinee DB] getItemsNeedingEnrichment failed:', error);
    return [];
  }
}

/** How many watched titles are still missing length or people data. */
export async function countItemsNeedingEnrichment(): Promise<number> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<{ pending: number }>(
      `SELECT COUNT(*) AS pending
         FROM watched_items w
        WHERE w.status = 'watched'
          AND (
                w.total_runtime IS NULL
             OR w.total_runtime <= 0
             OR NOT EXISTS (
                  SELECT 1 FROM director_actor_cache d WHERE d.item_id = w.id
                )
          )`
    );
    return row?.pending ?? 0;
  } catch (error) {
    console.error('[Matinee DB] countItemsNeedingEnrichment failed:', error);
    return 0;
  }
}

/**
 * A short stamp that changes whenever the library does.
 *
 * Used as part of the recommendation cache key so a cached feed survives tab
 * switches and app restarts but is dropped the moment the user rates,
 * watchlists or dismisses anything — the events that should actually change
 * what gets recommended.
 */
export async function getLibraryVersion(): Promise<string> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<{ total: number; latest: string | null }>(
      `SELECT COUNT(*) AS total, MAX(updated_at) AS latest FROM watched_items`
    );
    const prefs = await database.getAllAsync<{key: string; value: string}>("SELECT key, value FROM preferences WHERE key IN ('PREF_LANGUAGES', 'PREF_USER_COUNTRY', 'PREF_OTT_PROVIDERS', 'PREF_ADULT_CONTENT', 'PREF_ADVENTURE') ORDER BY key");
    const feedback = await database.getFirstAsync<{ latest: string }>("SELECT MAX(updated_at) AS latest FROM library_activity WHERE kind = 'feedback'");
    return `${row?.total ?? 0}@${row?.latest ?? 'none'}:${JSON.stringify(prefs)}:${feedback?.latest ?? ''}`;
  } catch (error) {
    console.error('[Matinee DB] getLibraryVersion failed:', error);
    // A unique value degrades to "never cached", which is the safe direction.
    return `unknown@${Date.now()}`;
  }
}

export async function clearTmdbCache(): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync("DELETE FROM tmdb_cache");
    console.log('[Matinee DB] TMDB cache cleared.');
  } catch (error) {
    console.error('[Matinee DB] clearTmdbCache failed:', error);
  }
}

// ─── In-App Notifications ───────────────────────────────────────────

export interface InAppNotification {
  id: number;
  notificationId: string;
  title: string;
  body: string;
  type: 'new_release' | 'ott_available' | 'trending';
  tmdbId: number | null;
  mediaType: string | null;
  posterPath: string | null;
  providerName: string | null;
  isRead: boolean;
  createdAt: string;
  isDismissed?: boolean;
}

export async function getInAppNotifications(limit: number = 50): Promise<InAppNotification[]> {
  const database = await getDbAsync();
  try {
    const rows = await database.getAllAsync<any>(
      'SELECT * FROM in_app_notifications WHERE is_dismissed = 0 ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rows.map(r => ({
      id: r.id,
      notificationId: r.notification_id,
      title: r.title,
      body: r.body,
      type: r.type,
      tmdbId: r.tmdb_id,
      mediaType: r.media_type,
      posterPath: r.poster_path,
      providerName: r.provider_name,
      isRead: r.is_read === 1,
      createdAt: r.created_at,
      isDismissed: r.is_dismissed === 1,
    }));
  } catch (err) {
    console.error('getInAppNotifications error:', err);
    return [];
  }
}

export async function addInAppNotification(notification: Omit<InAppNotification, 'id' | 'isRead' | 'createdAt' | 'isDismissed'>): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync(
      `INSERT OR IGNORE INTO in_app_notifications (notification_id, title, body, type, tmdb_id, media_type, poster_path, provider_name, is_dismissed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        notification.notificationId,
        notification.title,
        notification.body,
        notification.type,
        notification.tmdbId,
        notification.mediaType,
        notification.posterPath,
        notification.providerName,
      ]
    );
  } catch (err) {
    console.error('addInAppNotification error:', err);
  }
}

export async function markNotificationRead(id: number): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync('UPDATE in_app_notifications SET is_read = 1 WHERE id = ?', [id]);
  } catch (err) {
    console.error('markNotificationRead error:', err);
  }
}

export async function dismissNotification(id: number): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync('UPDATE in_app_notifications SET is_dismissed = 1 WHERE id = ?', [id]);
  } catch (err) {
    console.error('dismissNotification error:', err);
  }
}

export async function getUnreadNotificationCount(): Promise<number> {
  const database = await getDbAsync();
  try {
    const row = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM in_app_notifications WHERE is_read = 0 AND is_dismissed = 0'
    );
    return row?.count ?? 0;
  } catch (err) {
    console.error('getUnreadNotificationCount error:', err);
    return 0;
  }
}

export async function clearAllNotifications(): Promise<void> {
  const database = await getDbAsync();
  try {
    await database.runAsync('UPDATE in_app_notifications SET is_dismissed = 1');
  } catch (err) {
    console.error('clearAllNotifications error:', err);
  }
}
