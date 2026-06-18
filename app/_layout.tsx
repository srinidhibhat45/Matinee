import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import { initDatabase, performFullSync } from '../services/database';
import { notificationService } from '../services/notifications';
import { cloudSync } from '../services/cloudSync';
import { isFirebaseConfigured } from '../services/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

function RootLayoutContent({ isReady }: { isReady: boolean }) {
  const { colors, isDark } = useTheme();

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="detail/[id]"
          options={{
            headerShown: false,
            animation: 'fade',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // 1. Initialise local database
        await initDatabase();
        await notificationService.initialize();

        // 2. Initialise cloud sync (if Firebase is configured)
        if (isFirebaseConfigured()) {
          try {
            const apiKey = await AsyncStorage.getItem('@matinee_api_key');
            if (apiKey) {
              const cloudReady = await cloudSync.initCloudSync(apiKey);
              if (cloudReady) {
                // Background sync — don't await, let it run while user interacts
                performFullSync().catch((err) =>
                  console.warn('[Matinee] Background sync failed:', err)
                );
              }
            }
          } catch (syncErr) {
            console.warn('[Matinee] Cloud sync init failed (non-fatal):', syncErr);
          }
        }
      } catch (err) {
        console.error('Failed to initialize services:', err);
      } finally {
        setIsReady(true);
      }
    }
    prepare();
  }, []);

  return (
    <ThemeProvider>
      <RootLayoutContent isReady={isReady} />
    </ThemeProvider>
  );
}
