import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { api } from '@/lib/api';
import { flatCards } from '@/lib/queue';
import { extrasForCategory } from '@/lib/service-extras';
import { showToast } from '@/lib/toast';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

/** What this entry would be charged right now, as the API computes it. */
interface Billing {
  suggestedAmount: { amount: number; currency: string };
  extras: { id: string; label: string; minutes: number; pricePaise: number }[];
}

export function DetailPanel() {
  const theme = useTheme();
  // Still needed for the seat chips in the 'move to another seat' row.
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
  const seatBusy = !!seatGroup?.serving;
  const busy = store.detailBusy;
  const extras = useMemo(
    () => extrasForCategory(store.business?.category),
    [store.business?.category],
  );
  /** Spin only the button that was pressed; disable the rest without spinning them. */
  const running = (action: typeof store.detailAction) => busy && store.detailAction === action;

  /**
   * The amount step.
   *
   * `visit.amount_paise` feeds customer lifetime spend and every revenue KPI, and it used to be
   * written from the BOOKED service alone — so someone who came for a beard trim and also had a
   * haircut was banked at the beard-trim price. Completing now passes through this step, which
   * pre-fills the derived total and lets it be corrected before it reaches the ledger.
   */
  const [billing, setBilling] = useState<Billing | null>(null);
  const [amount, setAmount] = useState('');

  // Reload whenever the open card changes, and again whenever `rightText` moves — the engine
  // rewrites that line ("~30 min") as the service is extended, so it is the observable signal
  // that an add-on landed and the suggested total is now stale.
  // The panel stays mounted (it is a Modal), so state is reset by the close handler below
  // rather than here — a synchronous reset inside an effect cascades an extra render.
  // Depend on the two primitives that matter, not on `card` — the object identity changes with
  // every queue snapshot the socket delivers, which would refetch the billing several times a
  // minute for a panel that is usually not even open.
  const cardId = card?.id;
  const cardRightText = card?.rightText;

  useEffect(() => {
    if (!cardId) return;
    let alive = true;
    (async () => {
      try {
        const b = await api.getQueueEntry(cardId);
        if (!alive) return;
        setBilling(b);
        setAmount(String(Math.round((b.suggestedAmount?.amount ?? 0) / 100)));
      } catch {
        if (alive) setBilling(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [cardId, cardRightText]);

  /** Closing drops the loaded billing so the next customer never sees the previous one's. */
  const close = () => {
    setBilling(null);
    store.closeDetail();
  };

  /**
   * Record an add-on and move the amount by exactly its price.
   *
   * The delta comes from the server's recomputed suggestion rather than re-syncing the whole
   * field to it — otherwise adding a shave would silently discard an amount already typed by
   * hand, which is the one thing this screen exists to let you do.
   */
  const addExtra = async (label: string, mins: number) => {
    const before = billing?.suggestedAmount?.amount ?? 0;
    store.extendService(card!.id, label, mins);
    try {
      const next = await api.getQueueEntry(card!.id);
      setBilling(next);
      const delta = ((next.suggestedAmount?.amount ?? 0) - before) / 100;
      const current = Number(amount);
      setAmount(
        Number.isFinite(current)
          ? String(current + delta)
          : String(Math.round((next.suggestedAmount?.amount ?? 0) / 100)),
      );
    } catch {
      /* the extend itself already reported any failure */
    }
  };

  const onConfirm = () => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees < 0) {
      showToast(t.detail.amountInvalid, 'error');
      return;
    }
    // Rupees in the box, paise on the wire. Math.round keeps 249.99 from arriving as 24998.99…
    store.checkout(card!.id, Math.round(rupees * 100));
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
      {card && (
        <View style={s.page}>
          <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
            <View style={[styles.flex, centerStyle]}>
            <View style={s.topBar}>
              <Pressable onPress={close} style={s.backBtn}>
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

              {/* The seat / service / source / position grid is gone. It restated what the
                  queue card behind this panel already showed, and pushed the thing you opened
                  the panel for — the price and the actions — below the fold on a small phone.
                  What is still worth knowing sits on one line under the name. */}
              <TText variant="bodySm" color="textMuted" align="center" style={styles.mt1}>
                {[seat?.name, card.service, card.srcLabel].filter(Boolean).join(' · ')}
              </TText>
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
                    variant="success"
                    size="lg"
                    fullWidth
                    loading={running('start')}
                    disabled={seatBusy || busy}
                    onPress={() => store.startService(card.id)}>
                    {t.detail.startService}
                  </Button>
                  <Button
                    variant="outline"
                    fullWidth
                    loading={running('noShow')}
                    disabled={busy}
                    leadingIcon={<Icon name="x" size={16} color={theme.colors.textBody} />}
                    onPress={() => store.noShow(card.id)}>
                    {t.detail.markNoShow}
                  </Button>
                </>
              )}
              {card.status === 'in-service' && (
                <>
                  {/* ONE sheet: amount, add-ons and the complete button together. They are a
                      single decision — you are looking at the person in the chair working out
                      what to charge — and splitting them across steps meant committing to the
                      extras before their effect on the price was visible. */}
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    {t.detail.amountTitle}
                  </TText>
                  <TText variant="caption" color="textMuted">
                    {t.detail.amountHint}
                  </TText>
                  <View style={s.amountRow}>
                    <TText variant="h4" color="textMuted" weight="bold">
                      ₹
                    </TText>
                    <TextInput
                      style={s.amountInput}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="numeric"
                      selectTextOnFocus
                      accessibilityLabel={t.detail.amountTitle}
                    />
                  </View>

                  <View style={s.chipWrap}>
                    {extras.map((e) => (
                      <Pressable
                        key={e.label}
                        disabled={busy}
                        onPress={() => addExtra(e.label, e.mins)}
                        style={s.chip}>
                        <Icon name={e.icon} size={16} color={theme.colors.textBody} />
                        <TText variant="bodySm" weight="semibold" color="textBody">
                          {e.label}
                        </TText>
                        <TText variant="caption" color="textMuted">
                          {format(t.detail.extendMins, { mins: e.mins })}
                        </TText>
                      </Pressable>
                    ))}
                  </View>

                  {billing ? (
                    <View style={s.breakdown}>
                      {billing.extras.map((x) => (
                        <View key={x.id} style={s.breakdownRow}>
                          <TText variant="caption" color="textMuted">
                            {format(t.detail.extendChip, { label: x.label, mins: x.minutes })}
                          </TText>
                          <TText variant="caption" color="textMuted">
                            ₹{Math.round(x.pricePaise / 100)}
                          </TText>
                        </View>
                      ))}
                      <View style={s.breakdownRow}>
                        <TText variant="caption" color="textBody" weight="semibold">
                          {t.detail.amountSuggested}
                        </TText>
                        <TText variant="caption" color="textBody" weight="semibold">
                          ₹{Math.round((billing.suggestedAmount?.amount ?? 0) / 100)}
                        </TText>
                      </View>
                    </View>
                  ) : null}

                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    loading={running('checkout')}
                    disabled={busy}
                    onPress={onConfirm}>
                    {t.detail.completeNext}
                  </Button>
                  <Button
                    variant="outline"
                    fullWidth
                    loading={running('noShow')}
                    disabled={busy}
                    leadingIcon={<Icon name="x" size={16} color={theme.colors.textBody} />}
                    onPress={() => store.noShow(card.id)}>
                    {t.detail.markNoShow}
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
    amountRow: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(6),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(8),
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
      borderRadius: moderateScale(radius.lg),
      backgroundColor: colors.surfaceCard,
    },
    amountInput: {
      ...styles.flex,
      fontSize: moderateScale(28),
      fontWeight: '800',
      color: colors.textStrong,
      paddingVertical: moderateScale(4),
    },
    breakdown: { gap: moderateScale(6) },
    breakdownRow: { ...styles.flexRow, ...styles.justifyBetween },
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
