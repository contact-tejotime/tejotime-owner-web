import React from 'react';
import { Text as RNText, TextProps, TextStyle, StyleProp } from 'react-native';

import { getTextVariantStyle } from '@/styles/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, SemanticColors, TextVariant } from '@/theme/tokens';

type ColorKey = keyof SemanticColors | 'inherit';
type WeightKey = keyof typeof fontFamily;

export function TText({
  variant = 'bodyMd',
  color = 'textBody',
  weight,
  align,
  style,
  children,
  ...props
}: {
  variant?: TextVariant;
  color?: ColorKey;
  weight?: WeightKey;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
} & TextProps) {
  const { colors } = useTheme();
  const colorValue = color === 'inherit' ? undefined : colors[color as keyof SemanticColors];

  return (
    <RNText
      style={[
        getTextVariantStyle(variant),
        weight ? { fontFamily: fontFamily[weight] } : null,
        colorValue ? { color: colorValue } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...props}>
      {children}
    </RNText>
  );
}
