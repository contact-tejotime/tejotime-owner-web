import React, { useRef } from 'react';
import { NativeSyntheticEvent, TextInput, TextInputKeyPressEventData, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

/** One-time-password input — N separate digit boxes. */
export function OTPInput({
  length = 4,
  value = '',
  onChange,
}: {
  length?: number;
  value?: string;
  onChange?: (next: string) => void;
}) {
  const { colors, radius, fontFamily } = useTheme();
  const refs = useRef<(TextInput | null)[]>([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  const setAt = (i: number, d: string) => {
    const arr = value.padEnd(length, ' ').slice(0, length).split('');
    arr[i] = d || ' ';
    onChange?.(arr.map((c) => (c === ' ' ? '' : c)).join(''));
  };

  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
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
            style={{
              width: 52,
              height: 60,
              textAlign: 'center',
              fontFamily: fontFamily.bold,
              fontSize: 24,
              color: colors.textStrong,
              borderWidth: 1.5,
              borderColor: ch ? colors.primary : colors.borderDefault,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceCard,
            }}
          />
        );
      })}
    </View>
  );
}
