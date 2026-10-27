import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Resolve lazily: an older installed binary may not expose the native module.
const secureStore = (): typeof import('expo-secure-store') => require('expo-secure-store');
const secureKey = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

/** Storage failures must never hide legacy credentials or prevent database startup. */
export async function getSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  const legacy = await AsyncStorage.getItem(key);
  if (legacy) {
    try { await setSecret(key, legacy); } catch { /* Keep the original copy. */ }
    return legacy;
  }
  try {
    return await secureStore().getItemAsync(secureKey(key));
  } catch {
    return null;
  }
}

/** Returns true only when the destination has been read back successfully. */
export async function setSecret(key: string, value: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return true;
  }
  try {
    const store = secureStore();
    await store.setItemAsync(secureKey(key), value);
    if (await store.getItemAsync(secureKey(key)) !== value) throw new Error('Credential verification failed');
  } catch {
    // Compatibility with binaries/devices where SecureStore is unavailable.
    await AsyncStorage.setItem(key, value);
    return false;
  }
  await AsyncStorage.removeItem(key);
  return true;
}
export async function removeSecret(key: string): Promise<void> {
  if (Platform.OS !== 'web') {
    // A deletion error must be reported, otherwise a removed key could reappear.
    await secureStore().deleteItemAsync(secureKey(key));
  }
  await AsyncStorage.removeItem(key);
}
