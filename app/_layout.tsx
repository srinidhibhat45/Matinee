import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar, View, ActivityIndicator, Platform, Text, TouchableOpacity } from 'react-native';
import * as Notifications from 'expo-notifications';
import { initDatabase, performFullSync, getPreference, setPreference } from '../services/database';
import { notificationService } from '../services/notifications';
import { cloudSync } from '../services/cloudSync';
import { isFirebaseConfigured, bindKeys, lookupKey, tmdbService } from '../services';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

function RootLayoutContent({ isReady }: { isReady: boolean }) {
  const { colors, isDark } = useTheme();
  const [showWebPrompt, setShowWebPrompt] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const checkWidth = () => {
        if (window.innerWidth > 768) {
          setShowWebPrompt(true);
        } else {
          setShowWebPrompt(false);
        }
      };
      checkWidth();
      window.addEventListener('resize', checkWidth);
      return () => window.removeEventListener('resize', checkWidth);
    }
  }, []);

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

      {showWebPrompt && (
        <View style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          backgroundColor: '#141416',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          padding: 16,
          borderRadius: 16,
          maxWidth: 320,
          zIndex: 99999,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 15 }}>🖥️ Mobile View Recommended</Text>
            <TouchableOpacity onPress={() => setShowWebPrompt(false)}>
              <Text style={{ color: '#9CA3AF', fontSize: 18, fontWeight: 'bold', paddingLeft: 8 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#9CA3AF', fontSize: 12, lineHeight: 17 }}>
            This app is optimized for phone viewports. For the best experience, please resize your browser window to a mobile width or toggle mobile emulation in DevTools (F12).
          </Text>
        </View>
      )}
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

        // 2. Initialise cloud sync and autofill bound keys (if Firebase is configured)
        if (isFirebaseConfigured()) {
          try {
            let apiKey = await AsyncStorage.getItem('@matinee_api_key');
            let geminiKey = await getPreference('PREF_GEMINI_API_KEY');

            if (apiKey && !geminiKey) {
              const bound = await lookupKey(apiKey);
              if (bound.geminiKey) {
                geminiKey = bound.geminiKey;
                await setPreference('PREF_GEMINI_API_KEY', geminiKey);
                console.log('[RootLayout] Automatically restored Gemini key from bound TMDB key.');
              }
            } else if (!apiKey && geminiKey) {
              const bound = await lookupKey(geminiKey);
              if (bound.tmdbKey) {
                apiKey = bound.tmdbKey;
                await setPreference('API_KEY_STORAGE', apiKey);
                await AsyncStorage.setItem('@matinee_api_key', apiKey);
                await tmdbService.setApiKey(apiKey);
                console.log('[RootLayout] Automatically restored TMDB key from bound Gemini key.');
              }
            } else if (apiKey && geminiKey) {
              // Ensure they are bound in the cloud
              bindKeys(apiKey, geminiKey).catch(() => {});
            }

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
