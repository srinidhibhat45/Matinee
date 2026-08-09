import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, motion, shape, spacing, withAlpha } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';
import Touchable from './Touchable';

/* ------------------------------------------------------------------ *
 * Badge
 * ------------------------------------------------------------------ */

export interface BadgeProps {
  /** Omit for the 6dp dot badge; pass a number for the labelled badge. */
  count?: number;
  max?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Material 3 badge. Counts above `max` collapse to "9+" so the pill never
 * outgrows the icon it is anchored to.
 */
export function Badge({ count, max = 9, style }: BadgeProps) {
  const { colors } = useTheme();

  if (count === undefined) {
    return (
      <View
        style={[badge.dot, { backgroundColor: colors.error }, style]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }

  if (count <= 0) return null;
  const label = count > max ? `${max}+` : String(count);

  return (
    <View
      style={[badge.pill, { backgroundColor: colors.error }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text variant="labelSmall" color={colors.onError} style={badge.text} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

const badge = StyleSheet.create({
  dot: {
    width: 6,
    height: 6,
    borderRadius: shape.full,
  },
  pill: {
    minWidth: 16,
    height: 16,
    borderRadius: shape.full,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    lineHeight: 16,
    textAlign: 'center',
  },
});

/* ------------------------------------------------------------------ *
 * Snackbar
 * ------------------------------------------------------------------ */

export interface SnackbarProps {
  visible: boolean;
  message: string;
  /** Optional single action, e.g. "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-hide delay in ms. Pass 0 to require an explicit dismissal. */
  duration?: number;
  /** Lifts the snackbar clear of a bottom navigation bar or FAB. */
  bottomOffset?: number;
}

/**
 * Material 3 snackbar — the app's replacement for `ToastAndroid`, which only
 * existed on Android and ignored the theme entirely.
 */
export function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 4000,
  bottomOffset = 0,
}: SnackbarProps) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? motion.duration.medium1 : motion.duration.short3,
      easing: Easing.bezier(...motion.easing.emphasizedDecelerate),
      useNativeDriver: true,
    }).start();

    if (!visible || duration <= 0) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onDismiss, progress, reduceMotion]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        snackbar.wrapper,
        {
          bottom: Math.max(insets.bottom, spacing.lg) + bottomOffset,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          ],
        },
      ]}
    >
      <View
        style={[
          snackbar.container,
          { backgroundColor: colors.inverseSurface, ...elevation(3, colors.shadow) },
        ]}
      >
        <Text
          variant="bodyMedium"
          color={colors.inverseOnSurface}
          numberOfLines={2}
          style={snackbar.message}
        >
          {message}
        </Text>
        {actionLabel ? (
          <Touchable
            onPress={() => {
              onAction?.();
              onDismiss();
            }}
            stateLayerColor={colors.inversePrimary}
            borderRadius={shape.small}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={snackbar.action}
          >
            <Text variant="labelLarge" color={colors.inversePrimary}>
              {actionLabel}
            </Text>
          </Touchable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const snackbar = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 10000,
    alignItems: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    width: '100%',
    maxWidth: 560,
    borderRadius: shape.extraSmall,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  message: {
    flex: 1,
  },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: shape.small,
    overflow: 'hidden',
  },
});

/* ------------------------------------------------------------------ *
 * Progress indicators
 * ------------------------------------------------------------------ */

export interface LoadingProps {
  /** Announced to screen readers while busy. */
  label?: string;
  size?: 'small' | 'large';
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Indeterminate circular progress with the busy state announced. A bare
 * `ActivityIndicator` is invisible to a screen reader, which makes a loading
 * screen read as an empty one.
 */
export function Loading({ label = 'Loading', size = 'small', color, style }: LoadingProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[loading.wrap, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator size={size} color={color ?? colors.primary} />
    </View>
  );
}

const loading = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
});

/* ------------------------------------------------------------------ *
 * Linear progress
 * ------------------------------------------------------------------ */

export interface LinearProgressProps {
  /** 0–1. Omit for the indeterminate track. */
  progress?: number;
  label?: string;
  height?: number;
  color?: string;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function LinearProgress({
  progress,
  label,
  height = 4,
  color,
  trackColor,
  style,
}: LinearProgressProps) {
  const { colors } = useTheme();
  const clamped = progress === undefined ? undefined : Math.min(1, Math.max(0, progress));

  return (
    <View
      style={[
        {
          height,
          borderRadius: shape.full,
          backgroundColor: trackColor ?? withAlpha(colors.onSurfaceVariant, 0.2),
          overflow: 'hidden',
        },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        clamped === undefined ? undefined : { min: 0, max: 100, now: Math.round(clamped * 100) }
      }
    >
      <View
        style={{
          width: `${(clamped ?? 0) * 100}%`,
          height: '100%',
          borderRadius: shape.full,
          backgroundColor: color ?? colors.primary,
        }}
      />
    </View>
  );
}
