import { NoticeProvider } from '../context/NoticeContext';
import { getSecret, setSecret, removeSecret } from '../services/secrets';
import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar, View, Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Loading } from '../components/m3';
import { initDatabase, performFullSync, getPreference, setPreference } from '../services/database';
import { notificationService } from '../services/notifications';
import { cloudSync } from '../services/cloudSync';
import { isFirebaseConfigured, bindKeys, lookupKey, tmdbService } from '../services';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import UpdateBanner from '../components/UpdateBanner';

function RootLayoutContent({ isReady }: { isReady: boolean }) {
  const { colors, isDark } = useTheme();
  useEffect(() => {
    if (!isReady) return;
    let lastAttempt = 0;
    const retry = () => {
      if (Date.now() - lastAttempt < 60000 || !cloudSync.isCloudEnabled()) return;
      lastAttempt = Date.now();
      performFullSync().catch(() => {});
    };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    const timer = setInterval(retry, 120000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [isReady]);


  useEffect(() => {
    if (!isReady || Platform.OS === 'web') return;

    function handleNotificationResponse(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data;
      const tmdbId = data?.tmdbId;
      const mediaType = data?.mediaType;
      const actionId = response.actionIdentifier;

      if (tmdbId && mediaType) {
        if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER || actionId === 'view-movie') {
          // Delay briefly to allow stack to layout, then navigate
          setTimeout(() => {
            router.push({
              pathname: '/detail/[id]',
              params: { id: String(tmdbId), mediaType },
            } as any);
          }, 200);
        }
      }
    }

    // 1. Check if the app was opened by a notification response
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    // 2. Listen for notification response received (tapped / action selected)
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });

    return () => {
      subscription.remove();
    };
  }, [isReady]);

  if (!isReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Loading label="Starting Matinee" size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <NoticeProvider><Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
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

      <UpdateBanner /></NoticeProvider>

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
        setIsReady(true);
        notificationService.initialize().catch(console.warn);

        // 2. Initialise cloud sync and autofill bound keys (if Firebase is configured)
        if (isFirebaseConfigured()) {
          try {
            const apiKey = await getSecret('@matinee_api_key');
            {
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
