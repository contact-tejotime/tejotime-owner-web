import React from 'react';
import { Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { SemanticColors } from '@/theme/tokens';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

function tonePair(tone: BadgeTone, c: SemanticColors) {
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
    case 'neutral':
    default:
      return { bg: c.surfaceSunken, fg: c.textBody };
  }
}

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
  const { colors, radius, fontFamily } = useTheme();
  const t = tonePair(tone, colors);
  const sm = size === 'sm';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: t.bg,
        borderRadius: radius.pill,
        paddingHorizontal: sm ? 8 : 10,
        paddingVertical: sm ? 4 : 5,
        alignSelf: 'flex-start',
      }}>
      {dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.fg }} />}
      <Text style={{ color: t.fg, fontFamily: fontFamily.semibold, fontSize: sm ? 11 : 12 }}>
        {children}
      </Text>
    </View>
  );
}
