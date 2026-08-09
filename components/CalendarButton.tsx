import React from 'react';
import { Button } from './m3';
import { calendarService } from '../services/calendar';

interface CalendarButtonProps {
  title: string;
  date: string; // ISO date string, e.g. "2026-07-15"
  overview?: string;
  genres?: string;
}

export default function CalendarButton({
  title,
  date,
  overview,
  genres,
}: CalendarButtonProps) {
  return (
    <Button
      label="Add to calendar"
      icon="calendar-outline"
      variant="outlined"
      size="small"
      onPress={() => calendarService.addToCalendar(title, date, overview, genres)}
      accessibilityLabel={`Add ${title} to your calendar`}
    />
  );
}
