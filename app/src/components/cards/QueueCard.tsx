import React from 'react';
import { GestureResponderHandlers, Pressable, Text, View } from 'react-native';

import { CardVM } from '@/lib/queue';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

/** Translucent tint of a hex accent color. */
function tint(hex: string, alpha: number) {
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/**
 * Queue row for both the dashboard preview (showSeat) and the seat view (source line).
 * Pass `dragging` + `panHandlers` to make it draggable within a seat.
 */
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
  const { colors, radius, fontFamily, fontSize, shadow } = useTheme();
  const resolveColor = useServiceColor();
  const seatColor = resolveColor(card.seatColor);
  const active = card.inService;

  const dotColor = active ? colors.primary : colors.warning;
  const rightColor = active ? colors.primary : colors.textMuted;

  const containerStyle = dragging
    ? {
        backgroundColor: colors.surfaceCard,
        borderWidth: 1.5,
        borderColor: colors.primary,
        ...shadow.lg,
        transform: [{ scale: 1.02 }],
        zIndex: 5,
      }
    : active
      ? {
          backgroundColor: tint(colors.primary, 0.06),
          borderWidth: 1,
          borderColor: tint(colors.primary, 0.32),
        }
      : { backgroundColor: colors.surfaceCard, borderWidth: 1, borderColor: colors.borderSubtle, ...shadow.xs };

  const numBg = active || dragging ? colors.primary : colors.surfaceSunken;
  const numFg = active || dragging ? '#fff' : colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      {...panHandlers}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: radius.lg, padding: 12 },
        containerStyle,
      ]}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.md,
          backgroundColor: numBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.bodyMd, color: numFg }}>{card.pos}</Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
          {card.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {showSeat && (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: seatColor }} />
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted }}>
            {showSeat ? `${card.seatName} · ${card.service}` : `${card.srcLabel} · ${card.service}`}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: dotColor }} />
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: rightColor }}>
          {card.rightText}
        </Text>
      </View>
    </Pressable>
  );
}
