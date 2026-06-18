import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '../context/ThemeContext';
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

  const renderItem = useCallback(
    ({ item }: { item: MovieCardItem }) => (
      <MovieCard
        item={item}
        onPress={onItemPress}
        onLongPress={onItemLongPress}
        size={cardSize}
        showRating={showRating}
        showMediaTypeBadge={showMediaTypeBadge}
      />
    ),
    [onItemPress, onItemLongPress, cardSize, showRating, showMediaTypeBadge]
  );

  const keyExtractor = useCallback(
    (item: MovieCardItem) => `${item.id}-${item.mediaType ?? 'movie'}`,
    []
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {onSeeAll && (
          <Pressable onPress={onSeeAll} hitSlop={8}>
            <Text style={[styles.seeAll, { color: colors.accent }]}>See All →</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Separator}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    paddingLeft: 16,
    paddingRight: 16,
  },
  separator: {
    width: 12,
  },
});
