import { useEffect, useSyncExternalStore } from 'react';
import { getAllItems, subscribeDatabase } from '../services/database';
import { readActivity, type ActivityRecord } from '../services/libraryActivity';
import type { WatchedItem } from '../types';
let snapshot: {
  items: WatchedItem[];
  activity: ActivityRecord[];
  ready: boolean;
} = {
  items: [],
  activity: [],
  ready: false
};
const listeners = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let started = false;
export async function refreshLibrary(): Promise<void> {
  const current = ++generation;
  try {
    const [items, activity] = await Promise.all([getAllItems(), readActivity()]);
    if (current !== generation) return;
    snapshot = {
      items,
      activity,
      ready: true
    };
    listeners.forEach(l => l());
  } catch (e) {
    console.warn('Library refresh failed', e);
  }
}
subscribeDatabase(() => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    void refreshLibrary();
  }, 40);
});
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getSnapshot = () => snapshot;
export function useLibrary() {
  useEffect(() => {
    if (!started) {
      started = true;
      void refreshLibrary();
    }
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
