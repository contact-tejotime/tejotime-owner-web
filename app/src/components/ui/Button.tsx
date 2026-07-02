import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { SemanticColors } from '@/theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

function variantColors(variant: ButtonVariant, c: SemanticColors, pressed: boolean) {
  switch (variant) {
    case 'secondary':
      return { bg: pressed ? c.secondaryHover : c.secondary, fg: c.textOnBrand, border: 'transparent' };
    case 'outline':
      return {
        bg: pressed ? c.surfaceSunken : c.surfaceCard,
        fg: c.textStrong,
        border: c.borderDefault,
      };
    case 'ghost':
      return { bg: pressed ? c.surfaceHover : 'transparent', fg: c.textBody, border: 'transparent' };
    case 'danger':
      return { bg: pressed ? c.errorSoftFg : c.error, fg: '#fff', border: 'transparent' };
    case 'primary':
    default:
      return { bg: pressed ? c.primaryHover : c.primary, fg: c.textOnBrand, border: 'transparent' };
  }
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  onPress,
  children,
  textColor,
  style,
}: {
  variant?: ButtonVariant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
  /** override label color (e.g. ghost destructive) */
  textColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, controlHeight, radius, fontFamily, fontSize, shadow } = useTheme();
  const isDisabled = disabled || loading;
  const heights = { sm: controlHeight.sm, md: controlHeight.md, lg: controlHeight.lg };
  const pads = { sm: 14, md: 18, lg: 22 };
  const fonts = { sm: fontSize.bodySm, md: fontSize.bodyMd, lg: fontSize.bodyLg };

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      style={({ pressed }) => {
        const v = variantColors(variant, colors, pressed && !isDisabled);
        return [
          {
            height: heights[size],
            paddingHorizontal: pads[size],
            borderRadius: radius.md,
            backgroundColor: v.bg,
            borderWidth: 1,
            borderColor: v.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: isDisabled ? 0.5 : 1,
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
            width: fullWidth ? '100%' : undefined,
          },
          variant !== 'ghost' ? shadow.xs : null,
          style,
        ];
      }}>
      {({ pressed }) => {
        const v = variantColors(variant, colors, pressed && !isDisabled);
        const fg = textColor ?? v.fg;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? (
              <ActivityIndicator size="small" color={fg} />
            ) : (
              leadingIcon
            )}
            {typeof children === 'string' ? (
              <Text
                style={{
                  color: fg,
                  fontFamily: fontFamily.semibold,
                  fontSize: fonts[size],
                  letterSpacing: -0.1,
                }}
                numberOfLines={1}>
                {children}
              </Text>
            ) : (
              children
            )}
            {!loading && trailingIcon}
          </View>
        );
      }}
    </Pressable>
  );
}
