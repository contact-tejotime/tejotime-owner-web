import React, { useMemo, useState } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';

import { TText } from '@/components/common/TText';
import { styles } from '@/styles';
import { moderateScale, rSize, scaleFont } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { fontFamily } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

type Size = 'sm' | 'md' | 'lg';

export function TInput({
  label,
  hint,
  error,
  size = 'md',
  leadingIcon,
  trailingIcon,
  prefix,
  containerStyle,
  ...rest
}: {
  label?: string;
  hint?: string;
  error?: string;
  size?: Size;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  prefix?: string;
  containerStyle?: StyleProp<ViewStyle>;
} & TextInputProps) {
  const theme = useTheme();
  const [focus, setFocus] = useState(false);
  const borderColor = error ? theme.colors.error : focus ? theme.colors.borderFocus : theme.colors.borderDefault;
  const s = useMemo(() => createTInputStyles(theme, borderColor), [theme, borderColor]);

  return (
    <View style={[s.root, containerStyle]}>
      {label && (
        <TText variant="bodySm" color="textBody" weight="medium">
          {label}
        </TText>
      )}
      <View style={tInputFieldStyle(s, size)}>
        {leadingIcon}
        {prefix && (
          <TText variant="bodyMd" color="textMuted">
            {prefix}
          </TText>
        )}
        <TextInput
          placeholderTextColor={theme.colors.textSubtle}
          {...rest}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          style={s.input}
        />
        {trailingIcon}
      </View>
      {(error || hint) && (
        <TText variant="bodySm" color={error ? 'error' : 'textMuted'}>
          {error || hint}
        </TText>
      )}
    </View>
  );
}

const createTInputStyles = (
  theme: ThemeStyleProps & { controlHeight: typeof import('@/theme/tokens').controlHeight; fontFamily: typeof fontFamily },
  borderColor: string,
) =>
  StyleSheet.create({
    root: { ...styles.g1 },
    field: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      paddingHorizontal: moderateScale(12),
      backgroundColor: theme.colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor,
      borderRadius: moderateScale(theme.radius.md),
    },
    fieldSm: { height: rSize(theme.controlHeight.sm) },
    fieldMd: { height: rSize(theme.controlHeight.md) },
    fieldLg: { height: rSize(theme.controlHeight.lg) },
    input: {
      ...styles.flex,
      fontFamily: theme.fontFamily.regular,
      fontSize: scaleFont(15),
      color: theme.colors.textStrong,
      padding: 0,
      includeFontPadding: false,
      // backgroundColor: 'red'
    } as TextStyle,
  });

const tInputFieldStyle = (
  s: ReturnType<typeof createTInputStyles>,
  size: Size,
) => [s.field, size === 'sm' ? s.fieldSm : size === 'lg' ? s.fieldLg : s.fieldMd];
