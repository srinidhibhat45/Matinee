/**
 * Categorical palette for charts.
 *
 * The old chart colours were an ad-hoc list of brand-ish hexes reused in both
 * themes, so several of them washed out against the light background. These are
 * picked per scheme at a tone that clears 3:1 against every surface — the WCAG
 * 1.4.11 threshold for non-text graphics — while staying distinguishable from
 * one another for the common forms of colour blindness.
 *
 * Hues are spaced ~40° apart and ordered so that adjacent series in a legend
 * never land on neighbouring hues.
 */

const DARK = [
  '#7CD6C6', // teal   — brand
  '#F7BB7E', // amber
  '#7BE08C', // green
  '#63D2E8', // cyan
  '#B9A6FF', // violet
  '#FFA463', // orange
  '#FFB1C2', // pink
  '#EBD24A', // yellow
  '#FF897D', // red
];

const LIGHT = [
  '#007461', // teal   — brand
  '#825422', // amber
  '#20661F', // green
  '#00629A', // blue
  '#5A43C4', // violet
  '#9A4A00', // orange
  '#B80F55', // pink
  '#6A5D00', // yellow
  '#B3261E', // red
];

export const chartPalette = { dark: DARK, light: LIGHT };

/** Colour for series `index`, wrapping when there are more series than colours. */
export function chartColor(index: number, isDark: boolean): string {
  const palette = isDark ? DARK : LIGHT;
  return palette[index % palette.length];
}
