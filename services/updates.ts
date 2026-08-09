// ============================================================
// Matinee — Over-the-Air (OTA) Update Service
//
// Wraps `expo-updates` so the rest of the app can check for,
// download, and apply EAS Updates without worrying about the
// environments where OTA is unavailable (Expo Go, dev client,
// web, and local development builds).
// ============================================================

import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

export type UpdateCheckResult =
  | { status: 'unavailable'; reason: string }
  | { status: 'up-to-date' }
  | { status: 'available'; manifestId: string | null }
  | { status: 'error'; error: string };

export type UpdateDownloadResult =
  | { status: 'ready' }
  | { status: 'up-to-date' }
  | { status: 'error'; error: string };

/**
 * OTA is only functional in a release build that was compiled with
 * `expo-updates` and pointed at an EAS Update URL. In Expo Go, dev
 * builds and on web, every call becomes a no-op instead of throwing.
 */
export function isUpdateSupported(): boolean {
  return Platform.OS !== 'web' && Updates.isEnabled && !__DEV__;
}

function unsupportedReason(): string {
  if (Platform.OS === 'web') return 'Over-the-air updates are not available on web.';
  if (__DEV__) return 'Over-the-air updates are disabled in development builds.';
  if (!Updates.isEnabled) return 'This build was not configured for over-the-air updates.';
  return 'Over-the-air updates are unavailable.';
}

/**
 * A short human-readable description of the JS bundle currently running.
 * Useful in Settings so the user can tell whether an update actually applied.
 */
export function getCurrentUpdateInfo(): {
  runtimeVersion: string;
  updateId: string | null;
  channel: string | null;
  isEmbedded: boolean;
  createdAt: Date | null;
} {
  return {
    runtimeVersion: Updates.runtimeVersion ?? 'unknown',
    updateId: Updates.updateId ?? null,
    channel: Updates.channel ?? null,
    isEmbedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt ?? null,
  };
}

/**
 * Ask the update server whether a newer compatible bundle exists.
 * Never throws — failures are returned as an `error` result so callers
 * can stay silent on flaky networks.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isUpdateSupported()) {
    return { status: 'unavailable', reason: unsupportedReason() };
  }

  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      return { status: 'available', manifestId: result.manifest?.id ?? null };
    }
    return { status: 'up-to-date' };
  } catch (error: any) {
    console.warn('[Updates] Check failed:', error?.message ?? error);
    return { status: 'error', error: error?.message ?? 'Update check failed.' };
  }
}

/**
 * Download the pending update into the local update cache. The new bundle
 * only takes effect after {@link applyUpdate} (or the next cold start).
 */
export async function downloadUpdate(): Promise<UpdateDownloadResult> {
  if (!isUpdateSupported()) {
    return { status: 'error', error: unsupportedReason() };
  }

  try {
    const result = await Updates.fetchUpdateAsync();
    return result.isNew ? { status: 'ready' } : { status: 'up-to-date' };
  } catch (error: any) {
    console.warn('[Updates] Download failed:', error?.message ?? error);
    return { status: 'error', error: error?.message ?? 'Update download failed.' };
  }
}

/**
 * Restart into the downloaded bundle. This tears down the JS runtime, so
 * callers must persist anything important before awaiting it.
 */
export async function applyUpdate(): Promise<void> {
  if (!isUpdateSupported()) return;
  await Updates.reloadAsync();
}

/**
 * Convenience helper for background checks: fetches a newer bundle if one
 * exists and reports whether it is staged and ready to be applied.
 * Returns `false` on any failure so callers can ignore it silently.
 */
export async function fetchUpdateIfAvailable(): Promise<boolean> {
  const check = await checkForUpdate();
  if (check.status !== 'available') return false;

  const download = await downloadUpdate();
  return download.status === 'ready';
}
