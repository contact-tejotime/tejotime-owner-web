import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';

import { TText } from '@/components/common/TText';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { SemanticColors, controlHeight, fontSize, radius } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export type TButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export function TButton({
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
  variant?: TButtonVariant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
  textColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, shadow } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      style={({ pressed }) => {
        const v = variantColors(variant, colors, pressed && !isDisabled);
        return [buttonShellStyle(size, fullWidth, isDisabled, v), variant !== 'ghost' ? shadow.xs : null, style];
      }}>
      {({ pressed }) => {
        const v = variantColors(variant, colors, pressed && !isDisabled);
        const fg = textColor ?? v.fg;
        return (
          <View style={tButtonStyles.inner}>
            {loading ? <ActivityIndicator size="small" color={fg} /> : leadingIcon}
            {typeof children === 'string' ? (
              <TText
                variant={size === 'sm' ? 'bodySm' : size === 'lg' ? 'bodyLg' : 'bodyMd'}
                color="inherit"
                weight="semibold"
                style={buttonLabelStyle(fg, size) as TextStyle}
                numberOfLines={1}>
                {children}
              </TText>
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

function variantColors(variant: string, c: SemanticColors, pressed: boolean) {
  switch (variant) {
    case 'secondary':
      return { bg: pressed ? c.secondaryHover : c.secondary, fg: c.textOnBrand, border: 'transparent' };
    case 'outline':
      return { bg: pressed ? c.surfaceSunken : c.surfaceCard, fg: c.textStrong, border: c.borderDefault };
    case 'ghost':
      return { bg: pressed ? c.surfaceHover : 'transparent', fg: c.textBody, border: 'transparent' };
    case 'danger':
      return { bg: pressed ? c.errorSoftFg : c.error, fg: '#fff', border: 'transparent' };
    case 'primary':
    default:
      return { bg: pressed ? c.primaryHover : c.primary, fg: c.textOnBrand, border: 'transparent' };
  }
}

const heights = { sm: controlHeight.sm, md: controlHeight.md, lg: controlHeight.lg };
const pads = { sm: moderateScale(14), md: moderateScale(18), lg: moderateScale(22) };
const fonts = { sm: fontSize.bodySm, md: fontSize.bodyMd, lg: fontSize.bodyLg };

const tButtonStyles = StyleSheet.create({
  inner: { ...styles.flexRow, ...styles.rowCenter, ...styles.g2 },
  label: { letterSpacing: -0.1 },
  fullWidth: { alignSelf: 'stretch', width: '100%' },
  selfStart: { alignSelf: 'flex-start' },
  disabled: { opacity: 0.5 },
});

function buttonShellStyle(
  size: Size,
  fullWidth: boolean,
  disabled: boolean,
  v: { bg: string; border: string },
): ViewStyle {
  return {
    height: heights[size],
    paddingHorizontal: pads[size],
    borderRadius: moderateScale(radius.md),
    backgroundColor: v.bg,
    borderWidth: moderateScale(1),
    borderColor: v.border,
    ...styles.flexRow,
    ...styles.itemsCenter,
    ...styles.justifyCenter,
    gap: moderateScale(8),
    ...(fullWidth ? tButtonStyles.fullWidth : tButtonStyles.selfStart),
    ...(disabled ? tButtonStyles.disabled : null),
  };
}

function buttonLabelStyle(fg: string, size: Size): TextStyle {
  return { ...tButtonStyles.label, color: fg, fontSize: fonts[size] };
}
