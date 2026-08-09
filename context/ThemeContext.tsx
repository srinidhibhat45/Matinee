import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkScheme,
  lightScheme,
  withAlpha,
  type M3ColorScheme,
} from '../constants/m3';

/**
 * The app's colour contract.
 *
 * Every Material 3 role is exposed under its spec name. The short aliases at
 * the bottom (`bg`, `card`, `text`, …) predate the M3 migration and are kept
 * because they are referenced across every screen; each one is now defined as a
 * pointer at the M3 role that carries the same meaning, so the two vocabularies
 * can never drift apart.
 */
export interface ThemeColors extends M3ColorScheme {
  /** @deprecated Prefer `background`. */
  bg: string;
  /** @deprecated Prefer `surfaceContainerLow`. */
  card: string;
  /** @deprecated Prefer `surfaceContainerHigh`. */
  elevated: string;
  /** @deprecated Prefer `onSurface`. */
  text: string;
  /** @deprecated Prefer `onSurfaceVariant`. */
  secondary: string;
  /** @deprecated Prefer `outline`. */
  muted: string;
  /** @deprecated Prefer `primary`. */
  accent: string;
  /** @deprecated Prefer `onPrimary`. */
  onAccent: string;
  /** @deprecated Prefer `primaryContainer`. */
  accentMuted: string;
  /** @deprecated Prefer `outlineVariant`. */
  border: string;
}

function toThemeColors(scheme: M3ColorScheme): ThemeColors {
  return {
    ...scheme,
    bg: scheme.background,
    card: scheme.surfaceContainerLow,
    elevated: scheme.surfaceContainerHigh,
    text: scheme.onSurface,
    secondary: scheme.onSurfaceVariant,
    muted: scheme.outline,
    accent: scheme.primary,
    onAccent: scheme.onPrimary,
    accentMuted: withAlpha(scheme.primary, 0.16),
    border: scheme.outlineVariant,
  };
}

export const darkColors: ThemeColors = toThemeColors(darkScheme);
export const lightColors: ThemeColors = toThemeColors(lightScheme);

/**
 * `system` follows the OS setting and is the default, which is what users
 * expect from a modern Android app. The explicit modes pin it either way.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
  /** The resolved scheme currently painted on screen. */
  theme: 'dark' | 'light';
  /** What the user actually chose — may be `system`. */
  preference: ThemePreference;
  colors: ThemeColors;
  /** Cycles light → dark → system. */
  toggleTheme: () => void;
  setPreference: (preference: ThemePreference) => void;
  isDark: boolean;
  /** True when the OS asks for reduced motion; animations should be skipped. */
  reduceMotion: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  preference: 'system',
  colors: darkColors,
  toggleTheme: () => {},
  setPreference: () => {},
  isDark: true,
  reduceMotion: false,
});

const THEME_STORAGE_KEY = 'matinee_user_theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'dark' || saved === 'light' || saved === 'system') {
          setPreferenceState(saved);
        }
      } catch (err) {
        console.error('Failed to load theme preference', err);
      }
    };
    loadTheme();
  }, []);

  // Honour the OS "Remove animations" / "Reduce motion" accessibility setting.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled)
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const setPreference = useCallback(async (next: ThemePreference) => {
    setPreferenceState(next);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {
      console.error('Failed to save theme preference', err);
    }
  }, []);

  const theme: 'dark' | 'light' =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const toggleTheme = useCallback(() => {
    // light → dark → system → light
    const next: ThemePreference =
      preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light';
    setPreference(next);
  }, [preference, setPreference]);

  const value = useMemo<ThemeContextType>(() => {
    const isDark = theme === 'dark';
    return {
      theme,
      preference,
      colors: isDark ? darkColors : lightColors,
      toggleTheme,
      setPreference,
      isDark,
      reduceMotion,
    };
  }, [theme, preference, toggleTheme, setPreference, reduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
