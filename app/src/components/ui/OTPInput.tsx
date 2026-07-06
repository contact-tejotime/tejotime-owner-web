import React, { useMemo, useRef } from 'react';
import { NativeSyntheticEvent, StyleSheet, TextInput, TextInputKeyPressEventData, TextStyle, View } from 'react-native';

import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { fontFamily } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export function OTPInput({
  length = 4,
  value = '',
  onChange,
}: {
  length?: number;
  value?: string;
  onChange?: (next: string) => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createOTPInputStyles(theme), [theme]);
  const refs = useRef<(TextInput | null)[]>([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  const setAt = (i: number, d: string) => {
    const arr = value.padEnd(length, ' ').slice(0, length).split('');
    arr[i] = d || ' ';
    onChange?.(arr.map((c) => (c === ' ' ? '' : c)).join(''));
  };

  return (
    <View style={s.row}>
      {Array.from({ length }).map((_, i) => {
        const ch = digits[i] === ' ' ? '' : digits[i];
        return (
          <TextInput
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={ch}
            keyboardType="number-pad"
            maxLength={1}
            onChangeText={(text) => {
              const d = text.replace(/\D/g, '').slice(-1);
              setAt(i, d);
              if (d && i < length - 1) refs.current[i + 1]?.focus();
            }}
            onKeyPress={(e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
              if (e.nativeEvent.key === 'Backspace' && !ch && i > 0) refs.current[i - 1]?.focus();
            }}
            style={s.cellStyle(!!ch)}
          />
        );
      })}
    </View>
  );
}

const createOTPInputStyles = ({ colors, radius }: ThemeStyleProps) => {
  const base = StyleSheet.create({
    row: { ...styles.flexRow, ...styles.g3 },
    cell: {
      width: moderateScale(52),
      height: moderateScale(60),
      textAlign: 'center',
      fontFamily: fontFamily.bold,
      fontSize: moderateScale(24),
      color: colors.textStrong,
      borderWidth: moderateScale(1.5),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceCard,
    } as TextStyle,
    cellFilled: { borderColor: colors.primary },
    cellEmpty: { borderColor: colors.borderDefault },
  });

  return {
    ...base,
    cellStyle: (filled: boolean) => [base.cell, filled ? base.cellFilled : base.cellEmpty],
  };
};
