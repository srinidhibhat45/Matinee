/**
 * Material Design 3 system tokens: type scale, shape scale, elevation, motion,
 * state layers and spacing.
 *
 * These are the raw numbers from the M3 spec, expressed as React Native style
 * objects so screens can spread them directly instead of re-deriving font sizes
 * and radii by hand.
 */

import { Platform, TextStyle } from 'react-native';

/* ------------------------------------------------------------------ *
 * Type scale
 * ------------------------------------------------------------------ */

type Role = TextStyle & { fontSize: number; lineHeight: number };

/**
 * M3 ships a variable-weight Roboto; RN has to pick a concrete family per
 * weight. Android maps numeric weights natively, iOS resolves via San
 * Francisco, and web falls back through the Roboto stack.
 */
const systemFont = Platform.select({
  android: 'sans-serif',
  ios: undefined,
  default: undefined,
});

const mediumFont = Platform.select({
  android: 'sans-serif-medium',
  ios: undefined,
  default: undefined,
});

const regular = (): TextStyle => ({ fontFamily: systemFont, fontWeight: '400' });
const medium = (): TextStyle => ({ fontFamily: mediumFont, fontWeight: '500' });

export const typescale = {
  displayLarge: { ...regular(), fontSize: 57, lineHeight: 64, letterSpacing: -0.25 } as Role,
  displayMedium: { ...regular(), fontSize: 45, lineHeight: 52, letterSpacing: 0 } as Role,
  displaySmall: { ...regular(), fontSize: 36, lineHeight: 44, letterSpacing: 0 } as Role,

  headlineLarge: { ...regular(), fontSize: 32, lineHeight: 40, letterSpacing: 0 } as Role,
  headlineMedium: { ...regular(), fontSize: 28, lineHeight: 36, letterSpacing: 0 } as Role,
  headlineSmall: { ...regular(), fontSize: 24, lineHeight: 32, letterSpacing: 0 } as Role,

  titleLarge: { ...regular(), fontSize: 22, lineHeight: 28, letterSpacing: 0 } as Role,
  titleMedium: { ...medium(), fontSize: 16, lineHeight: 24, letterSpacing: 0.15 } as Role,
  titleSmall: { ...medium(), fontSize: 14, lineHeight: 20, letterSpacing: 0.1 } as Role,

  bodyLarge: { ...regular(), fontSize: 16, lineHeight: 24, letterSpacing: 0.5 } as Role,
  bodyMedium: { ...regular(), fontSize: 14, lineHeight: 20, letterSpacing: 0.25 } as Role,
  bodySmall: { ...regular(), fontSize: 12, lineHeight: 16, letterSpacing: 0.4 } as Role,

  labelLarge: { ...medium(), fontSize: 14, lineHeight: 20, letterSpacing: 0.1 } as Role,
  labelMedium: { ...medium(), fontSize: 12, lineHeight: 16, letterSpacing: 0.5 } as Role,
  labelSmall: { ...medium(), fontSize: 11, lineHeight: 16, letterSpacing: 0.5 } as Role,
} as const;

export type TypescaleRole = keyof typeof typescale;

/**
 * Emphasised variants for headings that need to hold their own against poster
 * art. M3 allows raising weight within a role as long as metrics are kept.
 */
export const emphasis = {
  bold: { fontWeight: '700' } as TextStyle,
  semibold: { fontWeight: '600' } as TextStyle,
};

/* ------------------------------------------------------------------ *
 * Shape scale
 * ------------------------------------------------------------------ */

export const shape = {
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 9999,
} as const;

/* ------------------------------------------------------------------ *
 * Spacing — M3's 4dp base grid
 * ------------------------------------------------------------------ */

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/* ------------------------------------------------------------------ *
 * Elevation
 * ------------------------------------------------------------------ */

/**
 * M3 elevation levels 0–5 in dp. On Android these drive the native shadow;
 * on iOS/web they are converted into a matching ambient + key shadow pair.
 */
const ELEVATION_DP = [0, 1, 3, 6, 8, 12] as const;

export type ElevationLevel = 0 | 1 | 2 | 3 | 4 | 5;

export function elevation(level: ElevationLevel, shadowColor = '#000000') {
  const dp = ELEVATION_DP[level];
  if (dp === 0) {
    return { elevation: 0, shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } };
  }
  return {
    elevation: dp,
    shadowColor,
    shadowOffset: { width: 0, height: Math.max(1, Math.round(dp / 2)) },
    shadowOpacity: 0.12 + level * 0.035,
    shadowRadius: dp * 1.4,
  };
}

/* ------------------------------------------------------------------ *
 * State layers
 * ------------------------------------------------------------------ */

/**
 * Opacities M3 applies to a state layer painted over a component's container.
 * `pressed` is the one that matters most on touch devices.
 */
export const stateLayer = {
  hover: 0.08,
  focus: 0.1,
  pressed: 0.1,
  dragged: 0.16,
} as const;

export const emphasisOpacity = {
  /** Disabled text and icons. */
  disabledContent: 0.38,
  /** Disabled container fills. */
  disabledContainer: 0.12,
  /** Scrim behind modals and sheets. */
  scrim: 0.32,
} as const;

/* ------------------------------------------------------------------ *
 * Motion
 * ------------------------------------------------------------------ */

/**
 * M3 motion tokens. Bezier control points are exported raw so callers can feed
 * them to `Easing.bezier(...)` from either `react-native` or `reanimated`.
 */
export const motion = {
  easing: {
    emphasized: [0.2, 0, 0, 1] as const,
    emphasizedDecelerate: [0.05, 0.7, 0.1, 1] as const,
    emphasizedAccelerate: [0.3, 0, 0.8, 0.15] as const,
    standard: [0.2, 0, 0, 1] as const,
    standardDecelerate: [0, 0, 0, 1] as const,
    standardAccelerate: [0.3, 0, 1, 1] as const,
    linear: [0, 0, 1, 1] as const,
  },
  duration: {
    short1: 50,
    short2: 100,
    short3: 150,
    short4: 200,
    medium1: 250,
    medium2: 300,
    medium3: 350,
    medium4: 400,
    long1: 450,
    long2: 500,
    long3: 550,
    long4: 600,
  },
} as const;

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

/**
 * Minimum interactive size. M3 and WCAG 2.1 (2.5.5 AAA / 2.5.8 AA) agree on
 * 48dp; anything smaller needs `hitSlop` to make up the difference.
 */
export const MIN_TOUCH_TARGET = 48;

/** Expands a visually smaller control to a 48dp hit area. */
export function touchTargetSlop(visualSize: number) {
  const pad = Math.max(0, Math.round((MIN_TOUCH_TARGET - visualSize) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
