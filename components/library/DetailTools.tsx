import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Text, TextField } from '../m3';
import { useLibrary, refreshLibrary } from '../../hooks/useLibrary';
import { useTheme } from '../../context/ThemeContext';
import { useNotice } from '../../context/NoticeContext';
import { addViewing, localDay, setWatching, setRecommendationFeedback, titleKey, writeActivity } from '../../services/libraryActivity';
import type { TMDBMediaDetails } from '../../types';
export default function DetailTools({
  item
}: {
  item: TMDBMediaDetails;
}) {
  const {
    activity
  } = useLibrary();
  const {
    colors
  } = useTheme();
  const notice = useNotice();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localDay());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const key = titleKey(item.mediaType, item.id);
  const watching = activity.some(r => r.key === `watching:${key}`);
  const feedback = activity.find(r => r.key === `feedback:${key}`);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refreshLibrary();
    } catch (e: any) {
      notice({
        message: e.message || 'Could not save. Try again.'
      });
    } finally {
      setBusy(false);
    }
  }
  const future = item.releaseDate && item.releaseDate > localDay();
  return <View style={{
    marginHorizontal: 20,
    gap: 16,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderColor: colors.outlineVariant
  }}>
    {!future && <View style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    }}>
      <Button label={watching ? 'Watching · stop tracking' : 'Start watching'} icon="play-outline" variant="tonal" disabled={busy} onPress={() => run(async () => {
        await setWatching(item, !watching);
        notice({
          message: watching ? 'Removed from Continue watching' : 'Added to Continue watching'
        });
      })} />
      <Button label={open ? 'Close viewing form' : 'Log a viewing / rewatch'} icon="journal-outline" variant="outlined" onPress={() => setOpen(!open)} />
    </View>}
    {open && <View style={{
      gap: 12
    }}>
      <TextField label="Watched date (YYYY-MM-DD)" value={date} onChangeText={setDate} maxLength={10} />
      <TextField label="A note for your diary (optional)" value={note} onChangeText={setNote} maxLength={2000} multiline />
      <Button label="Save viewing" loading={busy} disabled={busy} onPress={() => run(async () => {
        await addViewing(item, date, note);
        setOpen(false);
        setNote('');
        notice({
          message: 'Viewing added to your diary'
        });
      })} />
    </View>}
    <Text variant="titleSmall" accessibilityRole="header">Shape your recommendations</Text>
    <View style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    }}>
      {([{
        key: 'more',
        label: 'More like this'
      }, {
        key: 'similar',
        label: 'Too similar'
      }, {
        key: 'mood',
        label: 'Not tonight'
      }, {
        key: 'hide',
        label: 'Hide suggestion'
      }] as const).map(f => <Chip key={f.key} label={f.label} variant="filter" selected={feedback?.payload.feedback === f.key} disabled={busy} onPress={() => run(async () => {
        if (feedback?.payload.feedback === f.key) await writeActivity('feedback', key, feedback.payload, true);else await setRecommendationFeedback(item, f.key);
        notice({
          message: 'Recommendation preference saved'
        });
      })} />)}
    </View>
    {feedback && <Text variant="bodySmall" color={colors.onSurfaceVariant}>{feedback.payload.feedback === 'mood' ? 'This title takes a break for 24 hours.' : 'Tap the selected option again to clear it.'}</Text>}
  </View>;
}
