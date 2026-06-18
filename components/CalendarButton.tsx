import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
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
  const { colors } = useTheme();

  const handlePress = async () => {
    await calendarService.addToCalendar(title, date, overview, genres);
  };

  return (
    <Pressable onPress={handlePress} style={[styles.button, { borderColor: colors.accent }]}>
      <Ionicons
        name="calendar-outline"
        size={16}
        color={colors.accent}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: colors.accent }]}>Add to Calendar</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 36,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 6,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
});
