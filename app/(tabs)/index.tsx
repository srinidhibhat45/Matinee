import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Image,
  RefreshControl,
  Keyboard,
  ScrollView,
  BackHandler,
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
import GenreChips from '../../components/GenreChips';
import CarouselSection from '../../components/CarouselSection';
import EmptyState from '../../components/EmptyState';
import Logo from '../../components/Logo';
import { TMDBMediaItem, RecommendedItem, MediaType } from '../../types';
import {
  MOVIE_GENRES,
  TV_GENRES,
  getGenreName,
  mapGenreIdsForMediaType,
} from '../../constants/genres';
import { DEFAULT_LANGUAGES } from '../../constants/languages';
import { useTheme } from '../../context/ThemeContext';
import { useResponsive, gridItemWidth } from '../../hooks/useResponsive';
import { shape, spacing, withAlpha } from '../../constants/m3';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  IconButton,
  ListItem,
  Loading,
  SearchField,
  SegmentedButtons,
  Text,
  Badge,
  NAVIGATION_BAR_HEIGHT,
} from '../../components/m3';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inAppNotificationService } from '../../services/inAppNotifications';
import { notificationService } from '../../services/notifications';
import NotificationPanel from '../../components/NotificationPanel';

/** Fallback when the user has never opened language preferences. */
const DEFAULT_FEED_LANGUAGES = DEFAULT_LANGUAGES;

/** Gap between poster tiles in the discover / recommendations grids. */
const GRID_GAP = spacing.md;

type TabType = 'all' | 'movies' | 'series';

const MEDIA_TABS: { value: TabType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movies', label: 'Movies' },
  { value: 'series', label: 'Series' },
];

export default function DiscoverScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, gutter, posterColumns, isCompact } = useResponsive();

  // Poster tiles are sized from the live window width so the grid reflows on
  // rotation, on foldables, and in a resized browser window.
  const gridCardWidth = useMemo(
    () => gridItemWidth(width, posterColumns, gutter, GRID_GAP),
    [width, posterColumns, gutter]
  );
  const gridPosterHeight = Math.round(gridCardWidth * 1.5);

  /** Keeps content clear of the navigation bar and the floating FAB. */
  const listBottomPadding =
    (isCompact ? NAVIGATION_BAR_HEIGHT + insets.bottom : insets.bottom) + 88;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TMDBMediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [discoverResults, setDiscoverResults] = useState<TMDBMediaItem[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverLoadingMore, setDiscoverLoadingMore] = useState(false);
  const [discoverPage, setDiscoverPage] = useState(1);
  const [discoverTotalPages, setDiscoverTotalPages] = useState(1);
  const discoverRequestId = useRef(0);
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
  const [notificationPanelVisible, setNotificationPanelVisible] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

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

  const fetchHomeData = useCallback(async (isSilent = false, forceRefresh = false) => {
    try {
      if (!isSilent) {
        setHomeLoading(true);
      }

      // Fetch preferred languages from DB
      const langPref = await getPreference('PREF_LANGUAGES');
      const langs = langPref ? langPref.split(',') : DEFAULT_FEED_LANGUAGES;
      setPreferredLanguages(langs);

      // Fetch DB items to filter out from feeds (watched and not_interested).
      // Keyed by media type — a watched movie must not hide the series that
      // happens to share its TMDB id.
      const allDb = await getAllItems();
      const skipKeys = new Set(
        allDb
          .filter((w: any) => w.status === 'watched' || w.status === 'not_interested')
          .map((w: any) => `${w.mediaType}-${w.tmdbId}`)
      );

      /**
       * Preferred languages come first, but a rail is never left empty just
       * because a narrow language selection filtered everything out — the rest
       * is appended as a tail so the section still has something to show.
       */
      const MIN_RAIL_ITEMS = 8;
      const prepareRail = (list: TMDBMediaItem[]) => {
        const visible = list.filter((m) => !skipKeys.has(`${m.mediaType || 'movie'}-${m.id}`));
        const preferred = visible.filter((m) => langs.includes(m.originalLanguage));
        if (preferred.length >= MIN_RAIL_ITEMS) return uniqueList(preferred);

        const rest = visible.filter((m) => !langs.includes(m.originalLanguage));
        return uniqueList([...preferred, ...rest]);
      };

      let trendingPromise;
      let popularPromise;
      let topRatedPromise;
      let recsPromise;

      if (activeTab === 'all') {
        trendingPromise = Promise.all([
          tmdbService.getTrending('all', 'day', 1, forceRefresh),
          tmdbService.getTrending('all', 'day', 2, forceRefresh),
          tmdbService.getTrending('all', 'day', 3, forceRefresh),
          tmdbService.getTrending('all', 'day', 4, forceRefresh),
          tmdbService.getTrending('all', 'day', 5, forceRefresh),
        ]).then((pages) => {
          const merged = pages.flatMap((p) => p?.results || []);
          return { results: merged };
        });

        popularPromise = Promise.all([
          tmdbService.getPopular('movie', 1, forceRefresh),
          tmdbService.getPopular('tv', 1, forceRefresh)
        ]).then(([movies, tv]) => {
          const merged = [...(movies?.results || []), ...(tv?.results || [])];
          merged.sort((a, b) => b.popularity - a.popularity);
          return { results: merged };
        });

        topRatedPromise = Promise.all([
          tmdbService.getTopRated('movie', 1, forceRefresh),
          tmdbService.getTopRated('tv', 1, forceRefresh)
        ]).then(([movies, tv]) => {
          const merged = [...(movies?.results || []), ...(tv?.results || [])];
          merged.sort((a, b) => b.voteAverage - a.voteAverage);
          return { results: merged };
        });

        recsPromise = recommendationService.getPersonalizedRecommendations(120, undefined);
      } else {
        const mediaType: MediaType = activeTab === 'series' ? 'tv' : 'movie';
        trendingPromise = Promise.all([
          tmdbService.getTrending(mediaType, 'day', 1, forceRefresh),
          tmdbService.getTrending(mediaType, 'day', 2, forceRefresh),
          tmdbService.getTrending(mediaType, 'day', 3, forceRefresh),
          tmdbService.getTrending(mediaType, 'day', 4, forceRefresh),
          tmdbService.getTrending(mediaType, 'day', 5, forceRefresh),
        ]).then((pages) => {
          const merged = pages.flatMap((p) => p?.results || []);
          return { results: merged };
        });
        popularPromise = tmdbService.getPopular(mediaType, 1, forceRefresh);
        topRatedPromise = tmdbService.getTopRated(mediaType, 1, forceRefresh);
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
        setTrending(prepareRail(trendingRes.value?.results || []));
      }
      if (popularRes.status === 'fulfilled') {
        setPopular(prepareRail(popularRes.value?.results || []));
      }
      if (topRatedRes.status === 'fulfilled') {
        setTopRated(prepareRail(topRatedRes.value?.results || []));
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
          uniqueList(
            recs.filter(
              (r: RecommendedItem) => !skipKeys.has(`${r.mediaType || 'movie'}-${r.id}`)
            )
          )
        );
      }
      lastFetchedRef.current = Date.now();
    } catch (err) {
      console.error('Home data fetch error:', err);
    } finally {
      setHomeLoading(false);
    }
  }, [activeTab]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const count = await inAppNotificationService.getUnreadCount();
      setUnreadCount(count);
    } catch (err) {
      console.warn('Error fetching unread count:', err);
    }
  }, []);

  const triggerNotificationSync = useCallback(async () => {
    try {
      await fetchUnreadCount();
      await inAppNotificationService.generateNotifications();
      await fetchUnreadCount();
    } catch (err) {
      console.warn('Error syncing notifications:', err);
    }
  }, [fetchUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      fetchUnreadCount();
      const { dbChangeTimestamp } = require('../../services/database');
      if (dbChangeTimestamp > lastFetchedRef.current) {
        fetchHomeData(true);
      }
    }, [fetchHomeData, fetchUnreadCount])
  );

  useEffect(() => {
    fetchHomeData();
    triggerNotificationSync();
  }, [activeTab, fetchHomeData, triggerNotificationSync]);

  const [longPressItem, setLongPressItem] = useState<any | null>(null);
  const [longPressStatus, setLongPressStatus] = useState<string | null>(null);

  const handleItemLongPress = useCallback(async (item: any) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const existing = await getItem(item.id, item.mediaType || 'movie');
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

      const existing = await getItem(tmdbId, mediaType);

      if (action === 'watchlist') {
        if (existing?.status === 'watchlist') {
          await deleteItem(existing.id);
          await notificationService.cancelReminder(tmdbId, mediaType);
        } else {
          const status = 'watchlist';
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

          // Match the detail and upcoming screens: watchlisting an unreleased
          // title also schedules its release reminders.
          if (longPressItem.releaseDate && new Date(longPressItem.releaseDate) > new Date()) {
            await notificationService.scheduleReleaseReminder(
              longPressItem.title,
              longPressItem.releaseDate,
              tmdbId,
              mediaType,
              longPressItem.posterPath
            );
          }
        }
      } else if (action === 'not_interested') {
        if (existing) {
          await deleteItem(existing.id);
          await notificationService.cancelReminder(tmdbId, mediaType);
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

  /**
   * Fetch one page of genre-filtered discover results.
   *
   * Selected genre IDs are translated per media type: the chip list mixes
   * movie and TV genres, and TMDB rejects cross-namespace IDs, so sending the
   * raw selection to /discover/tv used to return nothing at all.
   */
  const fetchDiscoverPage = useCallback(
    async (pageToLoad: number, replace: boolean) => {
      if (selectedGenres.length === 0) return;

      if (replace) setDiscoverLoading(true);
      else setDiscoverLoadingMore(true);

      const requestId = ++discoverRequestId.current;

      try {
        const fetches: Promise<any>[] = [];

        if (activeTab === 'all' || activeTab === 'movies') {
          const movieGenres = mapGenreIdsForMediaType(selectedGenres, 'movie');
          if (movieGenres.length > 0) {
            fetches.push(
              tmdbService.discover(
                'movie',
                { genres: movieGenres.join(','), sortBy: 'popularity.desc' },
                pageToLoad
              )
            );
          }
        }
        if (activeTab === 'all' || activeTab === 'series') {
          const tvGenres = mapGenreIdsForMediaType(selectedGenres, 'tv');
          if (tvGenres.length > 0) {
            fetches.push(
              tmdbService.discover(
                'tv',
                { genres: tvGenres.join(','), sortBy: 'popularity.desc' },
                pageToLoad
              )
            );
          }
        }

        const [resList, dbItems, langPref] = await Promise.all([
          Promise.all(fetches),
          getAllItems(),
          getPreference('PREF_LANGUAGES'),
        ]);

        if (requestId !== discoverRequestId.current) return;

        const skipKeys = new Set(
          dbItems
            .filter((w: any) => w.status === 'watched' || w.status === 'not_interested')
            .map((w: any) => `${w.mediaType}-${w.tmdbId}`)
        );
        const langs = langPref ? langPref.split(',') : DEFAULT_FEED_LANGUAGES;

        let merged: TMDBMediaItem[] = [];
        let maxPages = 1;
        for (const res of resList) {
          merged.push(...(res?.results || []));
          maxPages = Math.max(maxPages, res?.totalPages || 1);
        }

        if (activeTab === 'all') {
          merged.sort((a, b) => b.popularity - a.popularity);
        }

        const filtered = merged.filter(
          (m) =>
            !skipKeys.has(`${m.mediaType || 'movie'}-${m.id}`) &&
            langs.includes(m.originalLanguage)
        );

        setDiscoverTotalPages(maxPages);
        setDiscoverPage(pageToLoad);
        setDiscoverResults((prev) =>
          uniqueList(replace ? filtered : [...prev, ...filtered])
        );
      } catch {
        if (requestId === discoverRequestId.current && replace) {
          setDiscoverResults([]);
        }
      } finally {
        if (requestId === discoverRequestId.current) {
          setDiscoverLoading(false);
          setDiscoverLoadingMore(false);
        }
      }
    },
    [activeTab, selectedGenres, uniqueList]
  );

  // Reactive discovery fetching when activeTab or selectedGenres change
  useEffect(() => {
    if (selectedGenres.length === 0) {
      discoverRequestId.current++;
      setDiscoverResults([]);
      setDiscoverPage(1);
      setDiscoverTotalPages(1);
      return;
    }
    fetchDiscoverPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedGenres]);

  const loadMoreDiscover = useCallback(() => {
    if (discoverLoading || discoverLoadingMore) return;
    if (discoverPage >= discoverTotalPages) return;
    fetchDiscoverPage(discoverPage + 1, false);
  }, [discoverLoading, discoverLoadingMore, discoverPage, discoverTotalPages, fetchDiscoverPage]);

  // Monotonically increasing id for search requests. Only the newest request
  // is allowed to write results, so a slow response for "bat" can no longer
  // land after — and overwrite — a fast response for "batman".
  const searchRequestId = useRef(0);

  const runSearch = useCallback(
    async (query: string, mediaTypeFilter: 'all' | 'movie' | 'tv') => {
      const requestId = ++searchRequestId.current;
      setIsSearching(true);
      try {
        const result = await tmdbService.search(
          query,
          mediaTypeFilter === 'all' ? undefined : mediaTypeFilter,
          1
        );
        if (requestId !== searchRequestId.current) return;

        setSearchResults(uniqueList(result?.results || []));
        setSearchPage(1);
        setSearchTotalPages(result?.totalPages || 1);
      } catch {
        if (requestId !== searchRequestId.current) return;
        setSearchResults([]);
        setSearchPage(1);
        setSearchTotalPages(1);
      } finally {
        if (requestId === searchRequestId.current) setIsSearching(false);
      }
    },
    [uniqueList]
  );

  // Debounced search with pagination resetting
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimer.current) clearTimeout(searchTimer.current);

      if (!query.trim()) {
        // Invalidate any in-flight request so it can't repopulate a cleared box.
        searchRequestId.current++;
        setSearchResults([]);
        setIsSearching(false);
        setSearchPage(1);
        setSearchTotalPages(1);
        return;
      }

      setIsSearching(true);
      searchTimer.current = setTimeout(() => {
        runSearch(query, searchMediaType);
      }, 400);
    },
    [runSearch, searchMediaType]
  );

  // Media type is a server-side filter, so changing it must re-query rather
  // than just hide rows from the page already loaded.
  useEffect(() => {
    if (!searchQuery.trim()) return;
    runSearch(searchQuery, searchMediaType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMediaType]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const loadMoreSearchResults = useCallback(async () => {
    if (isSearching || isSearchingMore || searchPage >= searchTotalPages || !searchQuery.trim()) {
      return;
    }

    const requestId = searchRequestId.current;
    setIsSearchingMore(true);
    const nextPage = searchPage + 1;
    try {
      const result = await tmdbService.search(
        searchQuery,
        searchMediaType === 'all' ? undefined : searchMediaType,
        nextPage
      );
      // Drop the page if the query changed while it was in flight.
      if (requestId !== searchRequestId.current) return;

      if (result?.results) {
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
  }, [searchQuery, searchPage, searchTotalPages, isSearching, isSearchingMore, searchMediaType]);

  const processedSearchResults = useMemo(() => {
    let list = [...searchResults];

    // Media type is applied server-side, but results merged from the person
    // and genre expansions can still carry the other type — filter defensively.
    if (searchMediaType !== 'all') {
      list = list.filter((item) => item.mediaType === searchMediaType);
    }

    if (searchLang !== 'all') {
      list = list.filter((item) => item.originalLanguage === searchLang);
    }

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

  // The language filter runs client-side over whatever has been paged in, so a
  // narrow language can empty the visible list while more pages remain. Keep
  // pulling pages so the filter doesn't look broken.
  useEffect(() => {
    if (searchLang === 'all') return;
    if (!searchQuery.trim()) return;
    if (processedSearchResults.length >= 10) return;
    if (isSearching || isSearchingMore) return;
    if (searchPage >= searchTotalPages) return;
    if (searchPage >= 5) return; // bound the auto-paging

    loadMoreSearchResults();
  }, [
    searchLang,
    searchQuery,
    processedSearchResults.length,
    isSearching,
    isSearchingMore,
    searchPage,
    searchTotalPages,
    loadMoreSearchResults,
  ]);

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
    // Invalidate in-flight requests so a late response can't repopulate the
    // list after the user has cleared the box.
    searchRequestId.current++;
    if (searchTimer.current) clearTimeout(searchTimer.current);

    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
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

  const formatReleaseLabel = useCallback((releaseDate?: string) => {
    if (!releaseDate) return '—';
    const date = new Date(releaseDate);
    if (date > new Date()) {
      try {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `Releases ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
      } catch {
        return releaseDate;
      }
    }
    return releaseDate.split('-')[0];
  }, []);

  const renderSearchResult = useCallback(
    ({ item }: { item: TMDBMediaItem }) => {
      const typeLabel = item.mediaType === 'tv' ? 'Series' : 'Movie';
      const genres =
        item.genreIds
          ?.slice(0, 3)
          .map((id) => getGenreName(id, item.mediaType || 'movie'))
          .filter(Boolean)
          .join(' · ') || '';

      return (
        <Card
          variant="filled"
          radius={shape.large}
          onPress={() => handleItemPress(item)}
          onLongPress={() => handleItemLongPress(item)}
          style={styles.resultCard}
          accessibilityLabel={[
            item.title,
            typeLabel,
            genres,
            formatReleaseLabel(item.releaseDate),
            item.voteAverage > 0 ? `Rated ${item.voteAverage.toFixed(1)} out of 10` : null,
          ]
            .filter(Boolean)
            .join(', ')}
          accessibilityHint="Double tap to open. Long press for quick actions."
        >
          <View style={styles.resultRow}>
            {item.posterPath ? (
              <Image
                source={{ uri: getImageUrl(item.posterPath, 'w185') || '' }}
                style={styles.resultPoster}
                accessible={false}
              />
            ) : (
              <View
                style={[
                  styles.resultPoster,
                  styles.center,
                  { backgroundColor: colors.surfaceContainerHighest },
                ]}
              >
                <Ionicons name="film-outline" size={24} color={colors.onSurfaceVariant} />
              </View>
            )}

            <View style={styles.resultInfo}>
              <View style={styles.resultTitleRow}>
                <Text
                  variant="titleMedium"
                  color={colors.onSurface}
                  numberOfLines={2}
                  style={styles.flexShrink}
                >
                  {item.title}
                </Text>
                <View
                  style={[styles.pill, { backgroundColor: colors.surfaceContainerHighest }]}
                >
                  <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                    {typeLabel}
                  </Text>
                </View>
              </View>

              {genres ? (
                <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
                  {genres}
                </Text>
              ) : null}

              <View style={styles.resultMeta}>
                <Text variant="labelMedium" color={colors.onSurfaceVariant}>
                  {formatReleaseLabel(item.releaseDate)}
                </Text>

                {item.voteAverage > 0 ? (
                  <View style={styles.inlineRow}>
                    <Ionicons name="star" size={13} color={colors.tertiary} />
                    <Text variant="labelMedium" color={colors.tertiary}>
                      {item.voteAverage.toFixed(1)}
                    </Text>
                  </View>
                ) : null}

                {item.certification ? (
                  <View style={[styles.pillOutlined, { borderColor: colors.outlineVariant }]}>
                    <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                      {item.certification}
                    </Text>
                  </View>
                ) : null}

                {item.originalLanguage ? (
                  <View style={[styles.pillOutlined, { borderColor: colors.outlineVariant }]}>
                    <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                      {item.originalLanguage.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
              </View>

              {item.overview ? (
                <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
                  {item.overview}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      );
    },
    [handleItemPress, handleItemLongPress, colors, formatReleaseLabel]
  );

  const renderGridItem = useCallback(
    ({ item }: { item: any }) => {
      const type = item.mediaType || (item.releaseDate ? 'movie' : 'tv');
      const typeLabel = type === 'tv' ? 'Series' : 'Movie';
      const year = item.releaseDate ? item.releaseDate.split('-')[0] : '—';

      return (
        <Card
          variant="filled"
          radius={shape.medium}
          onPress={() => handleItemPress(item)}
          onLongPress={() => handleItemLongPress(item)}
          style={{ width: gridCardWidth, backgroundColor: 'transparent' }}
          accessibilityLabel={[
            item.title,
            typeLabel,
            year,
            item.voteAverage > 0 ? `Rated ${item.voteAverage.toFixed(1)} out of 10` : null,
            item.reason ? `Suggested because ${item.reason}` : null,
          ]
            .filter(Boolean)
            .join(', ')}
          accessibilityHint="Double tap to open. Long press for quick actions."
        >
          <View
            style={[
              styles.gridPosterWrap,
              {
                height: gridPosterHeight,
                backgroundColor: colors.surfaceContainerHighest,
              },
            ]}
          >
            {item.posterPath ? (
              <Image
                source={{ uri: getImageUrl(item.posterPath, 'w342') || '' }}
                style={styles.fill}
                resizeMode="cover"
                accessible={false}
              />
            ) : (
              <View style={[styles.fill, styles.center]}>
                <Ionicons name="film-outline" size={24} color={colors.onSurfaceVariant} />
              </View>
            )}

            {item.certification ? (
              <View style={[styles.overlayBadge, styles.badgeTopLeft]}>
                <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
                  {item.certification}
                </Text>
              </View>
            ) : null}

            {item.voteAverage > 0 ? (
              <View style={[styles.overlayBadge, styles.badgeTopRight]}>
                <Ionicons name="star" size={10} color={SCRIM_ON} />
                <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
                  {item.voteAverage.toFixed(1)}
                </Text>
              </View>
            ) : null}

            <View style={[styles.overlayBadge, styles.badgeBottomRight]}>
              <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
                {typeLabel}
              </Text>
            </View>
          </View>

          <View style={styles.gridMeta}>
            <Text variant="titleSmall" color={colors.onSurface} numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              {year}
            </Text>
            {item.reason ? (
              <Text variant="labelSmall" color={colors.tertiary} numberOfLines={2}>
                ✨ {item.reason}
              </Text>
            ) : null}
          </View>
        </Card>
      );
    },
    [handleItemPress, handleItemLongPress, colors, gridCardWidth, gridPosterHeight]
  );

  const hasActiveSearchFilters =
    searchMediaType !== 'all' || searchSortBy !== 'popularity' || searchLang !== 'all';

  /** Media-type / genre controls shared by the feed and the genre grid. */
  const browseControls = (
    <View style={styles.browseControls}>
      <View style={{ paddingHorizontal: gutter }}>
        <SegmentedButtons
          options={MEDIA_TABS}
          value={activeTab}
          onChange={setActiveTab}
          accessibilityLabel="Media type"
          style={styles.fullWidthSegments}
        />
      </View>

      <View style={styles.genreSection}>
        <Text
          variant="titleSmall"
          color={colors.onSurfaceVariant}
          accessibilityRole="header"
          style={{ paddingHorizontal: gutter, marginBottom: spacing.sm }}
        >
          Browse by genre
        </Text>
        <GenreChips
          genres={genreList}
          selectedIds={selectedGenres}
          onToggle={handleGenreToggle}
          gutter={gutter}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {showAllRecommendations ? (
        <View style={styles.flex}>
          <View
            style={[
              styles.appBar,
              { paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.xs },
            ]}
          >
            <IconButton
              icon="arrow-back"
              onPress={() => setShowAllRecommendations(false)}
              accessibilityLabel="Back to discover"
            />
            <Text
              variant="titleLarge"
              color={colors.onSurface}
              accessibilityRole="header"
              numberOfLines={1}
              style={styles.flexShrink}
            >
              All recommendations
            </Text>
          </View>

          <FlatList
            style={styles.flex}
            key={`recs-grid-${posterColumns}`}
            data={recommendations}
            renderItem={renderGridItem}
            keyExtractor={(item) => `rec-grid-${item.mediaType || 'movie'}-${item.id}`}
            numColumns={posterColumns}
            columnWrapperStyle={
              posterColumns > 1 ? { paddingHorizontal: gutter, gap: GRID_GAP } : undefined
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: listBottomPadding, gap: spacing.lg }}
            ListEmptyComponent={
              <EmptyState
                icon="sparkles-outline"
                title="No recommendations yet"
                subtitle="Rate a few titles and personalised picks will show up here."
                compact
              />
            }
          />
        </View>
      ) : (
        <>
          {/* Top app bar */}
          <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm, paddingHorizontal: gutter }]}>
            <View style={styles.brandRow}>
              <Logo size={30} />
              <Text
                variant="headlineSmall"
                color={colors.onSurface}
                accessibilityRole="header"
                weight="700"
              >
                Matinee
              </Text>
            </View>

            <View style={styles.appBarActions}>
              <View>
                <IconButton
                  icon="notifications-outline"
                  onPress={() => setNotificationPanelVisible(true)}
                  accessibilityLabel={
                    unreadCount > 0
                      ? `Notifications, ${unreadCount} unread`
                      : 'Notifications'
                  }
                  accessibilityHint="Opens your notifications"
                />
                {unreadCount > 0 ? (
                  <Badge count={unreadCount} style={styles.bellBadge} />
                ) : null}
              </View>
            </View>
          </View>

          {/* Search */}
          <View style={[styles.searchArea, { paddingHorizontal: gutter }]}>
            <SearchField
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search movies, series, people"
              accessibilityLabel="Search movies, series and people"
              onFocus={() => setIsSearchFocused(true)}
              onClear={handleClearSearch}
              leading={
                searchQuery.trim() ? (
                  <IconButton
                    icon="arrow-back"
                    size={40}
                    iconSize={22}
                    onPress={handleClearSearch}
                    accessibilityLabel="Clear search and go back"
                    style={styles.searchLeading}
                  />
                ) : undefined
              }
              trailing={
                searchQuery.trim() ? (
                  <IconButton
                    icon="options-outline"
                    variant={hasActiveSearchFilters ? 'tonal' : 'standard'}
                    size={40}
                    iconSize={22}
                    onPress={() => setIsFilterSheetVisible(true)}
                    accessibilityLabel={
                      hasActiveSearchFilters ? 'Search filters, active' : 'Search filters'
                    }
                    accessibilityHint="Opens sorting and filtering options"
                  />
                ) : undefined
              }
            />

            {/* Active filters, each removable */}
            {searchQuery.trim() && hasActiveSearchFilters ? (
              <View style={styles.filterChipsRow}>
                {searchSortBy !== 'popularity' ? (
                  <Chip
                    variant="input"
                    label={`Sort: ${
                      searchSortBy === 'rating'
                        ? 'Rating'
                        : searchSortBy === 'newest'
                          ? 'Newest'
                          : 'Oldest'
                    }`}
                    selected
                    onRemove={() => setSearchSortBy('popularity')}
                    onPress={() => setIsFilterSheetVisible(true)}
                  />
                ) : null}
                {searchMediaType !== 'all' ? (
                  <Chip
                    variant="input"
                    label={`Type: ${searchMediaType === 'movie' ? 'Movies' : 'Series'}`}
                    selected
                    onRemove={() => setSearchMediaType('all')}
                    onPress={() => setIsFilterSheetVisible(true)}
                  />
                ) : null}
                {searchLang !== 'all' ? (
                  <Chip
                    variant="input"
                    label={`Language: ${searchLang.toUpperCase()}`}
                    selected
                    onRemove={() => setSearchLang('all')}
                    onPress={() => setIsFilterSheetVisible(true)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Main content */}
          {searchQuery.trim() ? (
            <View style={styles.flex}>
              {isSearching ? (
                <Loading label="Searching" style={styles.topSpaced} />
              ) : processedSearchResults.length > 0 ? (
                <FlatList
                  style={styles.flex}
                  data={processedSearchResults}
                  renderItem={renderSearchResult}
                  keyExtractor={(item) => `${item.mediaType || 'movie'}-${item.id}`}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: gutter,
                    paddingBottom: listBottomPadding,
                    gap: spacing.md,
                  }}
                  keyboardShouldPersistTaps="handled"
                  onEndReached={loadMoreSearchResults}
                  onEndReachedThreshold={0.5}
                  ListFooterComponent={
                    isSearchingMore ? <Loading label="Loading more results" /> : null
                  }
                />
              ) : isSearchingMore ? (
                <Loading label="Loading more results" style={styles.topSpaced} />
              ) : (
                <EmptyState
                  icon="search-outline"
                  title={searchResults.length > 0 ? 'No matches' : 'Nothing found'}
                  subtitle={
                    searchResults.length > 0
                      ? 'Try loosening the filters you applied.'
                      : 'Check the spelling, or search for something else.'
                  }
                  actionLabel={searchResults.length > 0 ? 'Clear filters' : undefined}
                  onAction={
                    searchResults.length > 0
                      ? () => {
                          setSearchSortBy('popularity');
                          setSearchMediaType('all');
                          setSearchLang('all');
                        }
                      : undefined
                  }
                />
              )}
            </View>
          ) : selectedGenres.length > 0 ? (
            /* Genre-filtered grid */
            <FlatList
              style={styles.flex}
              key={`discover-grid-${posterColumns}`}
              ListHeaderComponent={
                <>
                  {browseControls}
                  {discoverLoading ? <Loading label="Loading titles" /> : null}
                </>
              }
              data={discoverResults}
              renderItem={renderGridItem}
              keyExtractor={(item) => `grid-${item.mediaType || 'movie'}-${item.id}`}
              numColumns={posterColumns}
              columnWrapperStyle={
                posterColumns > 1 ? { paddingHorizontal: gutter, gap: GRID_GAP } : undefined
              }
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: listBottomPadding, gap: spacing.lg }}
              onEndReached={loadMoreDiscover}
              onEndReachedThreshold={0.6}
              ListFooterComponent={
                discoverLoadingMore ? <Loading label="Loading more titles" /> : null
              }
              ListEmptyComponent={
                !discoverLoading ? (
                  <EmptyState
                    icon="funnel-outline"
                    title="No titles in these genres"
                    subtitle="Try a different combination, or clear a genre or two."
                    compact
                  />
                ) : null
              }
            />
          ) : (
            /* Home feed */
            <ScrollView
              style={styles.flex}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={async () => {
                    setRefreshing(true);
                    // Bypass the response cache — otherwise pull-to-refresh just
                    // re-renders the same cached payload and appears to do nothing.
                    await Promise.all([fetchHomeData(true, true), triggerNotificationSync()]);
                    setRefreshing(false);
                  }}
                  tintColor={colors.primary}
                  colors={[colors.primary]}
                  progressBackgroundColor={colors.surfaceContainerHigh}
                />
              }
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: listBottomPadding }}
            >
              {browseControls}

              {homeLoading ? (
                <Loading label="Loading your feed" style={styles.topSpaced} />
              ) : (
                <View style={styles.feed}>
                  <CarouselSection
                    title="Recommended for you"
                    items={recommendations.slice(0, 15)}
                    onItemPress={handleItemPress}
                    onItemLongPress={handleItemLongPress}
                    onSeeAll={() => setShowAllRecommendations(true)}
                    cardSize="medium"
                    showMediaTypeBadge={activeTab === 'all'}
                  />
                  <CarouselSection
                    title="Trending this week"
                    items={trending}
                    onItemPress={handleItemPress}
                    onItemLongPress={handleItemLongPress}
                    cardSize="large"
                    showMediaTypeBadge={activeTab === 'all'}
                  />
                  <CarouselSection
                    title="Recently watched"
                    items={recentlyWatched}
                    onItemPress={handleItemPress}
                    onItemLongPress={handleItemLongPress}
                    cardSize="small"
                    showMediaTypeBadge={activeTab === 'all'}
                  />
                  <CarouselSection
                    title={`Popular ${
                      activeTab === 'all' ? 'titles' : activeTab === 'movies' ? 'movies' : 'series'
                    }`}
                    items={popular}
                    onItemPress={handleItemPress}
                    onItemLongPress={handleItemLongPress}
                    cardSize="medium"
                    showMediaTypeBadge={activeTab === 'all'}
                  />
                  <CarouselSection
                    title={`Top rated ${
                      activeTab === 'all' ? 'titles' : activeTab === 'movies' ? 'movies' : 'series'
                    }`}
                    items={topRated}
                    onItemPress={handleItemPress}
                    onItemLongPress={handleItemLongPress}
                    cardSize="medium"
                    showMediaTypeBadge={activeTab === 'all'}
                  />

                  {recommendations.length === 0 &&
                  trending.length === 0 &&
                  popular.length === 0 &&
                  topRated.length === 0 ? (
                    <EmptyState
                      icon="cloud-offline-outline"
                      title="Nothing to show"
                      subtitle="Check your connection or your TMDB key, then pull down to refresh."
                      compact
                    />
                  ) : null}
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* Quick actions for a long-pressed title */}
      <BottomSheet
        visible={!!longPressItem}
        onDismiss={() => setLongPressItem(null)}
        title={longPressItem?.title ?? ''}
        subtitle={
          longPressItem?.releaseDate
            ? new Date(longPressItem.releaseDate) > new Date()
              ? 'Not yet released'
              : `Released in ${longPressItem.releaseDate.substring(0, 4)}`
            : undefined
        }
      >
        <View style={styles.sheetList}>
          {longPressItem &&
          !(longPressItem.releaseDate && new Date(longPressItem.releaseDate) > new Date()) ? (
            <ListItem
              headline="Rate and log"
              leadingIcon="star-outline"
              leadingIconColor={colors.primary}
              onPress={() => handleLongPressAction('rate')}
              accessibilityHint="Opens the title so you can rate it"
            />
          ) : null}

          <ListItem
            headline={
              longPressStatus === 'watchlist' ? 'Remove from watchlist' : 'Add to watchlist'
            }
            leadingIcon={longPressStatus === 'watchlist' ? 'bookmark' : 'bookmark-outline'}
            leadingIconColor={colors.primary}
            onPress={() => handleLongPressAction('watchlist')}
          />

          <ListItem
            headline={
              longPressStatus === 'not_interested' ? 'Show this again' : 'Not interested'
            }
            leadingIcon={longPressStatus === 'not_interested' ? 'eye-off' : 'eye-off-outline'}
            leadingIconColor={colors.primary}
            onPress={() => handleLongPressAction('not_interested')}
            accessibilityHint="Hides this title from your feed"
          />
        </View>
      </BottomSheet>

      {/* Search filters */}
      <BottomSheet
        visible={isFilterSheetVisible}
        onDismiss={() => setIsFilterSheetVisible(false)}
        title="Filters"
        footer={
          <>
            <Button
              label="Reset"
              variant="text"
              onPress={() => {
                setSearchSortBy('popularity');
                setSearchMediaType('all');
                setSearchLang('all');
              }}
              style={styles.flex}
            />
            <Button
              label="Show results"
              variant="filled"
              onPress={() => setIsFilterSheetVisible(false)}
              style={styles.flex}
            />
          </>
        }
      >
        <Text variant="titleSmall" color={colors.onSurfaceVariant} style={styles.filterHeading}>
          Sort by
        </Text>
        <View style={styles.filterGroup}>
          {[
            { label: 'Popularity', value: 'popularity' },
            { label: 'Rating', value: 'rating' },
            { label: 'Newest', value: 'newest' },
            { label: 'Oldest', value: 'oldest' },
          ].map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              variant="filter"
              selected={searchSortBy === option.value}
              onPress={() => setSearchSortBy(option.value as any)}
            />
          ))}
        </View>

        <Text variant="titleSmall" color={colors.onSurfaceVariant} style={styles.filterHeading}>
          Media type
        </Text>
        <View style={styles.filterGroup}>
          {[
            { label: 'All', value: 'all' },
            { label: 'Movies', value: 'movie' },
            { label: 'Series', value: 'tv' },
          ].map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              variant="filter"
              selected={searchMediaType === option.value}
              onPress={() => setSearchMediaType(option.value as any)}
            />
          ))}
        </View>

        <Text variant="titleSmall" color={colors.onSurfaceVariant} style={styles.filterHeading}>
          Language
        </Text>
        <View style={styles.filterGroup}>
          <Chip
            label="All languages"
            variant="filter"
            selected={searchLang === 'all'}
            onPress={() => setSearchLang('all')}
          />
          {preferredLanguages.map((langCode) => (
            <Chip
              key={langCode}
              label={langCode.toUpperCase()}
              variant="filter"
              selected={searchLang === langCode}
              onPress={() => setSearchLang(langCode)}
            />
          ))}
        </View>
      </BottomSheet>

      <NotificationPanel
        visible={notificationPanelVisible}
        onClose={() => setNotificationPanelVisible(false)}
        onRefreshCount={fetchUnreadCount}
      />
    </View>
  );
}

/** Foreground for badges drawn on the poster scrim. */
const SCRIM_ON = '#FFFFFF';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSpaced: {
    marginTop: spacing.xxl,
  },

  /* App bar */
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    minHeight: 64,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  appBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 8,
    right: 6,
  },

  /* Search */
  searchArea: {
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  searchLeading: {
    marginLeft: -spacing.sm,
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  /* Browse controls */
  browseControls: {
    paddingTop: spacing.xs,
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  fullWidthSegments: {
    alignSelf: 'stretch',
  },
  genreSection: {
    gap: 0,
  },

  /* Feed */
  feed: {
    marginTop: spacing.xs,
  },

  /* Search result card */
  resultCard: {
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.lg,
  },
  resultPoster: {
    width: 84,
    height: 126,
    borderRadius: shape.small,
  },
  resultInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  resultTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: shape.extraSmall,
  },
  pillOutlined: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: shape.extraSmall,
    borderWidth: 1,
  },

  /* Poster grid */
  gridPosterWrap: {
    width: '100%',
    borderRadius: shape.medium,
    overflow: 'hidden',
  },
  gridMeta: {
    marginTop: spacing.sm,
    gap: 2,
  },
  overlayBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: withAlpha('#000000', 0.62),
    borderRadius: shape.extraSmall,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgeTopLeft: {
    top: spacing.sm,
    left: spacing.sm,
  },
  badgeTopRight: {
    top: spacing.sm,
    right: spacing.sm,
  },
  badgeBottomRight: {
    bottom: spacing.sm,
    right: spacing.sm,
  },

  /* Sheets */
  sheetList: {
    marginHorizontal: -spacing.xl,
  },
  filterHeading: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  filterGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
