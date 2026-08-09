import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useResponsive, gridItemWidth } from '../../hooks/useResponsive';
import { shape, spacing, withAlpha } from '../../constants/m3';
import { chartColor } from '../../constants/m3/charts';
import {
  Button,
  Card,
  IconButton,
  Loading,
  Text,
  NAVIGATION_BAR_HEIGHT,
} from '../../components/m3';
import HeatmapGrid from '../../components/HeatmapGrid';
import StatCard from '../../components/StatCard';
import EmptyState from '../../components/EmptyState';
import { useDatabase } from '../../hooks/useDatabase';
import { UserStats } from '../../types';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STAT_GAP = spacing.md;

/** Section wrapper with an icon, a heading, and consistent spacing. */
function Section({
  icon,
  title,
  gutter,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  gutter: number;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { paddingHorizontal: gutter }]}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={20} color={colors.primary} />
        <Text variant="titleMedium" color={colors.onSurface} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const { isReady, getStats } = useDatabase();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter, statColumns, width, isCompact } = useResponsive();

  // Defaults to the live current year — hardcoding it meant the screen opened
  // on a stale year once the calendar moved on.
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllGenres, setShowAllGenres] = useState(false);

  const currentYear = new Date().getFullYear();
  const atLatestYear = selectedYear >= currentYear;

  const statCardWidth = useMemo(
    () => gridItemWidth(width, statColumns, gutter, STAT_GAP),
    [width, statColumns, gutter]
  );

  const bottomPadding =
    (isCompact ? NAVIGATION_BAR_HEIGHT + insets.bottom : insets.bottom) + 88;

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

  const fullMonthlyBreakdown = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const monthNum = i + 1;
        const entry = stats?.monthlyBreakdown?.find((m) => Number(m.month) === monthNum);
        return { month: monthNum, count: entry ? entry.count : 0 };
      }),
    [stats]
  );

  if (loading || !isReady) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Loading label="Loading your stats" size="large" />
      </View>
    );
  }

  const hasStats = !!stats && stats.totalWatched > 0;
  const genreTotal = stats?.favoriteGenres?.reduce((acc, g) => acc + g.count, 0) || 1;
  const maxRatingCount = Math.max(...(stats?.ratingDistribution || []).map((r) => r.count), 1);
  const maxMonthCount = Math.max(...fullMonthlyBreakdown.map((m) => m.count), 1);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surfaceContainerHigh}
          />
        }
      >
        {/* Header with a year stepper */}
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + spacing.md, paddingHorizontal: gutter },
          ]}
        >
          <View style={styles.headerRow}>
            <Text
              variant="headlineSmall"
              color={colors.onSurface}
              accessibilityRole="header"
              style={styles.flexShrink}
            >
              Your stats
            </Text>

            <View
              style={[styles.yearStepper, { backgroundColor: colors.surfaceContainerHigh }]}
              accessibilityRole="adjustable"
              accessibilityLabel={`Year ${selectedYear}`}
              accessibilityValue={{ text: String(selectedYear) }}
            >
              <IconButton
                icon="chevron-back"
                size={36}
                iconSize={20}
                onPress={() => setSelectedYear((y) => y - 1)}
                accessibilityLabel={`Show ${selectedYear - 1}`}
              />
              <Text variant="titleMedium" color={colors.onSurface} style={styles.yearValue}>
                {selectedYear}
              </Text>
              <IconButton
                icon="chevron-forward"
                size={36}
                iconSize={20}
                disabled={atLatestYear}
                onPress={() => setSelectedYear((y) => y + 1)}
                accessibilityLabel={`Show ${selectedYear + 1}`}
              />
            </View>
          </View>

          <Text variant="bodyLarge" color={colors.onSurfaceVariant}>
            {stats?.totalWatched
              ? `${stats.totalWatched} titles logged in ${selectedYear}`
              : `Nothing logged in ${selectedYear} yet`}
          </Text>
        </View>

        {/* Headline metrics */}
        <View style={[styles.statsGrid, { paddingHorizontal: gutter }]}>
          <StatCard
            label="Movies"
            value={stats?.totalMovies || 0}
            icon="film-outline"
            color={chartColor(0, isDark)}
            width={statCardWidth}
            onPress={() =>
              router.push({ pathname: '/profile', params: { tab: 'watched', mediaType: 'movie' } })
            }
          />
          <StatCard
            label="Series"
            value={stats?.totalSeries || 0}
            icon="tv-outline"
            color={chartColor(3, isDark)}
            width={statCardWidth}
            onPress={() =>
              router.push({ pathname: '/profile', params: { tab: 'watched', mediaType: 'tv' } })
            }
          />
          <StatCard
            label="Hours watched"
            value={stats?.totalHoursWatched || 0}
            icon="time-outline"
            color={chartColor(4, isDark)}
            width={statCardWidth}
          />
          <StatCard
            label="Average rating"
            value={
              stats?.averageRating &&
              !isNaN(Number(stats.averageRating)) &&
              Number(stats.averageRating) > 0
                ? Number(stats.averageRating).toFixed(1)
                : '—'
            }
            icon="star-outline"
            color={chartColor(7, isDark)}
            width={statCardWidth}
          />
          <StatCard
            label="Current streak"
            value={`${stats?.currentStreak || 0}d`}
            icon="flame-outline"
            color={chartColor(8, isDark)}
            width={statCardWidth}
          />
          <StatCard
            label="Best streak"
            value={`${stats?.longestStreak || 0}d`}
            icon="trophy-outline"
            color={chartColor(5, isDark)}
            width={statCardWidth}
          />
        </View>

        {/* With nothing logged, an empty heatmap and three flat charts say less
            than one clear message — so the charts below are skipped entirely. */}
        {!hasStats ? (
          <EmptyState
            icon="analytics-outline"
            title={`Nothing logged in ${selectedYear}`}
            subtitle="Rate a few movies or series and your watching patterns will show up here."
            compact
          />
        ) : (
          <Section icon="calendar-outline" title={`${selectedYear} activity`} gutter={gutter}>
            <Card variant="filled" radius={shape.large} style={styles.chartCard}>
              <HeatmapGrid data={stats?.heatmapData || []} year={selectedYear} />
            </Card>
          </Section>
        )}

        {/* Genre split */}
        {stats?.favoriteGenres && stats.favoriteGenres.length > 0 ? (
          <Section icon="pricetags-outline" title="Favourite genres" gutter={gutter}>
            <View
              style={[styles.segmentedBar, { backgroundColor: colors.surfaceContainerHighest }]}
              accessibilityRole="image"
              accessibilityLabel={`Genre split: ${stats.favoriteGenres
                .slice(0, 5)
                .map((g) => `${g.genre} ${Math.round((g.count / genreTotal) * 100)} percent`)
                .join(', ')}`}
            >
              {stats.favoriteGenres.map((genre, index) => (
                <View
                  key={`seg-${genre.genre}`}
                  style={{
                    width: `${(genre.count / genreTotal) * 100}%`,
                    height: '100%',
                    backgroundColor: chartColor(index, isDark),
                  }}
                />
              ))}
            </View>

            <View style={styles.legend}>
              {stats.favoriteGenres
                .slice(0, showAllGenres ? stats.favoriteGenres.length : 6)
                .map((genre, index) => {
                  const percentage = Math.round((genre.count / genreTotal) * 100);
                  return (
                    <View
                      key={genre.genre}
                      style={styles.legendItem}
                      accessible
                      accessibilityLabel={`${genre.genre}: ${genre.count} titles, ${percentage} percent`}
                    >
                      <View
                        style={[styles.legendDot, { backgroundColor: chartColor(index, isDark) }]}
                      />
                      <Text
                        variant="bodyMedium"
                        color={colors.onSurface}
                        numberOfLines={1}
                        style={styles.flexShrink}
                      >
                        {genre.genre}
                      </Text>
                      <Text variant="labelMedium" color={colors.onSurfaceVariant}>
                        {percentage}%
                      </Text>
                    </View>
                  );
                })}
            </View>

            {stats.favoriteGenres.length > 6 ? (
              <Button
                label={showAllGenres ? 'Show less' : `Show all ${stats.favoriteGenres.length}`}
                variant="text"
                icon={showAllGenres ? 'chevron-up' : 'chevron-down'}
                trailingIcon
                onPress={() => setShowAllGenres((v) => !v)}
                style={styles.showMore}
              />
            ) : null}
          </Section>
        ) : null}

        {/* Rating distribution */}
        {stats?.ratingDistribution && stats.ratingDistribution.length > 0 ? (
          <Section icon="star-outline" title="Rating distribution" gutter={gutter}>
            <Card variant="filled" radius={shape.large} style={styles.chartCard}>
              <View style={styles.barChart}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((rating) => {
                  const count =
                    stats.ratingDistribution.find((r) => r.rating === rating)?.count || 0;
                  const barHeight = Math.max(4, (count / maxRatingCount) * 88);
                  return (
                    <View
                      key={rating}
                      style={styles.barColumn}
                      accessible
                      accessibilityLabel={`${rating} out of 10: ${count} ${
                        count === 1 ? 'title' : 'titles'
                      }`}
                    >
                      <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                        {count > 0 ? count : ' '}
                      </Text>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: barHeight,
                            backgroundColor:
                              count > 0
                                ? colors.rating[rating]
                                : withAlpha(colors.onSurfaceVariant, 0.18),
                          },
                        ]}
                      />
                      <Text variant="labelMedium" color={colors.onSurfaceVariant}>
                        {rating}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Card>
          </Section>
        ) : null}

        {/* Monthly breakdown */}
        {hasStats ? (
          <Section icon="bar-chart-outline" title={`Monthly breakdown`} gutter={gutter}>
            <Card variant="filled" radius={shape.large} style={styles.chartCard}>
              <View style={styles.barChart}>
                {fullMonthlyBreakdown.map((m, idx) => (
                  <View
                    key={m.month}
                    style={styles.barColumn}
                    accessible
                    accessibilityLabel={`${MONTH_NAMES[idx]}: ${m.count} ${
                      m.count === 1 ? 'title' : 'titles'
                    }`}
                  >
                    <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                      {m.count > 0 ? m.count : ' '}
                    </Text>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: Math.max(4, (m.count / maxMonthCount) * 72),
                          backgroundColor:
                            m.count > 0
                              ? colors.primary
                              : withAlpha(colors.onSurfaceVariant, 0.18),
                        },
                      ]}
                    />
                    <Text variant="labelMedium" color={colors.onSurfaceVariant}>
                      {MONTH_INITIALS[idx]}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </Section>
        ) : null}

        {/* People */}
        {stats?.topDirectors && stats.topDirectors.length > 0 ? (
          <Section icon="videocam-outline" title="Top directors" gutter={gutter}>
            <Card variant="filled" radius={shape.large}>
              {stats.topDirectors.map((director, index) => (
                <View
                  key={director.name}
                  style={[
                    styles.personRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
                  ]}
                  accessible
                  accessibilityLabel={`Number ${index + 1}, ${director.name}, ${director.count} ${
                    director.count === 1 ? 'film' : 'films'
                  }`}
                >
                  <Text variant="titleSmall" color={colors.primary} style={styles.rank}>
                    {index + 1}
                  </Text>
                  <Text
                    variant="bodyLarge"
                    color={colors.onSurface}
                    numberOfLines={1}
                    style={styles.flexOne}
                  >
                    {director.name}
                  </Text>
                  <Text variant="labelMedium" color={colors.onSurfaceVariant}>
                    {director.count} {director.count === 1 ? 'film' : 'films'}
                  </Text>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {stats?.topActors && stats.topActors.length > 0 ? (
          <Section icon="people-outline" title="Top actors" gutter={gutter}>
            <Card variant="filled" radius={shape.large}>
              {stats.topActors.map((actor, index) => (
                <View
                  key={actor.name}
                  style={[
                    styles.personRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
                  ]}
                  accessible
                  accessibilityLabel={`Number ${index + 1}, ${actor.name}, ${actor.count} ${
                    actor.count === 1 ? 'title' : 'titles'
                  }`}
                >
                  <Text variant="titleSmall" color={colors.primary} style={styles.rank}>
                    {index + 1}
                  </Text>
                  <Text
                    variant="bodyLarge"
                    color={colors.onSurface}
                    numberOfLines={1}
                    style={styles.flexOne}
                  >
                    {actor.name}
                  </Text>
                  <Text variant="labelMedium" color={colors.onSurfaceVariant}>
                    {actor.count} {actor.count === 1 ? 'title' : 'titles'}
                  </Text>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },

  header: {
    paddingBottom: spacing.lg,
    gap: spacing.xxs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  yearStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: shape.full,
    paddingHorizontal: spacing.xs,
  },
  yearValue: {
    minWidth: 46,
    textAlign: 'center',
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: STAT_GAP,
    marginBottom: spacing.lg,
  },

  section: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  chartCard: {
    padding: spacing.md,
  },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  bar: {
    width: '100%',
    maxWidth: 22,
    borderTopLeftRadius: shape.extraSmall,
    borderTopRightRadius: shape.extraSmall,
  },

  segmentedBar: {
    height: 16,
    borderRadius: shape.full,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    columnGap: spacing.lg,
  },
  legendItem: {
    minWidth: '44%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
  },
  showMore: {
    alignSelf: 'flex-start',
  },

  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  rank: {
    width: 24,
    textAlign: 'center',
  },
});
