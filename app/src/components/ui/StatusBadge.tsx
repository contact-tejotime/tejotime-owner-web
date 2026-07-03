import React, { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { SemanticColors } from '@/theme/tokens';

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

function tonePair(tone: Tone, c: SemanticColors) {
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
    case 'neutral':
    default:
      return { bg: c.surfaceSunken, fg: c.textMuted };
  }
}

export function StatusBadge({ status }: { status: StatusKind }) {
  const { colors, radius, fontFamily } = useTheme();
  const s = STATUS_MAP[status] ?? { label: status, tone: 'neutral' as Tone };
  const t = tonePair(s.tone, colors);
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
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: t.bg,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 5,
        alignSelf: 'flex-start',
      }}>
      <View style={{ width: 7, height: 7 }}>
        <View
          style={{ position: 'absolute', width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.fg }}
        />
        {live && (
          <Animated.View
            style={{
              position: 'absolute',
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: t.fg,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
            }}
          />
        )}
      </View>
      <Text style={{ color: t.fg, fontFamily: fontFamily.semibold, fontSize: 12 }}>{s.label}</Text>
    </View>
  );
}
