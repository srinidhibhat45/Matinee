import { Linking } from 'react-native';

class CalendarService {
  /**
   * Deep links to Google Calendar to add an all-day event for the movie release.
   * Directs the user to the Google Calendar app if installed, or the Google Calendar web page.
   *
   * @param title     Title of the movie/show
   * @param date      ISO release date string (e.g. "2026-07-15")
   * @param overview  Brief overview of the media
   * @param genres    Comma-separated list of genre names
   */
  async addToCalendar(
    title: string,
    date: string,
    overview?: string,
    genres?: string
  ): Promise<boolean> {
    try {
      if (!date) {
        console.error('[CalendarService] Cannot add to calendar: date is empty');
        return false;
      }

      const startDate = new Date(date);
      if (isNaN(startDate.getTime())) {
        console.error('[CalendarService] Invalid date format:', date);
        return false;
      }

      // Calculate next day for the end date of the all-day event
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);

      const startFormatted = date.replace(/-/g, '');
      const endFormatted = endDate.toISOString().split('T')[0].replace(/-/g, '');

      const eventTitle = `${title} release`;
      let details = '';
      if (overview) {
        details += overview;
      }
      if (genres) {
        details += `\n\nGenres: ${genres}`;
      }
      details += '\n\nAdded via Matinee 🎬';

      // Build Google Calendar template URL
      const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
        eventTitle
      )}&dates=${startFormatted}/${endFormatted}&details=${encodeURIComponent(details)}`;

      await Linking.openURL(url);
      return true;
    } catch (error) {
      console.error('[CalendarService] Failed to open calendar link:', error);
      return false;
    }
  }
}

export const calendarService = new CalendarService();
