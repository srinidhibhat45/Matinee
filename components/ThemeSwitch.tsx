import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../constants/m3';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import { SegmentedButtons } from './m3';

const OPTIONS: { value: ThemePreference; label: string; icon: 'sunny-outline' | 'moon-outline' | 'phone-portrait-outline' }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'Auto', icon: 'phone-portrait-outline' },
];

/**
 * Theme picker.
 *
 * Replaces the old two-state sliding toggle: that control could not express
 * "follow the system", which is the setting most users actually want and is
 * now the app's default.
 */
export default function ThemeSwitch() {
  const { preference, setPreference } = useTheme();

  return (
    <View style={styles.container}>
      <SegmentedButtons
        options={OPTIONS}
        value={preference}
        onChange={setPreference}
        accessibilityLabel="Appearance"
        dense
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    marginVertical: spacing.xs,
  },
});
