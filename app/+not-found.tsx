import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import EmptyState from '../components/EmptyState';

export default function NotFoundScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="compass-outline"
          title="This screen doesn't exist"
          subtitle="The link you followed may be broken, or the page may have moved."
          actionLabel="Go to Discover"
          onAction={() => router.replace('/(tabs)')}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
