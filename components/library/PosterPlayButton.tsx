import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { IconButton } from '../m3';
import { useNotice } from '../../context/NoticeContext';
import { getViewingLink } from '../../services/viewing';
import type { TMDBMediaDetails } from '../../types';

/** A single optional exit to streaming options; the app stays focused on logging. */
export default function PosterPlayButton({item}: {item: TMDBMediaDetails}) {
  const notice = useNotice();
  const action = getViewingLink(item);
  if (!action) return null;
  return (
    <View style={styles.position}>
      <IconButton
        icon="play"
        size={48}
        iconSize={22}
        color="#FFFFFF"
        style={styles.button}
        accessibilityLabel={action.label}
        accessibilityHint={action.hint}
        onPress={() => Linking.openURL(action.url).catch(() => notice({message: 'Could not open the link. Please try again.'}))}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  position: {position: 'absolute', bottom: 6, right: 6},
  button: {backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 24},
});
