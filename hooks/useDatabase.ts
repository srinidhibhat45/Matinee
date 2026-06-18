import { useState, useEffect, useCallback } from 'react';
import {
  initDatabase,
  addItem as dbAddItem,
  updateItem as dbUpdateItem,
  deleteItem as dbDeleteItem,
  getItem as dbGetItem,
  getAllItems as dbGetAllItems,
  getRecentItems as dbGetRecentItems,
  addRating as dbAddRating,
  getRating as dbGetRating,
  updateRating as dbUpdateRating,
  getPreference,
  setPreference,
  saveDirectorsActors as dbSaveDirectorsActors,
  getWatchStats,
  getGenreDistribution,
  getRatingDistribution,
  getHeatmapData,
  getMonthlyBreakdown,
  getStreakInfo,
  getTopDirectors,
  getTopActors,
} from '../services/database';
import type {
  WatchedItem,
  Rating,
  ItemStatus,
  MediaType,
} from '../types';
import type { NewWatchedItem, NewRating } from '../services/database';

export function useDatabase() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initDatabase()
      .then(() => setIsReady(true))
      .catch((err) => console.error('DB init failed:', err));
  }, []);

  const addItem = useCallback(async (item: NewWatchedItem) => {
    return dbAddItem(item);
  }, []);

  const updateItemStatus = useCallback(
    async (id: number, status: ItemStatus, watchedDate?: string) => {
      return dbUpdateItem(id, { status, watchedDate: watchedDate || undefined });
    },
    []
  );

  const findItem = useCallback(async (tmdbId: number) => {
    return dbGetItem(tmdbId);
  }, []);

  const getAllItems = useCallback(
    async (status?: ItemStatus, mediaType?: MediaType) => {
      return dbGetAllItems(status, mediaType);
    },
    []
  );

  const getRecentItems = useCallback(async (limit?: number) => {
    return dbGetRecentItems(limit);
  }, []);

  const deleteItem = useCallback(async (id: number) => {
    return dbDeleteItem(id);
  }, []);

  const addRating = useCallback(async (rating: NewRating) => {
    return dbAddRating(rating);
  }, []);

  const getRating = useCallback(async (itemId: number) => {
    return dbGetRating(itemId);
  }, []);

  const saveDirectorsActors = useCallback(
    async (
      itemId: number,
      people: { personId: number; personName: string; role: 'director' | 'actor'; profilePath: string | null }[]
    ) => {
      return dbSaveDirectorsActors(
        itemId,
        people.map((p) => ({
          itemId,
          personId: p.personId,
          personName: p.personName,
          role: p.role,
          profilePath: p.profilePath,
        }))
      );
    },
    []
  );

  const getStats = useCallback(async (year: number = new Date().getFullYear()) => {
    const [stats, genres, ratings, heatmap, monthly, streak, directors, actors] =
      await Promise.all([
        getWatchStats(year),
        getGenreDistribution(year),
        getRatingDistribution(year),
        getHeatmapData(year),
        getMonthlyBreakdown(year),
        getStreakInfo(),
        getTopDirectors(5, year),
        getTopActors(5, year),
      ]);

    return {
      totalWatched: stats.totalWatched,
      totalMovies: stats.totalMovies,
      totalSeries: stats.totalSeries,
      totalHoursWatched: stats.totalHours,
      averageRating: stats.averageRating,
      favoriteGenres: genres.map((g) => ({ genre: g.genre, count: g.count })),
      topDirectors: directors.map((d) => ({ name: d.personName, count: d.count })),
      topActors: actors.map((a) => ({ name: a.personName, count: a.count })),
      longestStreak: streak.longestStreak,
      currentStreak: streak.currentStreak,
      monthlyBreakdown: monthly.map((m) => ({ month: String(m.month), count: m.count })),
      ratingDistribution: ratings.map((r) => ({ rating: r.rating, count: r.count })),
      heatmapData: heatmap.map((h) => ({ date: h.date, count: h.count })),
    };
  }, []);

  return {
    isReady,
    addItem,
    updateItemStatus,
    findItem,
    getAllItems,
    getRecentItems,
    deleteItem,
    addRating,
    getRating,
    saveDirectorsActors,
    getStats,
    getPreference,
    setPreference,
  };
}
