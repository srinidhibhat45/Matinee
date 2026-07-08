import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getImageUrl } from './tmdb';

class NotificationService {
  private initialized = false;

  private async downloadPosterLocally(posterPath: string | null | undefined, tmdbId: number): Promise<string | null> {
    if (!posterPath) return null;
    const remoteUrl = getImageUrl(posterPath, 'w500');
    if (!remoteUrl) return null;

    try {
      const filename = `${tmdbId}_poster.jpg`;
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists) {
        return localUri;
      }

      await FileSystem.downloadAsync(remoteUrl, localUri);
      return localUri;
    } catch (err) {
      console.warn(`[Notifications] Failed to download poster locally:`, err);
      return null;
    }
  }

  async initialize(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    if (this.initialized) return true;

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('Notification permissions not granted');
        return false;
      }

      // Register the notification category for action buttons
      await Notifications.setNotificationCategoryAsync('movie-release-reminder', [
        {
          buttonTitle: '🍿 View Details',
          identifier: 'view-movie',
          options: {
            opensAppToForeground: true,
          },
        },
      ]);

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('movie-releases', {
          name: 'Movie Releases',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FFBF00',
        });
      }

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize notifications:', error);
      return false;
    }
  }

  async scheduleReleaseReminder(
    title: string,
    releaseDate: string,
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    posterPath?: string | null
  ): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await this.initialize();

      const release = new Date(releaseDate);
      const now = new Date();

      // Download the poster locally if available
      const localPosterUri = await this.downloadPosterLocally(posterPath, tmdbId);

      // Day before reminder (9 AM)
      const dayBefore = new Date(release);
      dayBefore.setDate(dayBefore.getDate() - 1);
      dayBefore.setHours(9, 0, 0, 0);

      if (dayBefore > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `🎬 Tomorrow: ${title} releases!`,
            body: `Don't forget — ${title} drops tomorrow. Get ready!`,
            data: { tmdbId, mediaType, type: 'day-before' },
            categoryIdentifier: 'movie-release-reminder',
            attachments: localPosterUri
              ? [
                  {
                    identifier: `${tmdbId}-day-before-poster`,
                    url: localPosterUri,
                    type: 'image/jpeg',
                  },
                ]
              : undefined,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: dayBefore,
            channelId: 'movie-releases',
          },
          identifier: `${tmdbId}-day-before`,
        });
      }

      // Release day reminder (10 AM)
      const releaseDay = new Date(release);
      releaseDay.setHours(10, 0, 0, 0);

      if (releaseDay > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `🍿 ${title} is out now!`,
            body: `${title} is now available. Time to watch!`,
            data: { tmdbId, mediaType, type: 'release-day' },
            categoryIdentifier: 'movie-release-reminder',
            attachments: localPosterUri
              ? [
                  {
                    identifier: `${tmdbId}-release-day-poster`,
                    url: localPosterUri,
                    type: 'image/jpeg',
                  },
                ]
              : undefined,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: releaseDay,
            channelId: 'movie-releases',
          },
          identifier: `${tmdbId}-release-day`,
        });
      }
    } catch (error) {
      console.error('Failed to schedule reminder:', error);
    }
  }

  async cancelReminder(tmdbId: number): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelScheduledNotificationAsync(`${tmdbId}-day-before`);
      await Notifications.cancelScheduledNotificationAsync(`${tmdbId}-release-day`);
    } catch (error) {
      console.error('Failed to cancel reminder:', error);
    }
  }

  async cancelAllReminders(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Failed to cancel all reminders:', error);
    }
  }

  async getScheduledNotifications() {
    if (Platform.OS === 'web') return [];
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Failed to get scheduled notifications:', error);
      return [];
    }
  }
}

export const notificationService = new NotificationService();
