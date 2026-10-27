import { bookmarkTitle } from '../../services/libraryActions';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { IconButton } from '../m3';
import { useLibrary, refreshLibrary } from '../../hooks/useLibrary';
import { toggleBookmark, localDay, titleKey } from '../../services/libraryActivity';
import { useNotice } from '../../context/NoticeContext';
import type { TMDBMediaItem } from '../../types';
import type { MovieCardItem } from '../MovieCard';
import { notificationService } from '../../services/notifications';
export function normalizeCard(item: MovieCardItem): TMDBMediaItem {
  return {
    overview: '',
    backdropPath: null,
    genreIds: [],
    originalLanguage: '',
    popularity: 0,
    voteCount: 0,
    ...item,
    mediaType: item.mediaType ?? 'movie'
  };
}
export default function QuickActions({
  item
}: {
  item: MovieCardItem;
}) {
  const library = useLibrary();
  const router = useRouter();
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const type = item.mediaType ?? 'movie';
  const existing = library.items.find(i => i.tmdbId === item.id && i.mediaType === type);
  const saved = existing?.status === 'watchlist' || library.activity.some(r => r.key === `bookmark:${titleKey(type, item.id)}`);
  const isFuture = !!item.releaseDate && item.releaseDate > localDay();
  async function bookmark() {
    if (busy) return;
    setBusy(true);
    try {
      const added = await bookmarkTitle(normalizeCard(item));
      await refreshLibrary();
      notice({
        message: added ? 'Added to bookmarks' : 'Bookmark removed',
        undo: async () => {
          await bookmarkTitle(normalizeCard(item));
          await refreshLibrary();
        }
      });
    } catch {
      notice({
        message: 'Could not update the bookmark. Please try again.'
      });
    } finally {
      setBusy(false);
    }
  }
  return <View style={{
    flexDirection: 'row',
    justifyContent: 'space-between'
  }}>
    <IconButton icon={saved ? 'bookmark' : 'bookmark-outline'} size={48} iconSize={19} disabled={busy} onPress={bookmark} accessibilityLabel={`${saved ? 'Remove' : 'Add'} bookmark: ${item.title}`} />
    {!isFuture && <IconButton icon={existing?.status === 'watched' ? 'checkmark-circle' : 'add-circle-outline'} size={48} iconSize={19} onPress={() => router.push({
      pathname: '/detail/[id]',
      params: {
        id: String(item.id),
        mediaType: type,
        autoRate: 'true'
      }
    })} accessibilityLabel={`Log or rate ${item.title}`} />}
  </View>;
}
