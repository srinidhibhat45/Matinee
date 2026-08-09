import React, { useCallback, useMemo } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useResponsive } from '../../hooks/useResponsive';
import {
  AdaptiveNavigation,
  NAVIGATION_RAIL_WIDTH,
  type NavDestination,
} from '../../components/m3';
import AiRecommendFab from '../../components/AiRecommendFab';

/**
 * The app's four top-level destinations, in the order M3 recommends: the
 * primary task first, settings-like content last.
 */
const DESTINATIONS: NavDestination[] = [
  { key: 'index', label: 'Discover', icon: 'compass-outline', activeIcon: 'compass' },
  { key: 'upcoming', label: 'Upcoming', icon: 'calendar-outline', activeIcon: 'calendar' },
  { key: 'stats', label: 'Stats', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { key: 'profile', label: 'Library', icon: 'library-outline', activeIcon: 'library' },
];

export default function TabLayout() {
  const { colors } = useTheme();
  const { isCompact } = useResponsive();

  /**
   * One custom tab bar serves both layouts. React Navigation is told where to
   * put it via `tabBarPosition`, so it reserves the right edge of the scene and
   * we never have to pad screens by hand.
   */
  const renderTabBar = useCallback(
    ({ state, navigation, descriptors }: any) => {
      const activeKey = state.routes[state.index]?.name ?? 'index';

      const destinations = DESTINATIONS.filter((destination) =>
        state.routes.some((route: any) => route.name === destination.key)
      );

      const emit = (key: string, type: 'tabPress' | 'tabLongPress') => {
        const route = state.routes.find((r: any) => r.name === key);
        if (!route) return null;
        return navigation.emit({ type, target: route.key, canPreventDefault: true });
      };

      return (
        <AdaptiveNavigation
          destinations={destinations}
          activeKey={activeKey}
          onSelect={(key) => {
            const event = emit(key, 'tabPress');
            if (!event?.defaultPrevented) {
              navigation.navigate(key);
            }
          }}
          // Re-tapping the active destination is how the screens reset their
          // own scroll/search state, so the event still has to be emitted.
          onReselect={(key) => emit(key, 'tabPress')}
        />
      );
    },
    []
  );

  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarPosition: (isCompact ? 'bottom' : 'left') as 'bottom' | 'left',
      sceneStyle: { backgroundColor: colors.background },
    }),
    [isCompact, colors.background]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Tabs tabBar={renderTabBar} screenOptions={screenOptions}>
        <Tabs.Screen name="index" options={{ title: 'Discover' }} />
        <Tabs.Screen name="upcoming" options={{ title: 'Upcoming' }} />
        <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
        <Tabs.Screen name="profile" options={{ title: 'Library' }} />
      </Tabs>

      {/* AI recommendation FAB — floats above every tab screen. */}
      <AiRecommendFab railOffset={isCompact ? 0 : NAVIGATION_RAIL_WIDTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
