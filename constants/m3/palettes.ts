/**
 * Material Design 3 tonal palettes for Matinee.
 *
 * Generated with Google's `@material/material-color-utilities` from the brand
 * source colour #EC407A (HCT hue 4.94, chroma 81.4). Baking the ramps in keeps
 * the HCT solver out of the bundle — the palettes only change when the brand
 * colour does.
 *
 * Every M3 colour role is a tone of one of these six ramps, which is what makes
 * a scheme internally consistent: the same hue runs through surfaces, outlines
 * and accents, so nothing ever looks bolted on.
 */

export type Tone =
  | 0 | 4 | 6 | 10 | 12 | 17 | 20 | 22 | 24 | 30 | 40 | 50
  | 60 | 70 | 80 | 87 | 90 | 92 | 94 | 95 | 96 | 98 | 99 | 100;

export type TonalPalette = Record<Tone, string>;

/** Brand pink. Drives buttons, selection, and the active navigation state. */
export const primary: TonalPalette = {
  0: '#000000', 4: '#26000C', 6: '#300010', 10: '#3F0018', 12: '#47001C',
  17: '#5A0025', 20: '#66002B', 22: '#6E002F', 24: '#760033', 30: '#8F003F',
  40: '#B80F55', 50: '#DB326E', 60: '#FD4E87', 70: '#FF85A4', 80: '#FFB1C2',
  87: '#FFCDD7', 90: '#FFD9DF', 92: '#FFE1E5', 94: '#FFE8EB', 95: '#FFECEE',
  96: '#FFF0F1', 98: '#FFF8F7', 99: '#FFFBFF', 100: '#FFFFFF',
};

/** Desaturated brand hue. Used for supporting accents and quieter containers. */
export const secondary: TonalPalette = {
  0: '#000000', 4: '#1F060D', 6: '#250B12', 10: '#2F131A', 12: '#33171E',
  17: '#3F2128', 20: '#47272F', 22: '#4C2B33', 24: '#513037', 30: '#603D45',
  40: '#7A545C', 50: '#956C74', 60: '#B1858E', 70: '#CD9FA8', 80: '#EBBAC3',
  87: '#FFCDD7', 90: '#FFD9DF', 92: '#FFE1E5', 94: '#FFE8EB', 95: '#FFECEE',
  96: '#FFF0F1', 98: '#FFF8F7', 99: '#FFFBFF', 100: '#FFFFFF',
};

/** Analogous amber (+60°). Reserved for contrast accents: ratings, highlights. */
export const tertiary: TonalPalette = {
  0: '#000000', 4: '#190B00', 6: '#210F00', 10: '#2C1600', 12: '#321A00',
  17: '#402300', 20: '#492900', 22: '#502C00', 24: '#563000', 30: '#663D0B',
  40: '#825422', 50: '#9E6D38', 60: '#BB864E', 70: '#D9A066', 80: '#F7BB7E',
  87: '#FFD2A7', 90: '#FFDCBD', 92: '#FFE3CC', 94: '#FFEAD9', 95: '#FFEEE0',
  96: '#FFF1E7', 98: '#FFF8F5', 99: '#FFFBFF', 100: '#FFFFFF',
};

/** Near-grey carrying a trace of the brand hue. All surfaces come from here. */
export const neutral: TonalPalette = {
  0: '#000000', 4: '#130C0E', 6: '#181213', 10: '#211A1B', 12: '#251E1F',
  17: '#302829', 20: '#372E30', 22: '#3B3334', 24: '#403738', 30: '#4E4446',
  40: '#665C5D', 50: '#7F7476', 60: '#9A8E8F', 70: '#B5A8A9', 80: '#D1C3C5',
  87: '#E5D7D8', 90: '#EEDFE0', 92: '#F3E5E6', 94: '#F9EAEC', 95: '#FCEDEF',
  96: '#FFF0F1', 98: '#FFF8F7', 99: '#FFFBFF', 100: '#FFFFFF',
};

/** Slightly warmer neutral. Outlines and secondary text live on this ramp. */
export const neutralVariant: TonalPalette = {
  0: '#000000', 4: '#170B0D', 6: '#1D1013', 10: '#26181B', 12: '#2A1C1F',
  17: '#352629', 20: '#3C2C2F', 22: '#413034', 24: '#463538', 30: '#544245',
  40: '#6D595D', 50: '#877275', 60: '#A28B8F', 70: '#BDA5A9', 80: '#D9C0C4',
  87: '#EED4D8', 90: '#F6DCE0', 92: '#FCE2E6', 94: '#FFE8EB', 95: '#FFECEE',
  96: '#FFF0F1', 98: '#FFF8F7', 99: '#FFFBFF', 100: '#FFFFFF',
};

/** M3's standard error ramp. */
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
 */
export const ratingScale = {
  dark: {
    1: '#FF897D', 2: '#FFA463', 3: '#FFC44D', 4: '#EBD24A', 5: '#B6DE5B',
    6: '#7BE08C', 7: '#5FDCC4', 8: '#63D2E8', 9: '#B9A6FF', 10: '#FFB1C2',
  } as Record<number, string>,
  light: {
    1: '#B3261E', 2: '#9A4A00', 3: '#7D5800', 4: '#6A5D00', 5: '#4C6300',
    6: '#20661F', 7: '#00655B', 8: '#00629A', 9: '#5A43C4', 10: '#B80F55',
  } as Record<number, string>,
};
