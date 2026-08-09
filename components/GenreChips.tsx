import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { spacing } from '../constants/m3';
import Chip from './m3/Chip';

export interface Genre {
  id: number;
  name: string;
}

interface GenreChipsProps {
  genres: Genre[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  /** Horizontal page gutter, so the rail lines up with the rest of the screen. */
  gutter?: number;
}

/**
 * Horizontally scrolling row of Material 3 filter chips.
 *
 * Each chip is an independent toggle, so they are exposed as checkboxes and a
 * selected one gains a checkmark — the state survives both a screen reader and
 * colour-blind viewing, which a fill-colour change alone does not.
 */
export default function GenreChips({
  genres,
  selectedIds,
  onToggle,
  gutter = spacing.lg,
}: GenreChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
      accessibilityLabel="Filter by genre"
    >
      {genres.map((genre) => (
        <Chip
          key={genre.id}
          label={genre.name}
          variant="filter"
          selected={selectedIds.includes(genre.id)}
          onPress={() => onToggle(genre.id)}
          accessibilityHint={
            selectedIds.includes(genre.id)
              ? `Removes the ${genre.name} filter`
              : `Filters results to ${genre.name}`
          }
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
