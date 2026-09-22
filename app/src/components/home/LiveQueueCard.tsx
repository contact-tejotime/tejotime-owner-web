import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { Icon } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import type { SeatGroupVM } from '@/lib/queue';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { withAlpha } from '@/theme/ink';
import { useTheme } from '@/theme/ThemeProvider';

/** The backend's id for the seatless group (`queue-engine.ts`): "Waiting" or "Any". */
export const UNASSIGNED_GROUP_ID = '__unassigned__';

/**
 * The live picture of the shop, in the three numbers an owner acts on, plus the one thing they do
 * most from Home: add a walk-in.
 *
 * - **Waiting:** across every seat this login can see (a staff login sees only its own chair).
 * - **In service:** people being served right now.
 * - **Walk-in wait:** what someone walking in now would wait on the soonest seat. "Now" while any
 *   seat is empty. It is the number the owner quotes at the door. It uses the same per-seat
 *   `clearMinutes` the seat boards and the customer's ticket are built from, so all three agree.
 *
 * Drawn on the store's own brand colour: the one filled surface on Home, so the primary action is
 * unmissable. Everything on it takes the brand's *ink* (`textOnBrand`), dimmed with `withAlpha`,
 * never a fixed white, because in dark mode the brand turns light and its ink turns dark.
 *
 * This replaces the old "Quick actions" row and the queue's own Walk-in pill: Home offered the same
 * action twice, a screen apart.
 */
export function LiveQueueCard({
  seats,
  loading,
  onAddWalkIn,
  onQr,
}: {
  seats: SeatGroupVM[];
  /** First load after sign-in: the zeros would be false, so the numbers pulse instead. */
  loading: boolean;
  onAddWalkIn: () => void;
  /** Omitted when this login can't see the booking QR. */
  onQr?: () => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const ink = theme.colors.textOnBrand;

  const waiting = seats.reduce((n, g) => n + g.waitN, 0);
  // People, not seats: a staffless business has one shared group that can serve several at once.
  const inService = seats.reduce((n, g) => n + g.cards.filter((c) => c.inService).length, 0);
  // The "Any" group holds tickets whose seat was deleted. Nobody new is ever placed there, so it
  // can't be the soonest seat, unless it is the only group (a business with no staff at all).
  const real = seats.filter((g) => g.id !== UNASSIGNED_GROUP_ID);
  const pool = real.length ? real : seats;
  const soonest = pool.length ? Math.min(...pool.map((g) => (g.empty ? 0 : g.clearMinutes))) : null;
  const walkInWait =
    soonest === null ? t.common.dash : soonest <= 0 ? t.dashboard.waitNow : format(t.dashboard.waitMins, { min: soonest });

  const stats = [
    { key: 'waiting', label: t.dashboard.statWaiting, value: String(waiting) },
    { key: 'service', label: t.dashboard.statInService, value: String(inService) },
    { key: 'wait', label: t.dashboard.statWalkInWait, value: walkInWait },
  ];

  return (
    <View style={s.card}>
      {/* Two soft discs in the brand's ink give the flat fill some depth, with no gradient library. */}
      <View style={[s.disc, s.discA]} pointerEvents="none" />
      <View style={[s.disc, s.discB]} pointerEvents="none" />

      <View style={s.topRow}>
        <View style={s.eyebrow}>
          <View style={s.liveDot} />
          <TText variant="caption" weight="bold" style={[s.eyebrowText, { color: withAlpha(ink, 0.9) }]}>
            {t.dashboard.liveQueue.toUpperCase()}
          </TText>
        </View>
        {onQr ? (
          <Pressable
            onPress={onQr}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t.dashboard.showQr}
            style={({ pressed }) => [s.qrBtn, pressed && s.pressed]}>
            <Icon name="qrCode" size={18} color={ink} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.stats}>
        {stats.map((st, i) => (
          <React.Fragment key={st.key}>
            {i > 0 ? <View style={s.divider} /> : null}
            <View style={s.stat} accessible accessibilityLabel={`${st.label}: ${st.value}`}>
              {loading ? (
                <View style={s.valueSkeleton} />
              ) : (
                <TText variant="h2" weight="extrabold" numberOfLines={1} adjustsFontSizeToFit style={[s.value, { color: ink }]}>
                  {st.value}
                </TText>
              )}
              <TText variant="caption" weight="semibold" numberOfLines={1} style={{ color: withAlpha(ink, 0.92) }}>
                {st.label}
              </TText>
            </View>
          </React.Fragment>
        ))}
      </View>

      <Pressable
        onPress={onAddWalkIn}
        accessibilityRole="button"
        style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        <Icon name="plus" size={20} color={theme.colors.primary} strokeWidth={2.6} />
        <TText variant="bodyMd" weight="bold" style={{ color: theme.colors.primary }}>
          {t.dashboard.addWalkIn}
        </TText>
      </Pressable>
    </View>
  );
}

const createStyles = ({ colors, radius, shadow }: ThemeStyleProps) => {
  const ink = colors.textOnBrand;
  return StyleSheet.create({
    card: {
      backgroundColor: colors.primary,
      borderRadius: moderateScale(radius.xl),
      padding: moderateScale(18),
      overflow: 'hidden',
      ...shadow.md,
    },
    disc: { position: 'absolute', borderRadius: 999, backgroundColor: withAlpha(ink, 0.08) },
    discA: { width: moderateScale(180), height: moderateScale(180), top: moderateScale(-70), right: moderateScale(-50) },
    discB: { width: moderateScale(120), height: moderateScale(120), bottom: moderateScale(-60), left: moderateScale(-30) },

    topRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween },
    eyebrow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(8) },
    // Green with a ring of the brand's ink: "live" reads the same on any store colour.
    liveDot: {
      width: moderateScale(9),
      height: moderateScale(9),
      borderRadius: moderateScale(5),
      backgroundColor: colors.success,
      borderWidth: moderateScale(2),
      borderColor: withAlpha(ink, 0.9),
    },
    eyebrowText: { letterSpacing: 1.2 },
    qrBtn: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(radius.md),
      backgroundColor: withAlpha(ink, 0.16),
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },

    stats: { ...styles.flexRow, ...styles.itemsCenter, marginTop: moderateScale(16), marginBottom: moderateScale(18) },
    stat: { ...styles.flex, ...styles.itemsCenter, gap: moderateScale(2) },
    value: { letterSpacing: -0.8 },
    valueSkeleton: {
      width: moderateScale(44),
      height: moderateScale(30),
      marginBottom: moderateScale(4),
      borderRadius: moderateScale(8),
      backgroundColor: withAlpha(ink, 0.22),
    },
    divider: { width: StyleSheet.hairlineWidth * 2, height: moderateScale(36), backgroundColor: withAlpha(ink, 0.24) },

    // Inverted against the card: the brand's ink as the fill, the brand colour as the label.
    cta: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      gap: moderateScale(8),
      height: moderateScale(48),
      borderRadius: moderateScale(radius.md),
      backgroundColor: ink,
    },
    pressed: { opacity: 0.85 },
  });
};
