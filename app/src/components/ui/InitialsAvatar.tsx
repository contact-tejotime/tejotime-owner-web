import React from 'react';
import { Text, View } from 'react-native';

import { initials as toInitials } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/** Circular initials chip — primary-soft by default, matching the owner app design. */
export function InitialsAvatar({
  name,
  size = 40,
  variant = 'primary',
}: {
  name: string;
  size?: number;
  variant?: 'primary' | 'sunken';
}) {
  const { colors, fontFamily } = useTheme();
  const bg = variant === 'sunken' ? colors.surfaceSunken : colors.primarySoft;
  const fg = variant === 'sunken' ? colors.textBody : colors.primarySoftFg;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: Math.round(size * 0.4), color: fg }}>
        {toInitials(name)}
      </Text>
    </View>
  );
}
