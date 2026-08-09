/**
 * Material Design 3 window size classes.
 *
 * M3 defines layout behaviour in terms of the *window* width rather than the
 * device, so a phone in landscape, a foldable and a browser at 900px all get
 * the same treatment. Everything responsive in the app keys off this hook:
 * navigation placement, grid column counts, and content gutters.
 *
 * Breakpoints (dp):
 *   compact   <  600   phone portrait          → bottom navigation bar
 *   medium    <  840   phone landscape, small tablet → navigation rail
 *   expanded  < 1200   tablet, small desktop    → navigation rail + wide gutters
 *   large     < 1600   desktop
 *   xlarge    >= 1600  large desktop
 */

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export type WindowSizeClass = 'compact' | 'medium' | 'expanded' | 'large' | 'xlarge';

export interface Responsive {
  width: number;
  height: number;
  sizeClass: WindowSizeClass;
  /** True on phone-sized windows — the only case that uses bottom navigation. */
  isCompact: boolean;
  /** Medium and up: navigation moves to a side rail. */
  isMedium: boolean;
  isExpanded: boolean;
  /** Landscape phones are short; vertical padding is tightened for them. */
  isLandscape: boolean;
  /** Horizontal page gutter for this size class. */
  gutter: number;
  /** Cap so text lines never run absurdly wide on desktop. */
  maxContentWidth: number;
  /** Poster grid columns for this size class. */
  posterColumns: number;
  /** Columns for the square stat/metric tiles. */
  statColumns: number;
}

function classify(width: number): WindowSizeClass {
  if (width < 600) return 'compact';
  if (width < 840) return 'medium';
  if (width < 1200) return 'expanded';
  if (width < 1600) return 'large';
  return 'xlarge';
}

const GUTTER: Record<WindowSizeClass, number> = {
  compact: 16,
  medium: 24,
  expanded: 24,
  large: 32,
  xlarge: 32,
};

const MAX_CONTENT: Record<WindowSizeClass, number> = {
  compact: Infinity,
  medium: Infinity,
  expanded: 1040,
  large: 1200,
  xlarge: 1320,
};

const POSTER_COLUMNS: Record<WindowSizeClass, number> = {
  compact: 3,
  medium: 4,
  expanded: 5,
  large: 6,
  xlarge: 7,
};

const STAT_COLUMNS: Record<WindowSizeClass, number> = {
  compact: 2,
  medium: 3,
  expanded: 4,
  large: 4,
  xlarge: 4,
};

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const sizeClass = classify(width);
    return {
      width,
      height,
      sizeClass,
      isCompact: sizeClass === 'compact',
      isMedium: sizeClass !== 'compact',
      isExpanded: sizeClass === 'expanded' || sizeClass === 'large' || sizeClass === 'xlarge',
      isLandscape: width > height,
      gutter: GUTTER[sizeClass],
      maxContentWidth: MAX_CONTENT[sizeClass],
      posterColumns: POSTER_COLUMNS[sizeClass],
      statColumns: STAT_COLUMNS[sizeClass],
    };
  }, [width, height]);
}

/**
 * Width of one cell in an evenly-spaced grid, accounting for gutters on both
 * sides and the gaps between columns. Floored so rounding never overflows the
 * row and pushes the last column onto a new line.
 */
export function gridItemWidth(
  containerWidth: number,
  columns: number,
  gutter: number,
  gap: number
): number {
  const available = containerWidth - gutter * 2 - gap * (columns - 1);
  return Math.floor(available / columns);
}
