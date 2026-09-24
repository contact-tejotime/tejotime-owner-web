import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TKeyboardScreen, TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { api } from '@/lib/api';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { extrasForCategory } from '@/lib/service-extras';
import { showToast } from '@/lib/toast';
import { styles } from '@/styles';
import { MAX_FONT_SCALE, moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

/** What this entry would be charged right now, as the API computes it. */
interface Billing {
  serviceAmount: { amount: number; currency: string };
  /** The booked service's pricing mode — see backend/src/domain/money.ts `servicePricing`. */
  servicePriceType: 'fixed' | 'range' | 'unset';
  /** Ceiling of a range-priced service. Null for a fixed one. */
  serviceMaxAmount: { amount: number; currency: string } | null;
  /**
   * What to pre-fill. NULL for a range-priced or unpriced service: there is no honest figure to
   * seed the box with, and seeding a band's floor is exactly how the minimum ends up banked as
   * the day's takings. The API refuses a checkout with no amount for these too.
   */
  suggestedAmount: { amount: number; currency: string } | null;
  amountRequired: boolean;
  extras: { id: string; label: string; minutes: number; pricePaise: number }[];
}

/**
 * What this entry is worth, worded the way the rest of the product words a price: a fixed amount,
 * a band, or "price on request". Never a bare number for a range or an unpriced service — that
 * derived figure is exactly what migration 0024 exists to keep out of sight.
 */
function priceLabel(billing: Billing | null): string {
  if (!billing) return t.common.dash;
  if (billing.servicePriceType === 'range' && billing.serviceMaxAmount) {
    return format(t.serviceSheet.rangeLabel, {
      min: formatMoney(billing.serviceAmount),
      max: formatMoney(billing.serviceMaxAmount),
    });
  }
  if (billing.servicePriceType === 'unset') return t.detail.priceOnRequest;
  return formatMoney(billing.suggestedAmount ?? billing.serviceAmount);
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
        // A range-priced service deliberately starts empty — the whole point of the mode is
        // that someone has to look at the customer and decide what to charge.
        setAmount(b.suggestedAmount ? String(Math.round(b.suggestedAmount.amount / 100)) : '');
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
    const before = billing?.suggestedAmount?.amount ?? null;
    store.extendService(card!.id, label, mins);
    try {
      const next = await api.getQueueEntry(card!.id);
      setBilling(next);
      // With no suggestion on either side (a range-priced service) there is no delta to apply.
      // The add-on's own price is still listed in the breakdown below, so the person typing can
      // see it; nudging a hand-typed figure by a number we did not derive would be worse.
      if (before == null || next.suggestedAmount == null) return;
      const suggested = next.suggestedAmount.amount;
      const delta = (suggested - before) / 100;
      const current = Number(amount);
      setAmount(
        Number.isFinite(current) && amount.trim() !== ''
          ? String(current + delta)
          : String(Math.round(suggested / 100)),
      );
    } catch {
      /* the extend itself already reported any failure */
    }
  };

  const onConfirm = () => {
    // Empty is never a valid bill. It reads as "not decided yet", which for a range-priced
    // service is the state this box exists to get out of — and the API rejects it anyway.
    if (amount.trim() === '') {
      showToast(billing?.amountRequired ? t.detail.amountRequired : t.detail.amountInvalid, 'error');
      return;
    }
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees < 0) {
      showToast(t.detail.amountInvalid, 'error');
      return;
    }
    // Rupees in the box, paise on the wire. Math.round keeps 249.99 from arriving as 24998.99…
    store.checkout(card!.id, Math.round(rupees * 100));
  };

  /**
   * Only what the queue card behind this panel does NOT already show. The card carries the name,
   * the service and the ETA; the price, the exact position and the visitor type are the reasons to
   * open the panel. Waiting entries get their place in line and their wait; an entry in the chair
   * does not (both are meaningless once the service has started).
   */
  const infoRows = useMemo(() => {
    if (!card) return [];
    const rows: { key: string; label: string; value: string }[] = [];
    if (card.isWaiting) rows.push({ key: 'pos', label: t.detail.position, value: `#${card.pos}` });
    rows.push({ key: 'seat', label: t.detail.seat, value: seat?.name ?? t.common.dash });
    rows.push({ key: 'service', label: t.detail.service, value: card.service });
    rows.push({ key: 'price', label: t.detail.price, value: priceLabel(billing) });
    if (card.isWaiting) rows.push({ key: 'wait', label: t.detail.estWait, value: card.rightText });
    rows.push({ key: 'source', label: t.detail.source, value: card.srcLabel });
    if (card.visitorType) {
      rows.push({
        key: 'visitor',
        label: t.detail.visitorType,
        value: card.visitorType === 'mr' ? t.queue.mr : t.queue.patient,
      });
    }
    return rows;
  }, [card, seat?.name, billing]);

  /** Two per row. An odd last fact keeps its half and leaves the other empty. */
  const infoPairs = useMemo(() => {
    const out: [(typeof infoRows)[number], (typeof infoRows)[number] | undefined][] = [];
    for (let i = 0; i < infoRows.length; i += 2) out.push([infoRows[i], infoRows[i + 1]]);
    return out;
  }, [infoRows]);

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
      {card && (
        <View style={s.page}>
          <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
            {/* The amount box and Complete button live in a bottom-anchored footer. Android
                resizes the window under the keyboard (softwareKeyboardLayoutMode: resize), so
                they stayed reachable there; iOS floats the keyboard over the app, which hid
                the whole checkout footer. Avoiding the keyboard here restores parity. */}
            <TKeyboardScreen isScrollView={false} style={[styles.flex, centerStyle]}>
            <View style={s.topBar}>
              <Pressable onPress={close} style={s.backBtn}>
                <Icon name="chevronLeft" size={22} color={theme.colors.textBody} />
              </Pressable>
              <TText variant="h5" weight="bold">
                {t.detail.customer}
              </TText>
            </View>

            {/* Scrollable, with the actions pinned in the footer below. An earlier cut put the
                seat/service/source/position grid here as full-width cards and pushed the price and
                buttons off a small phone; the fix then was to delete it and print one muted line
                instead, which left the screen two-thirds empty. Now it is a compact details card
                that scrolls, so the actions cannot be pushed anywhere. */}
            <ScrollView
              style={styles.flex}
              contentContainerStyle={s.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">
              <View style={s.hero}>
                <View style={s.avatar}>
                  <TText weight="bold" style={s.avatarText}>
                    {card.initials}
                  </TText>
                </View>
                <TText variant="h4" weight="bold" align="center" numberOfLines={2}>
                  {card.name}
                </TText>
                {/* StatusBadge pins itself `alignSelf: flex-start` (right for a list row, wrong
                    under a centred name). A child's alignSelf beats the parent's alignItems, so
                    centring it takes a ROW whose justifyContent does the centring instead. */}
                <View style={s.badgeRow}>
                  <StatusBadge status={card.status} />
                </View>
              </View>

              {/* The card only while they are waiting. Once they are in the chair the footer owns
                  the screen — amount, add-ons, breakdown, two buttons — and it already prints the
                  service and the price, so a details card there would just push the amount box
                  under the fold. That state keeps the one muted line it had. */}
              {card.isWaiting ? (
                /* Two columns, label above value. Six stacked full-width rows ran past the footer on a
                   phone with a larger system text size, so the last fact (Source) was cut in half.
                   Paired, the same six facts are half as tall and everything fits without a scroll. */
                <View style={s.infoCard}>
                  {infoPairs.map(([left, right], i) => (
                    <View key={left.key} style={[s.infoRow, i > 0 && s.infoRowBorder]}>
                      <View style={s.infoCell}>
                        <TText variant="caption" color="textMuted">
                          {left.label}
                        </TText>
                        <TText variant="bodyMd" color="textStrong" weight="semibold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                          {left.value}
                        </TText>
                      </View>
                      <View style={[s.infoCell, s.infoCellRight]}>
                        {right ? (
                          <>
                            <TText variant="caption" color="textMuted">
                              {right.label}
                            </TText>
                            <TText variant="bodyMd" color="textStrong" weight="semibold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                              {right.value}
                            </TText>
                          </>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <TText variant="bodySm" color="textMuted" align="center">
                  {[seat?.name, card.service, card.srcLabel].filter(Boolean).join(' · ')}
                </TText>
              )}
            </ScrollView>

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
                  {/* The hint changes with the mode: a fixed service's box is already right and
                      only needs correcting; a range's is empty, and the band the customer was
                      quoted is what they need to see while filling it in. */}
                  <TText variant="caption" color="textMuted">
                    {billing?.servicePriceType === 'range' && billing.serviceMaxAmount
                      ? format(t.detail.amountHintRange, {
                          range: format(t.serviceSheet.rangeLabel, {
                            min: formatMoney(billing.serviceAmount),
                            max: formatMoney(billing.serviceMaxAmount),
                          }),
                        })
                      : billing?.servicePriceType === 'unset'
                        ? t.detail.amountHintUnpriced
                        : t.detail.amountHint}
                  </TText>
                  <View style={s.amountRow}>
                    <TText variant="h4" color="textMuted" weight="bold">
                      ₹
                    </TText>
                    <TextInput
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
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
                      {/* No suggested total for a range: printing one would be the derived
                          figure this mode exists to stop anybody reaching for. */}
                      {billing.suggestedAmount ? (
                        <View style={s.breakdownRow}>
                          <TText variant="caption" color="textBody" weight="semibold">
                            {t.detail.amountSuggested}
                          </TText>
                          <TText variant="caption" color="textBody" weight="semibold">
                            ₹{Math.round(billing.suggestedAmount.amount / 100)}
                          </TText>
                        </View>
                      ) : null}
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
            </TKeyboardScreen>
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
    content: { ...styles.ph5, paddingBottom: moderateScale(20), flexGrow: 1 },
    hero: { ...styles.itemsCenter, gap: moderateScale(6), ...styles.pt1, paddingBottom: moderateScale(12) },
    badgeRow: { ...styles.flexRow, ...styles.justifyCenter, alignSelf: 'stretch' },
    avatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(56),
      height: moderateScale(56),
      borderRadius: moderateScale(28),
      backgroundColor: colors.primarySoft,
    },
    avatarText: { fontSize: moderateScale(21), color: colors.primarySoftFg },
    // One card of label/value rows, hairline-divided: five separate bordered cards (the shape the
    // old grid used) read as five things to act on rather than one set of facts.
    infoCard: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    infoRow: { ...styles.flexRow },
    infoRowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.borderSubtle },
    infoCell: {
      ...styles.flex,
      ...styles.minWidth0,
      gap: moderateScale(2),
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(14),
    },
    infoCellRight: { borderLeftWidth: StyleSheet.hairlineWidth * 2, borderLeftColor: colors.borderSubtle },
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
    chipDotBg: (color: string) => [base.chipDot, { backgroundColor: color }],
  };
};
