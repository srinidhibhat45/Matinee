import React, { useMemo } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shape, spacing, withAlpha } from '../constants/m3';
import { useTheme } from '../context/ThemeContext';
import { Text, Touchable } from './m3';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

/** Poster aspect ratio TMDB serves. Keeps every card the same shape. */
const POSTER_RATIO = 3 / 2;

export interface MovieCardItem {
  id: number;
  title: string;
  posterPath: string | null;
  voteAverage: number;
  releaseDate: string;
  mediaType?: 'movie' | 'tv';
  certification?: string | null;
  reason?: string;
}

interface MovieCardProps {
  item: MovieCardItem;
  onPress?: (item: MovieCardItem) => void;
  onLongPress?: (item: MovieCardItem) => void;
  size?: 'small' | 'medium' | 'large';
  /** Explicit width, overriding the size preset. Used by responsive grids. */
  width?: number;
  showRating?: boolean;
  showMediaTypeBadge?: boolean;
}

const SIZE_CONFIG = {
  small: { width: 100 },
  medium: { width: 128 },
  large: { width: 148 },
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Poster card used across every rail and grid in the app.
 *
 * Badges sit on a fixed dark scrim rather than a theme colour: they overlay
 * artwork whose brightness is unknown, and a theme-coloured badge is legible
 * over some posters and invisible over others.
 */
export default function MovieCard({
  item,
  onPress,
  onLongPress,
  size = 'medium',
  width,
  showRating = true,
  showMediaTypeBadge = false,
}: MovieCardProps) {
  const { colors } = useTheme();
  const cardWidth = width ?? SIZE_CONFIG[size].width;
  const posterHeight = Math.round(cardWidth * POSTER_RATIO);

  const { releaseText, isFuture } = useMemo(() => {
    if (!item.releaseDate) return { releaseText: '', isFuture: false };
    const date = new Date(item.releaseDate);
    const future = date > new Date();
    if (!future) return { releaseText: item.releaseDate.substring(0, 4), isFuture: false };
    try {
      return {
        releaseText: `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
        isFuture: true,
      };
    } catch {
      return { releaseText: item.releaseDate, isFuture: true };
    }
  }, [item.releaseDate]);

  const posterUri = item.posterPath ? `${TMDB_IMAGE_BASE}${item.posterPath}` : null;
  const rating = item.voteAverage ? item.voteAverage.toFixed(1) : null;
  const typeLabel = item.mediaType === 'tv' ? 'Series' : 'Movie';

  // One combined label so a screen reader announces the card as a single item
  // rather than reading each badge as a separate stop.
  const a11yLabel = [
    item.title,
    typeLabel,
    releaseText ? (isFuture ? `Releases ${releaseText}` : `Released ${releaseText}`) : null,
    rating ? `Rated ${rating} out of 10` : null,
    item.certification ? `Certificate ${item.certification}` : null,
    item.reason ? `Suggested because ${item.reason}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Touchable
      onPress={() => onPress?.(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      stateLayerColor={colors.onSurface}
      borderRadius={shape.medium}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={onLongPress ? 'Double tap to open. Long press for quick actions.' : undefined}
      style={[styles.container, { width: cardWidth }]}
    >
      <View
        style={[
          styles.posterContainer,
          {
            width: cardWidth,
            height: posterHeight,
            backgroundColor: colors.surfaceContainerHighest,
          },
        ]}
      >
        {posterUri ? (
          <Image
            source={{ uri: posterUri }}
            style={{ width: cardWidth, height: posterHeight }}
            resizeMode="cover"
            accessible={false}
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="film-outline" size={32} color={colors.onSurfaceVariant} />
          </View>
        )}

        {item.certification ? (
          <View style={[styles.badge, styles.certBadge]}>
            <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
              {item.certification}
            </Text>
          </View>
        ) : null}

        {showRating && rating ? (
          <View style={[styles.badge, styles.ratingBadge]}>
            <Ionicons name="star" size={11} color={SCRIM_ON} />
            <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
              {rating}
            </Text>
          </View>
        ) : null}

        {showMediaTypeBadge ? (
          <View style={[styles.badge, styles.mediaTypeBadge]}>
            <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
              {typeLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.meta}>
        <Text variant="titleSmall" color={colors.onSurface} numberOfLines={2}>
          {item.title}
        </Text>

        {releaseText ? (
          <Text
            variant="bodySmall"
            color={isFuture ? colors.primary : colors.onSurfaceVariant}
            numberOfLines={1}
          >
            {releaseText}
          </Text>
        ) : null}

        {item.reason ? (
          <Text variant="labelSmall" color={colors.tertiary} numberOfLines={2}>
            ✨ {item.reason}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}

/** Foreground for badges painted on the poster scrim. */
const SCRIM_ON = '#FFFFFF';
const SCRIM = withAlpha('#000000', 0.62);

const styles = StyleSheet.create({
  container: {
    borderRadius: shape.medium,
  },
  posterContainer: {
    borderRadius: shape.medium,
    overflow: 'hidden',
  },
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: SCRIM,
    borderRadius: shape.extraSmall,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  certBadge: {
    top: spacing.sm,
    left: spacing.sm,
  },
  ratingBadge: {
    top: spacing.sm,
    right: spacing.sm,
  },
  mediaTypeBadge: {
    bottom: spacing.sm,
    right: spacing.sm,
  },
  meta: {
    marginTop: spacing.xs,
    gap: 1,
  },
});
