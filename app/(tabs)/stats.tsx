import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import HeatmapGrid from '../../components/HeatmapGrid';
import StatCard from '../../components/StatCard';
import { useDatabase } from '../../hooks/useDatabase';
import { UserStats } from '../../types';
import { MOVIE_GENRES, TV_GENRES } from '../../constants/genres';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const GENRE_COLORS = [
  '#D83B96', // Matinee warm pink
  '#FF7A50', // Orange-coral
  '#7F3FE7', // Purple
  '#00FFA3', // Teal/Green
  '#FFBF00', // Amber
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#10B981', // Green
  '#EC4899', // Pink
];

export default function StatsScreen() {
  const router = useRouter();
  const { isReady, getStats } = useDatabase();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllGenres, setShowAllGenres] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getStats(selectedYear);
      setStats(data);
    } catch (err) {
      console.error('Stats fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [getStats, selectedYear]);

  useFocusEffect(
    useCallback(() => {
      if (isReady) fetchStats();
    }, [isReady, fetchStats])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  }, [fetchStats]);

  const getRatingColor = (rating: number) => {
    const baseOpacity = 0.15 + (rating / 10) * 0.85;
    return isDark
      ? `rgba(0, 255, 163, ${baseOpacity})`
      : `rgba(0, 200, 83, ${baseOpacity})`;
  };

  const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  const fullMonthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
    const monthNum = i + 1;
    const dbEntry = stats?.monthlyBreakdown?.find((m) => Number(m.month) === monthNum);
    return {
      month: monthNum,
      count: dbEntry ? dbEntry.count : 0,
    };
  });

  if (loading || !isReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} />
      </View>
    );
  }

  const currentYear = new Date().getFullYear();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: Math.max(16, insets.top) + 12 }]}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Your Stats</Text>
            {/* Year Selector */}
            <View style={[styles.yearSelector, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity onPress={() => setSelectedYear(prev => prev - 1)} style={styles.yearBtn}>
                <Ionicons name="chevron-back" size={16} color={colors.accent} />
              </TouchableOpacity>
              <Text style={[styles.yearValueText, { color: colors.text }]}>{selectedYear}</Text>
              <TouchableOpacity 
                onPress={() => setSelectedYear(prev => prev + 1)} 
                disabled={selectedYear >= new Date().getFullYear()}
                style={[styles.yearBtn, selectedYear >= new Date().getFullYear() && { opacity: 0.3 }]}
              >
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={[styles.headerSubtitle, { color: colors.secondary }]}>
            {stats?.totalWatched
              ? `${stats.totalWatched} titles logged so far`
              : 'Start watching to see your stats!'}
          </Text>
        </View>

        {/* Stat Cards Grid */}
        <View style={styles.statsGrid}>
          <StatCard
            label="Movies"
            value={stats?.totalMovies || 0}
            icon="film-outline"
            color={colors.accent}
            onPress={() => router.push({ pathname: '/profile', params: { tab: 'watched', mediaType: 'movie' } })}
          />
          <StatCard
            label="Series"
            value={stats?.totalSeries || 0}
            icon="tv-outline"
            color={isDark ? '#00E5FF' : '#0097A7'}
            onPress={() => router.push({ pathname: '/profile', params: { tab: 'watched', mediaType: 'tv' } })}
          />
          <StatCard
            label="Hours"
            value={stats?.totalHoursWatched || 0}
            icon="time-outline"
            color="#A855F7"
          />
          <StatCard
            label="Avg Rating"
            value={
              stats?.averageRating && !isNaN(Number(stats.averageRating)) && Number(stats.averageRating) > 0
                ? Number(stats.averageRating).toFixed(1)
                : '—'
            }
            icon="star-outline"
            color={colors.accent}
          />
          <StatCard
            label="Current Streak"
            value={`${stats?.currentStreak || 0}d`}
            icon="flame-outline"
            color="#FF453A"
          />
          <StatCard
            label="Best Streak"
            value={`${stats?.longestStreak || 0}d`}
            icon="trophy-outline"
            color="#FF9F0A"
          />
        </View>

        {/* GitHub-style Heatmap */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={[styles.sectionTitleText, { color: colors.text }]}>{selectedYear} Activity</Text>
          </View>
          <View style={[styles.heatmapContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <HeatmapGrid
              data={stats?.heatmapData || []}
              year={selectedYear}
            />
          </View>
        </View>

        {/* Favorite Genres */}
        {stats?.favoriteGenres && stats.favoriteGenres.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="funnel-outline" size={18} color={colors.accent} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>Favorite Genres</Text>
            </View>
            
            {/* Proportional Segmented Bar */}
            <View style={[styles.segmentedBar, { backgroundColor: colors.card }]}>
              {stats.favoriteGenres.map((genre, index) => {
                const totalGenreSum = stats.favoriteGenres.reduce((acc, g) => acc + g.count, 0) || 1;
                const percentage = (genre.count / totalGenreSum) * 100;
                const color = GENRE_COLORS[index % GENRE_COLORS.length];
                return (
                  <View
                    key={`seg-${genre.genre}`}
                    style={{
                      width: `${percentage}%`,
                      height: '100%',
                      backgroundColor: color,
                    }}
                  />
                );
              })}
            </View>

            {/* Legend Grid */}
            <View style={styles.legendContainer}>
              {stats.favoriteGenres.slice(0, showAllGenres ? stats.favoriteGenres.length : 6).map((genre, index) => {
                const totalGenreSum = stats.favoriteGenres.reduce((acc, g) => acc + g.count, 0) || 1;
                const genreId = Number(genre.genre);
                const genreName = MOVIE_GENRES[genreId] ?? TV_GENRES[genreId] ?? `Genre ${genre.genre}`;
                const color = GENRE_COLORS[index % GENRE_COLORS.length];
                const percentage = Math.round((genre.count / totalGenreSum) * 100);

                return (
                  <View key={genre.genre} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: color }]} />
                    <View style={styles.legendTextContainer}>
                      <Text style={[styles.legendLabel, { color: colors.text }]} numberOfLines={1}>
                        {genreName}
                      </Text>
                      <Text style={[styles.legendValue, { color: colors.secondary }]}>
                        {genre.count} ({percentage}%)
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {stats.favoriteGenres.length > 6 && (
              <TouchableOpacity
                style={[styles.showMoreBtn, { borderColor: colors.border }]}
                onPress={() => setShowAllGenres(!showAllGenres)}
                activeOpacity={0.7}
              >
                <Text style={[styles.showMoreText, { color: colors.accent }]}>
                  {showAllGenres ? 'Show Less' : `Show All (${stats.favoriteGenres.length})`}
                </Text>
                <Ionicons
                  name={showAllGenres ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.accent}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Rating Distribution */}
        {stats?.ratingDistribution && stats.ratingDistribution.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="star-outline" size={18} color={colors.accent} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>Rating Distribution</Text>
            </View>
            <View style={styles.ratingChart}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((rating) => {
                const entry = stats.ratingDistribution.find(
                  (r) => r.rating === rating
                );
                const count = entry?.count || 0;
                const maxCount = Math.max(
                  ...stats.ratingDistribution.map((r) => r.count),
                  1
                );
                const barHeight = Math.max(4, (count / maxCount) * 80);
                return (
                  <View key={rating} style={styles.ratingColumn}>
                    <Text style={[styles.ratingColumnCount, { color: colors.secondary }]}>
                      {count > 0 ? count : ''}
                    </Text>
                    <View
                      style={[
                        styles.ratingBar,
                        {
                          height: barHeight,
                          backgroundColor: getRatingColor(rating),
                        },
                      ]}
                    />
                    <Text style={[styles.ratingColumnLabel, { color: colors.muted }]}>{rating}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Top Directors */}
        {stats?.topDirectors && stats.topDirectors.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="videocam-outline" size={18} color={colors.accent} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>Top Directors</Text>
            </View>
            {stats.topDirectors.map((director, index) => (
              <View key={director.name} style={[styles.personRow, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
                <Text style={[styles.personRank, { color: colors.accent }]}>#{index + 1}</Text>
                <Text style={[styles.personName, { color: colors.text }]}>{director.name}</Text>
                <Text style={[styles.personCount, { color: colors.secondary }]}>
                  {director.count} {director.count === 1 ? 'film' : 'films'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Top Actors */}
        {stats?.topActors && stats.topActors.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="people-outline" size={18} color={colors.accent} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>Top Actors</Text>
            </View>
            {stats.topActors.map((actor, index) => (
              <View key={actor.name} style={[styles.personRow, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
                <Text style={[styles.personRank, { color: colors.accent }]}>#{index + 1}</Text>
                <Text style={[styles.personName, { color: colors.text }]}>{actor.name}</Text>
                <Text style={[styles.personCount, { color: colors.secondary }]}>
                  {actor.count} {actor.count === 1 ? 'title' : 'titles'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Monthly Breakdown */}
        {stats?.monthlyBreakdown && stats.monthlyBreakdown.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="bar-chart-outline" size={18} color={colors.accent} />
              <Text style={[styles.sectionTitleText, { color: colors.text }]}>Monthly Breakdown ({selectedYear})</Text>
            </View>
            <View style={styles.monthlyChart}>
              {fullMonthlyBreakdown.map((m, idx) => {
                const maxCount = Math.max(
                  ...(stats?.monthlyBreakdown || []).map((x) => x.count),
                  1
                );
                const barHeight = Math.max(4, (m.count / maxCount) * 60);
                const label = MONTH_INITIALS[idx];
                return (
                  <View key={m.month} style={styles.monthColumn}>
                    <Text style={[styles.monthCount, { color: colors.secondary }]}>
                      {m.count > 0 ? m.count : ''}
                    </Text>
                    <View
                      style={[
                        styles.monthBar,
                        {
                          height: barHeight,
                          backgroundColor: m.count > 0 ? colors.accent : colors.border,
                        },
                      ]}
                    />
                    <Text style={[styles.monthLabel, { color: colors.muted }]}>{label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Empty state */}
        {(!stats || stats.totalWatched === 0) && (
          <View style={styles.emptyState}>
            <Ionicons name="analytics-outline" size={64} color={colors.muted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No stats yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.secondary }]}>
              Start logging movies and series to see your watching stats here!
            </Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 24,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleText: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: -0.2,
  },
  heatmapContainer: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 0.5,
  },
  genreList: {
    gap: 12,
  },
  genreRow: {
    gap: 6,
    marginBottom: 4,
  },
  genreInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  genreName: {
    fontSize: 13,
    fontWeight: '500',
  },
  genreBarContainer: {
    width: '100%',
    height: 8,
    borderRadius: 4,
  },
  genreBar: {
    height: '100%',
    borderRadius: 4,
  },
  genreCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  ratingChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    paddingTop: 20,
  },
  ratingColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  ratingColumnCount: {
    fontSize: 10,
    fontWeight: '600',
  },
  ratingBar: {
    width: 20,
    borderRadius: 4,
  },
  ratingColumnLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  personRank: {
    fontSize: 14,
    fontWeight: '700',
    width: 28,
  },
  personName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  personCount: {
    fontSize: 13,
  },
  monthlyChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 100,
    paddingTop: 20,
  },
  monthColumn: {
    alignItems: 'center',
    gap: 4,
  },
  monthCount: {
    fontSize: 10,
    fontWeight: '600',
  },
  monthBar: {
    width: 18,
    borderRadius: 4,
  },
  monthLabel: {
    fontSize: 10,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    gap: 6,
  },
  showMoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  yearSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  yearBtn: {
    padding: 6,
  },
  yearValueText: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'center',
  },
  segmentedBar: {
    height: 16,
    borderRadius: 8,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 16,
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
    columnGap: 16,
    justifyContent: 'space-between',
  },
  legendItem: {
    width: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendTextContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  legendValue: {
    fontSize: 12,
  },
});
