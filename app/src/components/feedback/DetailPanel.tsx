import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { flatCards } from '@/lib/queue';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

const EXTRAS = [
  { label: t.detail.extras.shave, mins: 10 },
  { label: t.detail.extras.beardTrim, mins: 15 },
  { label: t.detail.extras.hairWash, mins: 10 },
  { label: t.detail.extras.hairColor, mins: 30 },
];

function Row({ label, children, s }: { label: string; children: React.ReactNode; s: ReturnType<typeof createDetailPanelStyles> }) {
  return (
    <View style={s.row}>
      <TText variant="bodySm" color="textMuted">
        {label}
      </TText>
      {children}
    </View>
  );
}

export function DetailPanel() {
  const theme = useTheme();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const { centerStyle } = useResponsive(640);
  const s = useMemo(() => createDetailPanelStyles(theme), [theme]);

  const { card, seat, seatGroup } = useMemo(() => {
    const c = store.detailId ? flatCards(store.seats).find((x) => x.id === store.detailId) : undefined;
    return {
      card: c,
      seat: c ? store.staff.find((st) => st.id === c.staffId) : undefined,
      seatGroup: c ? store.seats.find((g) => g.id === c.staffId) : undefined,
    };
  }, [store.detailId, store.seats, store.staff]);
  const open = !!card;
  const seatColor = seat ? resolveColor(seat.color) : theme.colors.textSubtle;
  const seatBusy = !!seatGroup?.serving;
  const busy = store.detailBusy;

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={store.closeDetail}>
      {card && (
        <View style={s.page}>
          <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
            <View style={[styles.flex, centerStyle]}>
            <View style={s.topBar}>
              <Pressable onPress={store.closeDetail} style={s.backBtn}>
                <Icon name="chevronLeft" size={22} color={theme.colors.textBody} />
              </Pressable>
              <TText variant="h5" weight="bold">
                {t.detail.customer}
              </TText>
            </View>

            <View style={s.content}>
              <View style={s.hero}>
                <View style={s.avatar}>
                  <TText weight="bold" style={s.avatarText}>
                    {card.initials}
                  </TText>
                </View>
                <TText variant="h4" weight="bold">
                  {card.name}
                </TText>
                <StatusBadge status={card.status} />
              </View>

              <View style={s.rows}>
                <Row label={t.detail.seat} s={s}>
                  <View style={s.seatRow}>
                    <View style={s.seatDotBg(seatColor)} />
                    <TText variant="bodyMd" weight="semibold">
                      {seat?.name ?? t.common.dash}
                    </TText>
                  </View>
                </Row>
                <Row label={t.detail.service} s={s}>
                  <TText variant="bodyMd" weight="semibold">
                    {card.service}
                  </TText>
                </Row>
                <Row label={t.detail.source} s={s}>
                  <TText variant="bodyMd" weight="semibold">
                    {card.online ? t.detail.bookedOnline : t.detail.walkIn}
                  </TText>
                </Row>
                <Row label={t.detail.position} s={s}>
                  <TText variant="bodyMd" weight="semibold">
                    {format(t.detail.positionLine, { pos: card.pos, seat: seat?.name ?? t.detail.thisSeat })}
                  </TText>
                </Row>
              </View>
            </View>

            <View style={s.footer}>
              {card.status === 'waiting' && (
                <>
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    {t.detail.moveToSeat}
                  </TText>
                  <View style={s.chipWrap}>
                    {store.staff
                      .filter((st) => st.id !== card.staffId)
                      .map((st) => (
                        <Pressable
                          key={st.id}
                          disabled={busy}
                          onPress={() => store.reassign(card.id, st.id)}
                          style={s.chip}>
                          <View style={s.chipDotBg(resolveColor(st.color))} />
                          <TText variant="bodySm" weight="semibold" color="textBody">
                            {st.name}
                          </TText>
                        </Pressable>
                      ))}
                  </View>
                  {seatBusy && (
                    <TText variant="bodySm" color="textMuted" style={s.busyNote}>
                      {format(t.detail.seatBusy, {
                        seat: seat?.name ?? t.detail.seatBusyFallback,
                        name: seatGroup?.servingName ?? t.detail.someone,
                      })}
                    </TText>
                  )}
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={busy}
                    disabled={seatBusy}
                    onPress={() => store.startService(card.id)}>
                    {t.detail.startService}
                  </Button>
                  <Button variant="outline" fullWidth disabled={busy} onPress={() => store.noShow(card.id)}>
                    {t.detail.markNoShow}
                  </Button>
                </>
              )}
              {card.status === 'in-service' && (
                <>
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    {t.detail.changedMind}
                  </TText>
                  <View style={s.extraWrap}>
                    {EXTRAS.map((e) => (
                      <Pressable
                        key={e.label}
                        disabled={busy}
                        onPress={() => store.extendService(card.id, e.label, e.mins)}
                        style={s.extraChip}>
                        <Icon name="plus" size={15} color={theme.colors.textBody} />
                        <TText variant="bodySm" weight="semibold" color="textBody">
                          {format(t.detail.extendChip, { label: e.label, mins: e.mins })}
                        </TText>
                      </Pressable>
                    ))}
                  </View>
                  <Button variant="primary" size="lg" fullWidth loading={busy} onPress={() => store.checkout(card.id)}>
                    {t.detail.completeNext}
                  </Button>
                </>
              )}
            </View>
            </View>
          </SafeAreaView>
        </View>
      )}
    </Modal>
  );
}

const createDetailPanelStyles = ({ colors, radius }: ThemeStyleProps) => {
  const base = StyleSheet.create({
    page: { ...styles.flex, backgroundColor: colors.surfacePage },
    safe: { ...styles.flex },
    topBar: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      ...styles.ph4,
      ...styles.pv3,
    },
    backBtn: {
      ...styles.nonFlexCenter,
      width: moderateScale(40),
      height: moderateScale(40),
    },
    content: { ...styles.flex, ...styles.ph5 },
    hero: { ...styles.itemsCenter, gap: moderateScale(10), ...styles.pt2, paddingBottom: moderateScale(18) },
    avatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(72),
      height: moderateScale(72),
      borderRadius: moderateScale(36),
      backgroundColor: colors.primarySoft,
    },
    avatarText: { fontSize: moderateScale(26), color: colors.primarySoftFg },
    rows: { gap: moderateScale(10) },
    row: {
      ...styles.rowSpaceBetween,
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      ...styles.pv4,
      ...styles.ph4,
    },
    seatRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(7) },
    seatDot: { width: moderateScale(9), height: moderateScale(9), borderRadius: moderateScale(4.5) },
    footer: {
      ...styles.ph5,
      paddingTop: moderateScale(14),
      ...styles.pb2,
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.surfaceCard,
      gap: moderateScale(10),
    },
    chipWrap: { ...styles.flexRow, ...styles.wrap, ...styles.g2, ...styles.mb1 },
    chip: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(7),
      paddingHorizontal: moderateScale(13),
      paddingVertical: moderateScale(8),
      borderRadius: moderateScale(radius.pill),
      backgroundColor: colors.surfacePage,
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
    },
    chipDot: { width: moderateScale(9), height: moderateScale(9), borderRadius: moderateScale(4.5) },
    extraWrap: { ...styles.flexRow, ...styles.wrap, ...styles.g2 },
    extraChip: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(6),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(8),
      borderRadius: moderateScale(radius.pill),
      backgroundColor: colors.surfacePage,
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
    },
    busyNote: { lineHeight: moderateScale(20) },
  });

  return {
    ...base,
    seatDotBg: (color: string) => [base.seatDot, { backgroundColor: color }],
    chipDotBg: (color: string) => [base.chipDot, { backgroundColor: color }],
  };
};
