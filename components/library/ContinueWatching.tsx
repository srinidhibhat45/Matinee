import React from 'react';
import { useRouter } from 'expo-router';
import { useLibrary } from '../../hooks/useLibrary';
import CarouselSection from '../CarouselSection';
export default function ContinueWatching() {
  const {
    items,
    activity
  } = useLibrary();
  const router = useRouter();
  const watching = new Set(activity.filter(r => r.kind === 'watching').map(r => `${r.payload.mediaType}:${r.payload.tmdbId}`));
  const cards = items.filter(i => i.status !== 'not_interested' && watching.has(`${i.mediaType}:${i.tmdbId}`)).map(i => {
    const eps = activity.filter(r => r.kind === 'episode' && r.payload.tmdbId === i.tmdbId).sort((a, b) => b.payload.season - a.payload.season || b.payload.episode - a.payload.episode);
    return {
      id: i.tmdbId,
      title: i.title,
      posterPath: i.posterPath,
      voteAverage: i.voteAverage,
      releaseDate: i.releaseDate,
      mediaType: i.mediaType,
      reason: eps.length ? `${eps.length} episodes watched · last S${eps[0].payload.season} E${eps[0].payload.episode}` : 'Ready when you are'
    };
  });
  return <CarouselSection title="Continue watching" items={cards} onItemPress={i => router.push({
    pathname: '/detail/[id]',
    params: {
      id: String(i.id),
      mediaType: i.mediaType ?? 'tv'
    }
  })} showMediaTypeBadge />;
}
