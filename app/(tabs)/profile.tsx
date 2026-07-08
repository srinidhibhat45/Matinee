import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  TextInput,
  Alert,
  RefreshControl,
  Platform,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import ThemeSwitch from '../../components/ThemeSwitch';
import { getImageUrl, tmdbService } from '../../services/tmdb';
import {
  exportUserData,
  getAllItems,
  getPreference,
  importUserData,
  setPreference,
  clearAllData,
  performFullSync,
  addItem,
  deleteItem,
} from '../../services/database';
import { cloudSync } from '../../services/cloudSync';
import { isFirebaseConfigured, bindKeys, lookupKey, handleKeyAutofill } from '../../services';
import { WatchedItem, ItemStatus, MediaType } from '../../types';
import { LANGUAGES, DEFAULT_LANGUAGES } from '../../constants/languages';
import { COUNTRIES } from '../../constants/providers';
import { OTT_PROVIDERS } from '../../constants/providers';

type LibraryTab = 'watchlist' | 'watched';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 32 - 12) / 3; // 32px padding + 2×6px gaps

export default function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { tab, mediaType } = useLocalSearchParams<{ tab?: string; mediaType?: string }>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<LibraryTab>('watchlist');
  const [filterMediaType, setFilterMediaType] = useState<MediaType | null>(null);
  const [items, setItems] = useState<WatchedItem[]>([]);
  const [counts, setCounts] = useState<Record<LibraryTab, number>>({
    watched: 0,
    watchlist: 0,
  });
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    showCancel?: boolean;
    isDestructive?: boolean;
  } | null>(null);

  const showCustomAlert = useCallback((title: string, message: string, onConfirm?: () => void) => {
    setConfirmModal({
      visible: true,
      title,
      message,
      confirmText: 'OK',
      showCancel: false,
      onConfirm: onConfirm || (() => {}),
    });
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setShowSettings(false);
    });
    return unsubscribe;
  }, [navigation]);

  const fetchItems = useCallback(async () => {
    try {
      const allData = await getAllItems(undefined, filterMediaType || undefined);
      
      const watched = allData.filter((i) => i.status === 'watched');
      const watchlist = allData.filter((i) => i.status === 'watchlist');

      setCounts({
        watched: watched.length,
        watchlist: watchlist.length,
      });

      if (activeTab === 'watched') {
        setItems(watched);
      } else {
        const now = new Date();
        const upcoming = watchlist.filter((item) => {
          if (!item.releaseDate) return false;
          try {
            return new Date(item.releaseDate) > now;
          } catch {
            return false;
          }
        });
        const released = watchlist.filter((item) => {
          if (!item.releaseDate) return true;
          try {
            return new Date(item.releaseDate) <= now;
          } catch {
            return true;
          }
        });

        upcoming.sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());
        released.sort((a, b) => {
          if (!a.releaseDate && !b.releaseDate) return 0;
          if (!a.releaseDate) return 1;
          if (!b.releaseDate) return -1;
          return new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime();
        });

        setItems([...upcoming, ...released]);
      }
    } catch (err) {
      console.error('Fetch library items error:', err);
    }
  }, [activeTab, filterMediaType]);

  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [savedApiKey, setSavedApiKey] = useState('');
  const [apiProxy, setApiProxy] = useState('');
  const [savedApiProxy, setSavedApiProxy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [longPressItem, setLongPressItem] = useState<any | null>(null);

  const handleLibraryItemLongPress = useCallback(async (item: any) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setLongPressItem(item);
    } catch (err) {
      console.error('Library long press error:', err);
    }
  }, []);

  const handleLongPressAction = useCallback(async (action: 'rate' | 'remove' | 'not_interested') => {
    if (!longPressItem) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const tmdbId = longPressItem.tmdbId;
      const mediaType = longPressItem.mediaType;

      if (action === 'rate') {
        setLongPressItem(null);
        router.push({
          pathname: '/detail/[id]',
          params: { id: String(tmdbId), mediaType, autoRate: 'true' },
        });
        return;
      }

      if (action === 'remove') {
        await deleteItem(longPressItem.id);
      } else if (action === 'not_interested') {
        await addItem({
          tmdbId,
          mediaType,
          title: longPressItem.title,
          posterPath: longPressItem.posterPath,
          backdropPath: longPressItem.backdropPath,
          overview: longPressItem.overview,
          releaseDate: longPressItem.releaseDate,
          genres: longPressItem.genres,
          originalLanguage: longPressItem.originalLanguage,
          runtime: longPressItem.runtime,
          voteAverage: longPressItem.voteAverage,
          status: 'not_interested',
          watchedDate: null,
        });
      }

      setLongPressItem(null);
      await fetchItems();
    } catch (err) {
      console.error('Library long press action error:', err);
    }
  }, [longPressItem, fetchItems, router]);

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  // Preferences states
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [includeAdult, setIncludeAdult] = useState(false);
  const [filterByCountry, setFilterByCountry] = useState(false);
  const [userCountry, setUserCountry] = useState('US');
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [selectedOttProviders, setSelectedOttProviders] = useState<number[]>([]);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [savedGeminiApiKey, setSavedGeminiApiKey] = useState('');

  // Cloud sync states
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSyncDisplay, setLastSyncDisplay] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  // Sync tab/mediaType search params if they are passed
  useEffect(() => {
    if (tab === 'watchlist' || tab === 'watched') {
      setActiveTab(tab);
    }
    if (mediaType === 'movie' || mediaType === 'tv') {
      setFilterMediaType(mediaType);
    } else if (mediaType === 'clear') {
      setFilterMediaType(null);
    }
  }, [tab, mediaType]);

  const loadPreferences = useCallback(async () => {
    try {
      const key = await getPreference('API_KEY_STORAGE');
      if (key) {
        setApiKey(key);
        setSavedApiKey(key);
      }

      const langs = await getPreference('PREF_LANGUAGES');
      if (langs) {
        setSelectedLanguages(langs.split(','));
      } else {
        setSelectedLanguages(DEFAULT_LANGUAGES);
      }

      const adult = await getPreference('PREF_ADULT_CONTENT');
      setIncludeAdult(adult === 'true');

      const filterByCountryVal = await getPreference('PREF_FILTER_BY_COUNTRY');
      setFilterByCountry(filterByCountryVal === 'true');

      const userCountryVal = await getPreference('PREF_USER_COUNTRY');
      setUserCountry(userCountryVal || 'US');

      const ottPref = await getPreference('PREF_OTT_PROVIDERS');
      if (ottPref) setSelectedOttProviders(ottPref.split(',').map(Number).filter(Boolean));

      const geminiKey = await getPreference('PREF_GEMINI_API_KEY');
      if (geminiKey) {
        setGeminiApiKey(geminiKey);
        setSavedGeminiApiKey(geminiKey);
      }

      const proxy = await tmdbService.getProxy();
      if (proxy) {
        setApiProxy(proxy);
        setSavedApiProxy(proxy);
      }

      // Handle key binding lookup / sync at load time
      if (isFirebaseConfigured()) {
        if (key && !geminiKey) {
          const bound = await lookupKey(key);
          if (bound.geminiKey) {
            await setPreference('PREF_GEMINI_API_KEY', bound.geminiKey);
            setGeminiApiKey(bound.geminiKey);
            setSavedGeminiApiKey(bound.geminiKey);
          }
        } else if (!key && geminiKey) {
          const bound = await lookupKey(geminiKey);
          if (bound.tmdbKey) {
            await setPreference('API_KEY_STORAGE', bound.tmdbKey);
            await AsyncStorage.setItem('@matinee_api_key', bound.tmdbKey);
            await tmdbService.setApiKey(bound.tmdbKey);
            setApiKey(bound.tmdbKey);
            setSavedApiKey(bound.tmdbKey);
            cloudSync.initCloudSync(bound.tmdbKey).catch(() => {});
          }
        } else if (key && geminiKey) {
          // ensure they are bound
          bindKeys(key, geminiKey).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Load preferences error:', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchItems();
      loadPreferences();
      return () => {
        setShowSettings(false);
      };
    }, [fetchItems, loadPreferences])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchItems(), loadPreferences()]);
    setRefreshing(false);
  }, [fetchItems, loadPreferences]);

  const handleToggleLanguage = useCallback(async (langCode: string) => {
    setSelectedLanguages((prev) => {
      const next = prev.includes(langCode)
        ? prev.filter((code) => code !== langCode)
        : [...prev, langCode];
      
      setPreference('PREF_LANGUAGES', next.join(',')).catch((err) =>
        console.error('Save languages error:', err)
      );
      return next;
    });
  }, []);

  const handleToggleAdult = useCallback(async () => {
    try {
      const next = !includeAdult;
      setIncludeAdult(next);
      await setPreference('PREF_ADULT_CONTENT', String(next));
    } catch (err) {
      console.error('Save adult content pref error:', err);
    }
  }, [includeAdult]);

  const handleToggleFilterByCountry = useCallback(async () => {
    try {
      const next = !filterByCountry;
      setFilterByCountry(next);
      await setPreference('PREF_FILTER_BY_COUNTRY', String(next));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.error('Toggle filter by country error:', err);
    }
  }, [filterByCountry]);

  const handleSelectCountry = useCallback(async (code: string) => {
    try {
      setUserCountry(code);
      await setPreference('PREF_USER_COUNTRY', code);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.error('Select country error:', err);
    }
  }, []);

  const handleToggleOttProvider = useCallback(async (providerId: number) => {
    try {
      setSelectedOttProviders((prev) => {
        const next = prev.includes(providerId)
          ? prev.filter((id) => id !== providerId)
          : [...prev, providerId];
        setPreference('PREF_OTT_PROVIDERS', next.join(','));
        return next;
      });
    } catch (err) {
      console.error('Toggle OTT provider error:', err);
    }
  }, []);

  const handleSaveGeminiApiKey = useCallback(async () => {
    try {
      const trimmedKey = geminiApiKey.trim();
      await setPreference('PREF_GEMINI_API_KEY', trimmedKey);
      setSavedGeminiApiKey(trimmedKey);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (isFirebaseConfigured() && trimmedKey) {
        const result = await handleKeyAutofill(trimmedKey, 'gemini');
        if (result.autofilled && result.tmdbKey) {
          setApiKey(result.tmdbKey);
          setSavedApiKey(result.tmdbKey);
          showCustomAlert(
            'Success',
            'Gemini API key saved! Bound TMDB API key was automatically retrieved from the cloud.'
          );
          return;
        }

        // Link with existing TMDB key if it exists
        if (apiKey.trim()) {
          await bindKeys(apiKey.trim(), trimmedKey);
          showCustomAlert('Success', 'Gemini API key saved and bound with TMDB API key in the cloud.');
          return;
        }
      }

      showCustomAlert('Success', 'Gemini API key saved successfully');
    } catch (err) {
      console.error('Save Gemini API key error:', err);
      showCustomAlert('Error', 'Failed to save Gemini API key');
    }
  }, [geminiApiKey, apiKey, showCustomAlert]);

  const handleSaveApiKey = useCallback(async () => {
    try {
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        showCustomAlert('Error', 'Please enter a valid API key');
        return;
      }
      await setPreference('API_KEY_STORAGE', trimmedKey);
      setSavedApiKey(trimmedKey);
      await tmdbService.setApiKey(trimmedKey);

      // Re-initialise cloud sync with new key
      if (isFirebaseConfigured()) {
        cloudSync.initCloudSync(trimmedKey).catch(() => {});
        
        const result = await handleKeyAutofill(trimmedKey, 'tmdb');
        if (result.autofilled && result.geminiKey) {
          setGeminiApiKey(result.geminiKey);
          setSavedGeminiApiKey(result.geminiKey);
          showCustomAlert(
            'Success',
            'TMDB API key saved! Bound Gemini API key was automatically retrieved from the cloud.'
          );
          return;
        }

        // Link with existing Gemini key if it exists
        if (geminiApiKey.trim()) {
          await bindKeys(trimmedKey, geminiApiKey.trim());
          showCustomAlert('Success', 'TMDB API key saved and bound with Gemini API key in the cloud.');
          return;
        }
      }

      showCustomAlert('Success', 'API key saved successfully');
    } catch (err) {
      console.error('Save API key error:', err);
      showCustomAlert('Error', 'Failed to save API key');
    }
  }, [apiKey, geminiApiKey, showCustomAlert]);

  const handleSaveApiProxy = useCallback(async () => {
    try {
      const trimmed = apiProxy.trim();
      await tmdbService.setProxy(trimmed);
      setSavedApiProxy(trimmed);
      showCustomAlert('Success', trimmed ? 'Proxy configured successfully' : 'Proxy cleared successfully');
    } catch (err) {
      console.error('Save proxy error:', err);
      showCustomAlert('Error', 'Failed to save proxy configuration');
    }
  }, [apiProxy, showCustomAlert]);

  const performSync = useCallback(async () => {
    setSyncBusy(true);
    try {
      if (!cloudSync.isCloudEnabled()) {
        const key = await AsyncStorage.getItem('@matinee_api_key');
        if (key) {
          await cloudSync.initCloudSync(key);
        }
      }
      const result = await performFullSync();
      setLastSyncDisplay(new Date().toLocaleTimeString());
      showCustomAlert(
        'Sync Complete',
        `Pulled ${result.pulled} items from cloud, pushed ${result.pushed} local items.`
      );
    } catch (err) {
      console.error('Sync error:', err);
      showCustomAlert('Sync Failed', 'Could not sync with cloud. Check your connection.');
    } finally {
      setSyncBusy(false);
    }
  }, [showCustomAlert]);

  const handleSyncNow = useCallback(() => {
    if (syncBusy) return;
    setConfirmModal({
      visible: true,
      title: 'Confirm Sync',
      message: 'This will merge your local library and ratings with the cloud database. Continue?',
      confirmText: 'Sync Now',
      showCancel: true,
      onConfirm: performSync,
    });
  }, [syncBusy, performSync]);

  const performClearLocal = useCallback(async () => {
    try {
      await clearAllData();
      setItems([]);
      setCounts({ watched: 0, watchlist: 0 });
      showCustomAlert('Done', 'Local data has been cleared.');
    } catch (err) {
      console.error('Clear local data error:', err);
      showCustomAlert('Error', 'Failed to clear local data.');
    }
  }, [showCustomAlert]);

  const handleClearLocal = useCallback(() => {
    setConfirmModal({
      visible: true,
      title: 'Clear Local Data',
      message: 'This will delete all data from this device. Your cloud data (if any) will remain intact. Continue?',
      confirmText: 'Clear Data',
      showCancel: true,
      isDestructive: true,
      onConfirm: performClearLocal,
    });
  }, [performClearLocal]);

  const performFinalReset = useCallback(async () => {
    setResetBusy(true);
    try {
      if (cloudSync.isCloudEnabled()) {
        await cloudSync.deleteAllCloudData();
      }
      await clearAllData();
      await AsyncStorage.removeItem('@matinee_api_key');
      await tmdbService.removeApiKey();

      setItems([]);
      setCounts({ watched: 0, watchlist: 0 });
      setApiKey('');
      setSavedApiKey('');
      setSelectedLanguages(DEFAULT_LANGUAGES);
      setIncludeAdult(false);
      setFilterByCountry(false);
      setUserCountry('US');
      setSelectedOttProviders([]);
      setGeminiApiKey('');
      setSavedGeminiApiKey('');
      setLastSyncDisplay(null);
      
      await setPreference('API_KEY_STORAGE', '');
      await setPreference('PREF_LANGUAGES', DEFAULT_LANGUAGES.join(','));
      await setPreference('PREF_ADULT_CONTENT', 'false');
      await setPreference('PREF_FILTER_BY_COUNTRY', 'false');
      await setPreference('PREF_USER_COUNTRY', 'US');
      await setPreference('PREF_OTT_PROVIDERS', '');
      await setPreference('PREF_GEMINI_API_KEY', '');

      showCustomAlert('Reset Complete', 'Your application has been reset.');
      setShowSettings(false);
    } catch (err) {
      console.error('Reset all failed:', err);
      showCustomAlert('Reset Failed', 'Something went wrong. Please try again.');
    } finally {
      setResetBusy(false);
    }
  }, [showCustomAlert]);

  const handleResetAll = useCallback(() => {
    setConfirmModal({
      visible: true,
      title: '⚠️ Delete All Data & Reset',
      message: 'This will PERMANENTLY delete all your data from BOTH this device and the cloud. Your API key will be removed. This cannot be undone.\n\nAre you absolutely sure?',
      confirmText: 'Delete Everything',
      showCancel: true,
      isDestructive: true,
      onConfirm: () => {
        setTimeout(() => {
          setConfirmModal({
            visible: true,
            title: 'Final Confirmation',
            message: 'All your watched movies, ratings, and preferences will be gone forever. This is your last warning.',
            confirmText: 'I understand, delete all',
            showCancel: true,
            isDestructive: true,
            onConfirm: performFinalReset,
          });
        }, 300);
      },
    });
  }, [performFinalReset]);

  const handleExportBackup = useCallback(async () => {
    try {
      setBackupBusy(true);
      const backup = await exportUserData();
      const backupJson = JSON.stringify(backup, null, 2);
      const date = new Date().toISOString().split('T')[0];
      const filename = `matinee-backup-${date}.json`;

      if (Platform.OS === 'web') {
        const blob = new Blob([backupJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
        if (!directory) throw new Error('No file storage directory is available.');
        const fileUri = `${directory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, backupJson);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/json',
            dialogTitle: 'Save Matinee backup',
            UTI: 'public.json',
          });
        } else {
          showCustomAlert('Backup saved', fileUri);
        }
      }

      showCustomAlert(
        'Backup ready',
        `Exported ${backup.watchedItems.length} saved titles. Keep this file if you reinstall the app or move phones.`
      );
    } catch (err) {
      console.error('Export backup error:', err);
      showCustomAlert('Backup failed', 'Could not export your Matinee backup.');
    } finally {
      setBackupBusy(false);
    }
  }, [showCustomAlert]);

  const handleImportBackup = useCallback(async () => {
    try {
      setRestoreBusy(true);
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      const backupJson =
        Platform.OS === 'web' && asset.file
          ? await asset.file.text()
          : await FileSystem.readAsStringAsync(asset.uri);
      const summary = await importUserData(JSON.parse(backupJson));

      await Promise.all([fetchItems(), loadPreferences()]);

      showCustomAlert(
        'Backup restored',
        `Restored ${summary.items} titles, ${summary.ratings} ratings, and ${summary.episodeRatings} episode logs.`
      );
    } catch (err) {
      console.error('Import backup error:', err);
      showCustomAlert('Restore failed', 'That file could not be restored as a Matinee backup.');
    } finally {
      setRestoreBusy(false);
    }
  }, [fetchItems, loadPreferences, showCustomAlert]);

  const handleItemPress = useCallback(
    (item: WatchedItem) => {
      router.push({
        pathname: '/detail/[id]',
        params: { id: String(item.tmdbId), mediaType: item.mediaType },
      });
    },
    [router]
  );

  const renderLibraryItem = useCallback(
    ({ item }: { item: WatchedItem }) => {
      const isFuture = item.releaseDate && new Date(item.releaseDate) > new Date();
      
      let releaseText = '';
      if (item.releaseDate) {
        if (isFuture) {
          try {
            const dateObj = new Date(item.releaseDate);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            releaseText = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
          } catch {
            releaseText = item.releaseDate;
          }
        } else {
          releaseText = item.releaseDate.split('-')[0];
        }
      }

      return (
        <TouchableOpacity
          style={styles.gridCard}
          onPress={() => handleItemPress(item)}
          onLongPress={() => handleLibraryItemLongPress(item)}
          activeOpacity={0.8}
        >
          <View style={[styles.gridPosterContainer, { backgroundColor: colors.card }]}>
            {item.posterPath ? (
              <Image
                source={{ uri: getImageUrl(item.posterPath, 'w185') || "" }}
                style={styles.gridPoster}
              />
            ) : (
              <View style={[styles.gridPoster, styles.posterPlaceholder, { backgroundColor: colors.elevated }]}>
                <Ionicons name="film-outline" size={24} color={colors.muted} />
              </View>
            )}
            
            {/* Show user rating if available, otherwise fallback to TMDB rating */}
            {item.userRating ? (
              <View style={[styles.gridRating, { backgroundColor: colors.accent }]}>
                <Text style={[styles.gridRatingText, { color: colors.bg }]}>
                  ★ {item.userRating.toFixed(1)}
                </Text>
              </View>
            ) : item.voteAverage > 0 ? (
              <View style={styles.gridRating}>
                <Text style={[styles.gridRatingText, { color: colors.accent }]}>
                  ★ {item.voteAverage.toFixed(1)}
                </Text>
              </View>
            ) : null}
            {(() => {
              const type = item.mediaType || (item.releaseDate ? 'movie' : 'tv');
              return (
                <View style={[styles.gridMediaBadge, { backgroundColor: 'rgba(10, 10, 15, 0.85)', borderColor: colors.border }]}>
                  <Text style={[styles.gridMediaText, { color: type === 'tv' ? '#EC407A' : '#FFFFFF' }]}>
                    {type === 'tv' ? 'Series' : 'Movie'}
                  </Text>
                </View>
              );
            })()}
          </View>
          
          <Text style={[styles.gridTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          {releaseText ? (
            <Text style={[styles.gridYear, { color: isFuture ? colors.accent : colors.secondary }]} numberOfLines={1}>
              {releaseText}
            </Text>
          ) : null}
        </TouchableOpacity>
      );
    },
    [handleItemPress, colors]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(16, insets.top) + 12 }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {showSettings ? 'Settings' : 'Library'}
        </Text>
        <TouchableOpacity onPress={() => setShowSettings(!showSettings)}>
          <Ionicons
            name={showSettings ? 'close' : 'settings-outline'}
            size={24}
            color={colors.secondary}
          />
        </TouchableOpacity>
      </View>

      {showSettings ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: Math.max(100, insets.bottom + 40) }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.settingsPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.settingsTitle, { color: colors.text }]}>Settings</Text>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: colors.secondary }]}>TMDB API Key</Text>
              <TextInput
                style={[styles.settingInput, { backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }]}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="API Key (v3 auth)"
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
              />
              {apiKey !== savedApiKey && (
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.accent, marginTop: 8 }]}
                  onPress={handleSaveApiKey}
                >
                  <Text style={[styles.saveBtnText, { color: colors.bg }]}>Save Key</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Gemini API Key */}
            <View style={[styles.settingRow, { marginTop: 16 }]}>
              <Text style={[styles.settingLabel, { color: colors.secondary }]}>Gemini API Key (Optional)</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 }}>
                Enables AI-powered recommendations based on your detailed ratings (get a free key at aistudio.google.com)
              </Text>
              <TextInput
                style={[styles.settingInput, { backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }]}
                value={geminiApiKey}
                onChangeText={setGeminiApiKey}
                placeholder="Gemini API Key"
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
              />
              {geminiApiKey !== savedGeminiApiKey && (
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.accent, marginTop: 8 }]}
                  onPress={handleSaveGeminiApiKey}
                >
                  <Text style={[styles.saveBtnText, { color: colors.bg }]}>Save Gemini Key</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.settingRow, { marginTop: 16 }]}>
              <Text style={[styles.settingLabel, { color: colors.secondary }]}>Custom TMDB Proxy/Mirror (Optional)</Text>
              <TextInput
                style={[styles.settingInput, { backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }]}
                value={apiProxy}
                onChangeText={setApiProxy}
                placeholder="e.g. https://tmdb.cub.red/3"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.accent }]} onPress={handleSaveApiProxy}>
                <Text style={[styles.saveBtnText, { color: colors.bg }]}>Save Proxy</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.settingRowHorizontal, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: colors.secondary }]}>App Theme</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  Toggle dark and light UI modes
                </Text>
              </View>
              <ThemeSwitch />
            </View>

            {/* Include Adult Content Toggle */}
            <View style={[styles.settingRowHorizontal, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: colors.secondary }]}>Include Adult Content</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  Show R-rated movies & adult content
                </Text>
              </View>
              <TouchableOpacity onPress={handleToggleAdult} style={styles.toggleBtn}>
                <Ionicons
                  name={includeAdult ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={includeAdult ? colors.accent : colors.muted}
                />
              </TouchableOpacity>
            </View>

            {/* Filter Series by Country Toggle */}
            <View style={[styles.settingRowHorizontal, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingLabel, { color: colors.secondary }]}>Filter Series by Country</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  Only show series available on streaming/digital in your country
                </Text>
              </View>
              <TouchableOpacity onPress={handleToggleFilterByCountry} style={styles.toggleBtn}>
                <Ionicons
                  name={filterByCountry ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={filterByCountry ? colors.accent : colors.muted}
                />
              </TouchableOpacity>
            </View>

            {/* User Country Selector — Dropdown */}
            {filterByCountry && (
              <View style={[styles.settingRowVertical, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
                <Text style={[styles.settingLabel, { color: colors.secondary }]}>Your Country</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 }}>
                  Select region for watch provider availability
                </Text>
                <TouchableOpacity
                  style={[
                    styles.dropdownBtn,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                  onPress={() => setCountryDropdownOpen(true)}
                >
                  <Text style={[styles.dropdownBtnText, { color: colors.text }]}>
                    {(() => { const c = COUNTRIES.find(c => c.code === userCountry); return c ? `${c.flag}  ${c.name}` : userCountry; })()}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={colors.muted} />
                </TouchableOpacity>

                {/* Country Dropdown Modal */}
                <Modal visible={countryDropdownOpen} transparent animationType="fade" onRequestClose={() => setCountryDropdownOpen(false)}>
                  <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setCountryDropdownOpen(false)}>
                    <View style={[styles.dropdownModal, { backgroundColor: colors.card }]}>
                      <Text style={[styles.dropdownTitle, { color: colors.text }]}>Select Country</Text>
                      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                        {COUNTRIES.map((country) => {
                          const isSelected = userCountry === country.code;
                          return (
                            <TouchableOpacity
                              key={country.code}
                              style={[
                                styles.dropdownItem,
                                { borderBottomColor: colors.border },
                                isSelected && { backgroundColor: colors.accentMuted },
                              ]}
                              onPress={() => {
                                handleSelectCountry(country.code);
                                setCountryDropdownOpen(false);
                              }}
                            >
                              <Text style={{ fontSize: 18, marginRight: 10 }}>{country.flag}</Text>
                              <Text style={[styles.dropdownItemText, { color: colors.text }, isSelected && { color: colors.accent, fontWeight: '700' }]}>
                                {country.name}
                              </Text>
                              {isSelected && <Ionicons name="checkmark" size={18} color={colors.accent} style={{ marginLeft: 'auto' }} />}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  </Pressable>
                </Modal>
              </View>
            )}

            {/* Streaming Platforms Selector */}
            <View style={[styles.settingRowVertical, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <Text style={[styles.settingLabel, { color: colors.secondary }]}>Streaming Platforms</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 }}>
                Select your subscribed platforms to get OTT release alerts
              </Text>
              <View style={styles.langChipsContainer}>
                {OTT_PROVIDERS.map((provider) => {
                  const isSelected = selectedOttProviders.includes(provider.id);
                  return (
                    <TouchableOpacity
                      key={provider.id}
                      onPress={() => handleToggleOttProvider(provider.id)}
                      style={[
                        styles.langChip,
                        {
                          backgroundColor: isSelected ? colors.accentMuted : colors.bg,
                          borderColor: isSelected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.langChipText,
                          { color: isSelected ? colors.accent : colors.secondary },
                        ]}
                      >
                        {provider.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Preferred Languages Selector */}
            <View style={[styles.settingRowVertical, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <Text style={[styles.settingLabel, { color: colors.secondary }]}>Preferred Languages</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 }}>
                Filter upcoming movies by language
              </Text>
              <View style={styles.langChipsContainer}>
                {LANGUAGES.map((lang) => {
                  const isSelected = selectedLanguages.includes(lang.code);
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      onPress={() => handleToggleLanguage(lang.code)}
                      style={[
                        styles.langChip,
                        {
                          backgroundColor: isSelected ? colors.accentMuted : colors.bg,
                          borderColor: isSelected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.langChipText,
                          { color: isSelected ? colors.accent : colors.secondary },
                        ]}
                      >
                        {lang.nativeName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={[styles.settingRowVertical, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <Text style={[styles.settingLabel, { color: colors.secondary }]}>App Data</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 8 }}>
                Save or restore your watchlist, watched history, ratings, and episode logs
              </Text>
              <View style={styles.backupActions}>
                <TouchableOpacity
                  style={[styles.backupBtn, { borderColor: colors.border, backgroundColor: colors.bg }]}
                  onPress={handleExportBackup}
                  disabled={backupBusy}
                >
                  <Ionicons name="download-outline" size={16} color={colors.accent} />
                  <Text style={[styles.backupBtnText, { color: colors.text }]}>
                    {backupBusy ? 'Preparing...' : 'Backup'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.backupBtn, { borderColor: colors.border, backgroundColor: colors.bg }]}
                  onPress={handleImportBackup}
                  disabled={restoreBusy}
                >
                  <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
                  <Text style={[styles.backupBtnText, { color: colors.text }]}>
                    {restoreBusy ? 'Restoring...' : 'Restore'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {!savedApiKey && (
              <Text style={[styles.apiHint, { color: colors.muted, marginTop: 16 }]}>
                Get a free API key at themoviedb.org/settings/api
              </Text>
            )}
            {Boolean(savedApiKey) && (
              <Text style={[styles.apiSaved, { marginTop: 16 }]}>✓ API key is set</Text>
            )}

            {/* ── Cloud Sync Section ── */}
            <View style={[styles.settingRowVertical, { borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 16, marginTop: 16 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Ionicons name="cloud-outline" size={18} color={colors.accent} />
                <Text style={[styles.settingLabel, { color: colors.secondary }]}>Cloud Sync</Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                {cloudSync.isCloudEnabled()
                  ? `Connected${lastSyncDisplay ? ` · Last sync: ${lastSyncDisplay}` : ''}`
                  : isFirebaseConfigured()
                  ? 'Set your API key to enable sync'
                  : 'Firebase not configured — data is local only'}
              </Text>
              <TouchableOpacity
                style={[
                  styles.backupBtn,
                  {
                    borderColor: cloudSync.isCloudEnabled() ? colors.accent : colors.border,
                    backgroundColor: colors.bg,
                    opacity: syncBusy ? 0.6 : 1,
                  },
                ]}
                onPress={handleSyncNow}
                disabled={syncBusy}
              >
                {syncBusy ? (
                  <ActivityIndicator size={14} color={colors.accent} />
                ) : (
                  <Ionicons name="sync-outline" size={16} color={colors.accent} />
                )}
                <Text style={[styles.backupBtnText, { color: colors.text }]}>
                  {syncBusy ? 'Syncing...' : 'Sync Now'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── Danger Zone ── */}
            <View style={[styles.settingRowVertical, { borderTopWidth: 0.5, borderTopColor: '#3A1A1A', paddingTop: 16, marginTop: 16 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Ionicons name="warning-outline" size={18} color="#EF4444" />
                <Text style={[styles.settingLabel, { color: '#EF4444' }]}>Danger Zone</Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 10 }}>
                These actions cannot be undone. Proceed with caution.
              </Text>
              <View style={styles.backupActions}>
                <TouchableOpacity
                  style={[styles.backupBtn, { borderColor: '#EF4444', backgroundColor: colors.bg }]}
                  onPress={handleClearLocal}
                >
                  <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  <Text style={[styles.backupBtnText, { color: '#EF4444' }]}>Clear Local Data</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.backupBtn,
                    {
                      borderColor: '#EF4444',
                      backgroundColor: resetBusy ? '#3A1A1A' : '#EF4444',
                      opacity: resetBusy ? 0.6 : 1,
                    },
                  ]}
                  onPress={handleResetAll}
                  disabled={resetBusy}
                >
                  {resetBusy ? (
                    <ActivityIndicator size={14} color="#fff" />
                  ) : (
                    <Ionicons name="nuclear-outline" size={16} color="#fff" />
                  )}
                  <Text style={[styles.backupBtnText, { color: '#fff', fontWeight: '700' }]}>
                    {resetBusy ? 'Resetting...' : 'Delete All & Reset'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <>
          {/* Tab Switcher */}
          <View style={styles.tabRow}>
            {[
              { key: 'watchlist' as LibraryTab, label: 'Watchlist', icon: 'bookmark-outline' as const },
              { key: 'watched' as LibraryTab, label: 'Watched', icon: 'checkmark-circle-outline' as const },
            ].map(({ key, label, icon }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.tabItem,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  activeTab === key && { backgroundColor: colors.accentMuted, borderColor: colors.accent },
                ]}
                onPress={() => setActiveTab(key)}
              >
                <Ionicons
                  name={icon}
                  size={16}
                  color={activeTab === key ? colors.accent : colors.muted}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: colors.muted },
                    activeTab === key && { color: colors.accent },
                  ]}
                >
                  {label}
                </Text>
                 <View
                  style={[
                    styles.countBadge,
                    { backgroundColor: activeTab === key ? colors.accentMuted : colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.countText,
                      { color: activeTab === key ? colors.accent : colors.secondary },
                    ]}
                  >
                    {counts[key]}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Media Type Filter Chips */}
          <View style={styles.filterChipRow}>
            {[
              { key: null, label: 'All' },
              { key: 'movie' as MediaType, label: 'Movies' },
              { key: 'tv' as MediaType, label: 'Series' },
            ].map(({ key, label }) => (
              <TouchableOpacity
                key={String(key)}
                style={[
                  styles.filterChip,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  filterMediaType === key && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                onPress={() => setFilterMediaType(key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: colors.secondary },
                    filterMediaType === key && { color: colors.bg, fontWeight: '700' },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Items List */}
          <FlatList
            style={{ flex: 1 }}
            key={`${filterMediaType}-${activeTab}`}
            data={items}
            renderItem={renderLibraryItem}
            keyExtractor={(item) => `lib-${item.id}`}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name={
                    activeTab === 'watchlist'
                      ? 'bookmark-outline'
                      : 'checkmark-circle-outline'
                  }
                  size={48}
                  color={colors.muted}
                />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {activeTab === 'watchlist'
                    ? 'Your watchlist is empty'
                    : 'No movies logged yet'}
                </Text>
                <Text style={[styles.emptySubtitle, { color: colors.secondary }]}>
                  {activeTab === 'watchlist'
                    ? 'Browse movies and add them to your watchlist'
                    : 'Start logging movies you watch'}
                </Text>
              </View>
            }
          />
        </>
      )}
      {/* Custom Confirmation Modal */}
      {confirmModal && (
        <Modal
          visible={confirmModal.visible}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmModal(null)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setConfirmModal(null)}>
            <Pressable
              style={[
                styles.modalContent,
                { backgroundColor: colors.elevated, borderColor: colors.border },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>{confirmModal.title}</Text>
              <Text style={[styles.modalMessage, { color: colors.secondary }]}>{confirmModal.message}</Text>
              
              <View style={styles.modalButtonsRow}>
                {confirmModal.showCancel !== false && (
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalCancelBtn, { borderColor: colors.border }]}
                    onPress={() => setConfirmModal(null)}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[
                    styles.modalBtn,
                    confirmModal.isDestructive 
                      ? { backgroundColor: '#EF4444' } 
                      : { backgroundColor: colors.accent }
                  ]}
                  onPress={() => {
                    const action = confirmModal.onConfirm;
                    setConfirmModal(null);
                    action();
                  }}
                >
                  <Text style={[styles.modalBtnText, { color: colors.bg, fontWeight: '700' }]}>
                    {confirmModal.confirmText}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Long Press Quick Actions Bottom Sheet */}
      {longPressItem && (
        <Modal
          visible={!!longPressItem}
          transparent
          animationType="slide"
          onRequestClose={() => setLongPressItem(null)}
        >
          <Pressable style={styles.bottomSheetOverlay} onPress={() => setLongPressItem(null)}>
            <Pressable
              style={[
                styles.bottomSheetContent,
                { backgroundColor: colors.elevated },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <View style={styles.bottomSheetHeader}>
                <View style={[styles.bottomSheetHandle, { backgroundColor: colors.border }]} />
                <Text style={[styles.bottomSheetTitle, { color: colors.text }]} numberOfLines={1}>
                  {longPressItem.title}
                </Text>
                {longPressItem.releaseDate && (
                  <Text style={[styles.bottomSheetSubtitle, { color: colors.secondary }]}>
                    {new Date(longPressItem.releaseDate) > new Date() ? 'Unreleased' : 'Released in ' + longPressItem.releaseDate.substring(0, 4)}
                  </Text>
                )}
              </View>

              {/* Options */}
              <View style={styles.bottomSheetOptions}>
                {/* Option 1: Rate & Log (only if released) */}
                {!(longPressItem.releaseDate && new Date(longPressItem.releaseDate) > new Date()) && (
                  <TouchableOpacity
                    style={[styles.bottomSheetOptionBtn, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}
                    onPress={() => handleLongPressAction('rate')}
                  >
                    <Ionicons name="star" size={20} color={colors.accent} style={{ marginRight: 12 }} />
                    <Text style={[styles.bottomSheetOptionText, { color: colors.text }]}>Rate & Log</Text>
                  </TouchableOpacity>
                )}

                {/* Option 2: Remove from Library */}
                <TouchableOpacity
                  style={[styles.bottomSheetOptionBtn, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}
                  onPress={() => handleLongPressAction('remove')}
                >
                  <Ionicons name="trash-outline" size={20} color="#EF4444" style={{ marginRight: 12 }} />
                  <Text style={[styles.bottomSheetOptionText, { color: '#EF4444' }]}>Remove from Library</Text>
                </TouchableOpacity>

                {/* Option 3: Not Interested */}
                <TouchableOpacity
                  style={styles.bottomSheetOptionBtn}
                  onPress={() => handleLongPressAction('not_interested')}
                >
                  <Ionicons name="eye-off-outline" size={20} color={colors.accent} style={{ marginRight: 12 }} />
                  <Text style={[styles.bottomSheetOptionText, { color: colors.text }]}>Not Interested</Text>
                </TouchableOpacity>
              </View>

              {/* Cancel button */}
              <TouchableOpacity
                style={[styles.bottomSheetCancelBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setLongPressItem(null)}
              >
                <Text style={[styles.bottomSheetCancelText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  settingsPanel: {
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
  },
  settingsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  settingRow: {
    gap: 8,
  },
  settingRowHorizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  settingInput: {
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  saveBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  apiHint: {
    fontSize: 12,
    marginTop: 8,
  },
  apiSaved: {
    fontSize: 12,
    color: '#00C853',
    marginTop: 8,
    fontWeight: '500',
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 16,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 0.5,
    gap: 3,
  },
  tabItemActive: {},
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tabLabelActive: {},
  countBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countBadgeActive: {},
  countText: {
    fontSize: 9,
    fontWeight: '700',
  },
  countTextActive: {},
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    gap: 12,
    borderWidth: 0.5,
  },
  itemPoster: {
    width: 48,
    height: 72,
    borderRadius: 8,
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemMeta: {
    fontSize: 12,
  },
  itemDate: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  toggleBtn: {
    padding: 4,
  },
  settingRowVertical: {
    gap: 4,
  },
  langChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  langChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  backupActions: {
    flexDirection: 'row',
    gap: 8,
  },
  backupBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  backupBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 0.5,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  gridCard: {
    width: CARD_WIDTH,
    marginBottom: 16,
  },
  gridPosterContainer: {
    width: '100%',
    height: CARD_WIDTH * 1.5,
    borderRadius: 10,
    overflow: 'hidden',
  },
  gridPoster: {
    width: '100%',
    height: '100%',
  },
  gridRating: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  gridRatingText: {
    fontSize: 10,
    fontWeight: '700',
  },
  gridMediaBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    borderRadius: 4,
    borderWidth: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridMediaText: {
    fontSize: 8,
    fontWeight: '800',
  },
  gridTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  gridYear: {
    fontSize: 11,
    marginTop: 2,
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  bottomSheetContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 34,
  },
  bottomSheetHeader: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  bottomSheetSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  bottomSheetOptions: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 16,
  },
  bottomSheetOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  bottomSheetOptionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  bottomSheetCancelBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bottomSheetCancelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtn: {
    borderWidth: 1,
  },
  modalBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  dropdownBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownModal: {
    width: '80%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 16,
    maxHeight: 440,
  },
  dropdownTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderRadius: 8,
  },
  dropdownItemText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
