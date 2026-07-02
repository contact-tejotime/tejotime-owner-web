import React, { useState } from 'react';
import {
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

type Size = 'sm' | 'md' | 'lg';

export function Input({
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
  const { colors, controlHeight, radius, fontFamily, fontSize } = useTheme();
  const [focus, setFocus] = useState(false);
  const borderColor = error ? colors.error : focus ? colors.borderFocus : colors.borderDefault;

  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label && (
        <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textBody }}>
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: controlHeight[size],
          paddingHorizontal: 12,
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor,
          borderRadius: radius.md,
        }}>
        {leadingIcon}
        {prefix && (
          <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodyMd, color: colors.textMuted }}>
            {prefix}
          </Text>
        )}
        <TextInput
          placeholderTextColor={colors.textSubtle}
          {...rest}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          style={{
            flex: 1,
            fontFamily: fontFamily.regular,
            fontSize: fontSize.bodyMd,
            color: colors.textStrong,
            padding: 0,
          }}
        />
        {trailingIcon}
      </View>
      {(error || hint) && (
        <Text
          style={{
            fontFamily: fontFamily.regular,
            fontSize: fontSize.bodySm,
            color: error ? colors.error : colors.textMuted,
          }}>
          {error || hint}
        </Text>
      )}
    </View>
  );
}
