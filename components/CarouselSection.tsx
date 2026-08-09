import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { spacing } from '../constants/m3';
import { useTheme } from '../context/ThemeContext';
import { useResponsive } from '../hooks/useResponsive';
import { Button, Text } from './m3';
import MovieCard, { MovieCardItem } from './MovieCard';

interface CarouselSectionProps {
  title: string;
  items: MovieCardItem[];
  onSeeAll?: () => void;
  onItemPress: (item: MovieCardItem) => void;
  onItemLongPress?: (item: MovieCardItem) => void;
  cardSize?: 'small' | 'medium' | 'large';
  showRating?: boolean;
  showMediaTypeBadge?: boolean;
}

/** Cards grow with the window so wide layouts don't show a row of tiny posters. */
const CARD_WIDTH = {
  compact: { small: 100, medium: 128, large: 148 },
  wide: { small: 120, medium: 152, large: 180 },
} as const;

/**
 * A titled, horizontally scrolling rail of poster cards.
 *
 * The heading is a real accessibility header, so screen-reader users can jump
 * between rails instead of swiping through every card in one.
 */
export default function CarouselSection({
  title,
  items,
  onSeeAll,
  onItemPress,
  onItemLongPress,
  cardSize = 'medium',
  showRating = true,
  showMediaTypeBadge = false,
}: CarouselSectionProps) {
  const { colors } = useTheme();
  const { isCompact, gutter } = useResponsive();
  const width = CARD_WIDTH[isCompact ? 'compact' : 'wide'][cardSize];

  const renderItem = useCallback(
    ({ item }: { item: MovieCardItem }) => (
      <MovieCard
        item={item}
        onPress={onItemPress}
        onLongPress={onItemLongPress}
        width={width}
        showRating={showRating}
        showMediaTypeBadge={showMediaTypeBadge}
      />
    ),
    [onItemPress, onItemLongPress, width, showRating, showMediaTypeBadge]
  );

  const keyExtractor = useCallback(
    (item: MovieCardItem) => `${item.id}-${item.mediaType ?? 'movie'}`,
    []
  );

  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <Text
          variant="titleMedium"
          color={colors.onSurface}
          accessibilityRole="header"
          style={styles.title}
          numberOfLines={1}
        >
          {title}
        </Text>
        {onSeeAll ? (
          <Button
            label="See all"
            variant="text"
            size="small"
            icon="chevron-forward"
            trailingIcon
            onPress={onSeeAll}
            accessibilityLabel={`See all ${title}`}
          />
        ) : null}
      </View>

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.md }}
        // Rails are long; windowing keeps scrolling smooth on low-end devices.
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
    minHeight: 32,
  },
  title: {
    flexShrink: 1,
  },
});
