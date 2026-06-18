import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { tmdbService, getImageUrl } from '../../services/tmdb';
import { getItem, addItem, getPreference, setPreference, getAllItems, deleteItem } from '../../services/database';
import { notificationService } from '../../services/notifications';
import { calendarService } from '../../services/calendar';
import GenreChips from '../../components/GenreChips';
import SearchBar from '../../components/SearchBar';
import { TMDBMediaItem } from '../../types';
import { getGenreName } from '../../constants/genres';
import { LANGUAGES, DEFAULT_LANGUAGES } from '../../constants/languages';

const LANGUAGE_CHIPS = LANGUAGES.filter((l) =>
  DEFAULT_LANGUAGES.includes(l.code)
).map((l) => ({ id: l.code, name: l.name }));

type TimeBucket = 'thisWeek' | 'thisMonth' | 'later';

export default function UpcomingScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['en']);
  const [upcomingMovies, setUpcomingMovies] = useState<TMDBMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeBucket, setActiveBucket] = useState<TimeBucket>('thisMonth');

  // Paging and Search states
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const isFetchingRef = useRef(false);
  const loadedPageRef = useRef(1);

  const loadLanguagePreferences = useCallback(async () => {
    try {
      const langs = await getPreference('PREF_LANGUAGES');
      if (langs) {
        setSelectedLanguages(langs.split(','));
      } else {
        setSelectedLanguages(DEFAULT_LANGUAGES);
      }
    } catch (err) {
      console.error('Load language preferences error:', err);
    }
  }, []);

  const fetchUpcoming = useCallback(async (pageNum = 1, shouldAppend = false) => {
    if (isFetchingRef.current) return;
    if (shouldAppend && pageNum <= loadedPageRef.current) return;

    isFetchingRef.current = true;
    if (shouldAppend) {
      loadedPageRef.current = pageNum;
    } else {
      loadedPageRef.current = 1;
    }

    try {
      if (pageNum === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const res = await tmdbService.getUpcomingByLanguages(selectedLanguages, pageNum);
      const rawResults = res?.results || [];

      // Decorate with full details (runtime, watch providers, certification)
      const results = await Promise.all(
        rawResults.map(async (item) => {
          try {
            const details = await tmdbService.getDetails(item.id, item.mediaType || 'movie');
            if (details) {
              return {
                ...item,
                runtime: details.runtime,
                certification: details.certification,
                watchProviders: details.watchProviders,
              };
            }
          } catch (err) {
            console.error(`Failed to load details for upcoming movie ${item.id}:`, err);
          }
          return item;
        })
      );

      // Get all DB items to filter out (watched and not_interested)
      const dbItems = await getAllItems();
      const skipIds = new Set(dbItems.filter(i => i.status === 'watched' || i.status === 'not_interested').map(i => i.tmdbId));

      setUpcomingMovies((prev) => {
        const filteredResults = results.filter((m) => !skipIds.has(m.id));
        if (shouldAppend) {
          const existingIds = new Set(prev.map((m) => m.id));
          const newUnique = filteredResults.filter((m) => !existingIds.has(m.id));
          const combined = [...prev, ...newUnique];
          return combined.sort(
            (a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
          );
        } else {
          return filteredResults.sort(
            (a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
          );
        }
      });

      setPage(pageNum);
      setHasMore(pageNum < (res?.totalPages || 1));
    } catch (err) {
      console.error('Upcoming fetch error:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [selectedLanguages]);

  const [longPressItem, setLongPressItem] = useState<any | null>(null);
  const [longPressStatus, setLongPressStatus] = useState<string | null>(null);

  const handleItemLongPress = useCallback(async (item: any) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const existing = await getItem(item.id);
      setLongPressStatus(existing?.status || null);
      setLongPressItem(item);
    } catch (err) {
      console.error('Upcoming long press error:', err);
    }
  }, []);

  const handleLongPressAction = useCallback(async (action: 'rate' | 'watchlist' | 'not_interested') => {
    if (!longPressItem) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const tmdbId = longPressItem.id;
      const mediaType = longPressItem.mediaType || 'movie';

      if (action === 'rate') {
        setLongPressItem(null);
        router.push({
          pathname: '/detail/[id]',
          params: { id: String(tmdbId), mediaType, autoRate: 'true' },
        });
        return;
      }

      const existing = await getItem(tmdbId);

      if (action === 'watchlist') {
        if (existing?.status === 'watchlist' || existing?.status === 'interested') {
          await deleteItem(existing.id);
          await notificationService.cancelReminder(tmdbId);
        } else {
          const isUnreleased = longPressItem.releaseDate ? new Date(longPressItem.releaseDate) > new Date() : false;
          const status = isUnreleased ? 'interested' : 'watchlist';
          await addItem({
            tmdbId,
            mediaType,
            title: longPressItem.title,
            posterPath: longPressItem.posterPath,
            backdropPath: longPressItem.backdropPath,
            overview: longPressItem.overview,
            releaseDate: longPressItem.releaseDate,
            genres: JSON.stringify(longPressItem.genreIds || []),
            originalLanguage: longPressItem.originalLanguage,
            runtime: 0,
            voteAverage: longPressItem.voteAverage,
            status,
            watchedDate: null,
          });

          if (isUnreleased && longPressItem.releaseDate) {
            await notificationService.scheduleReleaseReminder(
              longPressItem.title,
              longPressItem.releaseDate,
              tmdbId,
              mediaType
            );
          }
        }
      } else if (action === 'not_interested') {
        if (existing) {
          await deleteItem(existing.id);
          await notificationService.cancelReminder(tmdbId);
        }
        await addItem({
          tmdbId,
          mediaType,
          title: longPressItem.title,
          posterPath: longPressItem.posterPath,
          backdropPath: longPressItem.backdropPath,
          overview: longPressItem.overview,
          releaseDate: longPressItem.releaseDate,
          genres: JSON.stringify(longPressItem.genreIds || []),
          originalLanguage: longPressItem.originalLanguage,
          runtime: 0,
          voteAverage: longPressItem.voteAverage,
          status: 'not_interested',
          watchedDate: null,
        });
      }

      setLongPressItem(null);
      await fetchUpcoming(1, false);
    } catch (err) {
      console.error('Upcoming long press action error:', err);
    }
  }, [longPressItem, fetchUpcoming, router]);

  useFocusEffect(
    useCallback(() => {
      loadLanguagePreferences();
    }, [loadLanguagePreferences])
  );

  useEffect(() => {
    fetchUpcoming(1, false);
  }, [fetchUpcoming, selectedLanguages]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUpcoming(1, false);
    setRefreshing(false);
  }, [fetchUpcoming]);

  const handleLoadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchUpcoming(page + 1, true);
  }, [loading, loadingMore, hasMore, page, fetchUpcoming]);

  const handleLanguageToggle = useCallback((langCode: string) => {
    setSelectedLanguages((prev) => {
      let next = prev.includes(langCode)
        ? prev.filter((code) => code !== langCode)
        : [...prev, langCode];
      if (next.length === 0) next = ['en']; // Keep English as fallback
      setPreference('PREF_LANGUAGES', next.join(',')).catch(console.error);
      return next;
    });
  }, []);

  const handleInterested = useCallback(
    async (item: TMDBMediaItem) => {
      try {
        await addItem({
          tmdbId: item.id,
          mediaType: item.mediaType,
          title: item.title,
          posterPath: item.posterPath,
          backdropPath: item.backdropPath,
          overview: item.overview,
          releaseDate: item.releaseDate,
          genres: JSON.stringify(item.genreIds),
          originalLanguage: item.originalLanguage,
          runtime: 0,
          voteAverage: item.voteAverage,
          status: 'interested',
          watchedDate: null,
        });

        // Schedule notification
        await notificationService.scheduleReleaseReminder(
          item.title,
          item.releaseDate,
          item.id,
          item.mediaType
        );

        alert(`Marked ${item.title} as interested. We'll remind you on release!`);
      } catch (err) {
        console.error('Mark interested error:', err);
      }
    },
    []
  );

  const handleAddToCalendar = useCallback((item: TMDBMediaItem) => {
    const genres = item.genreIds
      .map((id) => getGenreName(id, item.mediaType))
      .filter(Boolean)
      .join(', ');
    calendarService.addToCalendar(
      item.title,
      item.releaseDate,
      item.overview,
      genres
    );
  }, []);

  const filterByBucket = (movies: TMDBMediaItem[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const oneWeekLater = new Date(today);
    oneWeekLater.setDate(today.getDate() + 7);

    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const isSearching = !!searchQuery.trim();

    let list = movies.filter((m) => {
      if (!m.releaseDate) return false;
      const release = new Date(m.releaseDate);

      // Skip past releases in upcoming list
      if (release < today) return false;

      // When searching, bypass active time buckets (search all upcoming releases)
      if (isSearching) return true;

      if (activeBucket === 'thisWeek') {
        return release >= today && release <= oneWeekLater;
      } else if (activeBucket === 'thisMonth') {
        return release >= today && release <= endOfMonth;
      } else {
        // later
        return release > endOfMonth;
      }
    });

    if (isSearching) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.overview?.toLowerCase().includes(q) ||
          m.genreIds.some((gid) => getGenreName(gid, m.mediaType).toLowerCase().includes(q))
      );
    }

    return list;
  };

  const handleItemPress = useCallback(
    (item: TMDBMediaItem) => {
      router.push({
        pathname: '/detail/[id]',
        params: { id: item.id, mediaType: item.mediaType || 'movie' },
      });
    },
    [router]
  );

  const filteredMovies = filterByBucket(upcomingMovies);

  const renderUpcomingItem = useCallback(
    ({ item }: { item: TMDBMediaItem }) => {
      const releaseDate = item.releaseDate
        ? new Date(item.releaseDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : 'TBA';

      const genres = item.genreIds
        .slice(0, 2)
        .map((id) => getGenreName(id, item.mediaType))
        .filter(Boolean)
        .join(' · ');

      const langObj = LANGUAGES.find((l) => l.code === item.originalLanguage);
      const langName = langObj ? langObj.name : item.originalLanguage?.toUpperCase() ?? '';

      const runtimeStr = item.runtime
        ? `${Math.floor(item.runtime / 60)}h ${item.runtime % 60}m`
        : '';

      const providers = [
        ...(item.watchProviders?.flatrate || []),
        ...(item.watchProviders?.buy || []).filter(
          (b: any) => !(item.watchProviders?.flatrate || []).some((f: any) => f.provider_id === b.provider_id)
        ),
      ].slice(0, 3);

      return (
        <TouchableOpacity
          style={[styles.upcomingCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => handleItemPress(item)}
          onLongPress={() => handleItemLongPress(item)}
          activeOpacity={0.8}
        >
          {item.posterPath ? (
            <Image
              source={{ uri: getImageUrl(item.posterPath, 'w185') || "" }}
              style={styles.poster}
            />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder, { backgroundColor: colors.elevated }]}>
              <Ionicons name="film-outline" size={24} color={colors.muted} />
            </View>
          )}
          <View style={styles.cardInfo}>
            <View>
              <View style={styles.titleCertificationRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.certification ? (
                  <View style={[styles.certBadgeSmall, { borderColor: colors.border }]}>
                    <Text style={[styles.certBadgeTextSmall, { color: colors.secondary }]}>
                      {item.certification}
                    </Text>
                  </View>
                ) : null}
              </View>
              
              <View style={styles.dateRuntimeRow}>
                <Text style={[styles.cardDate, { color: colors.accent }]}>{releaseDate}</Text>
                {runtimeStr ? (
                  <>
                    <Text style={[styles.cardMetaDot, { color: colors.muted }]}>·</Text>
                    <Text style={[styles.cardDate, { color: colors.secondary }]}>{runtimeStr}</Text>
                  </>
                ) : null}
              </View>

              {genres ? <Text style={[styles.cardGenres, { color: colors.secondary }]}>{genres}</Text> : null}
              
              <View style={styles.cardBadgesRow}>
                <View style={[styles.mediaBadge, { backgroundColor: colors.accentMuted }]}>
                  <Text style={[styles.mediaBadgeText, { color: colors.accent }]}>
                    {item.mediaType === 'tv' ? 'Series' : 'Movie'}
                  </Text>
                </View>

                {item.originalLanguage && (
                  <View style={[styles.mediaBadge, { backgroundColor: colors.border }]}>
                    <Text style={[styles.mediaBadgeText, { color: colors.secondary }]}>
                      {langName}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Watch Platform Row */}
            <View style={styles.watchPlatformSection}>
              {providers.length > 0 ? (
                <View style={styles.watchProvidersRow}>
                  <Text style={[styles.watchLabel, { color: colors.secondary }]}>Watch on:</Text>
                  <View style={styles.watchProvidersList}>
                    {providers.map((p: any) => (
                      <Image
                        key={p.provider_id}
                        source={{ uri: getImageUrl(p.logo_path, 'w92') || "" }}
                        style={styles.providerLogoSmall}
                      />
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.theatreBadge}>
                  <Ionicons name="film-outline" size={13} color={colors.accent} style={{ marginRight: 4 }} />
                  <Text style={[styles.theatreText, { color: colors.accent }]}>Theatres</Text>
                </View>
              )}
            </View>

            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleInterested(item)}
              >
                <Ionicons name="notifications-outline" size={16} color={colors.accent} />
                <Text style={[styles.actionText, { color: colors.accent }]}>Remind</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.calendarBtn}
                onPress={() => handleAddToCalendar(item)}
              >
                <Ionicons name="calendar-outline" size={16} color={colors.secondary} />
                <Text style={[styles.actionText, { color: colors.secondary }]}>Calendar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [handleItemPress, handleAddToCalendar, handleInterested, colors]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: Math.max(16, insets.top) + 12 }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Upcoming</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search upcoming movies..."
          onClear={() => setSearchQuery('')}
        />
      </View>

      {/* Language Filter */}
      <View style={styles.filterSection}>
        <GenreChips
          genres={LANGUAGE_CHIPS.map((l) => ({ id: l.id as any, name: l.name }))}
          selectedIds={selectedLanguages as any[]}
          onToggle={handleLanguageToggle as any}
        />
      </View>

      {/* Time Buckets / Search Mode Indicator */}
      {searchQuery.trim() ? (
        <View style={styles.searchModeIndicator}>
          <Ionicons name="search-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
          <Text style={[styles.searchModeText, { color: colors.secondary }]}>
            Searching all upcoming releases
          </Text>
        </View>
      ) : (
        <View style={styles.bucketRow}>
          {[
            { key: 'thisWeek' as TimeBucket, label: 'This Week' },
            { key: 'thisMonth' as TimeBucket, label: 'This Month' },
            { key: 'later' as TimeBucket, label: 'Coming Soon' },
          ].map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.bucketChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                activeBucket === key && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              onPress={() => setActiveBucket(key)}
            >
              <Text
                style={[
                  styles.bucketText,
                  { color: colors.secondary },
                  activeBucket === key && { color: colors.bg },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Movie List */}
      {loading && page === 1 ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filteredMovies}
          renderItem={renderUpcomingItem}
          keyExtractor={(item) => `upcoming-${item.id}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 16 }} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={48} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No upcoming releases</Text>
              <Text style={[styles.emptySubtitle, { color: colors.secondary }]}>
                Try selecting different languages or time period
              </Text>
            </View>
          }
        />
      )}

      {/* Long Press Quick Actions Bottom Sheet */}
      {longPressItem && (
        <Modal
          visible={!!longPressItem}
          transparent
          animationType="slide"
          onRequestClose={() => setLongPressItem(null)}
        >
          <Pressable style={styles.bottomSheetOverlay} onPress={() => setLongPressItem(null)}>
            <Pressable
              style={[
                styles.bottomSheetContent,
                { backgroundColor: colors.elevated },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <View style={styles.bottomSheetHeader}>
                <View style={[styles.bottomSheetHandle, { backgroundColor: colors.border }]} />
                <Text style={[styles.bottomSheetTitle, { color: colors.text }]} numberOfLines={1}>
                  {longPressItem.title}
                </Text>
                {longPressItem.releaseDate && (
                  <Text style={[styles.bottomSheetSubtitle, { color: colors.secondary }]}>
                    {new Date(longPressItem.releaseDate) > new Date() ? 'Unreleased' : 'Released in ' + longPressItem.releaseDate.substring(0, 4)}
                  </Text>
                )}
              </View>

              {/* Options */}
              <View style={styles.bottomSheetOptions}>
                {/* Option 1: Rate & Log (only if released) */}
                {!(longPressItem.releaseDate && new Date(longPressItem.releaseDate) > new Date()) && (
                  <TouchableOpacity
                    style={[styles.bottomSheetOptionBtn, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}
                    onPress={() => handleLongPressAction('rate')}
                  >
                    <Ionicons name="star" size={20} color={colors.accent} style={{ marginRight: 12 }} />
                    <Text style={[styles.bottomSheetOptionText, { color: colors.text }]}>Rate & Log</Text>
                  </TouchableOpacity>
                )}

                {/* Option 2: Add to Watchlist / Remove from Watchlist */}
                <TouchableOpacity
                  style={[styles.bottomSheetOptionBtn, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}
                  onPress={() => handleLongPressAction('watchlist')}
                >
                  <Ionicons
                    name={
                      longPressStatus === 'watchlist' || longPressStatus === 'interested'
                        ? 'bookmark'
                        : 'bookmark-outline'
                    }
                    size={20}
                    color={colors.accent}
                    style={{ marginRight: 12 }}
                  />
                  <Text style={[styles.bottomSheetOptionText, { color: colors.text }]}>
                    {longPressStatus === 'watchlist' || longPressStatus === 'interested'
                      ? 'Remove from Watchlist'
                      : 'Add to Watchlist'}
                  </Text>
                </TouchableOpacity>

                {/* Option 3: Not Interested */}
                <TouchableOpacity
                  style={styles.bottomSheetOptionBtn}
                  onPress={() => handleLongPressAction('not_interested')}
                >
                  <Ionicons
                    name={longPressStatus === 'not_interested' ? 'eye-off' : 'eye-off-outline'}
                    size={20}
                    color={colors.accent}
                    style={{ marginRight: 12 }}
                  />
                  <Text style={[styles.bottomSheetOptionText, { color: colors.text }]}>
                    {longPressStatus === 'not_interested'
                      ? 'Remove from Not Interested'
                      : 'Not Interested'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Cancel button */}
              <TouchableOpacity
                style={[styles.bottomSheetCancelBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setLongPressItem(null)}
              >
                <Text style={[styles.bottomSheetCancelText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  filterSection: {
    paddingBottom: 8,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  cardBadgesRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    marginTop: 4,
  },
  bucketRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  searchModeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  searchModeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bucketChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  bucketActive: {},
  bucketText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bucketTextActive: {},
  upcomingCard: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 0.5,
  },
  poster: {
    width: 100,
    height: 150,
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardGenres: {
    fontSize: 12,
    marginBottom: 6,
  },
  mediaBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mediaBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  titleCertificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
  },
  certBadgeSmall: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  certBadgeTextSmall: {
    fontSize: 9,
    fontWeight: '800',
  },
  dateRuntimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    marginBottom: 4,
  },
  cardMetaDot: {
    fontSize: 12,
  },
  watchPlatformSection: {
    marginTop: 6,
    marginBottom: 2,
  },
  watchProvidersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  watchLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  watchProvidersList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  providerLogoSmall: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  theatreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 191, 0, 0.1)',
  },
  theatreText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  bottomSheetContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 34,
  },
  bottomSheetHeader: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  bottomSheetSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  bottomSheetOptions: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 16,
  },
  bottomSheetOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  bottomSheetOptionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  bottomSheetCancelBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bottomSheetCancelText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
