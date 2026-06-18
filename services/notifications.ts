import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

class NotificationService {
  private initialized = false;

  async initialize(): Promise<boolean> {
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
    mediaType: 'movie' | 'tv'
  ): Promise<void> {
    try {
      await this.initialize();

      const release = new Date(releaseDate);
      const now = new Date();

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
    try {
      await Notifications.cancelScheduledNotificationAsync(`${tmdbId}-day-before`);
      await Notifications.cancelScheduledNotificationAsync(`${tmdbId}-release-day`);
    } catch (error) {
      console.error('Failed to cancel reminder:', error);
    }
  }

  async cancelAllReminders(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Failed to cancel all reminders:', error);
    }
  }

  async getScheduledNotifications() {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Failed to get scheduled notifications:', error);
      return [];
    }
  }
}

export const notificationService = new NotificationService();
