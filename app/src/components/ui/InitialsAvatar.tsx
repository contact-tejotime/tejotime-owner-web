import React, { useMemo } from 'react';
import { StyleSheet, TextStyle, View } from 'react-native';

import { TText } from '@/components/common';
import { initials as toInitials } from '@/lib/format';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { SemanticColors } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export function InitialsAvatar({
  name,
  size = 40,
  variant = 'primary',
}: {
  name: string;
  size?: number;
  variant?: 'primary' | 'sunken';
}) {
  const { colors } = useTheme();
  const s = useMemo(() => createInitialsAvatarStyles(colors, size, variant), [colors, size, variant]);

  return (
    <View style={s.root}>
      <TText weight="semibold" style={s.text}>
        {toInitials(name)}
      </TText>
    </View>
  );
}

const createInitialsAvatarStyles = (
  colors: SemanticColors,
  size: number,
  variant: 'primary' | 'sunken',
) => {
  const bg = variant === 'sunken' ? colors.surfaceSunken : colors.primarySoft;
  const fg = variant === 'sunken' ? colors.textBody : colors.primarySoftFg;
  return StyleSheet.create({
    root: {
      ...styles.nonFlexCenter,
      width: moderateScale(size),
      height: moderateScale(size),
      borderRadius: moderateScale(size / 2),
      backgroundColor: bg,
    },
    text: { fontSize: moderateScale(Math.round(size * 0.4)), color: fg } as TextStyle,
  });
};
