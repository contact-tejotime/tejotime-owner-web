import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TKeyboardScreen, TText } from '@/components/common';
import { ConfirmSheet } from '@/components/feedback/ConfirmSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { api } from '@/lib/api';
import {
  boxAfterExtrasChange,
  boxAfterPriceChange,
  canComplete,
  initialBox,
  isExtraOn,
  missingLabels,
  parseRupees,
  requiredItems,
  SERVICE_KEY,
  suggestionDiffers,
} from '@/lib/checkout-amount';
import { currencySymbol } from '@/lib/currencies';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { extrasForCategory } from '@/lib/service-extras';
import { styles } from '@/styles';
import { MAX_FONT_SCALE, moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** The page's side gutter. The checkout panel bleeds past it by exactly this much. */
const GUTTER = moderateScale(space[5]);

/** What this entry would be charged right now, as the API computes it. */
interface Billing {
  /** The booked service on its own (the card's label carries every add-on too). Null: none. */
  serviceName: string | null;
  serviceAmount: { amount: number; currency: string };
  /** The booked service's pricing mode — see backend/src/domain/money.ts `servicePricing`. */
  servicePriceType: 'fixed' | 'range' | 'unset';
  /** Ceiling of a range-priced service. Null for a fixed one. */
  serviceMaxAmount: { amount: number; currency: string } | null;
  /**
   * What to pre-fill. NULL for a range-priced or unpriced service (or one with an unpriced service
   * among its add-ons): there is no honest figure to seed the box with, and seeding a band's floor
   * is exactly how the minimum ends up banked as the day's takings. The API refuses a checkout
   * with no amount for these too.
   */
  suggestedAmount: { amount: number; currency: string } | null;
  amountRequired: boolean;
  /** Sum of the add-ons below. Always known, even when the service has no price. */
  extrasAmount: { amount: number; currency: string };
  /** `priceRequired`: a booked service with no price, stored at a placeholder 0 (0040). */
  extras: { id: string; label: string; minutes: number; pricePaise: number; priceRequired?: boolean }[];
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

/**
 * The booked service's own price for the bill row: the fixed amount or the band. Unlike
 * `priceLabel`, never the suggested total — the add-ons are itemised on the rows below it. (An
 * unpriced service gets a price field in its row instead.)
 */
function servicePriceText(billing: Billing): string {
  if (billing.servicePriceType === 'range' && billing.serviceMaxAmount) {
    return format(t.serviceSheet.rangeLabel, {
      min: formatMoney(billing.serviceAmount),
      max: formatMoney(billing.serviceMaxAmount),
    });
  }
  if (billing.servicePriceType === 'unset') return t.serviceSheet.unpriced;
  return formatMoney(billing.serviceAmount);
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
   *
   * The box is always the whole bill. A service with no price gets its own required price field
   * in its bill row; whatever is typed there is added into the box, and Complete stays disabled
   * until every such field is filled. The add-on chips are a toggle: a plain one asks what was
   * charged for it and that price goes into the box; a highlighted one comes off and its price
   * comes back out. The bill ends with "Total to charge", which is the box. All of it lives in
   * lib/checkout-amount.ts, shared with owner-web (docs/checkout-add-ons.md).
   */
  const [billing, setBilling] = useState<Billing | null>(null);
  const [amount, setAmount] = useState('');
  /** Prices typed into the required rows (a no-price service), by row key. Rupees as typed. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  /** Required rows the owner has left at least once — only those turn red when still empty. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  /** The required row being typed in, for its focus ring. */
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  /** The add-on whose price is being asked for. The popup unmounts when this clears, so every
   *  open starts with an empty field. */
  const [pricePrompt, setPricePrompt] = useState<{ label: string; mins: number } | null>(null);
  /** Content is scrolled under the pinned footer: give the footer an edge so that reads. */
  const [raised, setRaised] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const requiredRefs = useRef<Record<string, TextInput | null>>({});
  /** Scroll geometry, kept outside state: it changes on every frame of a scroll. */
  const geometry = useRef({ offset: 0, viewport: 0, content: 0 });

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
        // Everything on the bill that already has a price; what has no price is asked for in its
        // own row instead.
        setAmount(initialBox(b));
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
    setPricePrompt(null);
    setTyped({});
    setTouched({});
    setRaised(false);
    store.closeDetail();
  };

  /** Is there content below the visible part of the scroll? Then the footer gets its edge. */
  const updateRaised = () => {
    const { offset, viewport, content } = geometry.current;
    setRaised(offset + viewport < content - 2);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    geometry.current.offset = e.nativeEvent.contentOffset.y;
    geometry.current.viewport = e.nativeEvent.layoutMeasurement.height;
    geometry.current.content = e.nativeEvent.contentSize.height;
    updateRaised();
  };

  /**
   * Put an add-on on (with the price typed into the popup) or take one off, then move the box by
   * exactly its price.
   *
   * The box moves by the change in the add-ons' total rather than re-syncing to the server's new
   * suggestion — otherwise adding a shave would silently discard an amount already typed by hand,
   * which is the one thing this screen exists to let you do (lib/checkout-amount.ts). A required
   * row that went with it (a booked no-price service whose chip was tapped off) takes its typed
   * price out of the box too.
   *
   * The store call is awaited before the bill is re-read. It used not to be, so the read raced
   * the write and often came back with the old total.
   */
  const changeExtras = async (write: () => Promise<boolean>) => {
    const before = billing;
    const id = card!.id;
    if (!before || !(await write())) return;
    try {
      const next = await api.getQueueEntry(id);
      const keep = new Set(requiredItems(next).map((item) => item.key));
      const kept: Record<string, string> = {};
      let dropped = 0;
      for (const [key, value] of Object.entries(typed)) {
        if (keep.has(key)) kept[key] = value;
        else dropped += parseRupees(value) ?? 0;
      }
      setBilling(next);
      setTyped(kept);
      setAmount((prev) => boxAfterExtrasChange(prev, before, next, kept, dropped));
    } catch {
      /* the write itself already reported any failure */
    }
  };

  /** A highlighted chip comes off at once; a plain one first asks what it cost. */
  const onChip = (label: string, mins: number) => {
    if (billing && isExtraOn(billing.extras, label)) {
      void changeExtras(() => store.removeExtra(card!.id, label));
    } else {
      setPricePrompt({ label, mins });
    }
  };

  const onAddOnPrice = (value: string) => {
    const prompt = pricePrompt;
    const pricePaise = parseRupees(value);
    setPricePrompt(null);
    if (!prompt || pricePaise === null) return;
    void changeExtras(() => store.extendService(card!.id, prompt.label, prompt.mins, pricePaise));
  };

  /** A required row's price changed: the box moves by the difference. */
  const onRequiredPrice = (key: string, value: string) => {
    if (!billing) return;
    const from = typed[key] ?? '';
    const next = { ...typed, [key]: value };
    setTyped(next);
    setAmount((prev) => boxAfterPriceChange(prev, billing, from, value, next));
  };

  /** The helper above the buttons: bring the first unpriced row into view and into focus. */
  const focusFirstMissing = () => {
    if (!billing) return;
    const first = requiredItems(billing).find((item) => parseRupees(typed[item.key] ?? '') === null);
    const input = first ? requiredRefs.current[first.key] : null;
    const content = contentRef.current;
    if (!input) return;
    if (content) {
      input.measureLayout(
        content,
        (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - moderateScale(120)), animated: true }),
        () => {},
      );
    }
    input.focus();
  };

  const onConfirm = () => {
    // The button is disabled until this holds; checked again so a stale render cannot send a bill
    // that is empty, unreadable, or missing a service's price.
    if (!billing || !canComplete(amount, billing, typed)) return;
    // Paise on the wire — money crosses the API as an integer minor unit.
    store.checkout(card!.id, parseRupees(amount)!);
  };

  const serviceName = billing?.serviceName ?? null;
  const currency = billing?.serviceAmount.currency ?? store.business?.currency;
  const symbol = currencySymbol(currency);
  const missing = billing ? missingLabels(billing, typed) : [];
  const ready = !!billing && canComplete(amount, billing, typed);
  const totalPaise = parseRupees(amount);

  /**
   * One bill row whose price has to be typed: the service's name with a required marker, and a
   * compact price field. It turns red only once the owner has left it empty, not on first open.
   */
  const requiredRow = (key: string, label: string, display: string = label) => {
    const value = typed[key] ?? '';
    const invalid = !!touched[key] && parseRupees(value) === null;
    return (
      <View key={key} style={s.reqRow}>
        <TText variant="bodySm" weight="semibold" color="textBody" numberOfLines={1} style={s.breakdownLabel}>
          {display}
          <TText variant="bodySm" weight="bold" color="error">
            {' *'}
          </TText>
        </TText>
        <View style={[s.reqField, focusedKey === key && s.reqFieldFocus, invalid && s.reqFieldInvalid]}>
          <TText variant="bodySm" weight="bold" color="textMuted">
            {symbol}
          </TText>
          <TextInput
            ref={(el) => {
              requiredRefs.current[key] = el;
            }}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={s.reqInput}
            value={value}
            onChangeText={(v) => onRequiredPrice(key, v)}
            keyboardType="decimal-pad"
            selectTextOnFocus
            editable={!busy}
            onFocus={() => setFocusedKey(key)}
            onBlur={() => {
              setFocusedKey(null);
              setTouched((prev) => ({ ...prev, [key]: true }));
            }}
            accessibilityLabel={format(t.detail.servicePriceAria, { service: label })}
          />
        </View>
      </View>
    );
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
    rows.push({ key: 'service', label: t.detail.service, value: card.service || t.common.dash });
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

  const inService = card?.status === 'in-service';

  return (
    // Android's back button closes the add-on price popup first, then the panel.
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={() => (pricePrompt ? setPricePrompt(null) : close())}>
      {card && (
        <View style={s.page}>
          <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
            {/* The buttons live in a bottom-anchored footer. Android resizes the window under the
                keyboard (softwareKeyboardLayoutMode: resize), so they stayed reachable there; iOS
                floats the keyboard over the app, which hid the whole footer. Avoiding the keyboard
                here restores parity. */}
            <TKeyboardScreen isScrollView={false} style={[styles.flex, centerStyle]}>
            <View style={s.topBar}>
              <Pressable onPress={close} style={s.backBtn}>
                <Icon name="chevronLeft" size={22} color={theme.colors.textBody} />
              </Pressable>
              <TText variant="h5" weight="bold">
                {t.detail.customer}
              </TText>
            </View>

            {/* ONE scroll for everything but the actions — the customer, and while they are in the
                chair the whole checkout (amount, add-ons, bill). The checkout used to sit in the
                pinned footer, which on a small phone squeezed the customer into a sliver above a
                footer that filled the screen. */}
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={[s.content, inService && s.contentCheckout]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              scrollEventThrottle={32}
              onScroll={onScroll}
              onLayout={(e) => {
                geometry.current.viewport = e.nativeEvent.layout.height;
                updateRaised();
              }}
              onContentSizeChange={(_w, h) => {
                geometry.current.content = h;
                updateRaised();
              }}>
              <View ref={contentRef} collapsable={false} style={s.contentInner}>
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

              {/* The card only while they are waiting. Once they are in the chair the checkout
                  below owns the screen — amount, add-ons, bill — and it already prints the service
                  and the price, so a details card there would just push the amount box down. That
                  state keeps the one muted line it had. */}
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

              {inService && (
                <View style={s.checkout}>
                  {/* ONE sheet: amount, add-ons and the complete button together. They are a
                      single decision — you are looking at the person in the chair working out
                      what to charge — and splitting them across steps meant committing to the
                      extras before their effect on the price was visible. */}
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    {t.detail.amountTitle}
                  </TText>
                  {/* The hint changes with the mode: a fixed service's box is already right and
                      only needs correcting; a range's band is what the customer was quoted. */}
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
                    {/* The store's own symbol — a literal ₹ here showed on stores set to USD.
                        Billing carries business.currency; the session is the fallback while
                        it loads. */}
                    <TText variant="h4" color="textMuted" weight="bold">
                      {symbol}
                    </TText>
                    <TextInput
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={s.amountInput}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="numeric"
                      selectTextOnFocus
                      editable={!!billing}
                      accessibilityLabel={t.detail.amountTitle}
                    />
                  </View>

                  <View style={s.chipWrap}>
                    {extras.map((e) => {
                      // On = already on this visit, whether added here or booked with it.
                      const on = !!billing && isExtraOn(billing.extras, e.label);
                      return (
                        <Pressable
                          key={e.label}
                          disabled={busy || !billing}
                          onPress={() => onChip(e.label, e.mins)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on, disabled: busy || !billing }}
                          accessibilityLabel={format(on ? t.detail.removeExtra : t.detail.addExtra, {
                            label: e.label,
                            minutes: e.mins,
                          })}
                          style={[s.chip, on && s.chipOn, !billing && s.chipDisabled]}>
                          <Icon
                            name={on ? 'check' : e.icon}
                            size={16}
                            color={on ? theme.colors.textOnBrand : theme.colors.textBody}
                          />
                          <TText variant="bodySm" weight="semibold" color={on ? 'textOnBrand' : 'textBody'}>
                            {e.label}
                          </TText>
                          <TText variant="caption" color={on ? 'textOnBrand' : 'textMuted'}>
                            {format(t.detail.extendMins, { mins: e.mins })}
                          </TText>
                        </Pressable>
                      );
                    })}
                  </View>

                  {billing ? (
                    <View style={s.breakdown}>
                      {/* The booked service on its own line — by its own name, since the add-ons
                          are itemised below it. With no price, the line is where it gets one. */}
                      {serviceName ? (
                        billing.servicePriceType === 'unset' ? (
                          requiredRow(SERVICE_KEY, serviceName)
                        ) : (
                          <View style={s.breakdownRow}>
                            <TText variant="caption" color="textMuted" style={s.breakdownLabel} numberOfLines={1}>
                              {serviceName}
                            </TText>
                            <TText variant="caption" color="textMuted">
                              {servicePriceText(billing)}
                            </TText>
                          </View>
                        )
                      ) : null}
                      {billing.extras.map((x) =>
                        x.priceRequired ? (
                          requiredRow(x.id, x.label, format(t.detail.extendChip, { label: x.label, mins: x.minutes }))
                        ) : (
                          <View key={x.id} style={s.breakdownRow}>
                            <TText variant="caption" color="textMuted" style={s.breakdownLabel} numberOfLines={1}>
                              {format(t.detail.extendChip, { label: x.label, mins: x.minutes })}
                            </TText>
                            <TText variant="caption" color="textMuted">
                              {/* Extras carry bare paise; they are priced in the store's currency,
                                  which the service amount already names. */}
                              {formatMoney({ amount: x.pricePaise, currency: billing.serviceAmount.currency })}
                            </TText>
                          </View>
                        ),
                      )}
                      {/* The server's figure, only once the box no longer matches it (a corrected
                          fixed price) — otherwise it would just repeat the total below. */}
                      {suggestionDiffers(amount, billing) && billing.suggestedAmount ? (
                        <View style={s.breakdownRow}>
                          <TText variant="caption" color="textBody" weight="semibold">
                            {t.detail.amountSuggested}
                          </TText>
                          <TText variant="caption" color="textBody" weight="semibold">
                            {formatMoney(billing.suggestedAmount)}
                          </TText>
                        </View>
                      ) : null}
                      {/* The box, live: exactly what Complete will charge. */}
                      <View style={[s.breakdownRow, s.grandRow]}>
                        <TText variant="bodyMd" color="textStrong" weight="bold">
                          {t.detail.totalToCharge}
                        </TText>
                        <TText variant="bodyMd" color="textStrong" weight="bold">
                          {totalPaise !== null
                            ? formatMoney({ amount: totalPaise, currency: billing.serviceAmount.currency })
                            : t.common.dash}
                        </TText>
                      </View>
                    </View>
                  ) : null}
                </View>
              )}
              </View>
            </ScrollView>

            <View style={[s.footer, raised && s.footerRaised]}>
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
              {inService && (
                <>
                  {/* Why Complete is disabled, and a way straight to the fix. */}
                  {missing.length > 0 ? (
                    <Pressable
                      onPress={focusFirstMissing}
                      accessibilityRole="button"
                      style={s.reqHint}>
                      <Icon name="alertTriangle" size={16} color={theme.colors.warningSoftFg} />
                      <TText variant="bodySm" weight="semibold" color="warningSoftFg" style={styles.flex}>
                        {format(t.detail.priceRequiredHint, { services: missing.join(', ') })}
                      </TText>
                    </Pressable>
                  ) : null}
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    loading={running('checkout')}
                    disabled={busy || !ready}
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
          {/* The add-on price popup, drawn INSIDE this Modal: iOS will not present a second Modal
              over an open one. Always empty, so the price on the visit is the one somebody typed
              for this customer, not a platform-wide default (docs/checkout-add-ons.md). */}
          {pricePrompt ? (
            <ConfirmSheet
              key={pricePrompt.label}
              visible
              presentation="overlay"
              title={format(t.detail.addOnPriceTitle, { label: pricePrompt.label })}
              body={format(t.detail.addOnPriceBody, { minutes: pricePrompt.mins })}
              confirmLabel={t.detail.addOnPriceConfirm}
              input={{
                label: t.detail.addOnPriceLabel,
                prefix: symbol,
                keyboardType: 'decimal-pad',
                validate: (value) => (parseRupees(value) === null ? t.detail.addOnPriceInvalid : null),
              }}
              onConfirm={onAddOnPrice}
              onCancel={() => setPricePrompt(null)}
            />
          ) : null}
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
    breakdown: { gap: moderateScale(8) },
    breakdownRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween, gap: moderateScale(12) },
    breakdownLabel: { ...styles.flex, ...styles.minWidth0 },
    // "Total to charge": the box, live — what Complete will charge. It closes the bill.
    grandRow: {
      paddingTop: moderateScale(10),
      marginTop: moderateScale(2),
      borderTopWidth: StyleSheet.hairlineWidth * 2,
      borderTopColor: colors.borderSubtle,
    },
    // A bill row whose price has to be typed (a service with no price).
    reqRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween, gap: moderateScale(12) },
    reqField: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(4),
      width: moderateScale(124),
      height: moderateScale(40),
      paddingHorizontal: moderateScale(10),
      borderWidth: moderateScale(1),
      borderColor: colors.borderStrong,
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceCard,
    },
    reqFieldFocus: { borderColor: colors.primary },
    reqFieldInvalid: { borderColor: colors.error },
    reqInput: {
      ...styles.flex,
      paddingVertical: 0,
      textAlign: 'right',
      fontSize: moderateScale(16),
      fontWeight: '700',
      color: colors.textStrong,
    },
    // Why Complete is disabled — and a tap away from the field that fixes it.
    reqHint: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(8),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(9),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.warningSoft,
    },
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
    content: { paddingHorizontal: GUTTER, paddingBottom: moderateScale(20), flexGrow: 1 },
    // In service the checkout panel runs to the bottom, into the footer's colour.
    contentCheckout: { paddingBottom: 0 },
    contentInner: { flexGrow: 1 },
    // The checkout: the card-coloured panel the footer continues, bleeding past the page gutter.
    checkout: {
      flexGrow: 1,
      gap: moderateScale(10),
      marginTop: moderateScale(14),
      marginHorizontal: -GUTTER,
      paddingHorizontal: GUTTER,
      paddingTop: moderateScale(16),
      paddingBottom: moderateScale(18),
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.surfaceCard,
    },
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
      paddingTop: moderateScale(12),
      ...styles.pb2,
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.surfaceCard,
      gap: moderateScale(10),
    },
    // Content is scrolled under the footer: a soft edge says "there is more above". The shadow
    // is iOS; Android draws the same idea with elevation.
    footerRaised: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 8,
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
    // An add-on that is on the visit: filled, so it reads as "on" at a glance; a tap takes it off.
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipDisabled: { opacity: 0.55 },
    chipDot: { width: moderateScale(9), height: moderateScale(9), borderRadius: moderateScale(4.5) },
    busyNote: { lineHeight: moderateScale(20) },
  });

  return {
    ...base,
    chipDotBg: (color: string) => [base.chipDot, { backgroundColor: color }],
  };
};
