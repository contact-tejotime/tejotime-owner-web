import React, { useMemo } from 'react';
import { StyleSheet, TextStyle, View } from 'react-native';

import { TText } from '@/components/common';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { SemanticColors } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export function Badge({
  tone = 'neutral',
  dot = false,
  size = 'md',
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  size?: 'sm' | 'md';
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const sm = size === 'sm';
  const t = useMemo(() => badgeTonePair(tone, theme.colors), [tone, theme.colors]);
  const s = useMemo(() => createBadgeStyles(theme, t, sm), [theme, t, sm]);

  return (
    <View style={s.root}>
      {dot && <View style={s.dot} />}
      <TText weight="semibold" style={s.text}>
        {children}
      </TText>
    </View>
  );
}

function badgeTonePair(tone: string, c: SemanticColors) {
  switch (tone) {
    case 'primary':
      return { bg: c.primarySoft, fg: c.primarySoftFg };
    case 'secondary':
      return { bg: c.secondarySoft, fg: c.secondarySoftFg };
    case 'success':
      return { bg: c.successSoft, fg: c.successSoftFg };
    case 'warning':
      return { bg: c.warningSoft, fg: c.warningSoftFg };
    case 'error':
      return { bg: c.errorSoft, fg: c.errorSoftFg };
    case 'info':
      return { bg: c.infoSoft, fg: c.infoSoftFg };
    default:
      return { bg: c.surfaceSunken, fg: c.textBody };
  }
}

const createBadgeStyles = ({ radius }: ThemeStyleProps, tone: { bg: string; fg: string }, sm: boolean) =>
  StyleSheet.create({
    root: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(6),
      backgroundColor: tone.bg,
      borderRadius: moderateScale(radius.pill),
      paddingHorizontal: sm ? moderateScale(8) : moderateScale(10),
      paddingVertical: sm ? moderateScale(4) : moderateScale(5),
      alignSelf: 'flex-start',
    },
    dot: { width: moderateScale(6), height: moderateScale(6), borderRadius: moderateScale(3), backgroundColor: tone.fg },
    text: { color: tone.fg, fontSize: sm ? moderateScale(11) : moderateScale(12) } as TextStyle,
  });
