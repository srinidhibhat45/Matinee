/**
 * Matinee Dark Cinema Theme
 * A content-first dark theme designed for movie poster visibility
 */

const colors = {
  bg: {
    primary: '#000000',
    card: '#0F0F0F',
    elevated: '#161616',
    input: '#0F0F0F',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#8E8E93',
    muted: '#444444',
  },
  accent: {
    amber: '#D83B96',
    amberDark: '#BD2F80',
    amberLight: '#F562B6',
    teal: '#2DD4BF',
    tealDark: '#0D9488',
    red: '#EF4444',
    green: '#D83B96',
  },
  border: {
    subtle: '#1C1C1E',
    medium: '#2C2C2E',
  },
  rating: {
    1: '#EF4444',
    2: '#F97316',
    3: '#F59E0B',
    4: '#EAB308',
    5: '#84CC16',
    6: '#22C55E',
    7: '#14B8A6',
    8: '#06B6D4',
    9: '#8B5CF6',
    10: '#EC4899',
  } as Record<number, string>,
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

const borderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 24,
  round: 999,
};

const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  elevated: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
};

const screen = {
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.lg,
};

const theme = {
  colors,
  spacing,
  borderRadius,
  shadows,
  screen,
} as const;

export default theme;
