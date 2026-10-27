import { bookmarkTitle } from '../../services/libraryActions';
import { normalizeCard } from '../../components/library/QuickActions';
import { snapshotItem } from '../../services/libraryActivity';
import { useNotice } from '../../context/NoticeContext';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, Image, RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useResponsive } from '../../hooks/useResponsive';
import { shape, spacing } from '../../constants/m3';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  ListItem,
  Loading,
  SearchField,
  SegmentedButtons,
  Text,
  Touchable,
  NAVIGATION_BAR_HEIGHT,
} from '../../components/m3';
import { tmdbService, getImageUrl, limitConcurrency } from '../../services/tmdb';
import { getItem, addItem, getPreference, setPreference, getAllItems, deleteItem } from '../../services/database';
import { notificationService } from '../../services/notifications';
import { calendarService } from '../../services/calendar';
import GenreChips from '../../components/GenreChips';
import EmptyState from '../../components/EmptyState';
import { TMDBMediaItem } from '../../types';
import { getGenreName } from '../../constants/genres';
import { LANGUAGES, DEFAULT_LANGUAGES } from '../../constants/languages';

const LANGUAGE_CHIPS = LANGUAGES.filter((l) =>
  DEFAULT_LANGUAGES.includes(l.code)
).map((l) => ({ id: l.code, name: l.name }));

/**
 * Upcoming keeps its own language selection, separate from the discover feed's
 * `PREF_LANGUAGES`.
 *
 * Sharing one key meant narrowing the release calendar to Kannada also
 * narrowed every recommendation rail, and widening the feed to seven languages
 * silently widened the calendar — so the chips on this screen kept showing a
 * selection the user had never made here.
 */
const UPCOMING_LANGUAGES_PREF = 'PREF_UPCOMING_LANGUAGES';

/**
 * One language until the user says otherwise.
 *
 * The old default was all seven of `DEFAULT_LANGUAGES`, which fired seven
 * parallel discover calls per page and produced a calendar too crowded to
 * scan. Starting from English alone makes the first paint fast and makes the
 * chip row mean something: what is ticked is what is in the list.
 */
const DEFAULT_UPCOMING_LANGUAGES = ['en'];

type TimeBucket = 'thisWeek' | 'thisMonth' | 'later';

/**
 * Labels are abbreviated so three segments plus the Series toggle fit one row
 * on a narrow phone; `a11yLabel` restores the full phrasing for screen readers.
 */
const BUCKETS: { value: TimeBucket; label: string; a11yLabel: string }[] = [
  { value: 'thisWeek', label: 'Week', a11yLabel: 'Releasing this week' },
  { value: 'thisMonth', label: 'Month', a11yLabel: 'Releasing this month' },
  { value: 'later', label: 'Later', a11yLabel: 'Releasing later' },
];

/**
 * Library key for a title. TMDB ids are only unique within a media type, so
 * keying status/dedup maps by bare id let a movie and a series with the same
 * id shadow each other.
 */
const itemKey = (mediaType: string | undefined, id: number) =>
  `${mediaType || 'movie'}-${id}`;

export default function UpcomingScreen() {
  const router = useRouter();
  const notice = useNotice();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter, isCompact } = useResponsive();

  /** Keeps the last card clear of the navigation bar and the floating FAB. */
  const bottomPadding =
    (isCompact ? NAVIGATION_BAR_HEIGHT + insets.bottom : insets.bottom) + 88;
  // Starts empty: the first fetch waits for the stored preference so the
  // screen can't fire one request wave for a placeholder selection and a
  // second for the real one — which is what made the chips visibly change
  // under the user a moment after the tab opened.
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [languagesLoaded, setLanguagesLoaded] = useState(false);
  const [upcomingMovies, setUpcomingMovies] = useState<TMDBMediaItem[]>([]);
  const [dbStatusMap, setDbStatusMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeBucket, setActiveBucket] = useState<TimeBucket>('thisMonth');
  const [showSeries, setShowSeries] = useState(false);

  // Paging and Search states
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [apiSearchResults, setApiSearchResults] = useState<TMDBMediaItem[]>([]);
  const [isApiSearching, setIsApiSearching] = useState(false);
  const isFetchingRef = useRef(false);
  const loadedPageRef = useRef(1);
  const lastFetchedRef = useRef(0);
  /**
   * Invalidates in-flight background enrichment. A language change or a pull
   * to refresh replaces the list wholesale, and details still arriving for the
   * previous list would otherwise merge themselves into the new one.
   */
  const decorationTokenRef = useRef(0);

  const loadLanguagePreferences = useCallback(async () => {
    try {
      const stored = await getPreference(UPCOMING_LANGUAGES_PREF);
      const parsed = stored
        ? stored.split(',').map((c) => c.trim()).filter(Boolean)
        : [];
      const nextLangs = parsed.length > 0 ? parsed : DEFAULT_UPCOMING_LANGUAGES;
      setSelectedLanguages((prev) => {
        if (prev.length === nextLangs.length && prev.every((l, idx) => l === nextLangs[idx])) {
          return prev;
        }
        return nextLangs;
      });
    } catch (err) {
      console.error('Load language preferences error:', err);
      setSelectedLanguages((prev) => (prev.length > 0 ? prev : DEFAULT_UPCOMING_LANGUAGES));
    } finally {
      setLanguagesLoaded(true);
    }
  }, []);

  const fetchUpcoming = useCallback(async (pageNum = 1, shouldAppend = false, forceRefresh = false) => {
    if (isFetchingRef.current) return;
    if (selectedLanguages.length === 0) return;
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

      // 1. Get all DB items to filter out (watched and not_interested for movies; not_interested only for series).
      // Keys carry the media type because TMDB ids are only unique per type.
      const dbItems = await getAllItems();
      const skipKeys = new Set(dbItems.filter(i => {
        if (i.mediaType === 'movie' && (i.status === 'watched' || i.status === 'not_interested')) return true;
        if (i.mediaType === 'tv' && i.status === 'not_interested') return true;
        return false;
      }).map(i => itemKey(i.mediaType, i.tmdbId)));

      const statusMap: Record<string, string> = {};
      dbItems.forEach((item) => {
        statusMap[itemKey(item.mediaType, item.tmdbId)] = item.status;
      });
      setDbStatusMap(statusMap);

      // 2. Fetch the upcoming list, passing showSeries down to discovery
      const res = await tmdbService.getUpcomingByLanguages(selectedLanguages, pageNum, forceRefresh, showSeries);
      const rawResults = res?.results || [];

      // 3. Pre-filter rawResults to avoid decorating watched/skipped items and disabled media types
      const filteredRawResults = rawResults.filter(item => {
        if (skipKeys.has(itemKey(item.mediaType, item.id))) return false;
        if (!showSeries && item.mediaType === 'tv') return false;
        return true;
      });

      // 4. Show the page immediately, then enrich it.
      //
      // Runtime, certification, watch providers and a series' next air date all
      // live behind a per-title details call. Awaiting twenty of those before
      // the first render meant the calendar sat on a spinner for as long as the
      // slowest one took. The list is published from the discover payload right
      // away and each detail merges in as it lands, so the screen is usable in
      // one round trip and simply gains detail as it goes.
      const sortByDate = (list: TMDBMediaItem[]) =>
        [...list].sort(
          (a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
        );

      setUpcomingMovies((prev) => {
        if (shouldAppend) {
          const existingKeys = new Set(prev.map((m) => itemKey(m.mediaType, m.id)));
          const newUnique = filteredRawResults.filter(
            (m) => !existingKeys.has(itemKey(m.mediaType, m.id))
          );
          return sortByDate([...prev, ...newUnique]);
        }
        return sortByDate(filteredRawResults);
      });

      setPage(pageNum);
      setHasMore(pageNum < (res?.totalPages || 1));
      if (pageNum === 1) {
        lastFetchedRef.current = Date.now();
      }

      // ── Background enrichment ──
      const decorationToken = ++decorationTokenRef.current;
      const filterByCountry = (await getPreference('PREF_FILTER_BY_COUNTRY')) === 'true';

      void limitConcurrency(filteredRawResults, 5, async (item) => {
        if (decorationToken !== decorationTokenRef.current) return;
        try {
          const details = await tmdbService.getDetails(
            item.id,
            item.mediaType || 'movie',
            forceRefresh
          );
          if (!details) return;
          if (decorationToken !== decorationTokenRef.current) return;

          let updatedReleaseDate = item.releaseDate;
          let upcomingEventTitle: string | undefined;
          let upcomingEpisodeInfo: string | undefined;

          if (item.mediaType === 'tv') {
            const todayStr = new Date().toISOString().split('T')[0];
            let upcomingDate: string | null = null;
            let eventTitle: string | null = null;

            // 1. Check nextEpisodeToAir
            if (details.nextEpisodeToAir && details.nextEpisodeToAir.air_date >= todayStr) {
              upcomingDate = details.nextEpisodeToAir.air_date;
              const { season_number, episode_number } = details.nextEpisodeToAir;
              eventTitle = episode_number === 1 ? `Season ${season_number} Premiere` : null;
              const sn = String(season_number).padStart(2, '0');
              const en = String(episode_number).padStart(2, '0');
              upcomingEpisodeInfo = `S${sn}-E${en}`;
            }

            // 2. Otherwise, check the seasons list for future season air dates
            if (!upcomingDate && details.seasons) {
              const futureSeasons = details.seasons
                .filter((se: any) => se.season_number > 0 && se.air_date && se.air_date >= todayStr)
                .sort((a: any, b: any) => a.season_number - b.season_number);
              if (futureSeasons.length > 0) {
                upcomingDate = futureSeasons[0].air_date;
                const sNum = futureSeasons[0].season_number;
                eventTitle = `Season ${sNum} Premiere`;
                upcomingEpisodeInfo = `S${String(sNum).padStart(2, '0')}`;
              }
            }

            if (upcomingDate) {
              updatedReleaseDate = upcomingDate;
              upcomingEventTitle = eventTitle || undefined;
            } else if (item.releaseDate && item.releaseDate >= todayStr) {
              upcomingEventTitle = 'Series Premiere';
            }
          }

          // "Available in my country" needs the provider list, which only
          // arrives with the details — so it is applied here, as a removal,
          // rather than up front.
          const providers = details.watchProviders;
          const hasProvider =
            !!providers &&
            ((providers.flatrate?.length ?? 0) > 0 ||
              (providers.buy?.length ?? 0) > 0 ||
              (providers.rent?.length ?? 0) > 0);
          const dropForCountry = filterByCountry && item.mediaType === 'tv' && !hasProvider;

          const key = itemKey(item.mediaType, item.id);
          setUpcomingMovies((prev) => {
            const index = prev.findIndex((m) => itemKey(m.mediaType, m.id) === key);
            if (index === -1) return prev;
            if (dropForCountry) {
              return prev.filter((_, idx) => idx !== index);
            }
            const next = [...prev];
            next[index] = {
              ...next[index],
              runtime: details.runtime,
              certification: details.certification,
              watchProviders: details.watchProviders,
              releaseDate: updatedReleaseDate,
              upcomingEventTitle,
              upcomingEpisodeInfo,
            } as TMDBMediaItem;
            // A series' real next air date can differ from its first air date,
            // so the row may need to move.
            return updatedReleaseDate !== item.releaseDate ? sortByDate(next) : next;
          });
        } catch (err) {
          console.error(`Failed to load details for upcoming item ${item.id}:`, err);
        }
      });
    } catch (err) {
      console.error('Upcoming fetch error:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [selectedLanguages, showSeries]);

  const [longPressItem, setLongPressItem] = useState<any | null>(null);
  const [longPressStatus, setLongPressStatus] = useState<string | null>(null);

  const handleItemLongPress = useCallback(async (item: any) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const existing = await getItem(item.id, item.mediaType || 'movie');
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

      const existing = await getItem(tmdbId, mediaType);

      const target = {...normalizeCard(longPressItem),mediaType};
      if (action === 'watchlist') {
        const saved = await bookmarkTitle(target);
        notice({message:saved?'Added to bookmarks':'Bookmark removed',undo:async()=>{await bookmarkTitle(target);}});
      } else if (action === 'not_interested') {
        const undo = existing ? await snapshotItem(existing) : async()=>{const added=await getItem(tmdbId,mediaType);if(added)await deleteItem(added.id);};
        await addItem({tmdbId,mediaType,title:target.title,posterPath:target.posterPath,backdropPath:target.backdropPath,overview:target.overview,releaseDate:target.releaseDate,genres:JSON.stringify(target.genreIds),originalLanguage:target.originalLanguage,runtime:target.runtime??0,voteAverage:target.voteAverage,status:'not_interested',watchedDate:existing?.watchedDate??null});
        await notificationService.cancelReminder(tmdbId,mediaType);
        notice({message:'Hidden from recommendations',undo});
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
      const { dbChangeTimestamp } = require('../../services/database');
      if (languagesLoaded && dbChangeTimestamp > lastFetchedRef.current) {
        fetchUpcoming(1, false);
      }
    }, [loadLanguagePreferences, fetchUpcoming, languagesLoaded])
  );

  useEffect(() => {
    if (!languagesLoaded || selectedLanguages.length === 0) return;
    fetchUpcoming(1, false);
  }, [fetchUpcoming, languagesLoaded, selectedLanguages]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // API Search for upcoming movies and shows
  useEffect(() => {
    let active = true;

    async function performSearch() {
      if (!debouncedSearchQuery.trim()) {
        setApiSearchResults([]);
        setIsApiSearching(false);
        return;
      }

      setIsApiSearching(true);
      try {
        const todayStr = new Date().toISOString().split('T')[0];

        // 1. Search TMDB
        const res = await tmdbService.search(debouncedSearchQuery.trim(), undefined, 1);
        const searchItems = res?.results || [];

        if (!active) return;

        // Get all DB items to filter out (watched and not_interested for movies; not_interested only for series)
        const dbItems = await getAllItems();
        const skipIds = new Set(dbItems.filter(i => {
          if (i.mediaType === 'movie' && (i.status === 'watched' || i.status === 'not_interested')) return true;
          if (i.mediaType === 'tv' && i.status === 'not_interested') return true;
          return false;
        }).map(i => i.tmdbId));

        // Filter search results first to avoid decorating skipped items and disabled media types
        const filteredSearchItems = searchItems.filter(item => {
          if (skipIds.has(item.id)) return false;
          if (!showSeries && item.mediaType === 'tv') return false;
          return true;
        });

        // 2. Fetch details and filter/decorate using limitConcurrency
        const decorated = await limitConcurrency(
          filteredSearchItems,
          5,
          async (item) => {
            try {
              const details = await tmdbService.getDetails(item.id, item.mediaType || 'movie');
              if (details) {
                let updatedReleaseDate = item.releaseDate;
                let upcomingEventTitle: string | undefined = undefined;
                let upcomingEpisodeInfo: string | undefined = undefined;

                if (item.mediaType === 'tv') {
                  let upcomingDate: string | null = null;
                  let eventTitle: string | null = null;

                  // nextEpisodeToAir
                  if (details.nextEpisodeToAir && details.nextEpisodeToAir.air_date >= todayStr) {
                    upcomingDate = details.nextEpisodeToAir.air_date;
                    const { season_number, episode_number } = details.nextEpisodeToAir;
                    if (episode_number === 1) {
                      eventTitle = `Season ${season_number} Premiere`;
                    } else {
                      eventTitle = null;
                    }
                    const s = String(season_number).padStart(2, '0');
                    const e = String(episode_number).padStart(2, '0');
                    upcomingEpisodeInfo = `S${s}-E${e}`;
                  }

                  // seasons list
                  if (!upcomingDate && details.seasons) {
                    const futureSeasons = details.seasons
                      .filter((s: any) => s.season_number > 0 && s.air_date && s.air_date >= todayStr)
                      .sort((a: any, b: any) => a.season_number - b.season_number);
                    if (futureSeasons.length > 0) {
                      upcomingDate = futureSeasons[0].air_date;
                      const sNum = futureSeasons[0].season_number;
                      eventTitle = `Season ${sNum} Premiere`;
                      upcomingEpisodeInfo = `S${String(sNum).padStart(2, '0')}`;
                    }
                  }

                  if (upcomingDate) {
                    updatedReleaseDate = upcomingDate;
                    upcomingEventTitle = eventTitle || undefined;
                  } else if (item.releaseDate && item.releaseDate >= todayStr) {
                    upcomingEventTitle = 'Series Premiere';
                  }
                }

                return {
                  ...item,
                  runtime: details.runtime,
                  certification: details.certification,
                  watchProviders: details.watchProviders,
                  releaseDate: updatedReleaseDate,
                  upcomingEventTitle,
                  upcomingEpisodeInfo,
                };
              }
            } catch (err) {
              console.error(`Failed to load details for search item ${item.id}:`, err);
            }
            return item;
          }
        );

        if (!active) return;

        const filterByCountry = (await getPreference('PREF_FILTER_BY_COUNTRY')) === 'true';
        let processedDecorated = decorated;
        if (filterByCountry) {
          processedDecorated = decorated.filter((item) => {
            if (item.mediaType !== 'tv') return true;
            const providers = item.watchProviders;
            if (!providers) return false;
            const hasFlatrate = Array.isArray(providers.flatrate) && providers.flatrate.length > 0;
            const hasBuy = Array.isArray(providers.buy) && providers.buy.length > 0;
            const hasRent = Array.isArray(providers.rent) && providers.rent.length > 0;
            return hasFlatrate || hasBuy || hasRent;
          });
        }

        // 3. Keep only movies/shows whose release date is in the future and not skipped
        const upcomingResults = processedDecorated.filter((m) => {
          if (skipIds.has(m.id)) return false;
          if (!m.releaseDate) return false;
          return m.releaseDate >= todayStr;
        });

        setApiSearchResults(upcomingResults);
      } catch (err) {
        console.error('API search error:', err);
        setApiSearchResults([]);
      } finally {
        if (active) {
          setIsApiSearching(false);
        }
      }
    }

    performSearch();

    return () => {
      active = false;
    };
  }, [debouncedSearchQuery, showSeries]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUpcoming(1, false, true);
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
      // Never leave the calendar with nothing to show.
      if (next.length === 0) next = DEFAULT_UPCOMING_LANGUAGES;
      setPreference(UPCOMING_LANGUAGES_PREF, next.join(',')).catch(console.error);
      return next;
    });
  }, []);

  const handleInterested = useCallback(async (item: TMDBMediaItem) => {
    try {
      const saved = await bookmarkTitle(item);
      setDbStatusMap(prev=>({...prev,[itemKey(item.mediaType,item.id)]:saved?'watchlist':'interested'}));
      notice({message:saved?'Added to bookmarks':'Bookmark removed',undo:async()=>{await bookmarkTitle(item);await fetchUpcoming(1,false);}});
    } catch { notice({message:'Could not update the bookmark. Please try again.'}); }
  }, [fetchUpcoming,notice]);

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
      if (!showSeries && m.mediaType === 'tv') return false;
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
      // The year is dropped for releases inside the current year — on this
      // screen almost everything is, so it was repeated noise crowding out the
      // runtime on a narrow card.
      const releaseDate = item.releaseDate
        ? new Date(item.releaseDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            ...(new Date(item.releaseDate).getFullYear() === new Date().getFullYear()
              ? {}
              : { year: 'numeric' }),
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
          (b: any) =>
            !(item.watchProviders?.flatrate || []).some((f: any) => f.provider_id === b.provider_id)
        ),
      ].slice(0, 3);

      const isInterested = dbStatusMap[itemKey(item.mediaType, item.id)] === 'watchlist';
      const typeLabel = item.mediaType === 'tv' ? 'Series' : 'Movie';

      return (
        <Card variant="filled" radius={shape.large}>
          {/* The card used to be one big pressable with the Remind and
              Calendar buttons inside it. Nesting a control inside a control is
              invalid — on web it renders a <button> inside a <button>, which
              React rejects outright — and it leaves a screen reader with no way
              to reach the actions separately from the card. Only the poster and
              the metadata open the title now; the action column sits beside
              them as a sibling. */}
          <View style={styles.cardRow}>
            <Touchable
              onPress={() => handleItemPress(item)}
              onLongPress={() => handleItemLongPress(item)}
              stateLayerColor={colors.onSurface}
              borderRadius={shape.large}
              accessibilityRole="button"
              accessibilityLabel={[
                item.title,
                item.upcomingEpisodeInfo,
                typeLabel,
                `Releases ${releaseDate}`,
                runtimeStr,
                genres,
                langName,
              ]
                .filter(Boolean)
                .join(', ')}
              accessibilityHint="Double tap to open. Long press for quick actions."
              style={styles.cardPressable}
            >
            <View>
              {item.posterPath ? (
                <Image
                  source={{ uri: getImageUrl(item.posterPath, 'w185') || '' }}
                  style={styles.poster}
                  resizeMode="cover"
                  accessible={false}
                />
              ) : (
                <View
                  style={[
                    styles.poster,
                    styles.center,
                    { backgroundColor: colors.surfaceContainerHighest },
                  ]}
                >
                  <Ionicons name="film-outline" size={24} color={colors.onSurfaceVariant} />
                </View>
              )}
              {item.upcomingEventTitle ? (
                <View style={[styles.premiereBadge, { backgroundColor: colors.primary }]}>
                  <Ionicons name="star" size={11} color={colors.onPrimary} />
                </View>
              ) : null}
            </View>

            {/* Metadata and actions sit side by side so the card's height is
                set by the poster rather than by a stack of rows. */}
            <View style={styles.cardBody}>
              <View style={styles.titleRow}>
                <Text
                  variant="titleSmall"
                  color={colors.onSurface}
                  numberOfLines={2}
                  style={styles.flexShrink}
                >
                  {item.title}
                </Text>
                {item.certification ? (
                  <View style={[styles.pillOutlined, { borderColor: colors.outlineVariant }]}>
                    <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                      {item.certification}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Date and runtime share one line — split across two, they
                  cost a row of height for no extra information. */}
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={13} color={colors.primary} />
                <Text
                  variant="labelMedium"
                  color={colors.primary}
                  numberOfLines={1}
                  style={styles.flexShrink}
                >
                  {releaseDate}
                  {runtimeStr ? `  ·  ${runtimeStr}` : ''}
                </Text>
              </View>

              {genres ? (
                <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
                  {genres}
                </Text>
              ) : null}

              {/* Badges and availability share one row. A badge is only shown
                  when it tells the user something their own filters haven't
                  already fixed — with Series off everything here is a movie,
                  and with one language selected every title is in it. */}
              <View style={styles.badgeRow}>
                {showSeries ? (
                  <View style={[styles.pill, { backgroundColor: colors.secondaryContainer }]}>
                    <Text variant="labelSmall" color={colors.onSecondaryContainer}>
                      {typeLabel}
                    </Text>
                  </View>
                ) : null}

                {item.upcomingEpisodeInfo ? (
                  <View style={[styles.pill, { backgroundColor: colors.tertiaryContainer }]}>
                    <Text variant="labelSmall" color={colors.onTertiaryContainer}>
                      {item.upcomingEpisodeInfo}
                    </Text>
                  </View>
                ) : null}

                {/* Shown unconditionally. It used to appear only when more
                    than one language was selected, so with a single language
                    the rows carried no evidence of which one they were in —
                    which is exactly what made the filter look untrustworthy. */}
                {item.originalLanguage ? (
                  <View style={[styles.pill, { backgroundColor: colors.surfaceContainerHigh }]}>
                    <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                      {langName}
                    </Text>
                  </View>
                ) : null}

                {providers.length > 0 ? (
                  <View
                    style={styles.providerRow}
                    accessible
                    accessibilityLabel={`Streaming on ${providers
                      .map((p: any) => p.provider_name)
                      .filter(Boolean)
                      .join(', ')}`}
                  >
                    {providers.map((p: any) => (
                      <Image
                        key={p.provider_id}
                        source={{ uri: getImageUrl(p.logo_path, 'w92') || '' }}
                        style={styles.providerLogo}
                        accessible={false}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={styles.inlineMeta}>
                    <Ionicons name="film-outline" size={12} color={colors.onSurfaceVariant} />
                    <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                      Theatres
                    </Text>
                  </View>
                )}
              </View>
            </View>
            </Touchable>

            <View style={styles.actionCol}>
              <Button
                label={isInterested ? 'On' : 'Remind'}
                icon={isInterested ? 'notifications' : 'notifications-outline'}
                // `filled` resolves to the primary role, and in dark mode that
                // is a tone-80 pastel pink — an "on" reminder came out as a
                // near-white pill. A selected tonal button uses the primary
                // *container* instead, which stays dark in dark mode and light
                // in light mode, and it announces itself as a toggle.
                variant={isInterested ? 'tonal' : 'outlined'}
                selected={isInterested}
                size="small"
                compact
                fullWidth
                onPress={() => handleInterested(item)}
                accessibilityLabel={`Release reminder for ${item.title}`}
              />
              <Button
                label="Calendar"
                icon="calendar-outline"
                variant="tonal"
                size="small"
                compact
                fullWidth
                onPress={() => handleAddToCalendar(item)}
                accessibilityLabel={`Add ${item.title} to your calendar`}
              />
            </View>
          </View>
        </Card>
      );
    },
    [
      handleItemPress,
      handleItemLongPress,
      handleAddToCalendar,
      handleInterested,
      colors,
      dbStatusMap,
      showSeries,
    ]
  );

  const listContentStyle = {
    paddingHorizontal: gutter,
    paddingBottom: bottomPadding,
    gap: spacing.sm,
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md, paddingHorizontal: gutter }]}>
        <Text variant="headlineSmall" color={colors.onSurface} accessibilityRole="header">
          Upcoming
        </Text>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.sm }}>
        <SearchField
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search upcoming releases"
          accessibilityLabel="Search upcoming releases"
          onClear={() => setSearchQuery('')}
        />
      </View>

      {/* Language filter */}
      <View style={styles.filterSection}>
        <GenreChips
          genres={LANGUAGE_CHIPS.map((l) => ({ id: l.id as any, name: l.name }))}
          selectedIds={selectedLanguages as any[]}
          onToggle={handleLanguageToggle as any}
          gutter={gutter}
        />
      </View>

      {/* Time buckets, or a note that search spans everything */}
      {searchQuery.trim() ? (
        <View style={[styles.searchNote, { paddingHorizontal: gutter }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
            Searching all upcoming releases
          </Text>
        </View>
      ) : (
        <View style={[styles.bucketRow, { paddingHorizontal: gutter }]}>
          <SegmentedButtons
            options={BUCKETS}
            value={activeBucket}
            onChange={setActiveBucket}
            accessibilityLabel="Release window"
            dense
            style={styles.flexOne}
          />
          <Chip
            label="Series"
            variant="filter"
            selected={showSeries}
            onPress={() => {
              setShowSeries(!showSeries);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            accessibilityHint={
              showSeries ? 'Hides TV series from the list' : 'Includes TV series in the list'
            }
          />
        </View>
      )}

      {/* List */}
      {searchQuery.trim() ? (
        isApiSearching ? (
          <Loading label="Searching upcoming releases" size="large" style={styles.topSpaced} />
        ) : (
          <FlatList
            style={styles.flexOne}
            data={apiSearchResults.filter((m) => showSeries || m.mediaType !== 'tv')}
            renderItem={renderUpcomingItem}
            keyExtractor={(item) => `upcoming-search-${item.mediaType || 'movie'}-${item.id}`}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={listContentStyle}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <EmptyState
                icon="search-outline"
                title="Nothing found"
                subtitle="Try a different title or search term."
                compact
              />
            }
          />
        )
      ) : loading && page === 1 ? (
        <Loading label="Loading upcoming releases" size="large" style={styles.topSpaced} />
      ) : (
        <FlatList
          style={styles.flexOne}
          data={filteredMovies}
          renderItem={renderUpcomingItem}
          keyExtractor={(item) => `upcoming-${item.mediaType || 'movie'}-${item.id}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentStyle}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surfaceContainerHigh}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <Loading label="Loading more releases" /> : null}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Nothing scheduled"
              subtitle="Try another time window, or add more languages in your library settings."
              compact
            />
          }
        />
      )}

      {/* Quick actions */}
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
            />
          ) : null}

          <ListItem
            headline={longPressStatus === 'watchlist' ? 'Remove from watchlist' : 'Add to watchlist'}
            leadingIcon={longPressStatus === 'watchlist' ? 'bookmark' : 'bookmark-outline'}
            leadingIconColor={colors.primary}
            onPress={() => handleLongPressAction('watchlist')}
          />

          <ListItem
            headline={longPressStatus === 'not_interested' ? 'Show this again' : 'Not interested'}
            leadingIcon={longPressStatus === 'not_interested' ? 'eye-off' : 'eye-off-outline'}
            leadingIconColor={colors.primary}
            onPress={() => handleLongPressAction('not_interested')}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flexOne: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSpaced: {
    marginTop: spacing.xxl,
  },

  header: {
    paddingBottom: spacing.sm,
  },
  filterSection: {
    paddingBottom: spacing.sm,
  },
  searchNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },

  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    gap: spacing.md,
  },
  poster: {
    width: 68,
    height: 102,
    borderRadius: shape.small,
  },
  premiereBadge: {
    position: 'absolute',
    top: spacing.xxs,
    left: spacing.xxs,
    width: 18,
    height: 18,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The tappable part of the card: poster plus metadata. The action column is
   * deliberately outside it so the two controls never nest.
   */
  cardPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: shape.large,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  /** Fixed-width action column; the buttons stretch to fill it. */
  actionCol: {
    width: 90,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inlineMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
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
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  providerLogo: {
    width: 22,
    height: 22,
    borderRadius: shape.extraSmall,
  },
  sheetList: {
    marginHorizontal: -spacing.xl,
  },
});
