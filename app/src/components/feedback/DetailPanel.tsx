import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useResponsive } from '@/hooks/useResponsive';
import { flatCards } from '@/lib/queue';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

const EXTRAS = [
  { label: 'Shave', mins: 10 },
  { label: 'Beard trim', mins: 15 },
  { label: 'Hair wash', mins: 10 },
  { label: 'Hair color', mins: 30 },
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

  const cards = flatCards(store.seats);
  const card = store.detailId ? cards.find((c) => c.id === store.detailId) : undefined;
  const open = !!card;
  const seat = card ? store.staff.find((st) => st.id === card.staffId) : undefined;
  const seatColor = seat ? resolveColor(seat.color) : theme.colors.textSubtle;
  const seatGroup = card ? store.seats.find((g) => g.id === card.staffId) : undefined;
  const seatBusy = !!seatGroup?.serving;

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
                Customer
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
                <Row label="Seat" s={s}>
                  <View style={s.seatRow}>
                    <View style={s.seatDotBg(seatColor)} />
                    <TText variant="bodyMd" weight="semibold">
                      {seat?.name ?? '—'}
                    </TText>
                  </View>
                </Row>
                <Row label="Service" s={s}>
                  <TText variant="bodyMd" weight="semibold">
                    {card.service}
                  </TText>
                </Row>
                <Row label="Source" s={s}>
                  <TText variant="bodyMd" weight="semibold">
                    {card.online ? 'Booked online' : 'Walk-in'}
                  </TText>
                </Row>
                <Row label="Position" s={s}>
                  <TText variant="bodyMd" weight="semibold">
                    #{card.pos} in {seat?.name ?? 'this'}&apos;s line
                  </TText>
                </Row>
              </View>
            </View>

            <View style={s.footer}>
              {card.status === 'waiting' && (
                <>
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    Move to another seat
                  </TText>
                  <View style={s.chipWrap}>
                    {store.staff
                      .filter((st) => st.id !== card.staffId)
                      .map((st) => (
                        <Pressable key={st.id} onPress={() => store.reassign(card.id, st.id)} style={s.chip}>
                          <View style={s.chipDotBg(resolveColor(st.color))} />
                          <TText variant="bodySm" weight="semibold" color="textBody">
                            {st.name}
                          </TText>
                        </Pressable>
                      ))}
                  </View>
                  {seatBusy && (
                    <TText variant="bodySm" color="textMuted" style={s.busyNote}>
                      {seat?.name ?? 'This seat'} is already serving {seatGroup?.servingName ?? 'someone'}. Complete that
                      service first, or move this customer to another seat.
                    </TText>
                  )}
                  <Button variant="primary" size="lg" fullWidth disabled={seatBusy} onPress={() => store.startService(card.id)}>
                    Start service
                  </Button>
                  <Button variant="outline" fullWidth onPress={() => store.noShow(card.id)}>
                    Mark no-show
                  </Button>
                </>
              )}
              {card.status === 'in-service' && (
                <>
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    Customer changed their mind? Add to this service
                  </TText>
                  <View style={s.extraWrap}>
                    {EXTRAS.map((e) => (
                      <Pressable key={e.label} onPress={() => store.extendService(card.id, e.label, e.mins)} style={s.extraChip}>
                        <Icon name="plus" size={15} color={theme.colors.textBody} />
                        <TText variant="bodySm" weight="semibold" color="textBody">
                          {e.label} · +{e.mins}m
                        </TText>
                      </Pressable>
                    ))}
                  </View>
                  <Button variant="primary" size="lg" fullWidth onPress={() => store.checkout(card.id)}>
                    Complete &amp; start next
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
