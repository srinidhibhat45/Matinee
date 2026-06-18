// ─── Firebase App Initialisation ────────────────────────────────────
// This module initialises the Firebase JS SDK and exports the Firestore
// instance that cloudSync.ts uses.  No native modules required (pure JS SDK).
//
// ⚠️  Replace the placeholder values below with your real Firebase config
//     from https://console.firebase.google.com → Project Settings → General.

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';

// ── Firebase Config ─────────────────────────────────────────────────
// TODO: Replace these with your own Firebase project credentials.
// Get them from https://console.firebase.google.com → Project Settings.

// Import the functions you need from the SDKs you need
import { getAnalytics } from "firebase/analytics";
import { Platform } from 'react-native';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDz5cn5jWg3h84GkzlrPp1OIHA3hGiqh1Y",
  authDomain: "matinee-521c7.firebaseapp.com",
  projectId: "matinee-521c7",
  storageBucket: "matinee-521c7.firebasestorage.app",
  messagingSenderId: "293586277703",
  appId: "1:293586277703:web:8bc95b2ef859938fe3e862",
  measurementId: "G-NGTXJ08PSK"
};

// Initialize Firebase
const app = initializeApp(FIREBASE_CONFIG);

// Initialize analytics safely (web only, as JS analytics crashes on native)
let analytics: any = null;
if (Platform.OS === 'web') {
  try {
    analytics = getAnalytics(app);
  } catch (err) {
    console.warn('[Matinee Firebase] Analytics failed to initialize:', err);
  }
}

// ── Singleton instances ─────────────────────────────────────────────

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;

/**
 * Returns true if real Firebase credentials have been provided.
 */
export function isFirebaseConfigured(): boolean {
  return (
    !!FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
    FIREBASE_CONFIG.apiKey !== ''
  );
}

/**
 * Initialise Firebase and return the Firestore instance.
 * Safe to call multiple times — subsequent calls return the cached instance.
 */
export function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp;

  if (!isFirebaseConfigured()) {
    throw new Error(
      '[Matinee Firebase] Firebase is not configured. ' +
      'Please update the config in services/firebase.ts with your project credentials.'
    );
  }

  firebaseApp =
    getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);

  return firebaseApp;
}

/**
 * Get the Firestore database instance.
 * Initialises Firebase if not already done.
 */
// Clear legacy local storage keys that might exceed browser quota
if (Platform.OS === 'web') {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('firestore_') || key.includes('firebase'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    console.log('[Firebase] Successfully cleared old Firestore LocalStorage keys.');
  } catch (err) {
    console.warn('[Firebase] Failed to clear localStorage keys:', err);
  }
}

/**
 * Get the Firestore database instance.
 * Initialises Firebase if not already done.
 */
export function getFirestoreDb(): Firestore {
  if (firestoreDb) return firestoreDb;

  const app = getFirebaseApp();

  // Use memory cache for web to avoid LocalStorage 5MB quota errors
  try {
    firestoreDb = initializeFirestore(app, {
      localCache: Platform.OS === 'web'
        ? memoryLocalCache()
        : persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
    });
  } catch {
    // If initializeFirestore was already called, fall back to getFirestore
    firestoreDb = getFirestore(app);
  }

  return firestoreDb;
}

/**
 * Update Firebase config at runtime (e.g. from user settings).
 * This is used when the user provides Firebase config through the app.
 */
export function updateFirebaseConfig(config: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}): void {
  Object.assign(FIREBASE_CONFIG, config);
}
