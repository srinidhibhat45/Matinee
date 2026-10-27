import React, { useMemo, useState } from 'react';
import { View, FlatList, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useLibrary, refreshLibrary } from '../../hooks/useLibrary';
import { useResponsive, gridItemWidth } from '../../hooks/useResponsive';
import { useTheme } from '../../context/ThemeContext';
import { useNotice } from '../../context/NoticeContext';
import { Button, Chip, Text, SearchField, IconButton, BottomSheet, ListItem, TextField, Loading, SegmentedButtons } from '../m3';
import MovieCard from '../MovieCard';
import EmptyState from '../EmptyState';
import { selectLibrary, type LibrarySection, type LibrarySort } from '../../services/libraryLogic';
import { createCollection, setCollectionMember, snapshotItem, writeActivity, toggleBookmark, localDay } from '../../services/libraryActivity';
import { deleteItem, updateItem } from '../../services/database';
import { notificationService } from '../../services/notifications';
import type { WatchedItem } from '../../types';
import Diary from './Diary';
const SECTIONS: {
  key: LibrarySection;
  label: string;
}[] = [{
  key: 'watchlist',
  label: 'Bookmarks'
}, {
  key: 'watched',
  label: 'Seen'
}, {
  key: 'watching',
  label: 'Watching'
}, {
  key: 'diary',
  label: 'Diary'
}, {
  key: 'hidden',
  label: 'Hidden'
}];
export default function LibraryBrowser({
  initialTab,
  initialMediaType,
  bottomPadding
}: {
  initialTab?: string;
  initialMediaType?: string;
  bottomPadding: number;
}) {
  const {
    items,
    activity,
    ready
  } = useLibrary();
  const {
    colors
  } = useTheme();
  const {
    gutter,
    posterColumns,
    width
  } = useResponsive();
  const notice = useNotice();
  const router = useRouter();
  const [section, setSection] = useState<LibrarySection>(initialTab === 'watched' ? 'watched' : 'watchlist');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [type, setType] = useState<string | null>(initialMediaType === 'movie' || initialMediaType === 'tv' ? initialMediaType : null);
  const [collection, setCollection] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sheet, setSheet] = useState<'tools' | 'sort' | 'collections' | null>(null);
  const [name, setName] = useState('');
  const [focused, setFocused] = useState<WatchedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [containerWidth, setContainerWidth] = useState(width);
  const collections = activity.filter(r => r.kind === 'collection');
  const visible = useMemo(() => selectLibrary(items, activity, section, query, type, sort, collection), [items, activity, section, query, type, sort, collection]);
  const cardWidth = gridItemWidth(containerWidth, posterColumns, gutter, 12);
  const asCard = (i: WatchedItem) => ({
    id: i.tmdbId,
    title: i.title,
    posterPath: i.posterPath,
    voteAverage: i.userRating ?? i.voteAverage,
    releaseDate: i.releaseDate,
    mediaType: i.mediaType
  });
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refreshLibrary();
    } catch (e: any) {
      notice({
        message: e.message || 'Could not save. Please try again.'
      });
    } finally {
      setBusy(false);
    }
  }
  async function remove(list: WatchedItem[]) {
    const undo = await Promise.all(list.filter(i => i.id > 0).map(snapshotItem));
    for (const i of list) {
      if (i.id < 0) continue;
      await deleteItem(i.id);
      await notificationService.cancelReminder(i.tmdbId, i.mediaType);
    }
    setSelected([]);
    setFocused(null);
    notice({
      message: `Removed ${list.length === 1 ? list[0].title : `${list.length} titles`}`,
      undo: async () => {
        for (const restore of undo) await restore();
        for (const i of list) if (i.status === 'watchlist' && i.releaseDate > localDay()) await notificationService.scheduleReleaseReminder(i.title, i.releaseDate, i.tmdbId, i.mediaType, i.posterPath);
        await refreshLibrary();
      }
    });
  }
  const selectedItems = items.filter(i => selected.includes(i.id));
  return <View style={{
    flex: 1
  }} onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}>
    <View style={{
      paddingHorizontal: gutter,
      paddingBottom: 12
    }}>
      <SegmentedButtons options={SECTIONS.slice(0, 2).map(s => ({
        value: s.key,
        label: `${s.label} (${selectLibrary(items, activity, s.key, '', null, 'recent').length})`
      }))} value={section} onChange={value => {
        setSection(value);
        setSelected([]);
        setQuery('');
        setCollection(null);
      }} accessibilityLabel="Library section" />
    </View>
    {!['watchlist', 'watched'].includes(section) && <View style={{
      paddingHorizontal: gutter,
      paddingBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
      <Text variant="titleMedium">{SECTIONS.find(s => s.key === section)?.label}</Text>
      <Button label="Back to bookmarks" variant="text" onPress={() => setSection('watchlist')} />
    </View>}
    {section === 'diary' ? <Diary bottomPadding={bottomPadding} /> : <>
      <View style={{
        paddingHorizontal: gutter,
        gap: 8,
        paddingBottom: 12
      }}>
        {(searchOpen || !!query) && <SearchField autoFocus value={query} onChangeText={setQuery} placeholder="Search your library" accessibilityLabel="Search your library" onClear={() => {
          setQuery('');
          setSearchOpen(false);
        }} />}
        <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1}} contentContainerStyle={{gap:8}}>
          {['All', 'Movies', 'Series'].map((label, index) => <Chip key={label} label={label} selected={type === [null, 'movie', 'tv'][index]} variant="filter" onPress={() => setType([null, 'movie', 'tv'][index])} />)}
          </ScrollView>
          <IconButton icon="search-outline" accessibilityLabel={searchOpen ? 'Close library search' : 'Search library'} onPress={() => {
            setSearchOpen(!searchOpen);
            setQuery('');
          }} />
          <IconButton icon="ellipsis-horizontal" accessibilityLabel="More library tools" onPress={() => setSheet('tools')} />
        </View>
        {collection && <Chip label={collections.find(c => c.payload.id === collection)?.payload.name ?? 'Collection'} variant="input" selected onRemove={() => setCollection(null)} onPress={() => setSheet('collections')} />}
        {selected.length > 0 ? <View style={{
          gap: 8
        }}>
          <Text variant="labelLarge">{selected.length} selected</Text>
          <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8
          }}>
            <Button label="Mark seen" variant="tonal" disabled={busy} onPress={() => run(async () => {
              for (const i of selectedItems) {
                if (i.status !== 'watched') await updateItem(i.id, {
                  status: 'watched',
                  watchedDate: localDay()
                });
                await writeActivity('watching', `${i.mediaType}:${i.tmdbId}`, {
                  tmdbId: i.tmdbId,
                  mediaType: i.mediaType
                }, true);
              }
              setSelected([]);
              notice({
                message: 'Marked as seen'
              });
            })} />
            <Button label="Collection" variant="outlined" onPress={() => setSheet('collections')} />
            <Button label="Remove" variant="outlined" tone="error" disabled={busy} onPress={() => run(() => remove(selectedItems))} />
            <Button label="Cancel" variant="text" onPress={() => setSelected([])} />
          </View>
        </View> : null}
      </View>
      {!ready ? <Loading label="Loading your library" /> : <FlatList data={visible} key={posterColumns} numColumns={posterColumns} keyExtractor={i => String(i.id)} contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingBottom: bottomPadding,
        gap: 16
      }} columnWrapperStyle={{
        gap: 12
      }} refreshing={busy} onRefresh={() => run(refreshLibrary)} initialNumToRender={12} maxToRenderPerBatch={9} windowSize={5} renderItem={({
        item
      }) => <View style={{
        width: cardWidth,
        gap: 2,
        borderRadius: 12,
        backgroundColor: selected.includes(item.id) ? colors.secondaryContainer : 'transparent'
      }}>
          <MovieCard item={asCard(item)} selected={selected.includes(item.id)} width={cardWidth} showMediaTypeBadge onPress={() => {
          if (selected.length) setSelected(s => s.includes(item.id) ? s.filter(id => id !== item.id) : [...s, item.id]);else router.push({
            pathname: '/detail/[id]',
            params: {
              id: String(item.tmdbId),
              mediaType: item.mediaType
            }
          });
        }} onLongPress={() => selected.length && item.id > 0 ? setSelected(s => s.includes(item.id) ? s.filter(id => id !== item.id) : [...s, item.id]) : setFocused(item)} />

        </View>} ListEmptyComponent={<EmptyState icon="library-outline" title={query || collection ? 'No matching titles' : section === 'hidden' ? 'No hidden titles' : section === 'watching' ? 'Start something good' : 'Your library starts here'} subtitle={query || collection ? 'Try another search or clear the collection filter.' : 'Find a title in Discover to bookmark it or log something you have seen.'} actionLabel="Discover titles" onAction={() => router.navigate('/(tabs)')} compact />} />}
    </>}
    <BottomSheet visible={sheet === 'tools'} title="Library tools" onDismiss={() => setSheet(null)}>
      <ListItem headline="Sort titles" leadingIcon="swap-vertical-outline" onPress={() => setSheet('sort')} />
      <ListItem headline="Collections" leadingIcon="folder-outline" onPress={() => setSheet('collections')} />
      {SECTIONS.slice(2).map(s => <ListItem key={s.key} headline={s.label} leadingIcon={s.key === 'watching' ? 'tv-outline' : s.key === 'diary' ? 'journal-outline' : 'eye-off-outline'} onPress={() => {
        setSection(s.key);
        setCollection(null);
        setSelected([]);
        setQuery('');
        setSheet(null);
      }} />)}
    </BottomSheet>
    <BottomSheet visible={sheet === 'sort'} title="Sort library" onDismiss={() => setSheet(null)}>
      {([{
        key: 'recent',
        label: 'Recently added'
      }, {
        key: 'title',
        label: 'Title A–Z'
      }, {
        key: 'rating',
        label: 'Your highest rated'
      }, {
        key: 'runtime',
        label: 'Shortest first'
      }, {
        key: 'release',
        label: 'Newest releases'
      }] as const).map(s => <ListItem key={s.key} headline={s.label} selected={sort === s.key} trailingIcon={sort === s.key ? 'checkmark' : undefined} onPress={() => {
        setSort(s.key);
        setSheet(null);
      }} />)}
    </BottomSheet>
    <BottomSheet visible={sheet === 'collections'} title={selected.length ? 'Add selected titles to a collection' : 'Your collections'} onDismiss={() => setSheet(null)}>
      <View style={{
        gap: 12,
        padding: 16
      }}>
        <TextField label="New collection" value={name} onChangeText={setName} maxLength={60} placeholder="Weekend watchlist" />
        <Button label="Create collection" disabled={!name.trim() || busy} onPress={() => run(async () => {
          const id = await createCollection(name);
          for (const i of selectedItems) await setCollectionMember(id, i, true);
          setName('');
          setCollection(id);
          setSelected([]);
          setSheet(null);
        })} />
        {collections.map(c => <ListItem key={c.key} headline={c.payload.name} trailingIcon="chevron-forward" onPress={() => run(async () => {
          for (const i of selectedItems) await setCollectionMember(c.payload.id, i, true);
          setCollection(c.payload.id);
          setSelected([]);
          setSheet(null);
        })} />)}
        {collection && <Button label="Delete this collection" variant="text" tone="error" onPress={() => run(async () => {
          const r = collections.find(c => c.payload.id === collection);
          if (r) {
            await writeActivity('collection', collection, r.payload, true);
            notice({
              message: 'Collection deleted; titles kept',
              undo: async () => {
                await writeActivity('collection', collection, r.payload);
              }
            });
          }
          setCollection(null);
          setSheet(null);
        })} />}
      </View>
    </BottomSheet>
    <BottomSheet visible={!!focused} title={focused?.title ?? ''} onDismiss={() => setFocused(null)}>
      {focused && <>
        <ListItem headline="Rate and log" leadingIcon="star-outline" onPress={() => {
          router.push({
            pathname: '/detail/[id]',
            params: {
              id: String(focused.tmdbId),
              mediaType: focused.mediaType,
              autoRate: 'true'
            }
          });
          setFocused(null);
        }} />
        {focused.id > 0 && <ListItem headline="Select multiple titles" leadingIcon="checkmark-circle-outline" onPress={() => {
          setSelected([focused.id]);
          setFocused(null);
        }} />}
        {focused.id > 0 && <ListItem headline="Add to collection" leadingIcon="folder-outline" onPress={() => {
          setSelected([focused.id]);
          setFocused(null);
          setSheet('collections');
        }} />}
        {section === 'hidden' && <ListItem headline="Show in recommendations again" leadingIcon="eye-outline" onPress={() => run(async () => {
          if (focused.status === 'not_interested' && focused.id > 0) await updateItem(focused.id, {
            status: 'watchlist'
          });
          const feedback = activity.find(r => r.key === `feedback:${focused.mediaType}:${focused.tmdbId}`);
          if (feedback) await writeActivity('feedback', `${focused.mediaType}:${focused.tmdbId}`, feedback.payload, true);
          setFocused(null);
        })} />}
        {collection && <ListItem headline="Remove from collection" leadingIcon="folder-outline" onPress={() => run(async () => {
          await setCollectionMember(collection, focused, false);
          setFocused(null);
        })} />}
        {focused.id > 0 && <ListItem headline="Remove from library" leadingIcon="trash-outline" destructive onPress={() => run(() => remove([focused]))} />}
      </>}
    </BottomSheet>
  </View>;
}
