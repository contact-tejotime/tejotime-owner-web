import { StyleSheet, TextStyle } from 'react-native';

import { fontFamily, fontSize, letterSpacing, lineHeight, textStyle, TextVariant } from '@/theme/tokens';

import { scaleFont } from './scale';

export const fontWeights = StyleSheet.create({
  extralight: { fontFamily: fontFamily.extralight },
  extralightItalic: { fontFamily: fontFamily.extralightItalic },
  light: { fontFamily: fontFamily.light },
  lightItalic: { fontFamily: fontFamily.lightItalic },
  regular: { fontFamily: fontFamily.regular },
  italic: { fontFamily: fontFamily.italic },
  medium: { fontFamily: fontFamily.medium },
  mediumItalic: { fontFamily: fontFamily.mediumItalic },
  semibold: { fontFamily: fontFamily.semibold },
  semiboldItalic: { fontFamily: fontFamily.semiboldItalic },
  bold: { fontFamily: fontFamily.bold },
  boldItalic: { fontFamily: fontFamily.boldItalic },
  extrabold: { fontFamily: fontFamily.extrabold },
  extraboldItalic: { fontFamily: fontFamily.extraboldItalic },
});

export const fontSizes = StyleSheet.create(
  Object.fromEntries(
    Object.entries(fontSize).map(([key, value]) => [key, { fontSize: scaleFont(value) }]),
  ) as Record<keyof typeof fontSize, TextStyle>,
);

export const lineHeights = StyleSheet.create({
  tight: { lineHeight: scaleFont(fontSize.h1) * lineHeight.tight },
  snug: { lineHeight: scaleFont(fontSize.h4) * lineHeight.snug },
  normal: { lineHeight: scaleFont(fontSize.bodyMd) * lineHeight.normal },
  relaxed: { lineHeight: scaleFont(fontSize.bodyLg) * lineHeight.relaxed },
});

export const letterSpacings = StyleSheet.create({
  tight: { letterSpacing: letterSpacing.tight },
  snug: { letterSpacing: letterSpacing.snug },
  normal: { letterSpacing: letterSpacing.normal },
  wide: { letterSpacing: letterSpacing.wide },
});

export function getTextVariantStyle(variant: TextVariant): TextStyle {
  const preset = textStyle[variant];
  const size = scaleFont(preset.fontSize);
  return {
    fontFamily: preset.fontFamily,
    fontSize: size,
    lineHeight: size * preset.lineHeight,
    letterSpacing: preset.letterSpacing,
  };
}

export default { fontWeights, fontSizes, lineHeights, letterSpacings, getTextVariantStyle };
