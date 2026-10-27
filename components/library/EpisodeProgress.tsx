import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Button, Chip, Text, Loading, IconButton } from '../m3';
import { tmdbService } from '../../services/tmdb';
import { markEpisode, localDay } from '../../services/libraryActivity';
import { useLibrary, refreshLibrary } from '../../hooks/useLibrary';
import { useTheme } from '../../context/ThemeContext';
import { useNotice } from '../../context/NoticeContext';
import type { TMDBMediaDetails, EpisodeRating } from '../../types';
interface Episode {
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  air_date: string | null;
  runtime?: number;
}
export default function EpisodeProgress({
  item,
  ratings,
  onRate
}: {
  item: TMDBMediaDetails;
  ratings: EpisodeRating[];
  onRate: (season: number, episode: number) => void;
}) {
  const {
    colors
  } = useTheme();
  const notice = useNotice();
  const {
    activity
  } = useLibrary();
  const seasons = item.seasons ?? [];
  const [season, setSeason] = useState(seasons.find(s => s.season_number > 0)?.season_number ?? 0);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError(false);
    setEpisodes([]);
    tmdbService.getTVSeason(item.id, season).then(data => {
      if (current === request.current) setEpisodes(data?.episodes ?? []);
    }).catch(() => {
      if (current === request.current) setError(true);
    }).finally(() => {
      if (current === request.current) setLoading(false);
    });
    return () => {
      request.current++;
    };
  }, [item.id, season, retry]);
  const watched = new Set(activity.filter(r => r.kind === 'episode' && r.payload.tmdbId === item.id && r.payload.season === season).map(r => r.payload.episode));
  const aired = episodes.filter(e => !!e.air_date && e.air_date <= localDay());
  async function change(list: Episode[], done: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      for (const ep of list) await markEpisode(item, season, ep.episode_number, done, ep.runtime);
      await refreshLibrary();
      notice({
        message: done ? `${list.length} episode${list.length === 1 ? '' : 's'} marked watched` : 'Episode marked unwatched'
      });
    } catch {
      notice({
        message: 'Could not save episode progress. Please try again.'
      });
    } finally {
      setBusy(false);
    }
  }
  const next = aired.find(ep => !watched.has(ep.episode_number));
  return <View style={{
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 12
  }}>
    <Text variant="titleLarge" accessibilityRole="header">Seasons & episode progress</Text>
    <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Watch first. Rate only if you want to.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
      gap: 8
    }}>{seasons.map(s => <Chip key={s.season_number} label={s.name || `Season ${s.season_number}`} variant="filter" selected={season === s.season_number} disabled={busy} onPress={() => setSeason(s.season_number)} />)}</ScrollView>
    {loading ? <Loading label="Loading episodes" /> : error ? <Button label="Retry loading episodes" variant="outlined" onPress={() => setRetry(n => n + 1)} /> : <>
      <Text variant="labelLarge">{aired.filter(e => watched.has(e.episode_number)).length} / {aired.length} released episodes watched{next ? ` · Next: E${next.episode_number}` : ''}</Text>
      <Button label="Mark released episodes watched" variant="tonal" disabled={busy || !aired.some(e => !watched.has(e.episode_number))} loading={busy} onPress={() => change(aired.filter(e => !watched.has(e.episode_number)), true)} />
      {!episodes.length && <Text variant="bodyMedium">No episodes listed for this season yet.</Text>}
      {episodes.map(ep => {
        const available = !!ep.air_date && ep.air_date <= localDay();
        const done = watched.has(ep.episode_number);
        const rating = ratings.find(r => r.seasonNumber === season && r.episodeNumber === ep.episode_number)?.rating;
        return <View key={ep.id} style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 64,
          borderBottomWidth: 1,
          borderColor: colors.outlineVariant
        }}>
          <IconButton icon={done ? 'checkbox' : 'square-outline'} disabled={!available || busy} accessibilityLabel={`${done ? 'Mark unwatched' : 'Mark watched'}: season ${season}, episode ${ep.episode_number}`} onPress={() => change([ep], !done)} />
          <View style={{
            flex: 1,
            gap: 4
          }}><Text variant="titleSmall">{ep.episode_number}. {ep.name}</Text><Text variant="bodySmall" color={colors.onSurfaceVariant}>{available ? done ? 'Watched' : 'Not watched' : ep.air_date ? `Releases ${ep.air_date}` : 'Air date unannounced'}{rating ? ` · Your rating ${rating}/10` : ''}</Text></View>
          {available && <Button label="Rate" variant="text" compact onPress={() => onRate(season, ep.episode_number)} />}
        </View>;
      })}
    </>}
  </View>;
}
