import React, { useMemo } from 'react';
import { GestureResponderHandlers, Pressable, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';

import { TText } from '@/components/common';
import { CardVM } from '@/lib/queue';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

export function QueueCard({
  card,
  onPress,
  showSeat = true,
  dragging = false,
  panHandlers,
}: {
  card: CardVM;
  onPress?: () => void;
  showSeat?: boolean;
  dragging?: boolean;
  panHandlers?: GestureResponderHandlers;
}) {
  const theme = useTheme();
  const resolveColor = useServiceColor();
  const seatColor = resolveColor(card.seatColor);
  const active = card.inService;
  const s = useMemo(() => createQueueCardStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      {...panHandlers}
      style={s.containerVariant(dragging, active)}>
      <View style={s.numBadgeVariant(active, dragging)}>
        <TText variant="bodyMd" weight="bold" style={s.numTextVariant(active, dragging) as TextStyle}>
          {card.pos}
        </TText>
      </View>

      <View style={s.body}>
        <TText variant="bodyMd" color="textStrong" weight="semibold" numberOfLines={1}>
          {card.name}
        </TText>
        <View style={s.subRow}>
          {showSeat && <View style={s.seatDotBg(seatColor)} />}
          <TText variant="bodySm" color="textMuted" numberOfLines={1} style={s.subText}>
            {showSeat ? `${card.seatName} · ${card.service}` : `${card.srcLabel} · ${card.service}`}
          </TText>
        </View>
      </View>

      <View style={s.rightRow}>
        <View style={s.statusDotBg(active)} />
        <TText variant="bodySm" weight="semibold" style={s.rightTextVariant(active) as TextStyle}>
          {card.rightText}
        </TText>
      </View>
    </Pressable>
  );
}

function tint(hex: string, alpha: number) {
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

const createQueueCardStyles = ({ colors, radius, shadow }: ThemeStyleProps) => {
  const base = StyleSheet.create({
    pressable: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(11),
      borderRadius: moderateScale(radius.lg),
      ...styles.p3,
    },
    numBadge: {
      ...styles.nonFlexCenter,
      width: moderateScale(34),
      height: moderateScale(34),
      borderRadius: moderateScale(radius.md),
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    subRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g1, ...styles.mt1 },
    seatDot: { width: moderateScale(8), height: moderateScale(8), borderRadius: moderateScale(4) },
    subText: { ...styles.flex },
    rightRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g1 },
    statusDot: { width: moderateScale(7), height: moderateScale(7), borderRadius: moderateScale(3.5) },
    numTextActive: { color: '#fff' },
    numTextIdle: { color: colors.textMuted },
    rightTextActive: { color: colors.primary },
    rightTextIdle: { color: colors.textMuted },
    default: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      ...shadow.xs,
    },
    active: {
      backgroundColor: tint(colors.primary, 0.06),
      borderWidth: moderateScale(1),
      borderColor: tint(colors.primary, 0.32),
    },
    dragging: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1.5),
      borderColor: colors.primary,
      ...shadow.lg,
      transform: [{ scale: 1.02 }],
      zIndex: 5,
    },
    numBgActive: { backgroundColor: colors.primary },
    numBgIdle: { backgroundColor: colors.surfaceSunken },
  });

  return {
    ...base,
    containerVariant: (dragging: boolean, active: boolean): ViewStyle[] => [
      base.pressable,
      dragging ? base.dragging : active ? base.active : base.default,
    ],
    numBadgeVariant: (active: boolean, dragging: boolean) => [
      base.numBadge,
      active || dragging ? base.numBgActive : base.numBgIdle,
    ],
    numTextVariant: (active: boolean, dragging: boolean) =>
      active || dragging ? base.numTextActive : base.numTextIdle,
    rightTextVariant: (active: boolean) => (active ? base.rightTextActive : base.rightTextIdle),
    seatDotBg: (color: string) => [base.seatDot, { backgroundColor: color }],
    statusDotBg: (active: boolean) => [
      base.statusDot,
      { backgroundColor: active ? colors.primary : colors.warning },
    ],
  };
};
