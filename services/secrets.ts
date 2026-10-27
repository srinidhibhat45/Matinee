import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Migrate native credentials out of general storage on their first read. */
export async function getSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  const secureKey = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  const saved = await SecureStore.getItemAsync(secureKey);
  if (saved) return saved;
  const legacy = await AsyncStorage.getItem(key);
  if (legacy) {
    await SecureStore.setItemAsync(secureKey, legacy);
    await AsyncStorage.removeItem(key);
  }
  return legacy;
}
export async function setSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key.replace(/[^a-zA-Z0-9._-]/g, '_'), value);
  await AsyncStorage.removeItem(key);
}
export async function removeSecret(key: string): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key.replace(/[^a-zA-Z0-9._-]/g, '_'));
  await AsyncStorage.removeItem(key);
}
