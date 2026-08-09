import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { motion, shape, spacing, MIN_TOUCH_TARGET } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import { useResponsive } from '../../hooks/useResponsive';
import { Badge } from './Feedback';
import Text from './Text';
import Touchable from './Touchable';

export const NAVIGATION_BAR_HEIGHT = 80;
export const NAVIGATION_RAIL_WIDTH = 80;

export interface NavDestination {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Filled counterpart shown when the destination is active, per M3. */
  activeIcon: keyof typeof Ionicons.glyphMap;
  badgeCount?: number;
}

interface NavItemProps {
  destination: NavDestination;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  orientation: 'bar' | 'rail';
}

/**
 * A single navigation destination.
 *
 * The active indicator — M3's rounded pill behind the icon — animates in rather
 * than snapping, which is what makes tab switching read as movement between
 * places instead of a colour change.
 */
function NavItem({ destination, active, onPress, onLongPress, orientation }: NavItemProps) {
  const { colors, reduceMotion } = useTheme();
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0,
      duration: reduceMotion ? 0 : motion.duration.medium1,
      easing: Easing.bezier(...([...motion.easing.emphasizedDecelerate] as [number, number, number, number])),
      useNativeDriver: true,
    }).start();
  }, [active, anim, reduceMotion]);

  const iconColor = active ? colors.onSecondaryContainer : colors.onSurfaceVariant;
  const labelColor = active ? colors.onSurface : colors.onSurfaceVariant;
  const indicatorWidth = orientation === 'bar' ? 64 : 56;

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      stateLayerColor={colors.onSurface}
      borderRadius={shape.full}
      accessibilityRole="tab"
      accessibilityLabel={destination.label}
      accessibilityState={{ selected: active }}
      accessibilityHint={active ? undefined : `Switches to ${destination.label}`}
      testID={`nav-${destination.key}`}
      style={[styles.item, orientation === 'rail' && styles.itemRail]}
    >
      <View style={styles.iconArea}>
        <Animated.View
          style={[
            styles.indicator,
            {
              width: indicatorWidth,
              backgroundColor: colors.secondaryContainer,
              opacity: anim,
              transform: [{ scaleX: anim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }],
            },
          ]}
        />
        <Ionicons
          name={active ? destination.activeIcon : destination.icon}
          size={24}
          color={iconColor}
        />
        {destination.badgeCount ? (
          <Badge count={destination.badgeCount} style={styles.badge} />
        ) : null}
      </View>

      <Text
        variant="labelMedium"
        color={labelColor}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={styles.label}
      >
        {destination.label}
      </Text>
    </Touchable>
  );
}

export interface NavigationProps {
  destinations: NavDestination[];
  activeKey: string;
  onSelect: (key: string) => void;
  onReselect?: (key: string) => void;
  /** Rail-only slot for a FAB above the destinations. */
  railHeader?: React.ReactNode;
}

/**
 * Material 3 navigation bar — the bottom bar used on compact (phone) windows.
 */
export function NavigationBar({
  destinations,
  activeKey,
  onSelect,
  onReselect,
}: NavigationProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceContainer,
          paddingBottom: insets.bottom,
          height: NAVIGATION_BAR_HEIGHT + insets.bottom,
        },
      ]}
    >
      {destinations.map((destination) => (
        <NavItem
          key={destination.key}
          destination={destination}
          orientation="bar"
          active={destination.key === activeKey}
          onPress={() =>
            destination.key === activeKey
              ? onReselect?.(destination.key)
              : onSelect(destination.key)
          }
        />
      ))}
    </View>
  );
}

/**
 * Material 3 navigation rail — the vertical bar that replaces the bottom bar
 * once the window is at least 600dp wide. Thumb reach stops being the
 * constraint at that size, and a rail returns the height to content.
 */
export function NavigationRail({
  destinations,
  activeKey,
  onSelect,
  onReselect,
  railHeader,
}: NavigationProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.rail,
        {
          backgroundColor: colors.surface,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          borderRightColor: colors.outlineVariant,
        },
      ]}
    >
      {railHeader ? <View style={styles.railHeader}>{railHeader}</View> : null}
      {destinations.map((destination) => (
        <NavItem
          key={destination.key}
          destination={destination}
          orientation="rail"
          active={destination.key === activeKey}
          onPress={() =>
            destination.key === activeKey
              ? onReselect?.(destination.key)
              : onSelect(destination.key)
          }
        />
      ))}
    </View>
  );
}

/**
 * Picks the bar or the rail for the current window size class. Screens never
 * need to know which one is showing — only how much space to leave, which the
 * navigator handles.
 */
export function AdaptiveNavigation(props: NavigationProps) {
  const { isCompact } = useResponsive();
  return isCompact ? <NavigationBar {...props} /> : <NavigationRail {...props} />;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: spacing.md,
  },
  rail: {
    width: NAVIGATION_RAIL_WIDTH,
    height: '100%',
    alignItems: 'center',
    gap: spacing.md,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  railHeader: {
    marginBottom: spacing.md,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 2,
  },
  itemRail: {
    flex: 0,
    width: NAVIGATION_RAIL_WIDTH,
    paddingVertical: spacing.xs,
  },
  iconArea: {
    height: 32,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    height: 32,
    borderRadius: shape.full,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: 14,
  },
  label: {
    textAlign: 'center',
  },
});
