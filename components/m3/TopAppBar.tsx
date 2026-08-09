import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, MIN_TOUCH_TARGET } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';

export type TopAppBarVariant = 'small' | 'medium' | 'large' | 'centerAligned';

export interface TopAppBarProps {
  title: string;
  subtitle?: string;
  /** Back arrow / menu button, rendered at the start of the bar. */
  leading?: React.ReactNode;
  /** Up to three trailing actions, per the M3 spec. */
  actions?: React.ReactNode;
  variant?: TopAppBarVariant;
  /**
   * Raises the bar to `surfaceContainer` — M3's "on-scroll" state, which
   * separates the bar from content scrolling underneath it.
   */
  scrolled?: boolean;
  /** Set false when the bar is not the first thing under the status bar. */
  applyTopInset?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Material 3 top app bar.
 *
 * `medium` and `large` put the headline on a second line below the action row,
 * which is what gives M3 screens their generous, unhurried header. `small` and
 * `centerAligned` keep everything on one 64dp row.
 */
export default function TopAppBar({
  title,
  subtitle,
  leading,
  actions,
  variant = 'small',
  scrolled = false,
  applyTopInset = true,
  style,
}: TopAppBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const background = scrolled ? colors.surfaceContainer : colors.surface;
  const twoLine = variant === 'medium' || variant === 'large';

  return (
    <View
      style={[
        {
          backgroundColor: background,
          paddingTop: applyTopInset ? insets.top : 0,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.leading}>{leading}</View>

        {!twoLine ? (
          <View
            style={[
              styles.titleWrap,
              variant === 'centerAligned' && styles.titleCentered,
            ]}
          >
            <Text
              variant="titleLarge"
              color={colors.onSurface}
              numberOfLines={1}
              accessibilityRole="header"
              style={variant === 'centerAligned' ? styles.textCentered : undefined}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                variant="labelMedium"
                color={colors.onSurfaceVariant}
                numberOfLines={1}
                style={variant === 'centerAligned' ? styles.textCentered : undefined}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.titleWrap} />
        )}

        <View style={styles.actions}>{actions}</View>
      </View>

      {twoLine ? (
        <View style={styles.headline}>
          <Text
            variant={variant === 'large' ? 'headlineMedium' : 'headlineSmall'}
            color={colors.onSurface}
            numberOfLines={2}
            accessibilityRole="header"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  leading: {
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  titleCentered: {
    alignItems: 'center',
  },
  textCentered: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  headline: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.xs,
    gap: spacing.xs,
  },
});
