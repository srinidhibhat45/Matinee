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
  compact: { small: 112, medium: 144, large: 168 },
  wide: { small: 132, medium: 168, large: 200 },
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
          variant="titleLarge"
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
    marginBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
    minHeight: 40,
  },
  title: {
    flexShrink: 1,
  },
});
