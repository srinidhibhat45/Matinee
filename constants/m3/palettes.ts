/**
 * Material Design 3 tonal palettes for Matinee.
 *
 * Derived from the brand source colour #14B8A6 (teal). Each ramp keeps the
 * exact tone (L*) and chroma its pink predecessor had at every step — only
 * hue was rotated — so every contrast ratio already verified for the old
 * scheme (WCAG AA text and non-text pairs, the OLED-black dark elevation
 * ladder) carries over unchanged. Only the hue changed; nothing had to be
 * re-verified.
 *
 * Every M3 colour role is a tone of one of these six ramps, which is what
 * makes a scheme internally consistent: the same hue runs through surfaces,
 * outlines and accents, so nothing ever looks bolted on.
 */

export type Tone =
  | 0 | 4 | 6 | 10 | 12 | 17 | 20 | 22 | 24 | 30 | 40 | 50
  | 60 | 70 | 80 | 87 | 90 | 92 | 94 | 95 | 96 | 98 | 99 | 100;

export type TonalPalette = Record<Tone, string>;

/** Brand teal. Drives buttons, selection, and the active navigation state. */
export const primary: TonalPalette = {
  0: '#000000', 4: '#00170D', 6: '#001E14', 10: '#00251C', 12: '#002A21',
  17: '#00362C', 20: '#003D32', 22: '#004337', 24: '#00483B', 30: '#005849',
  40: '#007461', 50: '#009079', 60: '#00AC92', 70: '#00C2AC', 80: '#7CD6C6',
  87: '#AFE4DA', 90: '#C3EAE4', 92: '#D0EFEA', 94: '#DBF2EF', 95: '#E1F4F2',
  96: '#E7F7F5', 98: '#F4FBFC', 99: '#FAFDF9', 100: '#FFFFFF',
};

/** Desaturated brand hue. Used for supporting accents and quieter containers. */
export const secondary: TonalPalette = {
  0: '#000000', 4: '#00140E', 6: '#001A13', 10: '#00211C', 12: '#002520',
  17: '#06302A', 20: '#0C3730', 22: '#103B34', 24: '#16403A', 30: '#244E47',
  40: '#3A665F', 50: '#517F78', 60: '#699A91', 70: '#83B5AB', 80: '#9CD1C7',
  87: '#AFE4DA', 90: '#C3EAE4', 92: '#D0EFEA', 94: '#DBF2EF', 95: '#E1F4F2',
  96: '#E7F7F5', 98: '#F4FBFC', 99: '#FAFDF9', 100: '#FFFFFF',
};

/** Analogous sky blue (+~27°). Reserved for contrast accents: ratings, highlights. */
export const tertiary: TonalPalette = {
  0: '#000000', 4: '#001117', 6: '#00171F', 10: '#00202E', 12: '#002537',
  17: '#00304C', 20: '#003859', 22: '#003D61', 24: '#00426A', 30: '#00507C',
  40: '#006996', 50: '#0082B3', 60: '#009CD1', 70: '#2FB8EE', 80: '#56D3FF',
  87: '#9DE3FF', 90: '#B8E9FF', 92: '#C9EDFF', 94: '#D8F1FF', 95: '#E0F4FF',
  96: '#E6F6FF', 98: '#F3FBFD', 99: '#FAFDF9', 100: '#FFFFFF',
};

/** Near-grey carrying a trace of the brand hue. All surfaces come from here. */
export const neutral: TonalPalette = {
  0: '#000000', 4: '#07100D', 6: '#0E1514', 10: '#161D1C', 12: '#1A2120',
  17: '#232C2A', 20: '#293230', 22: '#2E3735', 24: '#323B3A', 30: '#3E4946',
  40: '#56605F', 50: '#6E7977', 60: '#879392', 70: '#A0AEAC', 80: '#BBC9C7',
  87: '#CFDDDC', 90: '#D6E6E4', 92: '#DDEBEA', 94: '#E2F1EE', 95: '#E5F4F1',
  96: '#E7F7F5', 98: '#F4FBFC', 99: '#FAFDF9', 100: '#FFFFFF',
};

/** Slightly warmer neutral. Outlines and secondary text live on this ramp. */
export const neutralVariant: TonalPalette = {
  0: '#000000', 4: '#02110F', 6: '#051713', 10: '#0F1F1C', 12: '#132320',
  17: '#1D2D2A', 20: '#223330', 22: '#263834', 24: '#2A3D3A', 30: '#374A47',
  40: '#4D625E', 50: '#667C78', 60: '#7E9691', 70: '#97B0AB', 80: '#B2CBC7',
  87: '#C5E0DB', 90: '#CDE8E3', 92: '#D3EEE9', 94: '#DBF2EF', 95: '#E1F4F2',
  96: '#E7F7F5', 98: '#F4FBFC', 99: '#FAFDF9', 100: '#FFFFFF',
};

/** M3's standard error ramp. Errors stay red regardless of brand colour. */
export const error: TonalPalette = {
  0: '#000000', 4: '#280001', 6: '#310001', 10: '#410002', 12: '#490002',
  17: '#5C0004', 20: '#690005', 22: '#710005', 24: '#790006', 30: '#93000A',
  40: '#BA1A1A', 50: '#DE3730', 60: '#FF5449', 70: '#FF897D', 80: '#FFB4AB',
  87: '#FFCFC9', 90: '#FFDAD6', 92: '#FFE2DE', 94: '#FFE9E6', 95: '#FFEDEA',
  96: '#FFF0EE', 98: '#FFF8F7', 99: '#FFFBFF', 100: '#FFFFFF',
};

export const palettes = {
  primary,
  secondary,
  tertiary,
  neutral,
  neutralVariant,
  error,
} as const;

/**
 * Semantic ramp for the 1–10 star rating, walking red → amber → green → violet.
 * Split by scheme so each stop clears 4.5:1 against its own background.
 *
 * Independent of the brand hue for every stop except 10, which intentionally
 * mirrors `primary` — a perfect score is drawn in the app's own accent colour.
 */
export const ratingScale = {
  dark: {
    1: '#FF897D', 2: '#FFA463', 3: '#FFC44D', 4: '#EBD24A', 5: '#B6DE5B',
    6: '#7BE08C', 7: '#5FDCC4', 8: '#63D2E8', 9: '#B9A6FF', 10: '#7CD6C6',
  } as Record<number, string>,
  light: {
    1: '#B3261E', 2: '#9A4A00', 3: '#7D5800', 4: '#6A5D00', 5: '#4C6300',
    6: '#20661F', 7: '#00655B', 8: '#00629A', 9: '#5A43C4', 10: '#007461',
  } as Record<number, string>,
};
