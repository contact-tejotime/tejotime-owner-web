import React from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';

import { moderateScale, rSize } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';
import { SemanticColors } from '@/theme/tokens';

type Variant = 'ghost' | 'outline' | 'primary' | 'soft';
type Size = 'sm' | 'md' | 'lg';

function colorsFor(variant: Variant, c: SemanticColors, pressed: boolean) {
  switch (variant) {
    case 'outline':
      return { bg: pressed ? c.surfaceHover : c.surfaceCard, border: c.borderDefault };
    case 'primary':
      return { bg: pressed ? c.primaryHover : c.primary, border: 'transparent' };
    case 'soft':
      return { bg: c.surfaceSunken, border: 'transparent' };
    case 'ghost':
    default:
      return { bg: pressed ? c.surfaceHover : 'transparent', border: 'transparent' };
  }
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  onPress,
  children,
  style,
  accessibilityLabel,
}: {
  variant?: Variant;
  size?: Size;
  onPress?: () => void;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors, controlHeight, radius } = useTheme();
  const dim = rSize(controlHeight[size]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => {
        const v = colorsFor(variant, colors, pressed);
        return [
          {
            width: dim,
            height: dim,
            borderRadius: moderateScale(radius.md),
            backgroundColor: v.bg,
            borderWidth: moderateScale(1),
            borderColor: v.border,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ];
      }}>
      {children}
    </Pressable>
  );
}
