import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Chip, Text } from '../m3';
import { useTheme } from '../../context/ThemeContext';
import { LANGUAGES } from '../../constants/languages';
import { pickTonight, type TonightPreferences } from '../../services/tonight';
import { useLibrary } from '../../hooks/useLibrary';
import { getPreference, setPreference } from '../../services/database';
import MovieCard from '../MovieCard';
import type { RecommendedItem } from '../../types';
import { useResponsive } from '../../hooks/useResponsive';
export default function TonightPicker() {
  const {
    colors
  } = useTheme();
  const {
    gutter
  } = useResponsive();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [prefs, setPrefs] = useState<TonightPreferences>({
    mood: 'any',
    maxMinutes: null,
    language: 'all',
    subscriptionsOnly: false
  });
  const [languages, setLanguages] = useState<string[]>([]);
  const [picks, setPicks] = useState<RecommendedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [adventurous, setAdventurous] = useState(false);
  const request = useRef(0);
  const {
    items
  } = useLibrary();
  useEffect(() => {
    getPreference('PREF_LANGUAGES').then(v => setLanguages(v ? v.split(',') : ['en', 'hi', 'kn']));
    getPreference('PREF_ADVENTURE').then(v => setAdventurous(v === 'true'));
    return () => {
      request.current++;
    };
  }, []);
  function change(next: Partial<TonightPreferences>) {
    request.current++;
    setPrefs(p => ({
      ...p,
      ...next
    }));
    setPicks([]);
    setAttempted(false);
    setBusy(false);
    setError(null);
  }
  async function find() {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    setAttempted(true);
    try {
      const result = await pickTonight(prefs);
      if (id === request.current) setPicks(result);
    } catch (e: any) {
      if (id === request.current) setError(e.message || 'Could not find picks. Please try again.');
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  const visible = picks.filter(p => !items.some(i => i.tmdbId === p.id && i.mediaType === p.mediaType && (i.status === 'watched' || i.status === 'not_interested')));
  return <View style={{
    marginHorizontal: gutter,
    paddingVertical: 24,
    gap: 14
  }}>
    <Text variant="headlineSmall" accessibilityRole="header">Make tonight a good one.</Text>
    <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Three picks for your mood, your time, and your taste.</Text>
    {!expanded && <Button label="Pick for tonight" icon="sparkles-outline" onPress={() => setExpanded(true)} />}
    {expanded && <>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
        gap: 8
      }}>
      {([{
          key: 'any',
          label: 'Any mood'
        }, {
          key: 'funny',
          label: 'Make me laugh'
        }, {
          key: 'chill',
          label: 'Keep it light'
        }, {
          key: 'intense',
          label: 'Keep me hooked'
        }, {
          key: 'thoughtful',
          label: 'Make me think'
        }] as const).map(m => <Chip key={m.key} label={m.label} variant="filter" selected={prefs.mood === m.key} onPress={() => change({
          mood: m.key
        })} />)}
    </ScrollView>
    <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8
      }}>
      {[null, 90, 120, 180].map(time => <Chip key={String(time)} label={time ? `Under ${time} min` : 'Any length'} variant="filter" selected={prefs.maxMinutes === time} onPress={() => change({
          maxMinutes: time
        })} />)}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
        gap: 8
      }}>
      <Chip label="Any language" variant="filter" selected={prefs.language === 'all'} onPress={() => change({
          language: 'all'
        })} />
      {LANGUAGES.filter(l => languages.includes(l.code)).map(l => <Chip key={l.code} label={l.nativeName} variant="filter" selected={prefs.language === l.code} onPress={() => change({
          language: l.code
        })} />)}
    </ScrollView>
    <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8
      }}>
      <Chip label="My subscriptions only" variant="filter" selected={prefs.subscriptionsOnly} onPress={() => change({
          subscriptionsOnly: !prefs.subscriptionsOnly
        })} />
      <Chip label={adventurous ? 'Feeling adventurous' : 'Familiar favourites'} variant="filter" selected={adventurous} onPress={() => {
          setAdventurous(!adventurous);
          setPreference('PREF_ADVENTURE', String(!adventurous)).catch(() => setError('Could not save your preference.'));
        }} />
    </View>
    <Button label={busy ? 'Finding your three…' : 'Pick for tonight'} icon="sparkles-outline" loading={busy} disabled={busy} onPress={find} />
    <Button label="Close picker" variant="text" onPress={() => {
        request.current++;
        setExpanded(false);
        setBusy(false);
      }} />
    </>}
    {error && <Text variant="bodyMedium" color={colors.error} accessibilityRole="alert">{error}</Text>}
    {attempted && !busy && !error && !visible.length && <Text variant="bodyMedium" color={colors.onSurfaceVariant}>No suitable picks in this selection. Try another mood, allow more time, or broaden your language and subscription choices.</Text>}
    {!!visible.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
      gap: 16
    }}>{visible.map(item => <MovieCard key={`${item.mediaType}:${item.id}`} item={item} width={168} showMediaTypeBadge onPress={() => router.push({
        pathname: '/detail/[id]',
        params: {
          id: String(item.id),
          mediaType: item.mediaType,
          reason: item.reason
        }
      })} />)}</ScrollView>}
  </View>;
}
