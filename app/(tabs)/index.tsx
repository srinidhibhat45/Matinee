import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Dimensions,
  RefreshControl,
  Keyboard,
  ScrollView,
  BackHandler,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { tmdbService, getImageUrl } from '../../services/tmdb';
import { recommendationService } from '../../services/recommendations';
import {
  getRecentItems,
  getAllItems,
  addItem,
  deleteItem,
  getItem,
  getPreference,
} from '../../services/database';
import SearchBar from '../../components/SearchBar';
import GenreChips from '../../components/GenreChips';
import CarouselSection from '../../components/CarouselSection';
import Logo from '../../components/Logo';
import { TMDBMediaItem, RecommendedItem, MediaType } from '../../types';
import { MOVIE_GENRES, TV_GENRES, getGenreName } from '../../constants/genres';
import { useTheme } from '../../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 44) / 3;

type TabType = 'all' | 'movies' | 'series';

export default function DiscoverScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TMDBMediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [discoverResults, setDiscoverResults] = useState<TMDBMediaItem[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search Pagination & Filters
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [isSearchingMore, setIsSearchingMore] = useState(false);
  const [searchSortBy, setSearchSortBy] = useState<'popularity' | 'rating' | 'newest' | 'oldest'>('popularity');
  const [searchMediaType, setSearchMediaType] = useState<'all' | 'movie' | 'tv'>('all');
  const [searchLang, setSearchLang] = useState<string>('all');
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);

  // Recommendations Modal & Languages
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [preferredLanguages, setPreferredLanguages] = useState<string[]>([]);

  const currentGenres = activeTab === 'series'
    ? TV_GENRES
    : activeTab === 'movies'
      ? MOVIE_GENRES
      : { ...MOVIE_GENRES, ...TV_GENRES };
  const genreList = Object.entries(currentGenres).map(([id, name]) => ({
    id: Number(id),
    name,
  }));

  // Clear selected genres on tab switch
  useEffect(() => {
    setSelectedGenres([]);
  }, [activeTab]);

  // Tab retap listener to reset page
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as any, () => {
      if (navigation.isFocused()) {
        setSearchQuery('');
        setSearchResults([]);
        setSelectedGenres([]);
        setIsSearchFocused(false);
        setShowAllRecommendations(false);
      }
    });
    return unsubscribe;
  }, [navigation]);

  // Home page dashboard states
  const [trending, setTrending] = useState<TMDBMediaItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendedItem[]>([]);
  const [recentlyWatched, setRecentlyWatched] = useState<any[]>([]);
  const [popular, setPopular] = useState<TMDBMediaItem[]>([]);
  const [topRated, setTopRated] = useState<TMDBMediaItem[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastFetchedRef = useRef(0);

  const uniqueList = useCallback((list: any[]) => {
    const seen = new Set();
    return list.filter((item) => {
      if (!item) return false;
      const key = `${item.id}-${item.mediaType || 'movie'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  const fetchHomeData = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) {
        setHomeLoading(true);
      }

      // Fetch preferred languages from DB
      const langPref = await getPreference('PREF_LANGUAGES');
      const langs = langPref ? langPref.split(',') : ['en', 'hi', 'kn', 'ta', 'te', 'ko', 'ja'];
      setPreferredLanguages(langs);

      // Fetch DB items to filter out from feeds (watched and not_interested)
      const allDb = await getAllItems();
      const skipIds = new Set(allDb.filter((w: any) => w.status === 'watched' || w.status === 'not_interested').map((w: any) => w.tmdbId));

      let trendingPromise;
      let popularPromise;
      let topRatedPromise;
      let recsPromise;

      if (activeTab === 'all') {
        trendingPromise = Promise.all([
          tmdbService.getTrending('all', 'day', 1),
          tmdbService.getTrending('all', 'day', 2),
          tmdbService.getTrending('all', 'day', 3),
          tmdbService.getTrending('all', 'day', 4),
          tmdbService.getTrending('all', 'day', 5),
        ]).then((pages) => {
          const merged = pages.flatMap((p) => p?.results || []);
          return { results: merged };
        });
        
        popularPromise = Promise.all([
          tmdbService.getPopular('movie'),
          tmdbService.getPopular('tv')
        ]).then(([movies, tv]) => {
          const merged = [...(movies?.results || []), ...(tv?.results || [])];
          merged.sort((a, b) => b.popularity - a.popularity);
          return { results: merged };
        });

        topRatedPromise = Promise.all([
          tmdbService.getTopRated('movie'),
          tmdbService.getTopRated('tv')
        ]).then(([movies, tv]) => {
          const merged = [...(movies?.results || []), ...(tv?.results || [])];
          merged.sort((a, b) => b.voteAverage - a.voteAverage);
          return { results: merged };
        });

        recsPromise = recommendationService.getPersonalizedRecommendations(120, undefined);
      } else {
        const mediaType: MediaType = activeTab === 'series' ? 'tv' : 'movie';
        trendingPromise = Promise.all([
          tmdbService.getTrending(mediaType, 'day', 1),
          tmdbService.getTrending(mediaType, 'day', 2),
          tmdbService.getTrending(mediaType, 'day', 3),
          tmdbService.getTrending(mediaType, 'day', 4),
          tmdbService.getTrending(mediaType, 'day', 5),
        ]).then((pages) => {
          const merged = pages.flatMap((p) => p?.results || []);
          return { results: merged };
        });
        popularPromise = tmdbService.getPopular(mediaType);
        topRatedPromise = tmdbService.getTopRated(mediaType);
        recsPromise = recommendationService.getPersonalizedRecommendations(120, mediaType);
      }

      const [trendingRes, popularRes, topRatedRes, recentRes, recsRes] = await Promise.allSettled([
        trendingPromise,
        popularPromise,
        topRatedPromise,
        getRecentItems(10),
        recsPromise,
      ]);

      if (trendingRes.status === 'fulfilled') {
        const list = trendingRes.value?.results || [];
        setTrending(uniqueList(list.filter((m) => !skipIds.has(m.id) && langs.includes(m.originalLanguage))));
      }
      if (popularRes.status === 'fulfilled') {
        const list = popularRes.value?.results || [];
        setPopular(uniqueList(list.filter((m) => !skipIds.has(m.id) && langs.includes(m.originalLanguage))));
      }
      if (topRatedRes.status === 'fulfilled') {
        const list = topRatedRes.value?.results || [];
        setTopRated(uniqueList(list.filter((m) => !skipIds.has(m.id) && langs.includes(m.originalLanguage))));
      }
      if (recentRes.status === 'fulfilled') {
        const items = recentRes.value || [];
        // Recently logged movies/shows are EXEMPT from preferred language filtering
        setRecentlyWatched(
          uniqueList(
            items
              .filter((i: any) => activeTab === 'all' || i.mediaType === (activeTab === 'series' ? 'tv' : 'movie'))
              .map((i: any) => ({
                id: i.tmdbId,
                title: i.title,
                posterPath: i.posterPath,
                voteAverage: i.voteAverage,
                releaseDate: i.releaseDate,
                mediaType: i.mediaType,
              }))
          )
        );
      }
      if (recsRes.status === 'fulfilled') {
        const recs = recsRes.value || [];
        setRecommendations(
          uniqueList(recs.filter((r: RecommendedItem) => !skipIds.has(r.id)))
        );
      }
      lastFetchedRef.current = Date.now();
    } catch (err) {
      console.error('Home data fetch error:', err);
    } finally {
      setHomeLoading(false);
    }
  }, [activeTab]);

  useFocusEffect(
    useCallback(() => {
      const { dbChangeTimestamp } = require('../../services/database');
      if (dbChangeTimestamp > lastFetchedRef.current) {
        fetchHomeData(true);
      }
    }, [fetchHomeData])
  );

  useEffect(() => {
    fetchHomeData();
  }, [activeTab, fetchHomeData]);

  const [longPressItem, setLongPressItem] = useState<any | null>(null);
  const [longPressStatus, setLongPressStatus] = useState<string | null>(null);

  const handleItemLongPress = useCallback(async (item: any) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const existing = await getItem(item.id);
      setLongPressStatus(existing?.status || null);
      setLongPressItem(item);
    } catch (err) {
      console.error('Long press error:', err);
    }
  }, []);

  const handleLongPressAction = useCallback(async (action: 'rate' | 'watchlist' | 'not_interested') => {
    if (!longPressItem) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const tmdbId = longPressItem.id;
      const mediaType = longPressItem.mediaType || (activeTab === 'series' ? 'tv' : 'movie');

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
        }
      } else if (action === 'not_interested') {
        if (existing) {
          await deleteItem(existing.id);
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
      await fetchHomeData(true);
    } catch (err) {
      console.error('Long press action error:', err);
    }
  }, [longPressItem, activeTab, fetchHomeData, router]);

  // Reactive discovery fetching when activeTab or selectedGenres change
  useEffect(() => {
    if (selectedGenres.length > 0) {
      setDiscoverLoading(true);
      
      const fetches = [];
      if (activeTab === 'all' || activeTab === 'movies') {
        fetches.push(tmdbService.discover('movie', { genres: selectedGenres.join(','), sortBy: 'popularity.desc' }));
      }
      if (activeTab === 'all' || activeTab === 'series') {
        fetches.push(tmdbService.discover('tv', { genres: selectedGenres.join(','), sortBy: 'popularity.desc' }));
      }

      Promise.all([
        Promise.all(fetches),
        getAllItems(),
        getPreference('PREF_LANGUAGES'),
      ])
        .then(([resList, dbItems, langPref]) => {
          const skipIds = new Set(dbItems.filter((w: any) => w.status === 'watched' || w.status === 'not_interested').map((w: any) => w.tmdbId));
          const langs = langPref ? langPref.split(',') : ['en', 'hi', 'kn', 'ta', 'te', 'ko', 'ja'];
          
          let merged: TMDBMediaItem[] = [];
          for (const res of resList) {
            merged.push(...(res?.results || []));
          }

          if (activeTab === 'all') {
            merged.sort((a, b) => b.popularity - a.popularity);
          }

          setDiscoverResults(merged.filter((m) => !skipIds.has(m.id) && langs.includes(m.originalLanguage)));
        })
        .catch(() => setDiscoverResults([]))
        .finally(() => setDiscoverLoading(false));
    } else {
      setDiscoverResults([]);
    }
  }, [activeTab, selectedGenres]);

  // Debounced search with pagination resetting
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchPage(1);
      setSearchTotalPages(1);
      return;
    }

    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        setSearchPage(1);
        const result = await tmdbService.search(query, undefined, 1);
        setSearchResults(uniqueList(result?.results || []));
        setSearchTotalPages(result?.totalPages || 1);
      } catch {
        setSearchResults([]);
        setSearchTotalPages(1);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, []);

  const loadMoreSearchResults = useCallback(async () => {
    if (isSearching || isSearchingMore || searchPage >= searchTotalPages || !searchQuery.trim()) {
      return;
    }

    setIsSearchingMore(true);
    const nextPage = searchPage + 1;
    try {
      const result = await tmdbService.search(searchQuery, undefined, nextPage);
      if (result && result.results) {
        setSearchResults((prev) => {
          const merged = [...prev, ...result.results];
          const seen = new Set<string>();
          return merged.filter((r) => {
            const key = `${r.mediaType}:${r.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
        setSearchPage(nextPage);
      }
    } catch (err) {
      console.warn('[Search] Load more failed:', err);
    } finally {
      setIsSearchingMore(false);
    }
  }, [searchQuery, searchPage, searchTotalPages, isSearching, isSearchingMore]);

  const getProcessedSearchResults = useCallback(() => {
    let list = [...searchResults];

    // 1. Filter by Media Type
    if (searchMediaType !== 'all') {
      list = list.filter((item) => item.mediaType === searchMediaType);
    }

    // 2. Filter by Language
    if (searchLang !== 'all') {
      list = list.filter((item) => item.originalLanguage === searchLang);
    }

    // 3. Sort
    if (searchSortBy === 'popularity') {
      list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } else if (searchSortBy === 'rating') {
      list.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
    } else if (searchSortBy === 'newest') {
      list.sort((a, b) => {
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return b.releaseDate.localeCompare(a.releaseDate);
      });
    } else if (searchSortBy === 'oldest') {
      list.sort((a, b) => {
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return a.releaseDate.localeCompare(b.releaseDate);
      });
    }

    return list;
  }, [searchResults, searchSortBy, searchMediaType, searchLang]);

  const handleGenreToggle = useCallback(
    (genreId: number) => {
      setSelectedGenres((prev) =>
        prev.includes(genreId)
          ? prev.filter((g) => g !== genreId)
          : [...prev, genreId]
      );
    },
    []
  );

  const handleItemPress = useCallback(
    (item: any) => {
      router.push({
        pathname: '/detail/[id]',
        params: { id: item.id, mediaType: item.mediaType || 'movie', reason: item.reason },
      });
    },
    [router]
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchFocused(false);
    setSearchPage(1);
    setSearchTotalPages(1);
    setSearchSortBy('popularity');
    setSearchMediaType('all');
    setSearchLang('all');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (searchQuery.trim() || isSearchFocused) {
          handleClearSearch();
          Keyboard.dismiss();
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => {
        subscription.remove();
      };
    }, [searchQuery, isSearchFocused, handleClearSearch])
  );

  const renderSearchResult = useCallback(
    ({ item }: { item: TMDBMediaItem }) => (
      <TouchableOpacity
        style={[styles.searchResultCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
        activeOpacity={0.7}
      >
        {item.posterPath ? (
          <Image
            source={{ uri: getImageUrl(item.posterPath, 'w185') || "" }}
            style={styles.searchPoster}
          />
        ) : (
          <View style={[styles.searchPoster, styles.posterPlaceholder, { backgroundColor: colors.bg }]}>
            <Ionicons name="film-outline" size={24} color={colors.muted} />
          </View>
        )}
        <View style={styles.searchInfo}>
          <View style={styles.searchHeaderRow}>
            <Text style={[styles.searchTitle, { color: colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.certification ? (
              <View style={[styles.certBadgeSmall, { borderColor: colors.border, marginRight: 6 }]}>
                <Text style={[styles.certBadgeTextSmall, { color: colors.secondary }]}>
                  {item.certification}
                </Text>
              </View>
            ) : null}
            <View style={[styles.mediaBadge, { backgroundColor: colors.border }]}>
              <Text style={[styles.mediaBadgeText, { color: colors.secondary }]}>
                {item.mediaType === 'tv' ? 'Series' : 'Movie'}
              </Text>
            </View>
          </View>

          <Text style={[styles.searchGenres, { color: colors.secondary }]} numberOfLines={1}>
            {item.genreIds
              ?.slice(0, 3)
              .map((id) => getGenreName(id, item.mediaType || 'movie'))
              .filter(Boolean)
              .join(' · ') || '—'}
          </Text>

          <View style={styles.searchMeta}>
            <Text style={[styles.searchYear, { color: colors.muted }]}>
              {(() => {
                if (!item.releaseDate) return '—';
                const isFuture = new Date(item.releaseDate) > new Date();
                if (isFuture) {
                  try {
                    const dateObj = new Date(item.releaseDate);
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    return `Releases: ${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
                  } catch {
                    return item.releaseDate;
                  }
                }
                return item.releaseDate.split('-')[0];
              })()}
            </Text>
            {item.voteAverage > 0 && (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color={colors.accent} />
                <Text style={[styles.ratingText, { color: colors.accent }]}>
                  {item.voteAverage.toFixed(1)} ({item.voteCount || 0})
                </Text>
              </View>
            )}

            {!!item.originalLanguage && (
              <View style={[styles.mediaBadge, { backgroundColor: colors.border, paddingVertical: 1, paddingHorizontal: 6 }]}>
                <Text style={[styles.mediaBadgeText, { color: colors.secondary }]}>
                  {item.originalLanguage.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {item.overview ? (
            <Text style={[styles.searchOverview, { color: colors.muted }]} numberOfLines={2}>
              {item.overview}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    ),
    [handleItemPress, colors]
  );


  const renderGridItem = useCallback(
    ({ item }: { item: any }) => (
      <TouchableOpacity
        style={styles.gridCard}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
        activeOpacity={0.8}
      >
        <View>
          {item.posterPath ? (
            <Image
              source={{ uri: getImageUrl(item.posterPath, 'w185') || "" }}
              style={styles.gridPoster}
            />
          ) : (
            <View style={[styles.gridPoster, styles.posterPlaceholder, { backgroundColor: colors.card }]}>
              <Ionicons name="film-outline" size={24} color={colors.muted} />
            </View>
          )}
          {item.certification ? (
            <View style={[styles.certBadgeGrid, { backgroundColor: 'rgba(10, 10, 15, 0.85)', borderColor: colors.border }]}>
              <Text style={[styles.certBadgeTextGrid, { color: '#FFFFFF' }]}>{item.certification}</Text>
            </View>
          ) : null}
          {item.voteAverage > 0 && (
            <View style={styles.gridRating}>
              <Text style={[styles.gridRatingText, { color: colors.accent }]}>
                ★ {item.voteAverage.toFixed(1)}
              </Text>
            </View>
          )}
          {(() => {
            const type = item.mediaType || (item.releaseDate ? 'movie' : 'tv');
            return (
              <View style={[styles.gridMediaBadge, { backgroundColor: 'rgba(10, 10, 15, 0.85)', borderColor: colors.border }]}>
                <Text style={[styles.gridMediaText, { color: type === 'tv' ? '#EC407A' : '#FFFFFF' }]}>
                  {type === 'tv' ? 'Series' : 'Movie'}
                </Text>
              </View>
            );
          })()}
        </View>
        <Text style={[styles.gridTitle, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.gridYear, { color: colors.secondary }]}>
          {item.releaseDate ? item.releaseDate.split('-')[0] : '—'}
        </Text>
        {item.reason ? (
          <Text style={[styles.gridReason, { color: colors.accent }]} numberOfLines={1}>
            ✨ {item.reason}
          </Text>
        ) : null}
      </TouchableOpacity>
    ),
    [handleItemPress, colors]
  );
 
  if (showAllRecommendations) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: Math.max(16, insets.top) + 12 }]}>
        {/* Header */}
        <View style={[styles.header, { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 16 }]}>
          <TouchableOpacity onPress={() => setShowAllRecommendations(false)} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text, fontSize: 22 }]}>All Recommendations</Text>
        </View>

        {/* Grid List */}
        <FlatList
          key="recs-grid"
          data={recommendations}
          renderItem={renderGridItem}
          keyExtractor={(item) => `rec-grid-${item.id}`}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.emptySearch}>
              <Text style={[styles.emptyText, { color: colors.muted }]}>No recommendations available</Text>
            </View>
          }
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(16, insets.top) + 12 }]}>
        <View style={styles.logoRow}>
          <Logo size={28} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Matinee</Text>
        </View>
      </View>

      {/* Search Bar & Optional Back Button */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBarRow}>
          {searchQuery.trim() ? (
            <TouchableOpacity onPress={handleClearSearch} hitSlop={12} style={styles.searchBackBtn}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }}>
            <SearchBar
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search movies, series, people..."
              onFocus={() => setIsSearchFocused(true)}
              onClear={handleClearSearch}
            />
          </View>
          {/* Filter Button */}
          {searchQuery.trim() ? (
            <TouchableOpacity
              style={[
                styles.filterBtn,
                {
                  backgroundColor: (searchMediaType !== 'all' || searchSortBy !== 'popularity' || searchLang !== 'all')
                    ? colors.accent
                    : colors.card,
                  borderColor: colors.border
                }
              ]}
              onPress={() => setIsFilterSheetVisible(true)}
            >
              <Ionicons
                name="filter"
                size={20}
                color={(searchMediaType !== 'all' || searchSortBy !== 'popularity' || searchLang !== 'all') ? colors.bg : colors.text}
              />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Active Filter Chips */}
        {!!searchQuery.trim() && (
          <View style={styles.filterChipsRow}>
            {searchSortBy !== 'popularity' && (
              <TouchableOpacity
                style={[styles.filterChipActive, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setSearchSortBy('popularity')}
              >
                <Text style={[styles.filterChipText, { color: colors.text }]}>
                  Sort: {searchSortBy === 'rating' ? 'Rating' : searchSortBy === 'newest' ? 'Newest' : 'Oldest'}
                </Text>
                <Ionicons name="close-circle" size={14} color={colors.secondary} />
              </TouchableOpacity>
            )}
            {searchMediaType !== 'all' && (
              <TouchableOpacity
                style={[styles.filterChipActive, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setSearchMediaType('all')}
              >
                <Text style={[styles.filterChipText, { color: colors.text }]}>
                  Type: {searchMediaType === 'movie' ? 'Movies' : 'Series'}
                </Text>
                <Ionicons name="close-circle" size={14} color={colors.secondary} />
              </TouchableOpacity>
            )}
            {searchLang !== 'all' && (
              <TouchableOpacity
                style={[styles.filterChipActive, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setSearchLang('all')}
              >
                <Text style={[styles.filterChipText, { color: colors.text }]}>
                  Lang: {searchLang.toUpperCase()}
                </Text>
                <Ionicons name="close-circle" size={14} color={colors.secondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Main Content Area */}
      {searchQuery.trim() ? (
        <View style={styles.searchResultsContainer}>
          {isSearching ? (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={{ marginTop: 40 }}
            />
          ) : getProcessedSearchResults().length > 0 ? (
            <FlatList
              data={getProcessedSearchResults()}
              renderItem={renderSearchResult}
              keyExtractor={(item) => `${item.mediaType || 'movie'}-${item.id}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 100 }}
              onEndReached={loadMoreSearchResults}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isSearchingMore ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.accent}
                    style={{ paddingVertical: 20 }}
                  />
                ) : null
              }
            />
          ) : (
            <View style={styles.emptySearch}>
              <Ionicons name="search-outline" size={48} color={colors.muted} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {searchResults.length > 0 ? 'No results match filters' : 'No results found'}
              </Text>
            </View>
          )}
        </View>
      ) : selectedGenres.length > 0 ? (
        /* Genre Discover Grid Mode */
        <FlatList
          key="discover-grid"
          ListHeaderComponent={
            <>
              {/* Tab Switcher */}
              <View style={styles.tabSwitcher}>
                {/* All Tab */}
                <TouchableOpacity
                  style={[
                    styles.tab,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    activeTab === 'all' && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                  onPress={() => setActiveTab('all')}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: colors.secondary },
                      activeTab === 'all' && { color: colors.bg },
                    ]}
                  >
                    All
                  </Text>
                </TouchableOpacity>
                {/* Movies Tab */}
                <TouchableOpacity
                  style={[
                    styles.tab,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    activeTab === 'movies' && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                  onPress={() => setActiveTab('movies')}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: colors.secondary },
                      activeTab === 'movies' && { color: colors.bg },
                    ]}
                  >
                    Movies
                  </Text>
                </TouchableOpacity>
                {/* Series Tab */}
                <TouchableOpacity
                  style={[
                    styles.tab,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    activeTab === 'series' && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                  onPress={() => setActiveTab('series')}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: colors.secondary },
                      activeTab === 'series' && { color: colors.bg },
                    ]}
                  >
                    Series
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Genre Chips */}
              <View style={styles.genreSection}>
                <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Browse by Genre</Text>
                <GenreChips
                  genres={genreList}
                  selectedIds={selectedGenres}
                  onToggle={handleGenreToggle}
                />
              </View>

              {discoverLoading && (
                <ActivityIndicator
                  size="small"
                  color={colors.accent}
                  style={{ marginTop: 20 }}
                />
              )}
            </>
          }
          data={discoverResults}
          renderItem={renderGridItem}
          keyExtractor={(item) => `grid-${item.id}`}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            !discoverLoading ? (
              <View style={styles.emptySearch}>
                <Text style={[styles.emptyText, { color: colors.muted }]}>No results for selected genres</Text>
              </View>
            ) : null
          }
        />
      ) : (
        /* Home Feed Mode (selectedGenres.length === 0) */
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await fetchHomeData();
                setRefreshing(false);
              }}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          {/* Tab Switcher */}
          <View style={styles.tabSwitcher}>
            {/* All Tab */}
            <TouchableOpacity
              style={[
                styles.tab,
                { backgroundColor: colors.card, borderColor: colors.border },
                activeTab === 'all' && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              onPress={() => setActiveTab('all')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: colors.secondary },
                  activeTab === 'all' && { color: colors.bg },
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {/* Movies Tab */}
            <TouchableOpacity
              style={[
                styles.tab,
                { backgroundColor: colors.card, borderColor: colors.border },
                activeTab === 'movies' && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              onPress={() => setActiveTab('movies')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: colors.secondary },
                  activeTab === 'movies' && { color: colors.bg },
                ]}
              >
                Movies
              </Text>
            </TouchableOpacity>
            {/* Series Tab */}
            <TouchableOpacity
              style={[
                styles.tab,
                { backgroundColor: colors.card, borderColor: colors.border },
                activeTab === 'series' && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              onPress={() => setActiveTab('series')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: colors.secondary },
                  activeTab === 'series' && { color: colors.bg },
                ]}
              >
                Series
              </Text>
            </TouchableOpacity>
          </View>

          {/* Genre Chips */}
          <View style={styles.genreSection}>
            <Text style={[styles.sectionLabel, { color: colors.secondary }]}>Browse by Genre</Text>
            <GenreChips
              genres={genreList}
              selectedIds={selectedGenres}
              onToggle={handleGenreToggle}
            />
          </View>

          {homeLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={{ marginTop: 40 }}
            />
          ) : (
            <View style={{ marginTop: 12 }}>
              {recommendations.length > 0 && (
                <CarouselSection
                  title="Recommended for You"
                  items={recommendations.slice(0, 15)}
                  onItemPress={handleItemPress}
                  onItemLongPress={handleItemLongPress}
                  onSeeAll={() => setShowAllRecommendations(true)}
                  cardSize="medium"
                  showMediaTypeBadge={activeTab === 'all'}
                />
              )}
              {trending.length > 0 && (
                <CarouselSection
                  title="Trending This Week"
                  items={trending}
                  onItemPress={handleItemPress}
                  onItemLongPress={handleItemLongPress}
                  cardSize="large"
                  showMediaTypeBadge={activeTab === 'all'}
                />
              )}
              {recentlyWatched.length > 0 && (
                <CarouselSection
                  title="Recently Watched"
                  items={recentlyWatched}
                  onItemPress={handleItemPress}
                  onItemLongPress={handleItemLongPress}
                  cardSize="small"
                  showMediaTypeBadge={activeTab === 'all'}
                />
              )}
              {popular.length > 0 && (
                <CarouselSection
                  title={`Popular ${activeTab === 'all' ? 'Titles' : activeTab === 'movies' ? 'Movies' : 'Series'}`}
                  items={popular}
                  onItemPress={handleItemPress}
                  onItemLongPress={handleItemLongPress}
                  cardSize="medium"
                  showMediaTypeBadge={activeTab === 'all'}
                />
              )}
              {topRated.length > 0 && (
                <CarouselSection
                  title={`Top Rated ${activeTab === 'all' ? 'Titles' : activeTab === 'movies' ? 'Movies' : 'Series'}`}
                  items={topRated}
                  onItemPress={handleItemPress}
                  onItemLongPress={handleItemLongPress}
                  cardSize="medium"
                  showMediaTypeBadge={activeTab === 'all'}
                />
              )}
            </View>
          )}
        </ScrollView>
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
                {!!longPressItem.releaseDate && (
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

      {/* Search Filters Bottom Sheet */}
      <Modal
        visible={isFilterSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFilterSheetVisible(false)}
      >
        <Pressable style={styles.bottomSheetOverlay} onPress={() => setIsFilterSheetVisible(false)}>
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
              <Text style={[styles.bottomSheetTitle, { color: colors.text }]}>
                Search Filters
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              {/* Section 1: Sort By */}
              <Text style={[styles.filterSectionTitle, { color: colors.secondary }]}>Sort By</Text>
              <View style={styles.filterBtnGroup}>
                {[
                  { label: 'Popularity', value: 'popularity' },
                  { label: 'Rating', value: 'rating' },
                  { label: 'Newest Release', value: 'newest' },
                  { label: 'Oldest Release', value: 'oldest' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.filterSelectBtn,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      searchSortBy === opt.value && { backgroundColor: colors.accent, borderColor: colors.accent },
                    ]}
                    onPress={() => setSearchSortBy(opt.value as any)}
                  >
                    <Text
                      style={[
                        styles.filterSelectBtnText,
                        { color: colors.text },
                        searchSortBy === opt.value && { color: colors.bg, fontWeight: '700' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Section 2: Media Type */}
              <Text style={[styles.filterSectionTitle, { color: colors.secondary }]}>Media Type</Text>
              <View style={styles.filterBtnGroup}>
                {[
                  { label: 'All', value: 'all' },
                  { label: 'Movies', value: 'movie' },
                  { label: 'Series', value: 'tv' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.filterSelectBtn,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      searchMediaType === opt.value && { backgroundColor: colors.accent, borderColor: colors.accent },
                    ]}
                    onPress={() => setSearchMediaType(opt.value as any)}
                  >
                    <Text
                      style={[
                        styles.filterSelectBtnText,
                        { color: colors.text },
                        searchMediaType === opt.value && { color: colors.bg, fontWeight: '700' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Section 3: Original Language */}
              <Text style={[styles.filterSectionTitle, { color: colors.secondary }]}>Language</Text>
              <View style={styles.filterBtnGroup}>
                <TouchableOpacity
                  style={[
                    styles.filterSelectBtn,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    searchLang === 'all' && { backgroundColor: colors.accent, borderColor: colors.accent },
                  ]}
                  onPress={() => setSearchLang('all')}
                >
                  <Text
                    style={[
                      styles.filterSelectBtnText,
                      { color: colors.text },
                      searchLang === 'all' && { color: colors.bg, fontWeight: '700' },
                    ]}
                  >
                    All Languages
                  </Text>
                </TouchableOpacity>
                {preferredLanguages.map((langCode) => (
                  <TouchableOpacity
                    key={langCode}
                    style={[
                      styles.filterSelectBtn,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      searchLang === langCode && { backgroundColor: colors.accent, borderColor: colors.accent },
                    ]}
                    onPress={() => setSearchLang(langCode)}
                  >
                    <Text
                      style={[
                        styles.filterSelectBtnText,
                        { color: colors.text },
                        searchLang === langCode && { color: colors.bg, fontWeight: '700' },
                      ]}
                    >
                      {langCode.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Apply & Reset buttons */}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity
                style={[
                  styles.bottomSheetCancelBtn,
                  { flex: 1, backgroundColor: colors.card, borderColor: colors.border },
                ]}
                onPress={() => {
                  setSearchSortBy('popularity');
                  setSearchMediaType('all');
                  setSearchLang('all');
                  setIsFilterSheetVisible(false);
                }}
              >
                <Text style={[styles.bottomSheetCancelText, { color: colors.text }]}>Reset All</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bottomSheetCancelBtn,
                  { flex: 1, backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                onPress={() => setIsFilterSheetVisible(false)}
              >
                <Text style={[styles.bottomSheetCancelText, { color: colors.bg }]}>Apply</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>



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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tabSwitcher: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
    marginTop: 12,
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  tabActive: {},
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {},
  genreSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  gridRow: {
    paddingHorizontal: 16,
    gap: 6,
  },
  gridCard: {
    width: CARD_WIDTH,
    marginBottom: 16,
  },
  gridPoster: {
    width: '100%',
    height: CARD_WIDTH * 1.5,
    borderRadius: 10,
  },
  gridRating: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  gridRatingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  gridTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  gridYear: {
    fontSize: 11,
    marginTop: 2,
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchResultsContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBackBtn: {
    padding: 4,
  },
  searchResultCard: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 14,
  },
  searchPoster: {
    width: 80,
    height: 120,
    borderRadius: 10,
  },
  searchInfo: {
    flex: 1,
    justifyContent: 'space-between',
  },
  searchHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  searchTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  mediaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
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
  certBadgeGrid: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 4,
    borderWidth: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  certBadgeTextGrid: {
    fontSize: 8,
    fontWeight: '800',
  },
  gridMediaBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    borderRadius: 4,
    borderWidth: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridMediaText: {
    fontSize: 8,
    fontWeight: '800',
  },
  mediaBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  searchGenres: {
    fontSize: 12,
    marginTop: 4,
  },
  searchMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  searchYear: {
    fontSize: 12,
    fontWeight: '500',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchOverview: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
  emptySearch: {
    alignItems: 'center',
    marginTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
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
  filterBtn: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  filterChipActive: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filterSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  filterBtnGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterSelectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  filterSelectBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  gridReason: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 2,
  },
});
