/**
 * Material Design 3 colour schemes.
 *
 * Each role is a fixed tone of one of the six tonal palettes, exactly as the M3
 * spec assigns them. Because the mapping is mechanical, light and dark stay in
 * step automatically: change a palette and both schemes follow.
 */

import { palettes, ratingScale } from './palettes';

const { primary: P, secondary: S, tertiary: T, neutral: N, neutralVariant: NV, error: E } = palettes;

export interface M3ColorScheme {
  /* Accent roles */
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;

  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;

  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;

  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;

  /* Surface roles */
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;

  /* Utility roles */
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
  shadow: string;

  /** Semantic colour for a 1–10 star rating. */
  rating: Record<number, string>;
}

export const lightScheme: M3ColorScheme = {
  primary: P[40],
  onPrimary: P[100],
  primaryContainer: P[90],
  onPrimaryContainer: P[10],

  secondary: S[40],
  onSecondary: S[100],
  secondaryContainer: S[90],
  onSecondaryContainer: S[10],

  tertiary: T[40],
  onTertiary: T[100],
  tertiaryContainer: T[90],
  onTertiaryContainer: T[10],

  error: E[40],
  onError: E[100],
  errorContainer: E[90],
  onErrorContainer: E[10],

  background: N[98],
  onBackground: N[10],
  surface: N[98],
  onSurface: N[10],
  surfaceVariant: NV[90],
  onSurfaceVariant: NV[30],
  surfaceDim: N[87],
  surfaceBright: N[98],
  surfaceContainerLowest: N[100],
  surfaceContainerLow: N[96],
  surfaceContainer: N[94],
  surfaceContainerHigh: N[92],
  surfaceContainerHighest: N[90],

  outline: NV[50],
  outlineVariant: NV[80],
  inverseSurface: N[20],
  inverseOnSurface: N[95],
  inversePrimary: P[80],
  scrim: N[0],
  shadow: N[0],

  rating: ratingScale.light,
};

/**
 * Dark-mode surface ramp, re-anchored to true black.
 *
 * M3's stock dark surfaces sit around tone 6–22, which reads as charcoal grey.
 * Matinee's dark theme is an OLED-black theme instead: the page is pure black
 * and the container ladder climbs from there.
 *
 * The tones are not arbitrary. Each one is solved so its contrast ratio against
 * the black page matches what the same role had against M3's grey page — the
 * `surfaceContainerHigh` step, for instance, is 1.29:1 above the page in both
 * schemes. Dropping the page to black without re-solving would have flattened
 * every step, leaving cards and sheets barely separable from the background.
 *
 * Each entry's lightness and chroma are carried over unchanged from that
 * solve; only hue is rotated to match whatever `neutral`'s current brand hue
 * is (teal, as of this writing). That keeps the ladder in the same family as
 * the rest of the scheme instead of drifting toward whatever hue the brand
 * used to be — this table does NOT update automatically when the brand colour
 * changes, since it isn't derived from the `neutral` ramp at runtime. Rotate
 * it by hand (see the hue-transplant approach used when the palette itself
 * changes) whenever `constants/m3/palettes.ts` changes hue.
 */
const blackSurfaces = {
  background: '#000000',
  surface: '#000000',
  surfaceDim: '#000000',
  surfaceBright: '#263332',
  surfaceContainerLowest: '#000000',
  surfaceContainerLow: '#0B0E0E',
  surfaceContainer: '#0F1413',
  surfaceContainerHigh: '#192220',
  surfaceContainerHighest: '#222E2C',
} as const;

export const darkScheme: M3ColorScheme = {
  primary: P[80],
  onPrimary: P[20],
  primaryContainer: P[30],
  onPrimaryContainer: P[90],

  secondary: S[80],
  onSecondary: S[20],
  secondaryContainer: S[30],
  onSecondaryContainer: S[90],

  tertiary: T[80],
  onTertiary: T[20],
  tertiaryContainer: T[30],
  onTertiaryContainer: T[90],

  error: E[80],
  onError: E[20],
  errorContainer: E[30],
  onErrorContainer: E[90],

  background: blackSurfaces.background,
  onBackground: N[90],
  surface: blackSurfaces.surface,
  onSurface: N[90],
  surfaceVariant: NV[24],
  onSurfaceVariant: NV[80],
  surfaceDim: blackSurfaces.surfaceDim,
  surfaceBright: blackSurfaces.surfaceBright,
  surfaceContainerLowest: blackSurfaces.surfaceContainerLowest,
  surfaceContainerLow: blackSurfaces.surfaceContainerLow,
  surfaceContainer: blackSurfaces.surfaceContainer,
  surfaceContainerHigh: blackSurfaces.surfaceContainerHigh,
  surfaceContainerHighest: blackSurfaces.surfaceContainerHighest,

  outline: NV[60],
  outlineVariant: NV[30],
  inverseSurface: N[90],
  inverseOnSurface: N[20],
  inversePrimary: P[40],
  scrim: N[0],
  shadow: N[0],

  rating: ratingScale.dark,
};

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

/** Appends an alpha channel to a `#RRGGBB` string. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}

/**
 * Composites `overlay` at `alpha` on top of opaque `base` and returns the
 * flattened result. Needed wherever a translucent state layer would otherwise
 * sit over an image or a differently-coloured ancestor.
 */
export function overlayOn(base: string, overlay: string, alpha: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  };
  const [br, bg, bb] = parse(base);
  const [or, og, ob] = parse(overlay);
  const mix = (b: number, o: number) => Math.round(b + (o - b) * alpha);
  return `#${[mix(br, or), mix(bg, og), mix(bb, ob)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}
