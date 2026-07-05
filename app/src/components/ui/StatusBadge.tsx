import React, { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, TextStyle, View } from 'react-native';

import { TText } from '@/components/common';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { SemanticColors } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export type StatusKind =
  | 'waiting'
  | 'upcoming'
  | 'in-service'
  | 'serving'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  | 'confirmed';

type Tone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error';

const STATUS_MAP: Record<StatusKind, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting', tone: 'warning' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  'in-service': { label: 'In service', tone: 'primary' },
  serving: { label: 'In service', tone: 'primary' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  'no-show': { label: 'No-show', tone: 'error' },
  confirmed: { label: 'Confirmed', tone: 'success' },
};

export function StatusBadge({ status }: { status: StatusKind }) {
  const theme = useTheme();
  const meta = STATUS_MAP[status] ?? { label: status, tone: 'neutral' as Tone };
  const t = useMemo(() => statusTonePair(meta.tone, theme.colors), [meta.tone, theme.colors]);
  const s = useMemo(() => createStatusBadgeStyles(theme, t), [theme, t]);
  const live = status === 'in-service' || status === 'serving' || status === 'waiting';

  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  return (
    <View style={s.root}>
      <View style={s.dotWrap}>
        <View style={[s.dot, s.dotBg]} />
        {live && (
          <Animated.View
            style={[
              s.dot,
              s.dotBg,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
              },
            ]}
          />
        )}
      </View>
      <TText weight="semibold" style={s.text}>
        {meta.label}
      </TText>
    </View>
  );
}

function statusTonePair(tone: string, c: SemanticColors) {
  switch (tone) {
    case 'primary':
      return { bg: c.primarySoft, fg: c.primarySoftFg };
    case 'info':
      return { bg: c.infoSoft, fg: c.infoSoftFg };
    case 'success':
      return { bg: c.successSoft, fg: c.successSoftFg };
    case 'warning':
      return { bg: c.warningSoft, fg: c.warningSoftFg };
    case 'error':
      return { bg: c.errorSoft, fg: c.errorSoftFg };
    default:
      return { bg: c.surfaceSunken, fg: c.textMuted };
  }
}

const createStatusBadgeStyles = ({ radius }: ThemeStyleProps, tone: { bg: string; fg: string }) =>
  StyleSheet.create({
    root: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(6),
      backgroundColor: tone.bg,
      borderRadius: moderateScale(radius.pill),
      paddingHorizontal: moderateScale(10),
      paddingVertical: moderateScale(5),
      alignSelf: 'flex-start',
    },
    dotWrap: { width: moderateScale(7), height: moderateScale(7) },
    dot: {
      position: 'absolute',
      width: moderateScale(7),
      height: moderateScale(7),
      borderRadius: moderateScale(3.5),
    },
    dotBg: { backgroundColor: tone.fg },
    text: { color: tone.fg, fontSize: moderateScale(12) } as TextStyle,
  });
