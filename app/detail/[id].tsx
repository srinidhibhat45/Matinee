import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Linking,
  TextInput,
  Animated,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ToastAndroid,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { tmdbService, getImageUrl } from '../../services/tmdb';
import {
  getItem,
  addItem,
  addRating,
  getRating as dbGetRating,
  deleteItem,
  addEpisodeRating,
  getEpisodeRatings,
  deleteEpisodeRating,
  updateItem,
} from '../../services/database';
import { calendarService } from '../../services/calendar';
import { notificationService } from '../../services/notifications';
import CarouselSection from '../../components/CarouselSection';
import { getGenreName } from '../../constants/genres';
import type { MediaType, CastMember, EpisodeRating } from '../../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MOOD_EMOJIS = [
  { emoji: '🤯', label: 'Mind-blown' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '😍', label: 'Loved it' },
  { emoji: '😢', label: 'Emotional' },
  { emoji: '😴', label: 'Boring' },
  { emoji: '💀', label: 'Dead' },
  { emoji: '😂', label: 'Hilarious' },
  { emoji: '🤔', label: 'Thought-provoking' },
  { emoji: '😱', label: 'Scary' },
  { emoji: '🥱', label: 'Meh' },
];

const DETAIL_CATEGORIES = [
  { key: 'plot', label: 'Plot & Story', icon: 'book-outline' as const },
  { key: 'acting', label: 'Acting', icon: 'people-outline' as const },
  { key: 'visuals', label: 'Visuals', icon: 'eye-outline' as const },
  { key: 'soundtrack', label: 'Soundtrack', icon: 'musical-notes-outline' as const },
  { key: 'rewatchability', label: 'Rewatchability', icon: 'refresh-outline' as const },
];

const formatEpisodeAirDate = (dateStr: string | null) => {
  if (!dateStr) return 'TBA';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

const isEpFuture = (dateStr: string | null) => {
  if (!dateStr) return true;
  const todayStr = new Date().toISOString().split('T')[0];
  return dateStr > todayStr;
};

function SimpleStarRow({
  rating,
  onRate,
  size = 24,
}: {
  rating: number;
  onRate: (r: number) => void;
  size?: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
        <TouchableOpacity
          key={val}
          onPress={() => {
            onRate(rating === val ? 0 : val);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={val <= rating ? 'star' : 'star-outline'}
            size={size}
            color={val <= rating ? colors.accent : colors.border}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function DetailedStarRow({
  value,
  onChange,
  label,
  icon,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  icon: string;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.ratingSliderContainer}>
      <View style={styles.ratingSliderHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={icon as any} size={16} color={colors.secondary} />
          <Text style={[styles.ratingSliderLabel, { color: colors.secondary }]}>{label}</Text>
        </View>
        <Text style={[styles.ratingSliderValue, { color: colors.muted }, value !== null && value > 0 && { color: colors.accent }]}>
          {value !== null && value > 0 ? value : '—'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
          <TouchableOpacity
            key={val}
            onPress={() => {
              onChange(value === val ? null : val);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons
              name={value !== null && val <= value ? 'star' : 'star-outline'}
              size={20}
              color={value !== null && val <= value ? colors.accent : colors.border}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function DetailScreen() {
  const { id, mediaType: mt, autoRate, reason } = useLocalSearchParams<{ id: string; mediaType: string; autoRate?: string; reason?: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const mediaType = (mt || 'movie') as MediaType;
  const tmdbId = Number(id);

  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const isUnreleased = details?.releaseDate ? new Date(details.releaseDate) > new Date() : false;
  const [itemStatus, setItemStatus] = useState<string | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);

  // Bottom Sheet and Inline Rating States
  const [isRatingMode, setIsRatingMode] = useState(false);
  const [overallRating, setOverallRating] = useState(0);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [showDetailedRatings, setShowDetailedRatings] = useState(false);
  const [plotRating, setPlotRating] = useState<number | null>(null);
  const [actingRating, setActingRating] = useState<number | null>(null);
  const [visualsRating, setVisualsRating] = useState<number | null>(null);
  const [soundtrackRating, setSoundtrackRating] = useState<number | null>(null);
  const [rewatchability, setRewatchability] = useState<number | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  const today = new Date();
  const [watchDay, setWatchDay] = useState(String(today.getDate()).padStart(2, '0'));
  const [watchMonth, setWatchMonth] = useState(String(today.getMonth() + 1).padStart(2, '0'));
  const [watchYear, setWatchYear] = useState(String(today.getFullYear()));

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const [keyboardAvoidingEnabled, setKeyboardAvoidingEnabled] = useState(false);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start(({ finished }) => {
      if (finished) {
        setKeyboardAvoidingEnabled(true);
      }
    });
  }, []);

  const handleClose = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    });
  }, [router, slideAnim]);

  const resetRatingForm = useCallback(() => {
    setOverallRating(0);
    setSelectedMood(null);
    setShowDetailedRatings(false);
    setPlotRating(null);
    setActingRating(null);
    setVisualsRating(null);
    setSoundtrackRating(null);
    setRewatchability(null);
    setReviewText('');
    setDateError(null);
    const d = new Date();
    setWatchDay(String(d.getDate()).padStart(2, '0'));
    setWatchMonth(String(d.getMonth() + 1).padStart(2, '0'));
    setWatchYear(String(d.getFullYear()));
  }, []);

  const handleSetToday = useCallback(() => {
    const d = new Date();
    setWatchDay(String(d.getDate()).padStart(2, '0'));
    setWatchMonth(String(d.getMonth() + 1).padStart(2, '0'));
    setWatchYear(String(d.getFullYear()));
    setDateError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSetYesterday = useCallback(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    setWatchDay(String(d.getDate()).padStart(2, '0'));
    setWatchMonth(String(d.getMonth() + 1).padStart(2, '0'));
    setWatchYear(String(d.getFullYear()));
    setDateError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  useEffect(() => {
    setDateError(null);
  }, [watchDay, watchMonth, watchYear]);

  // Episode ratings states
  const [episodeRatings, setEpisodeRatings] = useState<EpisodeRating[]>([]);
  const [seasonInput, setSeasonInput] = useState('1');
  const [episodeInput, setEpisodeInput] = useState('1');
  const [episodeRatingInput, setEpisodeRatingInput] = useState(8.0);
  const [episodeReviewInput, setEpisodeReviewInput] = useState('');
  const [isLoggingEpisode, setIsLoggingEpisode] = useState(false);

  // Seasons & Episodes states
  const [activeSeasonNumber, setActiveSeasonNumber] = useState<number | null>(null);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Record<number, any[]>>({});
  const [episodesLoading, setEpisodesLoading] = useState(false);

  const hasAutoRated = React.useRef(false);
  useEffect(() => {
    if (details && autoRate === 'true' && !hasAutoRated.current) {
      hasAutoRated.current = true;
      setIsRatingMode(true);
    }
  }, [details, autoRate]);

  const isLogEpisodeDisabled = isLoggingEpisode || !seasonInput.trim() || !episodeInput.trim() || isNaN(parseInt(seasonInput, 10)) || isNaN(parseInt(episodeInput, 10));

  const fetchDetails = useCallback(async () => {
    try {
      const data = await tmdbService.getDetails(tmdbId, mediaType);
      setDetails(data);

      // Check if user has this in their library
      const existing = await getItem(tmdbId);
      if (existing) {
        setItemStatus(existing.status);
        const rating = await dbGetRating(existing.id);
        if (rating) setUserRating(rating.overallRating);

        // Fetch episode ratings if it's a TV show
        if (mediaType === 'tv') {
          const epRatings = await getEpisodeRatings(existing.id);
          setEpisodeRatings(epRatings);
        }
      }

      // Initialize active season number
      if (mediaType === 'tv' && data?.seasons && data.seasons.length > 0) {
        const regularSeasons = data.seasons.filter((s: any) => s.season_number > 0);
        if (regularSeasons.length > 0) {
          setActiveSeasonNumber(regularSeasons[0].season_number);
        } else {
          setActiveSeasonNumber(data.seasons[0].season_number);
        }
      }
    } catch (err) {
      console.error('Detail fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [tmdbId, mediaType]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Lazily load episodes when activeSeasonNumber changes
  useEffect(() => {
    if (mediaType !== 'tv' || activeSeasonNumber === null) return;
    if (seasonEpisodes[activeSeasonNumber]) return;

    let isMounted = true;
    const loadSeasonEpisodes = async () => {
      try {
        setEpisodesLoading(true);
        const data = await tmdbService.getTVSeason(tmdbId, activeSeasonNumber);
        if (isMounted && data?.episodes) {
          setSeasonEpisodes((prev) => ({
            ...prev,
            [activeSeasonNumber]: data.episodes,
          }));
        }
      } catch (err) {
        console.error('Failed to load season episodes:', err);
      } finally {
        if (isMounted) {
          setEpisodesLoading(false);
        }
      }
    };

    loadSeasonEpisodes();
    return () => {
      isMounted = false;
    };
  }, [tmdbId, mediaType, activeSeasonNumber]);

  const handleAction = useCallback(
    async (status: 'watched' | 'watchlist' | 'interested' | 'not_interested') => {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (itemStatus === status) {
          // Unbookmark: delete the item from the DB
          const existing = await getItem(tmdbId);
          if (existing) {
            await deleteItem(existing.id);
          }
          setItemStatus(null);
          setUserRating(null);
          setEpisodeRatings([]);
          return;
        }

        await addItem({
          tmdbId: details.id,
          mediaType,
          title: details.title,
          posterPath: details.posterPath,
          backdropPath: details.backdropPath,
          overview: details.overview,
          releaseDate: details.releaseDate,
          genres: JSON.stringify(details.genreIds || details.genres?.map((g: any) => g.id) || []),
          originalLanguage: details.originalLanguage,
          runtime: details.runtime || 0,
          voteAverage: details.voteAverage,
          status,
          watchedDate: status === 'watched' ? new Date().toISOString().split('T')[0] : null,
        });

        setItemStatus(status);

        // Save directors and actors for recommendation engine
        if (status !== 'not_interested' && details.credits) {
          const { saveDirectorsActors } = require('../../services/database');
          const existing = await getItem(tmdbId);
          if (existing) {
            const people: any[] = [];
            const directors = details.credits.crew?.filter(
              (c: any) => c.job === 'Director'
            ) || [];
            const topActors = details.credits.cast?.slice(0, 5) || [];

            directors.forEach((d: any) => {
              people.push({
                itemId: existing.id,
                personId: d.id,
                personName: d.name,
                role: 'director',
                profilePath: d.profile_path,
              });
            });
            topActors.forEach((a: any) => {
              people.push({
                itemId: existing.id,
                personId: a.id,
                personName: a.name,
                role: 'actor',
                profilePath: a.profile_path,
              });
            });

            if (people.length > 0) {
              await saveDirectorsActors(existing.id, people);
            }
          }
        }

        if (status === 'watched') {
          setIsRatingMode(true);
        }

        if (status === 'interested' && details.releaseDate) {
          await notificationService.scheduleReleaseReminder(
            details.title,
            details.releaseDate,
            tmdbId,
            mediaType
          );
        }
      } catch (err) {
        console.error('Action error:', err);
      }
    },
    [details, mediaType, tmdbId, itemStatus]
  );

  const handleLogEpisode = useCallback(async () => {
    try {
      if (!seasonInput.trim() || !episodeInput.trim()) return;
      const seasonNum = parseInt(seasonInput, 10);
      const epNum = parseInt(episodeInput, 10);
      if (isNaN(seasonNum) || isNaN(epNum)) return;

      // Ensure item is in database
      let existing = await getItem(tmdbId);
      if (!existing) {
        await addItem({
          tmdbId: details.id,
          mediaType,
          title: details.title,
          posterPath: details.posterPath,
          backdropPath: details.backdropPath,
          overview: details.overview,
          releaseDate: details.releaseDate,
          genres: JSON.stringify(details.genreIds || details.genres?.map((g: any) => g.id) || []),
          originalLanguage: details.originalLanguage,
          runtime: details.runtime || 0,
          voteAverage: details.voteAverage,
          status: 'watched',
          watchedDate: new Date().toISOString().split('T')[0],
        });
        setItemStatus('watched');
        existing = await getItem(tmdbId);
      }

      if (existing) {
        setIsLoggingEpisode(true);
        await addEpisodeRating({
          itemId: existing.id,
          seasonNumber: seasonNum,
          episodeNumber: epNum,
          rating: episodeRatingInput,
          reviewText: episodeReviewInput.trim() || null,
        });

        // Increment episode number for convenience
        setEpisodeInput((prev) => {
          const next = parseInt(prev, 10) + 1;
          return isNaN(next) ? '1' : String(next);
        });
        setEpisodeReviewInput('');

        // Refresh episode ratings
        const epRatings = await getEpisodeRatings(existing.id);
        setEpisodeRatings(epRatings);
      }
    } catch (err) {
      console.error('Log episode error:', err);
    } finally {
      setIsLoggingEpisode(false);
    }
  }, [tmdbId, mediaType, details, seasonInput, episodeInput, episodeRatingInput, episodeReviewInput]);

  const handleDeleteEpisodeRating = useCallback(async (epRatingId: number) => {
    try {
      await deleteEpisodeRating(epRatingId);
      const existing = await getItem(tmdbId);
      if (existing) {
        const epRatings = await getEpisodeRatings(existing.id);
        setEpisodeRatings(epRatings);
      }
    } catch (err) {
      console.error('Delete episode rating error:', err);
    }
  }, [tmdbId]);

  const handleInlineRatingSubmit = useCallback(async () => {
    if (overallRating === 0) return;

    const day = watchDay.trim().padStart(2, '0');
    const month = watchMonth.trim().padStart(2, '0');
    const year = watchYear.trim();
    let watchedDateStr = `${year}-${month}-${day}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(watchedDateStr) || isNaN(Date.parse(watchedDateStr))) {
      setDateError('Please enter a valid date.');
      return;
    }

    if (details?.releaseDate && !isNaN(Date.parse(details.releaseDate))) {
      const watched = new Date(watchedDateStr);
      const released = new Date(details.releaseDate);
      watched.setHours(0, 0, 0, 0);
      released.setHours(0, 0, 0, 0);

      if (watched < released) {
        let formattedReleaseDate = details.releaseDate;
        try {
          const releasedObj = new Date(details.releaseDate);
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          formattedReleaseDate = `${months[releasedObj.getMonth()]} ${releasedObj.getDate()}, ${releasedObj.getFullYear()}`;
        } catch {}
        setDateError(`Watched date cannot be before the release date (${formattedReleaseDate}).`);
        return;
      }
    }

    setDateError(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      let existing = await getItem(tmdbId);
      if (!existing) {
        await addItem({
          tmdbId: details.id,
          mediaType,
          title: details.title,
          posterPath: details.posterPath,
          backdropPath: details.backdropPath,
          overview: details.overview,
          releaseDate: details.releaseDate,
          genres: JSON.stringify(details.genreIds || details.genres?.map((g: any) => g.id) || []),
          originalLanguage: details.originalLanguage,
          runtime: details.runtime || 0,
          voteAverage: details.voteAverage,
          status: 'watched',
          watchedDate: watchedDateStr,
        });
        existing = await getItem(tmdbId);
      } else {
        await updateItem(existing.id, {
          status: 'watched',
          watchedDate: watchedDateStr,
        });
      }

      if (existing) {
        await addRating({
          itemId: existing.id,
          overallRating,
          plotRating,
          actingRating,
          visualsRating,
          soundtrackRating,
          rewatchability,
          moodEmoji: selectedMood,
          reviewText: reviewText.trim() || null,
        });
        setItemStatus('watched');
        setUserRating(overallRating);
        if (Platform.OS === 'android') {
          ToastAndroid.show('Rating saved successfully! 🍿', ToastAndroid.SHORT);
        }
      }
    } catch (err) {
      console.error('Rating error:', err);
    }

    setIsRatingMode(false);
  }, [overallRating, plotRating, actingRating, visualsRating, soundtrackRating, rewatchability, selectedMood, reviewText, watchDay, watchMonth, watchYear, details, tmdbId, mediaType]);

  const handleCalendar = useCallback(async () => {
    if (!details) return;
    const genres = (details.genres || []).map((g: any) => g.name).join(', ');
    await calendarService.addToCalendar(
      details.title,
      details.releaseDate,
      details.overview,
      genres
    );
  }, [details]);

  const handleItemPress = useCallback(
    (item: any) => {
      router.push({
        pathname: '/detail/[id]',
        params: { id: item.id, mediaType: item.mediaType || 'movie' },
      });
    },
    [router]
  );

  const openTrailer = useCallback(() => {
    if (!details?.videos) return;
    const trailer = details.videos.find(
      (v: any) => v.type === 'Trailer' && v.site === 'YouTube'
    ) || details.videos[0];
    if (trailer) {
      Linking.openURL(`https://www.youtube.com/watch?v=${trailer.key}`);
    }
  }, [details]);

  if (loading) {
    return (
      <View style={styles.overlayContainer}>
        <Pressable style={styles.modalBackdrop} onPress={handleClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bg,
              transform: [{ translateY: slideAnim }],
              paddingBottom: insets.bottom || 16,
              justifyContent: 'center',
              alignItems: 'center',
            },
          ]}
        >
          <ActivityIndicator size="large" color={colors.accent} />
        </Animated.View>
      </View>
    );
  }

  if (!details) {
    return (
      <View style={styles.overlayContainer}>
        <Pressable style={styles.modalBackdrop} onPress={handleClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bg,
              transform: [{ translateY: slideAnim }],
              paddingBottom: insets.bottom || 16,
              justifyContent: 'center',
              alignItems: 'center',
            },
          ]}
        >
          <Text style={[styles.errorText, { color: colors.secondary, marginTop: 0 }]}>Failed to load details</Text>
          <TouchableOpacity onPress={handleClose} style={[styles.ratingCancelBtn, { borderColor: colors.border, marginTop: 16, maxWidth: 120 }]}>
            <Text style={{ color: colors.text }}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  const directors = details.director ? [{ name: details.director, job: 'Director' }] : (details.crew?.filter((c: any) => c.job === 'Director') || []);
  const cast: CastMember[] = details.cast?.slice(0, 15) || [];
  const genres = details.genres || details.genreIds?.map((id: number) => ({
    id,
    name: getGenreName(id, mediaType),
  })) || [];

  const tvSeasons = details.seasons
    ? [...details.seasons].sort((a: any, b: any) => a.season_number - b.season_number)
    : [];
  const episodes = activeSeasonNumber !== null ? seasonEpisodes[activeSeasonNumber] : null;

  const providers = [
    ...(details.watchProviders?.flatrate || []),
    ...(details.watchProviders?.buy || []).filter(
      (b: any) => !(details.watchProviders?.flatrate || []).some((f: any) => f.provider_id === b.provider_id)
    ),
  ].slice(0, 5);
  const hasTrailer = details.videos?.some(
    (v: any) => v.type === 'Trailer' && v.site === 'YouTube'
  );
  const releaseYear = details.releaseDate?.split('-')[0] || '';
  const isUpcoming = details.releaseDate && new Date(details.releaseDate) > new Date();
  const formattedReleaseDate = details.releaseDate
    ? new Date(details.releaseDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  const runtimeStr = details.runtime
    ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m`
    : '';

  // Compute preset statuses
  const currentTodayDate = new Date();
  const isTodaySelected = 
    watchDay === String(currentTodayDate.getDate()).padStart(2, '0') &&
    watchMonth === String(currentTodayDate.getMonth() + 1).padStart(2, '0') &&
    watchYear === String(currentTodayDate.getFullYear());

  const currentYesterdayDate = new Date();
  currentYesterdayDate.setDate(currentYesterdayDate.getDate() - 1);
  const isYesterdaySelected = 
    watchDay === String(currentYesterdayDate.getDate()).padStart(2, '0') &&
    watchMonth === String(currentYesterdayDate.getMonth() + 1).padStart(2, '0') &&
    watchYear === String(currentYesterdayDate.getFullYear());

  const getRatingLabel = (rating: number): string => {
    if (rating === 0) return 'Tap to rate';
    if (rating <= 2) return 'Terrible';
    if (rating <= 4) return 'Meh';
    if (rating <= 5) return 'Average';
    if (rating <= 6) return 'Decent';
    if (rating <= 7) return 'Good';
    if (rating <= 8) return 'Great';
    if (rating <= 9) return 'Amazing';
    return 'Masterpiece';
  };

  const detailSetters: Record<string, (v: number | null) => void> = {
    plot: setPlotRating,
    acting: setActingRating,
    visuals: setVisualsRating,
    soundtrack: setSoundtrackRating,
    rewatchability: setRewatchability,
  };

  const detailValues: Record<string, number | null> = {
    plot: plotRating,
    acting: actingRating,
    visuals: visualsRating,
    soundtrack: soundtrackRating,
    rewatchability: rewatchability,
  };

  return (
    <View style={styles.overlayContainer}>
      <Pressable style={styles.modalBackdrop} onPress={handleClose} />
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.bg,
            transform: [{ translateY: slideAnim }],
            paddingBottom: insets.bottom || 16,
          },
        ]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          enabled={keyboardAvoidingEnabled}
        >
          <View style={styles.sheetHeaderContainer}>
          <View style={[styles.handleBar, { backgroundColor: colors.border }]} />
        </View>

        {isRatingMode && (
          <TouchableOpacity
            style={styles.ratingBackBtn}
            onPress={() => setIsRatingMode(false)}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
        )}
        {!isRatingMode && (
          <TouchableOpacity
            style={[styles.sheetCloseBtn, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
            onPress={handleClose}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}

        {isRatingMode ? (
          <ScrollView
            key="rating-scroll"
            style={styles.ratingScroll}
            contentContainerStyle={styles.ratingScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.ratingHeader}>
              <Text style={[styles.ratingSheetTitle, { color: colors.secondary }]}>Rate & Log</Text>
              <Text style={[styles.ratingMovieName, { color: colors.text }]} numberOfLines={2}>
                {details.title}
              </Text>
            </View>

            {/* Date Watched Section */}
            <View style={styles.ratingFormSection}>
              <Text style={[styles.ratingSectionTitle, { color: colors.secondary, alignSelf: 'flex-start' }]}>When did you watch it?</Text>
              <View style={styles.ratingDatePresetsRow}>
                <TouchableOpacity
                  style={[
                    styles.ratingDatePresetChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    isTodaySelected && { backgroundColor: colors.accentMuted, borderColor: colors.accent },
                  ]}
                  onPress={handleSetToday}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.ratingDatePresetText, { color: colors.secondary }, isTodaySelected && { color: colors.accent, fontWeight: '600' }]}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.ratingDatePresetChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    isYesterdaySelected && { backgroundColor: colors.accentMuted, borderColor: colors.accent },
                  ]}
                  onPress={handleSetYesterday}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.ratingDatePresetText, { color: colors.secondary }, isYesterdaySelected && { color: colors.accent, fontWeight: '600' }]}>Yesterday</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.ratingDateInputRow}>
                <View style={styles.ratingDateInputContainer}>
                  <Text style={[styles.ratingDateInputLabel, { color: colors.muted }]}>Day</Text>
                  <TextInput
                    style={[styles.ratingDateInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={watchDay}
                    onChangeText={setWatchDay}
                    placeholder="DD"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
                <View style={styles.ratingDateInputContainer}>
                  <Text style={[styles.ratingDateInputLabel, { color: colors.muted }]}>Month</Text>
                  <TextInput
                    style={[styles.ratingDateInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={watchMonth}
                    onChangeText={setWatchMonth}
                    placeholder="MM"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
                <View style={styles.ratingDateInputContainer}>
                  <Text style={[styles.ratingDateInputLabel, { color: colors.muted }]}>Year</Text>
                  <TextInput
                    style={[styles.ratingDateInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={watchYear}
                    onChangeText={setWatchYear}
                    placeholder="YYYY"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                </View>
              </View>
              {dateError && (
                <Text style={[styles.ratingErrorText, { color: '#EF4444' }]}>
                  {dateError}
                </Text>
              )}
            </View>

            {/* Overall Rating */}
            <View style={styles.ratingSection}>
              <View style={styles.ratingDisplay}>
                <Text style={[
                  styles.ratingNumber,
                  { color: colors.muted },
                  overallRating > 0 && { color: colors.accent },
                ]}>
                  {overallRating > 0 ? overallRating : '—'}
                </Text>
                <Text style={[styles.ratingMax, { color: colors.muted }]}>/10</Text>
              </View>
              <Text style={[
                styles.ratingLabel,
                { color: colors.muted },
                overallRating > 0 && { color: colors.text },
              ]}>
                {getRatingLabel(overallRating)}
              </Text>

              <SimpleStarRow
                rating={overallRating}
                onRate={setOverallRating}
                size={28}
              />
            </View>

            {/* Mood Emoji */}
            <View style={styles.ratingFormSection}>
              <Text style={[styles.ratingSectionTitle, { color: colors.secondary, alignSelf: 'flex-start' }]}>How did it make you feel?</Text>
              <View style={styles.ratingMoodGrid}>
                {MOOD_EMOJIS.map(({ emoji, label }) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.ratingMoodChip,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      selectedMood === emoji && { backgroundColor: colors.accentMuted, borderColor: colors.accent },
                    ]}
                    onPress={() => {
                      setSelectedMood(selectedMood === emoji ? null : emoji);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.ratingMoodEmoji}>{emoji}</Text>
                    <Text style={[
                      styles.ratingMoodLabel,
                      { color: colors.secondary },
                      selectedMood === emoji && { color: colors.accent },
                    ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Detail Ratings (collapsible) */}
            <TouchableOpacity
              style={styles.ratingDetailToggle}
              onPress={() => {
                setShowDetailedRatings(!showDetailedRatings);
                Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.ratingDetailToggleText, { color: colors.accent }]}>
                {showDetailedRatings ? 'Hide detailed ratings' : 'Rate in detail (optional)'}
              </Text>
              <Ionicons
                name={showDetailedRatings ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.accent}
              />
            </TouchableOpacity>

            {showDetailedRatings && (
              <View style={styles.ratingDetailSection}>
                {DETAIL_CATEGORIES.map(({ key, label, icon }) => (
                  <DetailedStarRow
                    key={key}
                    value={detailValues[key]}
                    onChange={(v) => detailSetters[key](v)}
                    label={label}
                    icon={icon}
                  />
                ))}
              </View>
            )}

            {/* Quick Review */}
            <View style={styles.ratingFormSection}>
              <Text style={[styles.ratingSectionTitle, { color: colors.secondary, alignSelf: 'flex-start' }]}>Quick thoughts (optional)</Text>
              <TextInput
                style={[styles.ratingReviewInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, width: '100%' }]}
                placeholder="One-liner about this movie..."
                placeholderTextColor={colors.muted}
                value={reviewText}
                onChangeText={setReviewText}
                maxLength={200}
                multiline
                numberOfLines={2}
              />
              <Text style={[styles.ratingCharCount, { color: colors.muted, alignSelf: 'flex-end' }]}>{reviewText.length}/200</Text>
            </View>

            {/* Submit & Cancel Buttons */}
            <View style={styles.ratingButtonRow}>
              <TouchableOpacity
                style={[styles.ratingCancelBtn, { borderColor: colors.border }]}
                onPress={() => setIsRatingMode(false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.ratingCancelText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.ratingSubmitBtn,
                  { backgroundColor: colors.accent },
                  overallRating === 0 && { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: 0.25 },
                ]}
                onPress={handleInlineRatingSubmit}
                disabled={overallRating === 0}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-circle" size={22} color={overallRating > 0 ? colors.bg : colors.muted} />
                <Text style={[
                  styles.ratingSubmitText,
                  { color: colors.bg },
                  overallRating === 0 && { color: colors.muted },
                ]}>
                  Log & Rate
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <ScrollView key="detail-scroll" showsVerticalScrollIndicator={false}>
        <View style={styles.backdropContainer}>
          {details.backdropPath ? (
            <Image
              source={{ uri: getImageUrl(details.backdropPath, 'w1280') || "" }}
              style={styles.backdrop}
            />
          ) : details.posterPath ? (
            <Image
              source={{ uri: getImageUrl(details.posterPath, 'w500') || "" }}
              style={styles.backdrop}
              blurRadius={15}
            />
          ) : (
            <View style={[styles.backdrop, styles.backdropPlaceholder, { backgroundColor: colors.card }]}>
              <Ionicons name="film" size={48} color={colors.accent} style={{ opacity: 0.8 }} />
              <Text style={[styles.placeholderText, { color: colors.secondary }]}>Matinee Preview</Text>
            </View>
          )}
          <View style={styles.backdropGradient} />
        </View>

        {/* Main Info */}
        <View style={styles.mainInfo}>
          <View style={styles.posterRow}>
            {!!details.posterPath && (
              <Image
                source={{ uri: getImageUrl(details.posterPath, 'w342') || "" }}
                style={[styles.poster, { backgroundColor: colors.card }]}
              />
            )}
            <View style={styles.titleArea}>
              <Text style={[styles.title, { color: colors.text }]}>{details.title}</Text>
              <View style={styles.metaRow}>
                {formattedReleaseDate ? (
                  <Text style={[styles.metaText, { color: isUpcoming ? colors.accent : colors.secondary, fontWeight: isUpcoming ? '600' : '400' }]}>
                    {isUpcoming ? `Releases: ${formattedReleaseDate}` : formattedReleaseDate}
                  </Text>
                ) : null}
                {details.certification ? (
                  <>
                    <Text style={[styles.metaDot, { color: colors.muted }]}>·</Text>
                    <View style={[styles.certBadge, { borderColor: colors.border }]}>
                      <Text style={[styles.certBadgeText, { color: colors.secondary }]}>
                        {details.certification}
                      </Text>
                    </View>
                  </>
                ) : null}
                {runtimeStr ? (
                  <>
                    <Text style={[styles.metaDot, { color: colors.muted }]}>·</Text>
                    <Text style={[styles.metaText, { color: colors.secondary }]}>{runtimeStr}</Text>
                  </>
                ) : null}
              </View>

              {/* TMDB Rating */}
              <View style={styles.tmdbRating}>
                <Ionicons name="star" size={14} color={colors.accent} />
                <Text style={[styles.tmdbRatingText, { color: colors.accent }]}>
                  {details.voteAverage?.toFixed(1) || '—'}
                </Text>
                <Text style={[styles.tmdbVotes, { color: colors.muted }]}>
                  ({(details.voteCount || 0).toLocaleString()})
                </Text>
              </View>

              {/* User Rating */}
              {!!userRating && (
                <View style={[styles.userRatingBadge, { backgroundColor: colors.accentMuted }]}>
                  <Text style={[styles.userRatingText, { color: colors.accent }]}>Your: {userRating}/10</Text>
                </View>
              )}

              {/* Watch Providers */}
              {providers.length > 0 && (
                <View style={styles.providersRow}>
                  <Text style={[styles.providersLabel, { color: colors.secondary }]}>Stream:</Text>
                  <View style={styles.providersList}>
                    {providers.map((p: any) => (
                      <Image
                        key={p.provider_id}
                        source={{ uri: getImageUrl(p.logo_path, 'w92') || "" }}
                        style={styles.providerLogo}
                        accessibilityLabel={p.provider_name}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Genre Tags */}
          <View style={styles.genreTags}>
            {genres.slice(0, 4).map((g: any) => (
              <View key={g.id} style={[styles.genreTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.genreTagText, { color: colors.secondary }]}>{g.name}</Text>
              </View>
            ))}
            <View style={[styles.mediaTag, { backgroundColor: colors.accentMuted }]}>
              <Text style={[styles.mediaTagText, { color: colors.accent }]}>
                {mediaType === 'tv' ? 'Series' : 'Movie'}
              </Text>
            </View>
          </View>

          {/* Tagline */}
          {details.tagline ? (
            <Text style={[styles.tagline, { color: colors.secondary }]}>"{details.tagline}"</Text>
          ) : null}
        </View>

        {reason ? (
          <View style={[styles.insightBanner, { backgroundColor: colors.accentMuted, borderColor: colors.accent + '22' }]}>
            <Ionicons name="sparkles-outline" size={13} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={[styles.insightText, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
              {reason}
            </Text>
          </View>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          {!isUnreleased && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                itemStatus === 'watched' && { borderColor: colors.accent, backgroundColor: colors.accentMuted },
              ]}
              onPress={() => handleAction('watched')}
            >
              <Ionicons
                name={itemStatus === 'watched' ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={20}
                color={itemStatus === 'watched' ? colors.accent : colors.text}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  { color: colors.text },
                  itemStatus === 'watched' && { color: colors.accent },
                ]}
              >
                Watched
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              itemStatus === 'watchlist' && { borderColor: colors.accent, backgroundColor: colors.accentMuted },
            ]}
            onPress={() => handleAction('watchlist')}
          >
            <Ionicons
              name={itemStatus === 'watchlist' ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={itemStatus === 'watchlist' ? colors.accent : colors.text}
            />
            <Text
              style={[
                styles.actionButtonText,
                { color: colors.text },
                itemStatus === 'watchlist' && { color: colors.accent },
              ]}
            >
              Watchlist
            </Text>
          </TouchableOpacity>

          {!isUnreleased && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setIsRatingMode(true)}
            >
              <Ionicons name="star-outline" size={20} color={colors.accent} />
              <Text style={[styles.actionButtonText, { color: colors.text }]}>Rate</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Media & Links Row */}
        <View style={[styles.actionRow, { marginTop: 8 }]}>
          {hasTrailer && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={openTrailer}
            >
              <Ionicons name="logo-youtube" size={20} color="#FF0000" />
              <Text style={[styles.actionButtonText, { color: colors.text }]}>Trailer</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {
              const query = encodeURIComponent(`${details.title} ${mediaType === 'tv' ? 'soundtrack' : 'OST album'}`);
              Linking.openURL(`https://music.youtube.com/search?q=${query}`);
            }}
          >
            <Ionicons name="musical-notes" size={20} color="#FF0000" />
            <Text style={[styles.actionButtonText, { color: colors.text }]}>Soundtrack</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              itemStatus === 'not_interested' && { borderColor: colors.accent, backgroundColor: colors.accentMuted },
            ]}
            onPress={() => handleAction('not_interested')}
            activeOpacity={0.7}
          >
            <Ionicons
              name={itemStatus === 'not_interested' ? 'eye-off' : 'eye-off-outline'}
              size={20}
              color={itemStatus === 'not_interested' ? colors.accent : colors.text}
            />
            <Text
              style={[
                styles.actionButtonText,
                { color: colors.text },
                itemStatus === 'not_interested' && { color: colors.accent },
              ]}
            >
              No Interest
            </Text>
          </TouchableOpacity>
        </View>

        {/* Calendar Button for upcoming */}
        {!!(details.releaseDate && new Date(details.releaseDate) > new Date()) && (
          <TouchableOpacity
            style={[styles.calendarRow, { backgroundColor: colors.accentMuted, borderColor: colors.accent }]}
            onPress={handleCalendar}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={[styles.calendarText, { color: colors.accent }]}>Add release to calendar</Text>
          </TouchableOpacity>
        )}

        {/* Detailed Stats Grid */}
        <View style={styles.statsGrid}>
          {directors.length > 0 ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Director</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {directors.map((d: any) => d.name).join(', ')}
              </Text>
            </View>
          ) : null}
          {cast.length > 0 ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Starring</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {cast.slice(0, 3).map((c) => c.name).join(', ')}
              </Text>
            </View>
          ) : null}
          {details.status ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Status</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {details.status}
              </Text>
            </View>
          ) : null}
          {details.originalLanguage ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Language</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {details.originalLanguage.toUpperCase()}
              </Text>
            </View>
          ) : null}
          {mediaType === 'movie' && details.budget ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Budget</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                ${(details.budget / 1000000).toFixed(1)}M
              </Text>
            </View>
          ) : null}
          {mediaType === 'movie' && details.revenue ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Revenue</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                ${(details.revenue / 1000000).toFixed(1)}M
              </Text>
            </View>
          ) : null}
          {mediaType === 'tv' && details.numberOfSeasons ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Seasons</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {details.numberOfSeasons}
              </Text>
            </View>
          ) : null}
          {mediaType === 'tv' && details.numberOfEpisodes ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Episodes</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {details.numberOfEpisodes}
              </Text>
            </View>
          ) : null}
          {details.popularity ? (
            <View style={[styles.statGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statGridLabel, { color: colors.muted }]}>Popularity Rank</Text>
              <Text style={[styles.statGridValue, { color: colors.text }]} numberOfLines={1}>
                {Math.round(details.popularity).toLocaleString()}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Overview */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Overview</Text>
          <Text style={[styles.overview, { color: colors.secondary }]}>{details.overview || 'No overview available.'}</Text>
        </View>

        {/* Director */}
        {directors.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {directors.length === 1 ? 'Director' : 'Directors'}
            </Text>
            <Text style={[styles.directorText, { color: colors.text }]}>
              {directors.map((d: any) => d.name).join(', ')}
            </Text>
          </View>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Cast</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingLeft: 20, gap: 12 }}
            >
              {cast.map((person) => (
                <View key={person.id} style={styles.castCard}>
                  {person.profile_path ? (
                    <Image
                      source={{
                        uri: `https://image.tmdb.org/t/p/w185${person.profile_path}`,
                      }}
                      style={[styles.castPhoto, { backgroundColor: colors.card }]}
                    />
                  ) : (
                    <View style={[styles.castPhoto, styles.castPlaceholder, { backgroundColor: colors.card }]}>
                      <Ionicons name="person" size={20} color={colors.muted} />
                    </View>
                  )}
                  <Text style={[styles.castName, { color: colors.text }]} numberOfLines={1}>
                    {person.name}
                  </Text>
                  <Text style={[styles.castCharacter, { color: colors.muted }]} numberOfLines={1}>
                    {person.character}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Seasons & Episodes directory for TV Series */}
        {mediaType === 'tv' && tvSeasons.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 12 }]}>Seasons & Episodes</Text>
            
            {/* Season tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
            >
              {tvSeasons.map((season) => {
                const isActive = activeSeasonNumber === season.season_number;
                return (
                  <TouchableOpacity
                    key={season.id}
                    style={[
                      styles.seasonTabBtn,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      isActive && { backgroundColor: colors.accent, borderColor: colors.accent },
                    ]}
                    onPress={() => {
                      setActiveSeasonNumber(season.season_number);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <Text
                      style={[
                        styles.seasonTabText,
                        { color: colors.secondary },
                        isActive && { color: colors.bg, fontWeight: '700' },
                      ]}
                    >
                      {season.name || `Season ${season.season_number}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Episodes List */}
            <View style={[styles.episodesContainer, { marginTop: 12 }]}>
              {episodesLoading ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 24 }} />
              ) : episodes && episodes.length > 0 ? (
                <View style={styles.episodesList}>
                  {episodes.map((ep) => {
                    const isFuture = isEpFuture(ep.air_date);
                    const userEpRating = episodeRatings.find(
                      (r) => r.seasonNumber === activeSeasonNumber && r.episodeNumber === ep.episode_number
                    )?.rating;

                    return (
                      <TouchableOpacity
                        key={ep.id}
                        style={[styles.episodeRow, { borderBottomColor: colors.border }]}
                        activeOpacity={0.7}
                        onPress={() => {
                          if (!isFuture) {
                            setSeasonInput(String(activeSeasonNumber));
                            setEpisodeInput(String(ep.episode_number));
                            if (Platform.OS === 'android') {
                              ToastAndroid.show(`Selected S${activeSeasonNumber} E${ep.episode_number} for logging`, ToastAndroid.SHORT);
                            }
                          }
                        }}
                      >
                        {/* Still Image */}
                        <View style={styles.epStillContainer}>
                          {ep.still_path ? (
                            <Image
                              source={{ uri: getImageUrl(ep.still_path, 'w185') || "" }}
                              style={styles.epStill}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={[styles.epStill, styles.epStillPlaceholder, { backgroundColor: colors.card }]}>
                              <Ionicons name="image-outline" size={20} color={colors.muted} />
                            </View>
                          )}
                          <View style={[styles.epNumberBadge, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
                            <Text style={styles.epNumberText}>Ep {ep.episode_number}</Text>
                          </View>
                        </View>

                        {/* Episode Info */}
                        <View style={styles.epInfo}>
                          <View style={styles.epTitleRow}>
                            <Text style={[styles.epTitle, { color: colors.text }]} numberOfLines={1}>
                              {ep.name || `Episode ${ep.episode_number}`}
                            </Text>
                            {userEpRating !== undefined && (
                              <View style={[styles.epUserRatingBadge, { backgroundColor: colors.accentMuted }]}>
                                <Ionicons name="star" size={10} color={colors.accent} />
                                <Text style={[styles.epUserRatingText, { color: colors.accent }]}>
                                  {userEpRating.toFixed(1)}
                                </Text>
                              </View>
                            )}
                          </View>

                          <Text
                            style={[
                              styles.epAirDate,
                              { color: isFuture ? colors.accent : colors.secondary }
                            ]}
                          >
                            {isFuture ? `Airing: ${formatEpisodeAirDate(ep.air_date)}` : formatEpisodeAirDate(ep.air_date)}
                          </Text>

                          {ep.overview ? (
                            <Text style={[styles.epOverview, { color: colors.muted }]} numberOfLines={2}>
                              {ep.overview}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.emptyEpisodesText, { color: colors.muted }]}>
                  No episodes found for this season.
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Episode Logging Section for TV Series */}
        {mediaType === 'tv' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="tv-outline" size={18} color={colors.accent} />
              <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 6, marginBottom: 0 }]}>
                Log Episodes
              </Text>
            </View>

            {/* Input card */}
            <View style={[styles.episodeLogCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.secondary }]}>Season</Text>
                  <TextInput
                    style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                    value={seasonInput}
                    onChangeText={setSeasonInput}
                    keyboardType="numeric"
                    placeholder="1"
                    placeholderTextColor={colors.muted}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.secondary }]}>Episode</Text>
                  <TextInput
                    style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                    value={episodeInput}
                    onChangeText={setEpisodeInput}
                    keyboardType="numeric"
                    placeholder="1"
                    placeholderTextColor={colors.muted}
                  />
                </View>
              </View>

              {/* Rating Stepper */}
              <View style={styles.ratingStepperContainer}>
                <Text style={[styles.inputLabel, { color: colors.secondary }]}>Rating</Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, { borderColor: colors.border, backgroundColor: colors.bg }]}
                    onPress={() => setEpisodeRatingInput((prev) => Math.max(1, prev - 0.5))}
                  >
                    <Text style={[styles.stepperBtnText, { color: colors.text }]}>-</Text>
                  </TouchableOpacity>
                  <View style={styles.ratingValueBox}>
                    <Text style={[styles.ratingValueText, { color: colors.accent }]}>
                      ★ {episodeRatingInput.toFixed(1)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.stepperBtn, { borderColor: colors.border, backgroundColor: colors.bg }]}
                    onPress={() => setEpisodeRatingInput((prev) => Math.min(10, prev + 0.5))}
                  >
                    <Text style={[styles.stepperBtnText, { color: colors.text }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Episode Review */}
              <View style={styles.reviewInputGroup}>
                <Text style={[styles.inputLabel, { color: colors.secondary }]}>Thoughts (Optional)</Text>
                <TextInput
                  style={[styles.reviewInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                  value={episodeReviewInput}
                  onChangeText={setEpisodeReviewInput}
                  placeholder="What did you think of this episode?"
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={2}
                />
              </View>

              {/* Submit button */}
              <TouchableOpacity
                style={[
                  styles.logEpisodeSubmitBtn,
                  { backgroundColor: colors.accent },
                  isLogEpisodeDisabled && { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: 0.4 },
                ]}
                onPress={handleLogEpisode}
                disabled={isLogEpisodeDisabled}
              >
                {isLoggingEpisode ? (
                  <ActivityIndicator size="small" color={colors.bg} />
                ) : (
                  <Text style={[
                    styles.logEpisodeSubmitText,
                    { color: colors.bg },
                    isLogEpisodeDisabled && { color: colors.muted }
                  ]}>
                    Log Episode
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Logged episodes list */}
            {episodeRatings.length > 0 && (
              <View style={styles.loggedEpisodesListContainer}>
                <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 16 }]}>
                  Logged Episodes ({episodeRatings.length})
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12, paddingVertical: 8 }}
                >
                  {episodeRatings.map((ep) => (
                    <View
                      key={ep.id}
                      style={[styles.loggedEpisodeCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={styles.loggedEpisodeHeader}>
                        <Text style={[styles.loggedEpisodeTitle, { color: colors.text }]}>
                          S{ep.seasonNumber} E{ep.episodeNumber}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleDeleteEpisodeRating(ep.id)}
                          hitSlop={8}
                          style={styles.deleteEpBtn}
                        >
                          <Ionicons name="trash-outline" size={14} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                      <Text style={[styles.loggedEpisodeRating, { color: colors.accent }]}>
                        ★ {ep.rating.toFixed(1)}
                      </Text>
                      {ep.reviewText && (
                        <Text style={[styles.loggedEpisodeReview, { color: colors.secondary }]} numberOfLines={2}>
                          {ep.reviewText}
                        </Text>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {/* Recommendations */}
        {details.recommendations?.results?.length > 0 && (
          <CarouselSection
            title="Recommended"
            items={details.recommendations.results}
            onItemPress={handleItemPress}
            cardSize="medium"
            showRating
          />
        )}

        {/* Similar */}
        {details.similar?.results?.length > 0 && (
          <CarouselSection
            title="Similar"
            items={details.similar.results}
            onItemPress={handleItemPress}
            cardSize="small"
            showRating
          />
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

        )}
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: SCREEN_HEIGHT * 0.9,
    overflow: 'hidden',
  },
  sheetHeaderContainer: {
    width: '100%',
    paddingTop: 12,
    paddingBottom: 4,
    zIndex: 11,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  sheetCloseBtn: {
    position: 'absolute',
    top: 18,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  ratingBackBtn: {
    position: 'absolute',
    top: 18,
    left: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  ratingScroll: {
    flex: 1,
  },
  ratingScrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  ratingHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
  },
  ratingSheetTitle: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  ratingMovieName: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  ratingDatePresetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  ratingDatePresetChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  ratingDatePresetText: {
    fontSize: 13,
  },
  ratingDateInputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  ratingDateInputContainer: {
    flex: 1,
    gap: 6,
  },
  ratingDateInputLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  ratingDateInput: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  ratingSection: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  ratingFormSection: {
    paddingVertical: 16,
    alignSelf: 'stretch',
  },
  ratingDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  ratingNumber: {
    fontSize: 56,
    fontWeight: '800',
  },
  ratingMax: {
    fontSize: 20,
    fontWeight: '500',
    marginLeft: 2,
  },
  ratingLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  ratingSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  ratingMoodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratingMoodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  ratingMoodEmoji: {
    fontSize: 18,
  },
  ratingMoodLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  ratingDetailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  ratingDetailToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  ratingDetailSection: {
    gap: 16,
    paddingBottom: 8,
  },
  ratingSliderContainer: {
    gap: 8,
  },
  ratingSliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ratingSliderLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  ratingSliderValue: {
    fontSize: 16,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'right',
  },
  ratingReviewInput: {
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  ratingCharCount: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  ratingButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  ratingCancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
  },
  ratingCancelText: {
    fontSize: 17,
    fontWeight: '700',
  },
  ratingSubmitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  ratingSubmitText: {
    fontSize: 17,
    fontWeight: '700',
  },
  ratingErrorText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
    textAlign: 'center',
  },
  backdropContainer: {
    height: 220,
    position: 'relative',
  },
  backdrop: {
    width: '100%',
    height: '100%',
  },
  backdropGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainInfo: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  providersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  providersLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  providersList: {
    flexDirection: 'row',
    gap: 6,
  },
  providerLogo: {
    width: 26,
    height: 26,
    borderRadius: 6,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    gap: 12,
  },
  statGridItem: {
    width: '47%',
    borderRadius: 10,
    padding: 10,
    borderWidth: 0.5,
  },
  statGridLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statGridValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  posterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  poster: {
    width: 110,
    height: 165,
    borderRadius: 12,
    marginTop: -56,
  },
  titleArea: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 4,
    paddingBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  metaText: {
    fontSize: 13,
  },
  metaDot: {
    fontSize: 13,
  },
  certBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  certBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  tmdbRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  tmdbRatingText: {
    fontSize: 15,
    fontWeight: '700',
  },
  tmdbVotes: {
    fontSize: 12,
  },
  userRatingBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  userRatingText: {
    fontSize: 12,
    fontWeight: '700',
  },
  genreTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  genreTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  genreTagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  mediaTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  mediaTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tagline: {
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 12,
  },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 20,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 0.5,
    gap: 4,
  },
  actionButtonActive: {},
  actionButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 0.5,
    gap: 6,
  },
  calendarText: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  overview: {
    fontSize: 14,
    lineHeight: 22,
  },
  directorText: {
    fontSize: 15,
    fontWeight: '500',
  },
  castCard: {
    width: 80,
    alignItems: 'center',
  },
  castPhoto: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  castPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  castName: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  castCharacter: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  episodeLogCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  smallInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  ratingStepperContainer: {
    marginTop: 4,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperBtn: {
    borderWidth: 1,
    borderRadius: 8,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: '700',
  },
  ratingValueBox: {
    minWidth: 60,
    alignItems: 'center',
  },
  ratingValueText: {
    fontSize: 16,
    fontWeight: '700',
  },
  reviewInputGroup: {
    marginTop: 4,
  },
  reviewInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  logEpisodeSubmitBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  logEpisodeSubmitText: {
    fontSize: 14,
    fontWeight: '700',
  },
  loggedEpisodesListContainer: {
    marginTop: 8,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  loggedEpisodeCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    width: 160,
    minHeight: 90,
    gap: 4,
  },
  loggedEpisodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  loggedEpisodeTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  deleteEpBtn: {
    padding: 2,
  },
  loggedEpisodeRating: {
    fontSize: 12,
    fontWeight: '700',
  },
  loggedEpisodeReview: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  backdropPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  placeholderText: {
    fontSize: 14,
    fontWeight: '600',
  },
  insightBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  insightText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  seasonTabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  episodesContainer: {
    width: '100%',
  },
  episodesList: {
    gap: 12,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  epStillContainer: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  epStill: {
    width: 100,
    height: 62,
    borderRadius: 8,
  },
  epStillPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  epNumberBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  epNumberText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  epInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  epTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  epTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  epUserRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  epUserRatingText: {
    fontSize: 10,
    fontWeight: '700',
  },
  epAirDate: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 4,
  },
  epOverview: {
    fontSize: 12,
    lineHeight: 16,
  },
  emptyEpisodesText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
