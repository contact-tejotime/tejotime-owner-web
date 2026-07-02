/**
 * TejoTime design tokens — ported from the Claude Design "TejoTime Design System".
 * Primitive scales + semantic aliases for light & dark themes.
 * Source: tokens/colors.css, typography.css, spacing.css, dark.css
 */

/* ---- Primitive color scales ---- */
export const palette = {
  brandInk: '#102A6B',
  brandAccent: '#F5821F',

  blue50: '#EFF6FF',
  blue100: '#DBEAFE',
  blue200: '#BFDBFE',
  blue300: '#93C5FD',
  blue400: '#60A5FA',
  blue500: '#3B82F6',
  blue600: '#2563EB',
  blue700: '#1D4ED8',
  blue800: '#1E40AF',
  blue900: '#1E3A8A',

  teal50: '#F0FDFA',
  teal100: '#CCFBF1',
  teal200: '#99F6E4',
  teal300: '#5EEAD4',
  teal400: '#2DD4BF',
  teal500: '#14B8A6',
  teal600: '#0D9488',
  teal700: '#0F766E',
  teal800: '#115E59',
  teal900: '#134E4A',

  green50: '#F0FDF4',
  green100: '#DCFCE7',
  green200: '#BBF7D0',
  green400: '#4ADE80',
  green500: '#22C55E',
  green600: '#16A34A',
  green700: '#15803D',

  amber50: '#FFFBEB',
  amber100: '#FEF3C7',
  amber200: '#FDE68A',
  amber400: '#FBBF24',
  amber500: '#F59E0B',
  amber600: '#D97706',
  amber700: '#B45309',

  red50: '#FEF2F2',
  red100: '#FEE2E2',
  red200: '#FECACA',
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',
  red700: '#B91C1C',

  gray0: '#FFFFFF',
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',
} as const;

/* ---- Semantic aliases ---- */
export type SemanticColors = {
  surfacePage: string;
  surfaceCard: string;
  surfaceSunken: string;
  surfaceHover: string;
  surfaceInverse: string;

  textStrong: string;
  textBody: string;
  textMuted: string;
  textSubtle: string;
  textOnBrand: string;
  textLink: string;

  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;

  primary: string;
  primaryHover: string;
  primaryActive: string;
  primarySoft: string;
  primarySoftFg: string;

  secondary: string;
  secondaryHover: string;
  secondarySoft: string;
  secondarySoftFg: string;

  success: string;
  successSoft: string;
  successSoftFg: string;
  warning: string;
  warningSoft: string;
  warningSoftFg: string;
  error: string;
  errorSoft: string;
  errorSoftFg: string;
  info: string;
  infoSoft: string;
  infoSoftFg: string;

  amber500: string;
  green500: string;
};

export const lightColors: SemanticColors = {
  surfacePage: palette.gray50,
  surfaceCard: palette.gray0,
  surfaceSunken: palette.gray100,
  surfaceHover: palette.gray100,
  surfaceInverse: palette.gray900,

  textStrong: palette.gray900,
  textBody: palette.gray700,
  textMuted: palette.gray500,
  textSubtle: palette.gray400,
  textOnBrand: '#FFFFFF',
  textLink: palette.blue600,

  borderSubtle: palette.gray200,
  borderDefault: palette.gray300,
  borderStrong: palette.gray400,
  borderFocus: palette.blue600,

  primary: palette.blue600,
  primaryHover: palette.blue700,
  primaryActive: palette.blue800,
  primarySoft: palette.blue50,
  primarySoftFg: palette.blue700,

  secondary: palette.teal500,
  secondaryHover: palette.teal600,
  secondarySoft: palette.teal50,
  secondarySoftFg: palette.teal700,

  success: palette.green600,
  successSoft: palette.green50,
  successSoftFg: palette.green700,
  warning: palette.amber600,
  warningSoft: palette.amber50,
  warningSoftFg: palette.amber700,
  error: palette.red600,
  errorSoft: palette.red50,
  errorSoftFg: palette.red700,
  info: palette.blue600,
  infoSoft: palette.blue50,
  infoSoftFg: palette.blue700,

  amber500: palette.amber500,
  green500: palette.green500,
};

export const darkColors: SemanticColors = {
  surfacePage: '#0B1220',
  surfaceCard: palette.gray900,
  surfaceSunken: '#0A1018',
  surfaceHover: palette.gray800,
  surfaceInverse: palette.gray50,

  textStrong: palette.gray50,
  textBody: palette.gray300,
  textMuted: palette.gray400,
  textSubtle: palette.gray500,
  textOnBrand: '#FFFFFF',
  textLink: palette.blue400,

  borderSubtle: '#1E293B',
  borderDefault: '#27364B',
  borderStrong: palette.gray600,
  borderFocus: palette.blue500,

  primary: palette.blue500,
  primaryHover: palette.blue400,
  primaryActive: palette.blue300,
  primarySoft: 'rgba(37, 99, 235, 0.16)',
  primarySoftFg: palette.blue300,

  secondary: palette.teal400,
  secondaryHover: palette.teal300,
  secondarySoft: 'rgba(20, 184, 166, 0.16)',
  secondarySoftFg: palette.teal300,

  success: palette.green400,
  successSoft: 'rgba(34,197,94,0.16)',
  successSoftFg: palette.green400,
  warning: palette.amber400,
  warningSoft: 'rgba(245,158,11,0.16)',
  warningSoftFg: palette.amber400,
  error: palette.red400,
  errorSoft: 'rgba(239,68,68,0.16)',
  errorSoftFg: palette.red400,
  info: palette.blue400,
  infoSoft: 'rgba(37,99,235,0.16)',
  infoSoftFg: palette.blue300,

  amber500: palette.amber500,
  green500: palette.green500,
};

/* ---- Spacing (4px base grid) ---- */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

/* ---- Radii ---- */
export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/* ---- Control heights ---- */
export const controlHeight = {
  sm: 36,
  md: 44,
  lg: 52,
} as const;

/* ---- Typography ---- */
export const fontSize = {
  h1: 40,
  h2: 32,
  h3: 26,
  h4: 21,
  h5: 18,
  bodyLg: 17,
  bodyMd: 15,
  bodySm: 13,
  caption: 12,
} as const;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

export const layout = {
  bottomNavHeight: 64,
  headerHeight: 64,
} as const;

/* ---- Shadows (RN-friendly elevation presets) ---- */
export const shadow = {
  xs: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  },
  xl: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.18,
    shadowRadius: 56,
    elevation: 16,
  },
} as const;
