import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

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
  showRating?: boolean;
  showMediaTypeBadge?: boolean;
}

const SIZE_CONFIG = {
  small: { width: 120, posterHeight: 170, titleSize: 12, yearSize: 11 },
  medium: { width: 150, posterHeight: 220, titleSize: 13, yearSize: 12 },
  large: { width: 180, posterHeight: 260, titleSize: 14, yearSize: 12 },
} as const;

export default function MovieCard({
  item,
  onPress,
  onLongPress,
  size = 'medium',
  showRating = true,
  showMediaTypeBadge = false,
}: MovieCardProps) {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const config = SIZE_CONFIG[size];

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const isFuture = item.releaseDate && new Date(item.releaseDate) > new Date();
  let releaseText = '';
  if (item.releaseDate) {
    if (isFuture) {
      try {
        const dateObj = new Date(item.releaseDate);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        releaseText = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
      } catch {
        releaseText = item.releaseDate;
      }
    } else {
      releaseText = item.releaseDate.substring(0, 4);
    }
  }
  const posterUri = item.posterPath
    ? `${TMDB_IMAGE_BASE}${item.posterPath}`
    : null;
  const rating = item.voteAverage ? item.voteAverage.toFixed(1) : null;

  return (
    <Pressable
      onPress={() => onPress?.(item)}
      onLongPress={() => onLongPress?.(item)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.container,
          { width: config.width, transform: [{ scale: scaleAnim }] },
        ]}
      >
        <View
          style={[
            styles.posterContainer,
            { width: config.width, height: config.posterHeight, backgroundColor: colors.card },
          ]}
        >
          {posterUri ? (
            <Image
              source={{ uri: posterUri }}
              style={[
                styles.poster,
                { width: config.width, height: config.posterHeight },
              ]}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.placeholder,
                { width: config.width, height: config.posterHeight, backgroundColor: colors.elevated },
              ]}
            >
              <Ionicons name="film-outline" size={36} color={colors.muted} />
            </View>
          )}

          {item.certification && (
            <View style={[styles.certBadge, { backgroundColor: 'rgba(10, 10, 15, 0.85)', borderColor: colors.border }]}>
              <Text style={[styles.certBadgeText, { color: colors.text }]}>{item.certification}</Text>
            </View>
          )}

          {showRating && rating && (
            <View style={[styles.ratingBadge, { backgroundColor: colors.accent }]}>
              <Ionicons
                name="star"
                size={10}
                color={colors.bg}
                style={styles.ratingIcon}
              />
              <Text style={[styles.ratingText, { color: colors.bg }]}>{rating}</Text>
            </View>
          )}

          {showMediaTypeBadge && (
            <View style={[styles.mediaTypeBadge, { backgroundColor: 'rgba(10, 10, 15, 0.85)', borderColor: colors.border }]}>
              <Text style={[styles.mediaTypeText, { color: item.mediaType === 'tv' ? colors.accent : colors.text }]}>
                {item.mediaType === 'tv' ? 'Series' : 'Movie'}
              </Text>
            </View>
          )}
        </View>

        <Text
          style={[styles.title, { fontSize: config.titleSize, color: colors.text }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {item.title}
        </Text>

        {releaseText ? (
          <Text
            style={[
              styles.year,
              { fontSize: config.yearSize, color: isFuture ? colors.accent : colors.secondary },
            ]}
            numberOfLines={1}
          >
            {releaseText}
          </Text>
        ) : null}

        {item.reason ? (
          <Text
            style={[
              styles.reason,
              { fontSize: config.yearSize - 2.5, color: colors.accent },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            ✨ {item.reason}
          </Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // width set dynamically
  },
  posterContainer: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  poster: {
    borderRadius: 14,
  },
  placeholder: {
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  certBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 5,
    borderWidth: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  certBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  mediaTypeBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    borderRadius: 5,
    borderWidth: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaTypeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  ratingIcon: {
    marginRight: 2,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontWeight: '600',
    marginTop: 8,
    lineHeight: 18,
  },
  year: {
    marginTop: 2,
  },
  reason: {
    marginTop: 2,
    fontWeight: '500',
  },
});
