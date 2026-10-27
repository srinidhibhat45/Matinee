import React, { useRef, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useLibrary } from '../../hooks/useLibrary';
import { selectLibrary } from '../../services/libraryLogic';
import { localDay } from '../../services/libraryActivity';
import { getPreference } from '../../services/database';
import { tmdbService, limitConcurrency } from '../../services/tmdb';
import { Button, Text } from '../m3';
import MovieCard from '../MovieCard';
import { useTheme } from '../../context/ThemeContext';
import { useResponsive } from '../../hooks/useResponsive';
import type { TMDBMediaDetails } from '../../types';
export default function AvailableBookmarks() {
  const library = useLibrary();
  const {
    colors
  } = useTheme();
  const {
    gutter
  } = useResponsive();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TMDBMediaDetails[]>([]);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const bookmarks = selectLibrary(library.items, library.activity, 'watchlist', '', null, 'recent').filter(i => i.releaseDate && i.releaseDate <= localDay());
  if (!bookmarks.length) return null;
  async function check() {
    const id = ++request.current;
    setBusy(true);
    setMessage('');
    try {
      const subscriptions = ((await getPreference('PREF_OTT_PROVIDERS')) ?? '').split(',').map(Number).filter(n => n > 0);
      if (!subscriptions.length) {
        setMessage('Choose your subscriptions in Library → Settings to check availability.');
        return;
      }
      const found = await limitConcurrency(bookmarks.slice(0, 12), 3, async i => {
        try {
          const details = await tmdbService.getDetails(i.tmdbId, i.mediaType);
          return details?.watchProviders?.flatrate?.some(p => subscriptions.includes(p.provider_id)) ? details : null;
        } catch {
          return null;
        }
      });
      if (id === request.current) {
        const matches = found.filter((i): i is TMDBMediaDetails => !!i);
        setResults(matches);
        if (!matches.length) setMessage('No confirmed subscription matches among your 12 most recent released bookmarks.');
      }
    } catch {
      setMessage('Could not check availability. Please try again.');
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return <View style={{
    paddingHorizontal: gutter,
    paddingBottom: 20,
    gap: 12
  }}>
    <View style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }}><Text variant="titleMedium" accessibilityRole="header">Already on your list</Text><Button label="Check my subscriptions" variant="text" loading={busy} disabled={busy} onPress={check} /></View>
    {message && <Text variant="bodyMedium" color={colors.onSurfaceVariant}>{message}</Text>}
    {!!results.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
      gap: 12
    }}>{results.filter(i => bookmarks.some(b => b.tmdbId === i.id && b.mediaType === i.mediaType)).map(i => <MovieCard key={`${i.mediaType}:${i.id}`} item={{
        ...i,
        reason: 'Included with your subscriptions'
      }} width={140} onPress={() => router.push({
        pathname: '/detail/[id]',
        params: {
          id: String(i.id),
          mediaType: i.mediaType
        }
      })} />)}</ScrollView>}
  </View>;
}
