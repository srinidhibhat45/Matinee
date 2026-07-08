// ============================================================
// Matinee — In-App Notification Service
// Generates local notifications for new relevant releases and
// theatre → OTT transitions.
// ============================================================

import { Platform } from 'react-native';
import { tmdbService } from './tmdb';
import {
  getPreference,
  getAllItems,
  addInAppNotification,
  getInAppNotifications,
  markNotificationRead,
  dismissNotification,
  getUnreadNotificationCount,
  clearAllNotifications,
  InAppNotification,
} from './database';
import { MOVIE_GENRES, TV_GENRES } from '../constants/genres';

// ─── Types ─────────────────────────────────────────────────

export type { InAppNotification };

export type NotificationType = 'new_release' | 'ott_available' | 'trending';

// ─── Service ───────────────────────────────────────────────

class InAppNotificationService {
  private isGenerating = false;

  /**
   * Generate new notifications based on user's preferences,
   * watch history, and OTT subscriptions.
   */
  async generateNotifications(): Promise<void> {
    if (this.isGenerating) return;
    this.isGenerating = true;

    try {
      // Load user preferences
      const [langPref, ottPref, userCountry] = await Promise.all([
        getPreference('PREF_LANGUAGES'),
        getPreference('PREF_OTT_PROVIDERS'),
        getPreference('PREF_USER_COUNTRY'),
      ]);

      const langs = langPref ? langPref.split(',') : ['en', 'hi', 'kn'];
      const ottProviderIds = ottPref ? ottPref.split(',').map(Number).filter(Boolean) : [];
      const country = userCountry || 'US';

      // Get all user items to build interest profile and check OTT transitions
      const allItems = await getAllItems();
      const watchedIds = new Set(
        allItems
          .filter((i: any) => i.status === 'watched')
          .map((i: any) => i.tmdbId)
      );
      const interestedItems = allItems.filter(
        (i: any) => i.status === 'watchlist'
      );

      // Get the user's favorite genres from watched items
      const genreCounts: Record<string, number> = {};
      allItems
        .filter((i: any) => i.status === 'watched' && i.genres)
        .forEach((item: any) => {
          const genres = item.genres.split(',').map((g: string) => g.trim());
          genres.forEach((g: string) => {
            genreCounts[g] = (genreCounts[g] || 0) + 1;
          });
        });
      const topGenres = Object.entries(genreCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([genre]) => genre);

      // Run both generation tasks in parallel
      await Promise.allSettled([
        this.generateNewReleaseNotifications(langs, topGenres, watchedIds),
        this.generateOttTransitionNotifications(interestedItems, ottProviderIds, country),
      ]);
    } catch (err) {
      console.warn('[InAppNotifications] Error generating:', err);
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Find new trending/popular releases that match user's language
   * and genre preferences.
   */
  private async generateNewReleaseNotifications(
    langs: string[],
    topGenres: string[],
    watchedIds: Set<number>,
  ): Promise<void> {
    try {
      // 1. Fetch top personalized recommendations
      const { recommendationService } = require('./recommendations');
      let recs: any[] = [];
      try {
        recs = await recommendationService.getPersonalizedRecommendations(20);
      } catch (recErr) {
        console.warn('[InAppNotifications] Failed to load personalized recommendations for notification sync:', recErr);
      }

      // 2. Resolve genre names to TMDB genre IDs as fallback/mix-in
      const genreNameToId: Record<string, number> = {};
      for (const [id, name] of Object.entries(MOVIE_GENRES)) {
        genreNameToId[name.toLowerCase()] = Number(id);
      }
      for (const [id, name] of Object.entries(TV_GENRES)) {
        genreNameToId[name.toLowerCase()] = Number(id);
      }
      const genreIds = topGenres
        .map((g) => genreNameToId[g.toLowerCase()])
        .filter(Boolean);

      // Get today's date range (last 14 days for fallback discover freshness)
      const today = new Date();
      const twoWeeksAgo = new Date(today);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const dateLte = today.toISOString().split('T')[0];
      const dateGte = twoWeeksAgo.toISOString().split('T')[0];

      const notificationsToAdd: any[] = [];

      // If we have personalized recommendations, process them!
      if (recs && recs.length > 0) {
        const filteredRecs = recs
          .filter((item: any) => !watchedIds.has(item.id))
          .slice(0, 8);

        for (const item of filteredRecs) {
          const score = item.score || 8.0;
          const scorePercent = Math.round(score * 10);
          
          notificationsToAdd.push({
            notificationId: `ai_rec_${item.id}_${dateLte}`,
            title: `Recommended: ${item.title || item.name}`,
            body: `🔥 ${scorePercent}% Taste Match! ${item.reason || 'Matches your favorite genres and directors.'}`,
            type: 'trending',
            tmdbId: item.id,
            mediaType: item.mediaType || 'movie',
            posterPath: item.posterPath,
            providerName: null,
          });
        }
      }

      // If we don't have enough personalized notifications, fall back to recent popular releases matching genres
      if (notificationsToAdd.length < 3) {
        const fetchPromises = langs.slice(0, 3).map((lang) =>
          tmdbService.discover('movie', {
            withOriginalLanguage: lang,
            sortBy: 'popularity.desc',
            releaseDateGte: dateGte,
            releaseDateLte: dateLte,
            ...(genreIds.length > 0 ? { genres: genreIds.slice(0, 2).join(',') } : {}),
          }, 1).catch(() => null)
        );

        const results = await Promise.allSettled(fetchPromises);
        const discoverItems = results
          .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && !!r.value)
          .flatMap((r) => r.value.results || [])
          .filter((item: any) => item && !watchedIds.has(item.id) && item.voteAverage >= 6.0)
          .slice(0, 5);

        for (const item of discoverItems) {
          const genreNames = (item.genreIds || [])
            .slice(0, 2)
            .map((gId: number) => MOVIE_GENRES[gId] || TV_GENRES[gId])
            .filter(Boolean);

          const genreText = genreNames.length > 0 ? ` · ${genreNames.join(', ')}` : '';

          notificationsToAdd.push({
            notificationId: `new_release_${item.id}_${dateLte}`,
            title: item.title || 'New Release',
            body: `New ${item.mediaType === 'tv' ? 'series' : 'movie'} release ⭐ ${item.voteAverage?.toFixed(1)}${genreText}`,
            type: 'new_release',
            tmdbId: item.id,
            mediaType: item.mediaType || 'movie',
            posterPath: item.posterPath,
            providerName: null,
          });
        }
      }

      // Add to database (only top 5)
      for (const notif of notificationsToAdd.slice(0, 5)) {
        await addInAppNotification(notif);
      }
    } catch (err) {
      console.warn('[InAppNotifications] New release generation error:', err);
    }
  }

  /**
   * Check if any interested/watchlist items are now available on
   * user's selected OTT platforms.
   */
  private async generateOttTransitionNotifications(
    interestedItems: any[],
    ottProviderIds: number[],
    country: string,
  ): Promise<void> {
    if (ottProviderIds.length === 0 || interestedItems.length === 0) return;

    try {
      const ottSet = new Set(ottProviderIds);

      // Check a batch of interested items (limit to avoid excessive API calls)
      const itemsToCheck = interestedItems.slice(0, 10);

      for (const item of itemsToCheck) {
        try {
          const details = await tmdbService.getDetails(
            item.tmdbId,
            item.mediaType || 'movie',
          );

          if (!details?.watchProviders) continue;

          const providers = [
            ...(details.watchProviders.flatrate || []),
            ...(details.watchProviders.rent || []),
          ];

          const matchingProvider = providers.find(
            (p: any) => ottSet.has(p.provider_id)
          );

          if (matchingProvider) {
            await addInAppNotification({
              notificationId: `ott_${item.tmdbId}_${matchingProvider.provider_id}`,
              title: item.title || 'Now Streaming',
              body: `Now available on ${matchingProvider.provider_name}! 🎬`,
              type: 'ott_available',
              tmdbId: item.tmdbId,
              mediaType: item.mediaType || 'movie',
              posterPath: item.posterPath,
              providerName: matchingProvider.provider_name,
            });
          }
        } catch {
          // Skip individual item failures
        }
      }
    } catch (err) {
      console.warn('[InAppNotifications] OTT transition check error:', err);
    }
  }

  // ── Public Accessors ────────────────────────────────────

  async getAll(limit?: number): Promise<InAppNotification[]> {
    return getInAppNotifications(limit);
  }

  async getUnreadCount(): Promise<number> {
    return getUnreadNotificationCount();
  }

  async markRead(id: number): Promise<void> {
    return markNotificationRead(id);
  }

  async dismiss(id: number): Promise<void> {
    return dismissNotification(id);
  }

  async clearAll(): Promise<void> {
    return clearAllNotifications();
  }
}

export const inAppNotificationService = new InAppNotificationService();
