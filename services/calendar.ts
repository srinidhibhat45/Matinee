import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

class CalendarService {
  async addToCalendar(
    title: string,
    date: string,
    overview?: string,
    genres?: string
  ): Promise<boolean> {
    try {
      if (!date) {
        console.error('Cannot add to calendar: date is empty');
        return false;
      }

      // 1. Append the word " release" to the end of the movie/series title
      const eventTitle = `${title} release`;

      // 2. Format the date as all-day event for the release date.
      // In iCalendar (.ics), an all-day event has:
      // DTSTART;VALUE=DATE:YYYYMMDD
      // DTEND;VALUE=DATE:YYYYMMDD (the day after the start date)
      const startDate = new Date(date);
      if (isNaN(startDate.getTime())) {
        console.error('Invalid date format:', date);
        return false;
      }

      // Calculate next day
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);

      const startFormatted = date.replace(/-/g, '');
      const endFormatted = endDate.toISOString().split('T')[0].replace(/-/g, '');

      const stampFormatted = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const uid = `matinee_${Date.now()}_${Math.floor(Math.random() * 1000000)}@matinee.app`;

      let description = '';
      if (overview) {
        description += overview;
      }
      if (genres) {
        description += `\n\nGenres: ${genres}`;
      }
      description += '\n\nAdded via Matinee 🎬';

      // Helper to escape characters for iCalendar format
      const escapeText = (text: string) => {
        return text
          .replace(/\\/g, '\\\\')
          .replace(/,/g, '\\,')
          .replace(/;/g, '\\;')
          .replace(/\n/g, '\\n');
      };

      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//MatineeApp//MovieRelease//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stampFormatted}`,
        `DTSTART;VALUE=DATE:${startFormatted}`,
        `DTEND;VALUE=DATE:${endFormatted}`,
        `SUMMARY:${escapeText(eventTitle)}`,
        `DESCRIPTION:${escapeText(description)}`,
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const fileUri = `${FileSystem.cacheDirectory}${uid}.ics`;
      await FileSystem.writeAsStringAsync(fileUri, icsContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/calendar',
          dialogTitle: `Add ${eventTitle} to Calendar`,
          UTI: 'public.calendar-event',
        });
        return true;
      } else {
        console.error('Sharing is not available on this platform');
        return false;
      }
    } catch (error) {
      console.error('Failed to open calendar:', error);
      return false;
    }
  }
}

export const calendarService = new CalendarService();
