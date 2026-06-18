import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export interface Genre {
  id: number;
  name: string;
}

interface GenreChipsProps {
  genres: Genre[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}

export default function GenreChips({
  genres,
  selectedIds,
  onToggle,
}: GenreChipsProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {genres.map((genre) => {
        const isSelected = selectedIds.includes(genre.id);
        return (
          <Pressable
            key={genre.id}
            onPress={() => onToggle(genre.id)}
            style={[
              styles.chip,
              {
                borderColor: isSelected ? colors.accent : colors.border,
                backgroundColor: isSelected ? colors.accent : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color: isSelected ? colors.bg : colors.secondary,
                },
              ]}
            >
              {genre.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
