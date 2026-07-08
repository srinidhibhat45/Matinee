import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestoreDb, isFirebaseConfigured } from './firebase';
import { setPreference, getPreference } from './database';
import { tmdbService } from './tmdb';

const API_KEY_STORAGE = '@matinee_api_key';

/**
 * Computes the SHA-256 hash of a key to act as a secure document ID.
 */
export async function hashKey(key: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    key.trim()
  );
  return digest;
}

/**
 * Binds the TMDB API key and Gemini API key together in the online Firebase database.
 * This writes two documents: one keyed by the TMDB key hash, and one keyed by the Gemini key hash.
 */
export async function bindKeys(tmdbKey: string, geminiKey: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  if (!tmdbKey.trim() || !geminiKey.trim()) return;

  try {
    const db = getFirestoreDb();
    const tmdbHash = await hashKey(tmdbKey);
    const geminiHash = await hashKey(geminiKey);

    const payload = {
      tmdbKey: tmdbKey.trim(),
      geminiKey: geminiKey.trim(),
      updatedAt: serverTimestamp(),
    };

    // Store under 'meta/preferences' which is allowed by Firestore rules
    await Promise.all([
      setDoc(doc(db, 'matinee_users', tmdbHash, 'meta', 'preferences'), payload, { merge: true }),
      setDoc(doc(db, 'matinee_users', geminiHash, 'meta', 'preferences'), payload, { merge: true }),
    ]);

    console.log('[KeyBinding] Successfully bound TMDB and Gemini keys in the cloud.');
  } catch (err) {
    console.warn('[KeyBinding] Failed to bind keys in Firestore:', err);
  }
}

/**
 * Looks up bound keys in the online Firebase database using an entered key.
 */
export async function lookupKey(enteredKey: string): Promise<{ tmdbKey: string | null; geminiKey: string | null }> {
  if (!isFirebaseConfigured() || !enteredKey.trim()) {
    return { tmdbKey: null, geminiKey: null };
  }

  try {
    const db = getFirestoreDb();
    const hash = await hashKey(enteredKey);
    const docRef = doc(db, 'matinee_users', hash, 'meta', 'preferences');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        tmdbKey: data.tmdbKey || null,
        geminiKey: data.geminiKey || null,
      };
    }
  } catch (err) {
    console.warn('[KeyBinding] Failed to look up key in Firestore:', err);
  }

  return { tmdbKey: null, geminiKey: null };
}

/**
 * Automatically checks and updates key states (local storage + memory services)
 * if a cloud binding exists for a newly entered key.
 */
export async function handleKeyAutofill(
  enteredKey: string,
  type: 'tmdb' | 'gemini'
): Promise<{ tmdbKey: string | null; geminiKey: string | null; autofilled: boolean }> {
  const result = { tmdbKey: null as string | null, geminiKey: null as string | null, autofilled: false };
  if (!enteredKey.trim()) return result;

  try {
    const bound = await lookupKey(enteredKey);
    
    if (type === 'tmdb' && bound.geminiKey) {
      // TMDB key entered, Gemini key autofilled
      await setPreference('PREF_GEMINI_API_KEY', bound.geminiKey);
      result.geminiKey = bound.geminiKey;
      result.tmdbKey = enteredKey;
      result.autofilled = true;
      console.log('[KeyBinding] Autofilled Gemini API Key from bound TMDB key.');
    } else if (type === 'gemini' && bound.tmdbKey) {
      // Gemini key entered, TMDB key autofilled
      await setPreference('API_KEY_STORAGE', bound.tmdbKey);
      await AsyncStorage.setItem(API_KEY_STORAGE, bound.tmdbKey);
      await tmdbService.setApiKey(bound.tmdbKey);
      
      result.tmdbKey = bound.tmdbKey;
      result.geminiKey = enteredKey;
      result.autofilled = true;
      console.log('[KeyBinding] Autofilled TMDB API Key from bound Gemini key.');
    }
  } catch (err) {
    console.warn('[KeyBinding] Handle key autofill failed:', err);
  }

  return result;
}
