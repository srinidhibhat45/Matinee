import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  Dimensions,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { useResponsive } from '../hooks/useResponsive';
import { FAB } from './m3';
import { NAVIGATION_BAR_HEIGHT } from './m3/Navigation';
import { spacing } from '../constants/m3';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPreference } from '../services/database';
import { recommendationService, MoodPreferences, MoodRecommendationResult } from '../services/recommendations';
import { getImageUrl } from '../services/tmdb';
import { MOVIE_GENRES, TV_GENRES } from '../constants/genres';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Constants ────────────────────────────────────────────────

const MOODS = [
  { label: 'Happy', emoji: '😊' },
  { label: 'Sad', emoji: '😢' },
  { label: 'Intense', emoji: '😤' },
  { label: 'Chill', emoji: '🧘' },
  { label: 'Funny', emoji: '😂' },
  { label: 'Thought-provoking', emoji: '🤔' },
  { label: 'Scary', emoji: '😱' },
  { label: 'Romantic', emoji: '💕' },
];

const ERAS = [
  'Any Era 🌍',
  'Golden Age (Pre-2000) 📽️',
  'Millennium Nostalgia (2000-2010) 💿',
  'Modern Era (2010-2020) 📱',
  'Brand New (2020+) ✨'
];

const DURATIONS = [
  'Short & Sweet (<90m) ⏱️',
  'Standard Length (90-120m) 🎬',
  'Epic Journey (>120m) 🍿',
  'Any Duration ⏳'
];

const MEDIA_TYPES: { label: string; value: 'movie' | 'tv' | 'both'; icon: string }[] = [
  { label: 'Movie', value: 'movie', icon: '🎬' },
  { label: 'Series', value: 'tv', icon: '📺' },
  { label: 'Both', value: 'both', icon: '🎞️' },
];

const VIBES = [
  { level: 1, label: 'Cozy & Casual', icon: '🍿', desc: 'Low effort / easy watch' },
  { level: 2, label: 'Light Entertainment', icon: '🥤', desc: 'Easygoing / fun' },
  { level: 3, label: 'Balanced & Engaging', icon: '🎬', desc: 'Standard story / thoughtful' },
  { level: 4, label: 'Immersive & Thrilling', icon: '🧠', desc: 'High focus / exciting' },
  { level: 5, label: 'Deep & Thoughtful', icon: '🌌', desc: 'Immersive / heavy / intense' }
];

const ALL_GENRE_IDS = [
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37,
];


// ─── Component ────────────────────────────────────────────────

export default function AiRecommendFab() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isCompact } = useResponsive();

  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [phase, setPhase] = useState<'form' | 'loading' | 'results'>('form');

  // Form state
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [vibeIntensity, setVibeIntensity] = useState(3);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [mediaType, setMediaType] = useState<'movie' | 'tv' | 'both'>('both');
  const [era, setEra] = useState('Any Era 🌍');
  const [duration, setDuration] = useState('Any Duration ⏳');

  // Results
  const [results, setResults] = useState<MoodRecommendationResult[]>([]);
  const [error, setError] = useState<string | null>(null);



  // ── Check Gemini Key ───────────────────────────────────────

  useEffect(() => {
    const check = async () => {
      try {
        const key = await getPreference('PREF_GEMINI_API_KEY');
        setHasGeminiKey(!!key && key.trim().length > 0);
      } catch {
        setHasGeminiKey(false);
      }
    };
    check();
    // Re-check every time app focuses
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  // ── Handlers ───────────────────────────────────────────────

  const openModal = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setPhase('form');
    setError(null);
    setModalVisible(true);
  }, []);

  const toggleGenre = useCallback((genreId: number) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genreId)) {
        return prev.filter((g) => g !== genreId);
      }
      if (prev.length >= 3) return prev; // max 3
      return [...prev, genreId];
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedMood) return;

    setPhase('loading');
    setError(null);

    try {
      const prefs: MoodPreferences = {
        mood: selectedMood,
        vibeIntensity,
        genres: selectedGenres,
        mediaType,
        era,
        duration,
      };
      const recs = await recommendationService.getMoodBasedRecommendations(prefs);
      setResults(recs);
      setPhase('results');
    } catch (err) {
      console.warn('[AiRecommendFab] Error:', err);
      setError('Something went wrong. Please try again.');
      setPhase('form');
    }
  }, [selectedMood, vibeIntensity, selectedGenres, mediaType, era, duration]);

  const handleTryAgain = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  const handleChangePrefs = useCallback(() => {
    setPhase('form');
    setError(null);
  }, []);

  const handleCardPress = useCallback((id: number, mType: string) => {
    setModalVisible(false);
    router.push(`/detail/${id}?type=${mType}`);
  }, [router]);

  const closeModal = useCallback(() => {
    setModalVisible(false);
  }, []);

  // ── Don't render if no Gemini key ──────────────────────────

  if (!hasGeminiKey) return null;

  // ── Render ─────────────────────────────────────────────────

  const accentColor = colors.primary;
  /** Text/icon colour for anything painted on top of `primary`. */
  const onAccent = colors.onPrimary;

  return (
    <>
      {/* FAB. It is right-anchored, so only the bottom navigation bar can sit
          under it — the rail is on the opposite edge and needs no allowance. */}
      <View
        style={[
          styles.fabContainer,
          {
            bottom: isCompact
              ? NAVIGATION_BAR_HEIGHT + insets.bottom + spacing.lg
              : Math.max(insets.bottom, spacing.lg) + spacing.lg,
            right: spacing.lg,
          },
        ]}
      >
        <FAB
          icon="sparkles"
          variant="primary"
          onPress={openModal}
          accessibilityLabel="Recommend something to watch"
          accessibilityHint="Opens a form that suggests titles based on your mood"
        />
      </View>

      {/* Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
        statusBarTranslucent
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeModal} />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            {/* Drag handle */}
            <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.headerLeft}>
                <Ionicons name="sparkles" size={20} color={accentColor} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {phase === 'results' ? 'Your Picks' : 'Recommend Me'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeModal}
                hitSlop={16}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>

            {phase === 'loading' && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={accentColor} />
                <Text style={[styles.loadingText, { color: colors.secondary }]}>
                  Finding your perfect picks...
                </Text>
                <Text style={[styles.loadingSubtext, { color: colors.muted }]}>
                  AI is analyzing your taste
                </Text>
              </View>
            )}

            {phase === 'form' && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.formContent}
              >
                {error && (
                  <View style={[styles.errorBanner, { backgroundColor: colors.errorContainer }]} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle" size={16} color={colors.onErrorContainer} />
                    <Text style={[styles.errorText, { color: colors.onErrorContainer }]}>{error}</Text>
                  </View>
                )}

                {/* 1. Mood */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>How are you feeling?</Text>
                <View style={styles.chipRow}>
                  {MOODS.map((m) => (
                    <TouchableOpacity
                      key={m.label}
                      style={[
                        styles.moodChip,
                        {
                          backgroundColor: selectedMood === m.label ? accentColor : colors.elevated,
                          borderColor: selectedMood === m.label ? accentColor : colors.border,
                        },
                      ]}
                      onPress={() => {
                        setSelectedMood(m.label);
                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                      }}
                      accessibilityRole="radio"
                      accessibilityLabel={m.label}
                      accessibilityState={{ selected: selectedMood === m.label, checked: selectedMood === m.label }}
                    >
                      <Text style={styles.moodEmoji}>{m.emoji}</Text>
                      <Text
                        style={[
                          styles.moodLabel,
                          { color: selectedMood === m.label ? onAccent : colors.text },
                        ]}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                 {/* 2. Vibe / Pacing Selector */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Vibe / Pacing</Text>
                <View style={styles.verticalCardContainer}>
                  {VIBES.map((v) => {
                    const isSelected = vibeIntensity === v.level;
                    return (
                      <TouchableOpacity
                        key={v.level}
                        style={[
                          styles.verticalCard,
                          {
                            backgroundColor: isSelected ? colors.accentMuted : colors.elevated,
                            borderColor: isSelected ? accentColor : colors.border,
                          },
                        ]}
                        onPress={() => {
                          setVibeIntensity(v.level);
                          if (Platform.OS !== 'web') Haptics.selectionAsync();
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={`${v.label}. ${v.desc}`}
                        accessibilityState={{ selected: isSelected, checked: isSelected }}
                      >
                        <Text style={styles.verticalCardIcon}>{v.icon}</Text>
                        <View style={styles.verticalCardTextContent}>
                          <Text style={[styles.verticalCardTitle, { color: colors.text, fontWeight: isSelected ? '700' : '600' }]}>
                            {v.label}
                          </Text>
                          <Text style={[styles.verticalCardDesc, { color: colors.secondary }]}>
                            {v.desc}
                          </Text>
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark-circle" size={18} color={accentColor} style={{ marginLeft: 'auto' }} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 3. Genre Preferences */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>
                  Genres <Text style={{ color: colors.muted, fontSize: 12 }}>(max 3)</Text>
                </Text>
                <View style={styles.chipRow}>
                  {ALL_GENRE_IDS.map((gId) => {
                    const name = MOVIE_GENRES[gId] || TV_GENRES[gId] || '';
                    const selected = selectedGenres.includes(gId);
                    return (
                      <TouchableOpacity
                        key={gId}
                        style={[
                          styles.genreChip,
                          {
                            backgroundColor: selected ? accentColor : colors.elevated,
                            borderColor: selected ? accentColor : colors.border,
                            opacity: !selected && selectedGenres.length >= 3 ? 0.4 : 1,
                          },
                        ]}
                        onPress={() => toggleGenre(gId)}
                        disabled={!selected && selectedGenres.length >= 3}
                        accessibilityRole="checkbox"
                        accessibilityLabel={name}
                        accessibilityHint={
                          !selected && selectedGenres.length >= 3
                            ? 'Deselect another genre first — three is the maximum'
                            : undefined
                        }
                        accessibilityState={{
                          checked: selected,
                          disabled: !selected && selectedGenres.length >= 3,
                        }}
                      >
                        <Text
                          style={[
                            styles.genreChipText,
                            { color: selected ? onAccent : colors.secondary },
                          ]}
                        >
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 4. Media Type */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Type</Text>
                <View style={[styles.segmentRow, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
                  {MEDIA_TYPES.map((mt) => (
                    <TouchableOpacity
                      key={mt.value}
                      style={[
                        styles.segmentItem,
                        mediaType === mt.value && {
                          backgroundColor: accentColor,
                        },
                      ]}
                      onPress={() => {
                        setMediaType(mt.value);
                        if (Platform.OS !== 'web') Haptics.selectionAsync();
                      }}
                      accessibilityRole="radio"
                      accessibilityLabel={mt.label}
                      accessibilityState={{ selected: mediaType === mt.value, checked: mediaType === mt.value }}
                    >
                      <Text style={styles.segmentIcon}>{mt.icon}</Text>
                      <Text
                        style={[
                          styles.segmentText,
                          { color: mediaType === mt.value ? onAccent : colors.secondary },
                        ]}
                      >
                        {mt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 5. Era */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Era</Text>
                <View style={styles.gridContainer}>
                  <View style={styles.gridRow}>
                    {ERAS.slice(1, 3).map((e) => {
                      const isSelected = era === e;
                      return (
                        <TouchableOpacity
                          key={e}
                          style={[
                            styles.gridCard,
                            {
                              backgroundColor: isSelected ? colors.accentMuted : colors.elevated,
                              borderColor: isSelected ? accentColor : colors.border,
                            },
                          ]}
                          onPress={() => {
                            setEra(e);
                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                          }}
                          accessibilityRole="radio"
                          accessibilityLabel={e}
                          accessibilityState={{ selected: isSelected, checked: isSelected }}
                        >
                          <Text style={[styles.gridCardTitle, { color: colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                            {e}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={styles.gridRow}>
                    {ERAS.slice(3, 5).map((e) => {
                      const isSelected = era === e;
                      return (
                        <TouchableOpacity
                          key={e}
                          style={[
                            styles.gridCard,
                            {
                              backgroundColor: isSelected ? colors.accentMuted : colors.elevated,
                              borderColor: isSelected ? accentColor : colors.border,
                            },
                          ]}
                          onPress={() => {
                            setEra(e);
                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                          }}
                          accessibilityRole="radio"
                          accessibilityLabel={e}
                          accessibilityState={{ selected: isSelected, checked: isSelected }}
                        >
                          <Text style={[styles.gridCardTitle, { color: colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                            {e}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.verticalCard,
                      {
                        backgroundColor: era === ERAS[0] ? colors.accentMuted : colors.elevated,
                        borderColor: era === ERAS[0] ? accentColor : colors.border,
                        marginTop: 4,
                      },
                    ]}
                    onPress={() => {
                      setEra(ERAS[0]);
                      if (Platform.OS !== 'web') Haptics.selectionAsync();
                    }}
                  >
                    <Text style={styles.verticalCardIcon}>🌍</Text>
                    <View style={styles.verticalCardTextContent}>
                      <Text style={[styles.verticalCardTitle, { color: colors.text, fontWeight: era === ERAS[0] ? '700' : '600' }]}>
                        Any Era
                      </Text>
                      <Text style={[styles.verticalCardDesc, { color: colors.secondary }]}>
                        Recommendations from all years
                      </Text>
                    </View>
                    {era === ERAS[0] && (
                      <Ionicons name="checkmark-circle" size={18} color={accentColor} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </View>

                 {/* 6. Duration */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Duration</Text>
                <View style={styles.gridContainer}>
                  <View style={styles.gridRow}>
                    {DURATIONS.slice(0, 2).map((d) => {
                      const isSelected = duration === d;
                      return (
                        <TouchableOpacity
                          key={d}
                          style={[
                            styles.gridCard,
                            {
                              backgroundColor: isSelected ? colors.accentMuted : colors.elevated,
                              borderColor: isSelected ? accentColor : colors.border,
                            },
                          ]}
                          onPress={() => {
                            setDuration(d);
                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                          }}
                          accessibilityRole="radio"
                          accessibilityLabel={d}
                          accessibilityState={{ selected: isSelected, checked: isSelected }}
                        >
                          <Text style={[styles.gridCardTitle, { color: colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                            {d}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={styles.gridRow}>
                    {DURATIONS.slice(2, 4).map((d) => {
                      const isSelected = duration === d;
                      return (
                        <TouchableOpacity
                          key={d}
                          style={[
                            styles.gridCard,
                            {
                              backgroundColor: isSelected ? colors.accentMuted : colors.elevated,
                              borderColor: isSelected ? accentColor : colors.border,
                            },
                          ]}
                          onPress={() => {
                            setDuration(d);
                            if (Platform.OS !== 'web') Haptics.selectionAsync();
                          }}
                          accessibilityRole="radio"
                          accessibilityLabel={d}
                          accessibilityState={{ selected: isSelected, checked: isSelected }}
                        >
                          <Text style={[styles.gridCardTitle, { color: colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                            {d}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* CTA */}
                <TouchableOpacity
                  style={[
                    styles.ctaButton,
                    {
                      backgroundColor: selectedMood ? accentColor : colors.elevated,
                      opacity: selectedMood ? 1 : 0.5,
                    },
                  ]}
                  onPress={handleSubmit}
                  disabled={!selectedMood}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Find my picks"
                  accessibilityHint={selectedMood ? undefined : 'Choose a mood first'}
                  accessibilityState={{ disabled: !selectedMood }}
                >
                  <Ionicons name="sparkles" size={18} color={selectedMood ? onAccent : colors.muted} />
                  <Text style={[styles.ctaText, { color: selectedMood ? onAccent : colors.muted }]}>
                    Find My Picks
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {phase === 'results' && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.resultsContent}
              >
                {results.length === 0 ? (
                  <View style={styles.emptyResults}>
                    <Ionicons name="sad-outline" size={48} color={colors.muted} />
                    <Text style={[styles.emptyText, { color: colors.secondary }]}>
                      No picks found. Try different preferences!
                    </Text>
                  </View>
                ) : (
                  results.map((item, index) => (
                    <TouchableOpacity
                      key={`${item.id}-${index}`}
                      style={[styles.resultCard, { backgroundColor: colors.elevated, borderColor: colors.border }]}
                      onPress={() => handleCardPress(item.id, item.mediaType)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={[
                        item.title,
                        item.mediaType === 'tv' ? 'Series' : 'Movie',
                        item.reason,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      accessibilityHint="Opens this title"
                    >
                      <View style={styles.resultCardInner}>
                        {/* Poster */}
                        <Image
                          source={{
                            uri: item.posterPath
                              ? (getImageUrl(item.posterPath, 'w185') ?? undefined)
                              : undefined,
                          }}
                          style={styles.resultPoster}
                        />

                        {/* Info */}
                        <View style={styles.resultInfo}>
                          <View style={styles.resultTitleRow}>
                            <Text
                              style={[styles.resultTitle, { color: colors.text }]}
                              numberOfLines={2}
                            >
                              {item.title}
                            </Text>
                            <View style={styles.resultBadge}>
                              <Text style={styles.resultBadgeText}>
                                {item.mediaType === 'tv' ? '📺' : '🎬'}
                              </Text>
                            </View>
                          </View>

                          {/* Year & Rating */}
                          <View style={styles.resultMetaRow}>
                            {item.releaseDate && (
                              <Text style={[styles.resultYear, { color: colors.muted }]}>
                                {item.releaseDate.split('-')[0]}
                              </Text>
                            )}
                            <View style={styles.ratingBadge}>
                              <Ionicons name="star" size={12} color="#FBBF24" />
                              <Text style={[styles.ratingText, { color: colors.text }]}>
                                {item.voteAverage?.toFixed(1)}
                              </Text>
                            </View>
                            {item.runtime != null && item.runtime > 0 && (
                              <Text style={[styles.resultRuntime, { color: colors.muted }]}>
                                {item.runtime}m
                              </Text>
                            )}
                          </View>

                          {/* Genres */}
                          {item.genres && item.genres.length > 0 && (
                            <View style={styles.resultGenresRow}>
                              {item.genres.slice(0, 3).map((g) => (
                                <View
                                  key={g.id}
                                  style={[styles.miniGenreChip, { backgroundColor: colors.bg }]}
                                >
                                  <Text style={[styles.miniGenreText, { color: colors.muted }]}>
                                    {g.name}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}

                          {/* AI Reason */}
                          <View style={[styles.reasonContainer, { backgroundColor: `${accentColor}15` }]}>
                            <Ionicons name="sparkles" size={12} color={accentColor} />
                            <Text
                              style={[styles.reasonText, { color: accentColor }]}
                              numberOfLines={2}
                            >
                              {item.reason}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))
                )}

                {/* Action buttons */}
                <View style={styles.resultActions}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: accentColor }]}
                    onPress={handleTryAgain}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Try again"
                    accessibilityHint="Fetches a new set of suggestions"
                  >
                    <Ionicons name="refresh" size={18} color={onAccent} />
                    <Text style={[styles.actionButtonText, { color: onAccent }]}>Try Again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: colors.elevated, borderColor: colors.border, borderWidth: 1 }]}
                    onPress={handleChangePrefs}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Change preferences"
                  >
                    <Ionicons name="options" size={18} color={colors.text} />
                    <Text style={[styles.actionButtonText, { color: colors.text }]}>Change Preferences</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // FAB
  fabContainer: {
    position: 'absolute',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    minHeight: 400,
    paddingHorizontal: 20,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  loadingSubtext: {
    fontSize: 13,
  },

  // Form
  formContent: {
    paddingBottom: 20,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Mood chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  moodEmoji: {
    fontSize: 16,
  },
  moodLabel: {
    fontSize: 13,
    fontWeight: '600',
  },

   // Grid layouts
  verticalCardContainer: {
    gap: 8,
    marginTop: 4,
  },
  verticalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  verticalCardIcon: {
    fontSize: 22,
    marginRight: 12,
  },
  verticalCardTextContent: {
    flex: 1,
  },
  verticalCardTitle: {
    fontSize: 14,
  },
  verticalCardDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  gridContainer: {
    marginTop: 4,
    gap: 8,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gridCard: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridCardTitle: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Genre chips
  genreChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  genreChipText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Segmented controls
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  segmentItemSmall: {
    paddingVertical: 9,
    gap: 0,
  },
  segmentIcon: {
    fontSize: 14,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextSmall: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Era pills
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 8,
  },
  pillChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // CTA
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 24,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
  },

  // Results
  resultsContent: {
    paddingBottom: 20,
    gap: 14,
  },
  emptyResults: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
  },
  resultCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  resultCardInner: {
    flexDirection: 'row',
    padding: 12,
    gap: 14,
  },
  resultPoster: {
    width: 90,
    height: 135,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  resultInfo: {
    flex: 1,
    gap: 6,
  },
  resultTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  resultBadge: {
    marginTop: 2,
  },
  resultBadgeText: {
    fontSize: 14,
  },
  resultMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultYear: {
    fontSize: 13,
    fontWeight: '500',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resultRuntime: {
    fontSize: 12,
  },
  resultGenresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  miniGenreChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  miniGenreText: {
    fontSize: 10,
    fontWeight: '600',
  },
  reasonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    marginTop: 4,
  },
  reasonText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },

  // Action buttons
  resultActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
  },
});
