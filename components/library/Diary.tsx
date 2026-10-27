import React, { useMemo, useState } from 'react';
import { View, ScrollView, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text, TextField, Chip, ListItem } from '../m3';
import { useLibrary } from '../../hooks/useLibrary';
import { useTheme } from '../../context/ThemeContext';
import { useNotice } from '../../context/NoticeContext';
import { localDay, writeActivity } from '../../services/libraryActivity';
import EmptyState from '../EmptyState';
export default function Diary({
  bottomPadding = 160
}: {
  bottomPadding?: number;
}) {
  const {
    activity
  } = useLibrary();
  const {
    colors
  } = useTheme();
  const notice = useNotice();
  const router = useRouter();
  const [period, setPeriod] = useState(localDay().slice(0, 7));
  const [yearly, setYearly] = useState(false);
  const entries = useMemo(() => activity.filter(r => r.kind === 'diary' && String(r.payload.date).startsWith(yearly ? period.slice(0, 4) : period)).sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.updatedAt.localeCompare(a.updatedAt)), [activity, period, yearly]);
  const minutes = entries.reduce((n, e) => n + (e.payload.runtime || 0), 0);
  const summary = `My Matinee ${yearly ? period.slice(0, 4) : period}: ${entries.length} viewings, ${new Set(entries.map(e => `${e.payload.mediaType}:${e.payload.tmdbId}`)).size} titles${minutes ? `, ${Math.round(minutes / 60)} film hours with known runtimes` : ''}.`;
  return <ScrollView contentContainerStyle={{
    padding: 20,
    paddingBottom: bottomPadding,
    gap: 16
  }} keyboardShouldPersistTaps="handled">
    <Text variant="headlineSmall" accessibilityRole="header">Your film diary</Text>
    <TextField label="Month (YYYY-MM)" value={period} onChangeText={setPeriod} maxLength={7} keyboardType="numbers-and-punctuation" errorText={!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? 'Use YYYY-MM, for example 2026-10' : undefined} />
    <View style={{
      flexDirection: 'row',
      gap: 8
    }}><Chip label="Month" variant="filter" selected={!yearly} onPress={() => setYearly(false)} /><Chip label="Year" variant="filter" selected={yearly} onPress={() => setYearly(true)} /></View>
    <Text variant="titleMedium">{entries.length} viewings · {Math.round(minutes / 60)} film hours</Text>
    <Text variant="bodySmall" color={colors.onSurfaceVariant}>Diary totals count the viewings you explicitly log here. Your existing Seen statistics remain available in Stats.</Text>
    <Button label="Share recap" icon="share-outline" variant="tonal" disabled={!entries.length} onPress={() => {
      Share.share({
        message: summary
      }).catch(() => notice({
        message: 'Sharing is unavailable on this device.'
      }));
    }} />
    {entries.map(e => <View key={e.key} style={{
      gap: 4,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderColor: colors.outlineVariant
    }}>
      <ListItem headline={e.payload.title} supportingText={`${e.payload.date} · ${e.payload.mediaType === 'tv' ? 'Series' : 'Movie'}`} onPress={() => router.push({
        pathname: '/detail/[id]',
        params: {
          id: String(e.payload.tmdbId),
          mediaType: e.payload.mediaType
        }
      })} />
      {!!e.payload.note && <Text variant="bodyMedium" selectable>{e.payload.note}</Text>}
      <Button label="Remove entry" variant="text" onPress={() => {
        writeActivity('diary', e.key.slice(6), e.payload, true).then(() => notice({
          message: 'Diary entry removed',
          undo: () => writeActivity('diary', e.key.slice(6), e.payload)
        })).catch(() => notice({
          message: 'Could not remove this entry.'
        }));
      }} />
    </View>)}
    {!entries.length && <EmptyState icon="journal-outline" title="Make it a movie night" subtitle="Open a title and log a viewing. Rewatches get their own entry, with an optional note." compact />}
  </ScrollView>;
}
