import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Constants from 'expo-constants';
import {
  View,
  StyleSheet,
  FlatList,
  Image,
  Alert,
  RefreshControl,
  Platform,
  ScrollView,
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
import { useResponsive, gridItemWidth } from '../../hooks/useResponsive';
import { shape, spacing, withAlpha } from '../../constants/m3';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  IconButton,
  ListItem,
  SegmentedButtons,
  Text,
  TextField,
  NAVIGATION_BAR_HEIGHT,
} from '../../components/m3';
import ThemeSwitch from '../../components/ThemeSwitch';
import EmptyState from '../../components/EmptyState';
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
import { notificationService } from '../../services/notifications';
import {
  applyUpdate,
  checkForUpdate,
  downloadUpdate,
  getCurrentUpdateInfo,
  isUpdateSupported,
} from '../../services/updates';
import { isFirebaseConfigured, bindKeys, lookupKey, handleKeyAutofill } from '../../services';
import { WatchedItem, ItemStatus, MediaType } from '../../types';
import { LANGUAGES, DEFAULT_LANGUAGES } from '../../constants/languages';
import { COUNTRIES } from '../../constants/providers';
import { OTT_PROVIDERS } from '../../constants/providers';

type LibraryTab = 'watchlist' | 'watched';

/** Gap between poster tiles in the library grid. */
const GRID_GAP = spacing.md;

export default function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { tab, mediaType } = useLocalSearchParams<{ tab?: string; mediaType?: string }>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, gutter, posterColumns, isCompact } = useResponsive();

  // Tile width is recomputed from the live window so the grid reflows on
  // rotation and on wide screens instead of being fixed at import time.
  const gridCardWidth = useMemo(
    () => gridItemWidth(width, posterColumns, gutter, GRID_GAP),
    [width, posterColumns, gutter]
  );
  const gridPosterHeight = Math.round(gridCardWidth * 1.5);

  const bottomPadding =
    (isCompact ? NAVIGATION_BAR_HEIGHT + insets.bottom : insets.bottom) + 88;
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
        // Removing a watchlisted title must also drop its release reminders.
        await notificationService.cancelReminder(tmdbId, mediaType);
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

  // OTA update states
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateReadyToApply, setUpdateReadyToApply] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState(
    isUpdateSupported()
      ? 'Check whether a newer version is available.'
      : 'Over-the-air updates are unavailable in this build.'
  );

  const appVersion = (Constants.expoConfig?.version as string) || '1.0.0';

  /**
   * Describes the running bundle.
   *
   * The channel is included deliberately: a binary built without one can never
   * receive an over-the-air update, and that failure is otherwise completely
   * silent — the app just reports "up to date" forever.
   */
  const buildLabel = useMemo(() => {
    const info = getCurrentUpdateInfo();
    if (!isUpdateSupported()) return 'development build';

    const origin = info.isEmbedded
      ? 'base build'
      : `OTA update · ${
          info.createdAt
            ? info.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : 'unknown date'
        }`;

    return info.channel ? `${origin} · ${info.channel}` : `${origin} · no channel`;
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateBusy(true);
    try {
      const result = await checkForUpdate();

      if (result.status === 'unavailable') {
        setUpdateStatusText(result.reason);
        return;
      }
      if (result.status === 'error') {
        setUpdateStatusText(`Could not check for updates: ${result.error}`);
        return;
      }
      if (result.status === 'up-to-date') {
        setUpdateStatusText("You're on the latest version.");
        return;
      }

      setUpdateStatusText('Downloading update...');
      const download = await downloadUpdate();
      if (download.status === 'ready') {
        setUpdateReadyToApply(true);
        setUpdateStatusText('Update downloaded. Restart to apply it.');
      } else if (download.status === 'up-to-date') {
        setUpdateStatusText("You're on the latest version.");
      } else {
        setUpdateStatusText(`Download failed: ${download.error}`);
      }
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  const handleApplyUpdate = useCallback(async () => {
    setUpdateBusy(true);
    try {
      await applyUpdate();
    } catch {
      setUpdateStatusText('Could not restart. Please close and reopen the app.');
      setUpdateBusy(false);
    }
  }, []);

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
      const isFuture = !!item.releaseDate && new Date(item.releaseDate) > new Date();

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

      const type = item.mediaType || (item.releaseDate ? 'movie' : 'tv');
      const typeLabel = type === 'tv' ? 'Series' : 'Movie';
      const ratingLabel = item.userRating
        ? `Your rating ${item.userRating.toFixed(1)} out of 10`
        : item.voteAverage > 0
          ? `Rated ${item.voteAverage.toFixed(1)} out of 10`
          : null;

      return (
        <Card
          variant="filled"
          radius={shape.medium}
          onPress={() => handleItemPress(item)}
          onLongPress={() => handleLibraryItemLongPress(item)}
          style={{ width: gridCardWidth, backgroundColor: 'transparent' }}
          accessibilityLabel={[item.title, typeLabel, releaseText, ratingLabel]
            .filter(Boolean)
            .join(', ')}
          accessibilityHint="Double tap to open. Long press for quick actions."
        >
          <View
            style={[
              styles.gridPosterWrap,
              { height: gridPosterHeight, backgroundColor: colors.surfaceContainerHighest },
            ]}
          >
            {item.posterPath ? (
              <Image
                source={{ uri: getImageUrl(item.posterPath, 'w342') || '' }}
                style={styles.fill}
                resizeMode="cover"
                accessible={false}
              />
            ) : (
              <View style={[styles.fill, styles.center]}>
                <Ionicons name="film-outline" size={24} color={colors.onSurfaceVariant} />
              </View>
            )}

            {/* A rating the user set outranks the TMDB average. */}
            {item.userRating ? (
              <View style={[styles.ratingBadge, { backgroundColor: colors.primary }]}>
                <Ionicons name="star" size={10} color={colors.onPrimary} />
                <Text variant="labelSmall" color={colors.onPrimary} maxFontSizeMultiplier={1.2}>
                  {item.userRating.toFixed(1)}
                </Text>
              </View>
            ) : item.voteAverage > 0 ? (
              <View style={styles.ratingBadgeScrim}>
                <Ionicons name="star" size={10} color={SCRIM_ON} />
                <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
                  {item.voteAverage.toFixed(1)}
                </Text>
              </View>
            ) : null}

            <View style={styles.typeBadge}>
              <Text variant="labelSmall" color={SCRIM_ON} maxFontSizeMultiplier={1.2}>
                {typeLabel}
              </Text>
            </View>
          </View>

          <View style={styles.gridMeta}>
            <Text variant="titleSmall" color={colors.onSurface} numberOfLines={2}>
              {item.title}
            </Text>
            {releaseText ? (
              <Text
                variant="bodySmall"
                color={isFuture ? colors.primary : colors.onSurfaceVariant}
                numberOfLines={1}
              >
                {releaseText}
              </Text>
            ) : null}
          </View>
        </Card>
      );
    },
    [handleItemPress, handleLibraryItemLongPress, colors, gridCardWidth, gridPosterHeight]
  );

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  const renderSettings = () => (
    <ScrollView
      style={styles.flexOne}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* API keys */}
      <SettingsGroup title="Connections" icon="key-outline">
        <TextField
          label="TMDB API key"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="API key (v3 auth)"
          secureTextEntry
          autoCapitalize="none"
          supportingText={
            savedApiKey ? 'A key is saved.' : 'Get a free key at themoviedb.org/settings/api'
          }
        />
        {apiKey !== savedApiKey ? (
          <Button label="Save key" variant="filled" size="small" onPress={handleSaveApiKey} />
        ) : null}

        <TextField
          label="Gemini API key (optional)"
          value={geminiApiKey}
          onChangeText={setGeminiApiKey}
          placeholder="Gemini API key"
          secureTextEntry
          autoCapitalize="none"
          supportingText="Enables AI recommendations. Free key at aistudio.google.com"
          containerStyle={styles.settingBlock}
        />
        {geminiApiKey !== savedGeminiApiKey ? (
          <Button
            label="Save Gemini key"
            variant="filled"
            size="small"
            onPress={handleSaveGeminiApiKey}
          />
        ) : null}

        <TextField
          label="Custom TMDB proxy (optional)"
          value={apiProxy}
          onChangeText={setApiProxy}
          placeholder="e.g. https://tmdb.cub.red/3"
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.settingBlock}
        />
        <Button label="Save proxy" variant="outlined" size="small" onPress={handleSaveApiProxy} />
      </SettingsGroup>

      {/* Appearance */}
      <SettingsGroup title="Appearance" icon="color-palette-outline">
        <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
          Choose light, dark, or follow your device setting.
        </Text>
        <ThemeSwitch />
      </SettingsGroup>

      {/* Content preferences */}
      <SettingsGroup title="Content" icon="options-outline" flush>
        <ListItem
          headline="Include adult content"
          supportingText="Show R-rated and adult titles"
          onPress={handleToggleAdult}
          accessibilityRole="switch"
          accessibilityState={{ checked: includeAdult }}
          trailing={
            <Ionicons
              name={includeAdult ? 'checkbox' : 'square-outline'}
              size={24}
              color={includeAdult ? colors.primary : colors.onSurfaceVariant}
            />
          }
        />
        <Divider inset={spacing.lg} />
        <ListItem
          headline="Filter series by country"
          supportingText="Only show series available where you are"
          onPress={handleToggleFilterByCountry}
          accessibilityRole="switch"
          accessibilityState={{ checked: filterByCountry }}
          trailing={
            <Ionicons
              name={filterByCountry ? 'checkbox' : 'square-outline'}
              size={24}
              color={filterByCountry ? colors.primary : colors.onSurfaceVariant}
            />
          }
        />
        {filterByCountry ? (
          <>
            <Divider inset={spacing.lg} />
            <ListItem
              headline="Your country"
              supportingText={(() => {
                const c = COUNTRIES.find((x) => x.code === userCountry);
                return c ? `${c.flag}  ${c.name}` : userCountry;
              })()}
              trailingIcon="chevron-down"
              onPress={() => setCountryDropdownOpen(true)}
              accessibilityHint="Opens the country picker"
            />
          </>
        ) : null}
      </SettingsGroup>

      {/* Streaming platforms */}
      <SettingsGroup title="Streaming platforms" icon="tv-outline">
        <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
          Pick your subscriptions to get OTT release alerts.
        </Text>
        <View style={styles.chipWrap}>
          {OTT_PROVIDERS.map((provider) => (
            <Chip
              key={provider.id}
              label={provider.name}
              variant="filter"
              selected={selectedOttProviders.includes(provider.id)}
              onPress={() => handleToggleOttProvider(provider.id)}
            />
          ))}
        </View>
      </SettingsGroup>

      {/* Languages */}
      <SettingsGroup title="Preferred languages" icon="language-outline">
        <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
          Shapes your feed and the upcoming releases list.
        </Text>
        <View style={styles.chipWrap}>
          {LANGUAGES.map((lang) => (
            <Chip
              key={lang.code}
              label={lang.nativeName}
              variant="filter"
              selected={selectedLanguages.includes(lang.code)}
              onPress={() => handleToggleLanguage(lang.code)}
            />
          ))}
        </View>
      </SettingsGroup>

      {/* Backup */}
      <SettingsGroup title="App data" icon="save-outline">
        <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
          Save or restore your watchlist, history, ratings, and episode logs.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label={backupBusy ? 'Preparing…' : 'Back up'}
            icon="download-outline"
            variant="tonal"
            onPress={handleExportBackup}
            loading={backupBusy}
          />
          <Button
            label={restoreBusy ? 'Restoring…' : 'Restore'}
            icon="cloud-upload-outline"
            variant="tonal"
            onPress={handleImportBackup}
            loading={restoreBusy}
          />
        </View>
      </SettingsGroup>

      {/* Cloud sync */}
      <SettingsGroup title="Cloud sync" icon="cloud-outline">
        <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
          {cloudSync.isCloudEnabled()
            ? `Connected${lastSyncDisplay ? ` · last sync ${lastSyncDisplay}` : ''}`
            : isFirebaseConfigured()
              ? 'Set your API key to enable sync.'
              : 'Firebase is not configured — your data stays on this device.'}
        </Text>
        <Button
          label={syncBusy ? 'Syncing…' : 'Sync now'}
          icon="sync-outline"
          variant="tonal"
          onPress={handleSyncNow}
          loading={syncBusy}
          disabled={!cloudSync.isCloudEnabled()}
        />
      </SettingsGroup>

      {/* Updates */}
      <SettingsGroup title="App updates" icon="cloud-download-outline">
        <Text variant="bodyMedium" color={colors.onSurfaceVariant} accessibilityLiveRegion="polite">
          {updateStatusText}
        </Text>
        <Button
          label={
            updateBusy
              ? 'Checking…'
              : updateReadyToApply
                ? 'Restart to apply'
                : 'Check for updates'
          }
          icon={updateReadyToApply ? 'refresh-outline' : 'cloud-download-outline'}
          variant={updateReadyToApply ? 'filled' : 'tonal'}
          onPress={updateReadyToApply ? handleApplyUpdate : handleCheckForUpdates}
          loading={updateBusy}
        />
        <Text variant="bodySmall" color={colors.onSurfaceVariant}>
          v{appVersion} · {buildLabel}
        </Text>
      </SettingsGroup>

      {/* Danger zone */}
      {/* Outlined rather than filled: M3 reserves a solid error fill for an
          active problem, not for a section that merely contains risky actions. */}
      <View style={[styles.dangerZone, { borderColor: colors.error }]}>
        <View style={styles.groupHeader}>
          <Ionicons name="warning-outline" size={20} color={colors.error} />
          <Text variant="titleMedium" color={colors.error} accessibilityRole="header">
            Danger zone
          </Text>
        </View>
        <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
          These actions cannot be undone.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Clear local data"
            icon="trash-outline"
            variant="outlined"
            tone="error"
            onPress={handleClearLocal}
            accessibilityHint="Deletes everything stored on this device"
          />
          <Button
            label={resetBusy ? 'Resetting…' : 'Delete all and reset'}
            icon="nuclear-outline"
            variant="filled"
            tone="error"
            onPress={handleResetAll}
            loading={resetBusy}
            accessibilityHint="Deletes local and cloud data, and clears your saved keys"
          />
        </View>
      </View>
    </ScrollView>
  );

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md, paddingHorizontal: gutter }]}>
        <Text
          variant="headlineSmall"
          color={colors.onSurface}
          accessibilityRole="header"
          style={styles.flexShrink}
          numberOfLines={1}
        >
          {showSettings ? 'Settings' : 'Library'}
        </Text>
        <IconButton
          icon={showSettings ? 'close' : 'settings-outline'}
          onPress={() => setShowSettings(!showSettings)}
          accessibilityLabel={showSettings ? 'Close settings' : 'Open settings'}
        />
      </View>

      {showSettings ? (
        renderSettings()
      ) : (
        <>
          {/* Watchlist / Watched */}
          <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.md }}>
            <SegmentedButtons
              options={[
                { value: 'watchlist' as LibraryTab, label: `Watchlist (${counts.watchlist})` },
                { value: 'watched' as LibraryTab, label: `Watched (${counts.watched})` },
              ]}
              value={activeTab}
              onChange={setActiveTab}
              accessibilityLabel="Library section"
              style={styles.fullWidthSegments}
            />
          </View>

          {/* Media type filter */}
          <View style={[styles.chipRow, { paddingHorizontal: gutter }]}>
            {[
              { key: null, label: 'All' },
              { key: 'movie' as MediaType, label: 'Movies' },
              { key: 'tv' as MediaType, label: 'Series' },
            ].map(({ key, label }) => (
              <Chip
                key={String(key)}
                label={label}
                variant="filter"
                selected={filterMediaType === key}
                onPress={() => setFilterMediaType(key)}
              />
            ))}
          </View>

          {/* Grid */}
          <FlatList
            style={styles.flexOne}
            key={`${filterMediaType}-${activeTab}-${posterColumns}`}
            data={items}
            renderItem={renderLibraryItem}
            keyExtractor={(item) => `lib-${item.id}`}
            numColumns={posterColumns}
            columnWrapperStyle={
              posterColumns > 1 ? { paddingHorizontal: gutter, gap: GRID_GAP } : undefined
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: bottomPadding, gap: spacing.lg }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
                progressBackgroundColor={colors.surfaceContainerHigh}
              />
            }
            ListEmptyComponent={
              <EmptyState
                icon={activeTab === 'watchlist' ? 'bookmark-outline' : 'checkmark-circle-outline'}
                title={
                  activeTab === 'watchlist' ? 'Your watchlist is empty' : 'Nothing logged yet'
                }
                subtitle={
                  activeTab === 'watchlist'
                    ? 'Browse Discover and save titles you want to watch.'
                    : 'Rate something you have seen and it will appear here.'
                }
                compact
              />
            }
          />
        </>
      )}

      {/* Country picker */}
      <BottomSheet
        visible={countryDropdownOpen}
        onDismiss={() => setCountryDropdownOpen(false)}
        title="Select country"
      >
        <View style={styles.sheetList}>
          {COUNTRIES.map((country) => (
            <ListItem
              key={country.code}
              headline={`${country.flag}  ${country.name}`}
              selected={userCountry === country.code}
              trailingIcon={userCountry === country.code ? 'checkmark' : undefined}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: userCountry === country.code }}
              onPress={() => {
                handleSelectCountry(country.code);
                setCountryDropdownOpen(false);
              }}
            />
          ))}
        </View>
      </BottomSheet>

      {/* Confirmation dialog */}
      <Dialog
        visible={!!confirmModal?.visible}
        onDismiss={() => setConfirmModal(null)}
        title={confirmModal?.title ?? ''}
        message={confirmModal?.message}
        dismissable={confirmModal?.showCancel !== false}
        actions={
          <>
            {confirmModal?.showCancel !== false ? (
              <Button label="Cancel" variant="text" onPress={() => setConfirmModal(null)} />
            ) : null}
            <Button
              label={confirmModal?.confirmText ?? 'OK'}
              variant={confirmModal?.isDestructive ? 'filled' : 'text'}
              tone={confirmModal?.isDestructive ? 'error' : 'primary'}
              onPress={() => {
                const action = confirmModal?.onConfirm;
                setConfirmModal(null);
                action?.();
              }}
            />
          </>
        }
      />

      {/* Quick actions */}
      <BottomSheet
        visible={!!longPressItem}
        onDismiss={() => setLongPressItem(null)}
        title={longPressItem?.title ?? ''}
        subtitle={
          longPressItem?.releaseDate
            ? new Date(longPressItem.releaseDate) > new Date()
              ? 'Not yet released'
              : `Released in ${longPressItem.releaseDate.substring(0, 4)}`
            : undefined
        }
      >
        <View style={styles.sheetList}>
          {longPressItem &&
          !(longPressItem.releaseDate && new Date(longPressItem.releaseDate) > new Date()) ? (
            <ListItem
              headline="Rate and log"
              leadingIcon="star-outline"
              leadingIconColor={colors.primary}
              onPress={() => handleLongPressAction('rate')}
            />
          ) : null}

          <ListItem
            headline="Remove from library"
            leadingIcon="trash-outline"
            destructive
            onPress={() => handleLongPressAction('remove')}
          />

          <ListItem
            headline="Not interested"
            leadingIcon="eye-off-outline"
            leadingIconColor={colors.primary}
            onPress={() => handleLongPressAction('not_interested')}
            accessibilityHint="Hides this title from recommendations"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

/** Foreground for badges drawn on the poster scrim. */
const SCRIM_ON = '#FFFFFF';

/**
 * Titled card grouping related settings.
 *
 * `flush` drops the inner padding for groups made of full-bleed list rows,
 * whose own padding would otherwise be doubled.
 */
function SettingsGroup({
  title,
  icon,
  children,
  flush = false,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  flush?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Card variant="filled" radius={shape.large} style={styles.settingsGroup}>
      <View style={[styles.groupHeader, styles.groupHeaderPadded]}>
        <Ionicons name={icon} size={20} color={colors.primary} />
        <Text variant="titleMedium" color={colors.onSurface} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={flush ? styles.groupBodyFlush : styles.groupBody}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flexOne: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    minHeight: 52,
  },

  fullWidthSegments: {
    alignSelf: 'stretch',
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  /* Library grid */
  gridPosterWrap: {
    width: '100%',
    borderRadius: shape.medium,
    overflow: 'hidden',
  },
  gridMeta: {
    marginTop: spacing.sm,
    gap: 2,
  },
  ratingBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: shape.extraSmall,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  ratingBadgeScrim: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: withAlpha('#000000', 0.62),
    borderRadius: shape.extraSmall,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  typeBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: withAlpha('#000000', 0.62),
    borderRadius: shape.extraSmall,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },

  /* Settings */
  settingsGroup: {
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupHeaderPadded: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  groupBody: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  groupBodyFlush: {
    gap: 0,
  },
  settingBlock: {
    marginTop: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dangerZone: {
    borderRadius: shape.large,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },

  sheetList: {
    marginHorizontal: -spacing.xl,
  },
});
