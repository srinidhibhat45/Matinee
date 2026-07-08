import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import AiRecommendFab from '../../components/AiRecommendFab';

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  
  const bottomInset = insets.bottom;
  const paddingBottom = bottomInset > 0 ? bottomInset : 6;
  const height = 50 + paddingBottom;

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: [
            styles.tabBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              height,
              paddingBottom,
            },
          ],
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Discover',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'search' : 'search-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="upcoming"
          options={{
            title: 'Upcoming',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: 'Stats',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Library',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} />
            ),
          }}
        />
      </Tabs>

      {/* AI Recommendation FAB — floats above all tab screens */}
      <AiRecommendFab />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabBar: {
    borderTopWidth: 0.5,
    paddingTop: 8,
    elevation: 0,
  },
});
