"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { t, format } from "@/i18n";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { UNASSIGNED_GROUP_ID } from "@/components/LiveQueueCard";
import { OverlayPortal } from "@/components/OverlayPortal";
import { Skeleton, Spinner } from "@/components/Skeleton";
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
} from "@/lib/checkout-amount";
import { currencySymbol } from "@/lib/currencies";
import { formatMoney, formatServicePrice } from "@/lib/format";
import { extrasForCategory } from "@/lib/service-extras";
import { showToast } from "@/lib/toast";
import type { Money, QueueCard, SeatGroup, ServicePriceType } from "@/lib/server-api";
import "@/styles/shell-sheets.css";

/**
 * The screen behind a queue card — the web twin of the app's `DetailPanel` ("Customer"), block
 * for block: a top bar, the customer (initials, name, status), the facts the card does NOT
 * already show, and a pinned footer holding the actions.
 *
 *   waiting     → the facts card (position, seat, service, price, est. wait, source, visitor
 *                 type), then Move to another seat · Start service · Mark no-show
 *   in service  → one muted line (seat · service · source), then the amount, the add-ons, the
 *                 bill · Complete & start next · Mark no-show
 *
 * ONE screen, not a wizard. An in-service customer's amount, add-ons and complete button are one
 * decision: you are looking at the person in the chair working out what to charge them.
 *
 * ONE scroll, too: everything but the buttons scrolls together, and only the actions are pinned.
 * The amount block used to live in the pinned footer, which on a laptop squeezed the customer's
 * name into a ~60px strip with its own scrollbar above a footer that filled the dialog.
 *
 * Laid out by width: on a phone it is the app's full-screen page (back chevron, pinned footer); on
 * a tablet or desktop the same blocks sit in a centred dialog with a close button.
 *
 * It renders IMMEDIATELY from the card the board already has. Only the price waits on the network,
 * behind a skeleton — an earlier version showed an almost-empty box reading "Customer / Loading…"
 * for the whole round trip, which read as a broken dialog.
 *
 * Why the amount is here at all: `visit.amount_paise` feeds customer lifetime spend and every
 * revenue KPI, and it used to be written from the BOOKED service alone, so a customer who came for
 * a beard trim and also had a haircut was banked at the beard-trim price.
 *
 * The box is always the whole bill. A service with no price gets its own required price field in
 * its bill row; whatever is typed there is added into the box, and Complete stays disabled until
 * every such field is filled. The add-on chips are a toggle: a plain one asks what was charged for
 * it and that price goes into the box; a highlighted one comes off and its price comes back out.
 * The bill ends with "Total to charge", which is the box. All of it lives in
 * lib/checkout-amount.ts, shared with the app; see docs/checkout-add-ons.md.
 */

interface Billing {
  /** The booked service on its own (the card's label carries every add-on too). Null: none. */
  serviceName: string | null;
  serviceAmount: Money;
  /** The booked service's pricing mode — see backend/src/domain/money.ts `servicePricing`. */
  servicePriceType: ServicePriceType;
  /** Ceiling of a range-priced service. Null for a fixed one. */
  serviceMaxAmount: Money | null;
  extrasAmount: Money;
  /**
   * What to pre-fill. NULL for a range-priced or unpriced service (or one with an unpriced
   * service among its add-ons): there is no honest figure to seed the box with, and seeding the
   * floor is exactly how a band's minimum gets banked as the day's takings. The API refuses a
   * checkout with no amount for these too.
   */
  suggestedAmount: Money | null;
  amountRequired: boolean;
  /** `priceRequired`: a booked service with no price, stored at a placeholder 0 (0040). */
  extras: { id: string; label: string; minutes: number; pricePaise: number; priceRequired?: boolean }[];
}

type Action = "start" | "checkout" | "no-show" | "reassign" | "extend";

const TOASTS: Record<string, string> = {
  start: t.detail.started,
  checkout: t.detail.checkedOut,
  "no-show": t.detail.noShow,
  reassign: t.detail.movedSeat,
};

/**
 * What this entry is worth, worded the way the rest of the product words a price: a fixed amount,
 * a band, or "Price on request". Never a bare number for a range or an unpriced service — that
 * derived figure is exactly what migration 0024 exists to keep out of sight.
 */
function priceLabel(billing: Billing): string {
  if (billing.servicePriceType === "range" && billing.serviceMaxAmount) {
    return formatServicePrice({
      price: billing.serviceAmount,
      priceType: "range",
      priceMax: billing.serviceMaxAmount,
    });
  }
  if (billing.servicePriceType === "unset") return t.detail.priceOnRequest;
  return formatMoney(billing.suggestedAmount ?? billing.serviceAmount);
}

export function QueueDetailSheet({
  card,
  seats,
  category,
  onClose,
  onChanged,
}: {
  /**
   * The card that was tapped. The board mounts this only while a card is open, which is also
   * what lets every piece of state below start fresh on each open.
   */
  card: QueueCard;
  seats: SeatGroup[];
  /** Business category — gates checkout add-on chips. */
  category?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [billing, setBilling] = useState<Billing | null>(null);
  /** Which button is working. Only that one spins; the rest are disabled without spinning. */
  const [running, setRunning] = useState<Action | null>(null);
  const [error, setError] = useState("");
  /** Rupees as typed. A string so the field can be empty mid-edit. */
  const [amount, setAmount] = useState("");
  /** Prices typed into the required rows (a no-price service), by row key. Rupees as typed. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  /** Required rows the owner has left at least once — only those turn red when still empty. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  /** The add-on whose price is being asked for. The popup unmounts when this clears, so every
   *  open starts with an empty field. */
  const [pricePrompt, setPricePrompt] = useState<{ label: string; minutes: number } | null>(null);
  /** Content is scrolled under the pinned footer: give the footer an edge so that reads. */
  const [raised, setRaised] = useState(false);
  const addOns = extrasForCategory(category);
  const titleId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const requiredRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // While the price popup is up, Escape is the popup's (it closes itself); closing the whole
  // customer sheet from under it would throw the typed price away with it.
  const onEscape = useEffectEvent(() => {
    if (!pricePrompt) onClose();
  });

  const entryId = card.id;
  const inService = card.status === "in_service";
  const waiting = card.status === "waiting";
  const busy = running !== null;

  /**
   * Escape closes, the page behind stops scrolling under the finger, focus moves into the dialog.
   * Once per open: `onClose` is an inline arrow from the board and changes on every live queue
   * update, which must not re-run this (it re-focused the dialog mid-typing).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  // A sentinel at the very end of the scrolling body: while it is out of view, there is more
  // above the pinned buttons, and the footer shows a raised edge.
  useEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setRaised(!entry.isIntersecting), { root });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/queue/${entryId}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setError(json?.error?.message ?? t.detail.errPrice);
          return;
        }
        setBilling(json as Billing);
        // Pre-fill with everything on the bill that already has a price, so the common case is
        // one tap. What has no price is asked for in its own row instead.
        setAmount(initialBox(json as Billing));
      } catch {
        if (alive) setError(t.detail.networkError);
      }
    })();
    return () => {
      alive = false;
    };
  }, [entryId]);

  async function send(action: Action, path: string, body?: unknown) {
    setRunning(action);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? t.common.thatDidntWork);
        return false;
      }
      return true;
    } catch {
      setError(t.detail.networkError);
      return false;
    } finally {
      setRunning(null);
    }
  }

  async function act(action: Exclude<Action, "extend">, body?: unknown) {
    const ok = await send(action, `/api/queue/${entryId}/${action}`, body);
    if (ok) {
      showToast(TOASTS[action] ?? t.detail.done, "success");
      onChanged();
      onClose();
    }
  }

  /**
   * Put an add-on on (`extend`, with the price typed into the popup) or take one off
   * (`remove-extra`), then move the box by exactly its price.
   *
   * The box moves by the change in the add-ons' total rather than re-syncing to the server's new
   * suggestion — otherwise adding a shave would silently discard an amount the user had already
   * typed by hand, which is the one thing they are here to do (lib/checkout-amount.ts). A
   * required row that went with it (a booked no-price service whose chip was tapped off) takes
   * its typed price out of the box too.
   */
  async function changeExtras(action: "extend" | "remove-extra", body: unknown) {
    const before = billing;
    const ok = await send("extend", `/api/queue/${entryId}/${action}`, body);
    if (!ok || !before) return;
    onChanged();
    const res = await fetch(`/api/queue/${entryId}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as Billing;
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
  }

  /** A highlighted chip comes off at once; a plain one first asks what it cost. */
  function onChip(label: string, minutes: number) {
    if (billing && isExtraOn(billing.extras, label)) {
      void changeExtras("remove-extra", { label });
    } else {
      setPricePrompt({ label, minutes });
    }
  }

  function onAddOnPrice(value: string) {
    const prompt = pricePrompt;
    setPricePrompt(null);
    if (!prompt) return;
    void changeExtras("extend", { label: prompt.label, minutes: prompt.minutes, pricePaise: parseRupees(value) });
  }

  /** A required row's price changed: the box moves by the difference. */
  function onRequiredPrice(key: string, value: string) {
    if (!billing) return;
    const from = typed[key] ?? "";
    const next = { ...typed, [key]: value };
    setTyped(next);
    setAmount((prev) => boxAfterPriceChange(prev, billing, from, value, next));
  }

  /** The helper line under the bill: bring the first unpriced row into view and into focus. */
  function focusFirstMissing() {
    if (!billing) return;
    const first = requiredItems(billing).find((item) => parseRupees(typed[item.key] ?? "") === null);
    const input = first ? requiredRefs.current[first.key] : null;
    if (!input) return;
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus({ preventScroll: true });
  }

  async function onComplete() {
    // The button is disabled until this holds; checked again so Enter or a stale render cannot
    // send a bill that is empty, unreadable, or missing a service's price.
    if (!billing || !canComplete(amount, billing, typed)) {
      setError(t.detail.errAmount);
      return;
    }
    // Paise on the wire — money crosses the API as an integer minor unit.
    await act("checkout", { amountPaise: parseRupees(amount) });
  }

  // Real chairs only: the seatless "Any"/"Waiting" group is not a seat the API can reassign to.
  const otherSeats = seats.filter((s) => s.id !== card.seatId && s.id !== UNASSIGNED_GROUP_ID);
  const seatGroup = card.seatId ? seats.find((s) => s.id === card.seatId) : undefined;
  // One person per chair: the API refuses a second start with SEAT_BUSY. Saying so up front, and
  // offering the move, beats a red error after the click — the app disables it the same way.
  const seatBusy = waiting && !!seatGroup?.serving;
  const source = card.online ? t.queue.online : t.queue.walkIn;

  const serviceName = billing?.serviceName ?? null;
  const symbol = billing ? currencySymbol(billing.serviceAmount.currency) : "";
  const missing = billing ? missingLabels(billing, typed) : [];
  const ready = !!billing && canComplete(amount, billing, typed);
  const totalPaise = parseRupees(amount);

  /**
   * One bill row whose price has to be typed: the service's name with a required marker, and a
   * compact price field. It turns red only once the owner has left it empty, not on first open.
   */
  function requiredRow(key: string, label: string, display: string = label): ReactNode {
    const value = typed[key] ?? "";
    const invalid = !!touched[key] && parseRupees(value) === null;
    const id = `${fieldId}-${key}`;
    return (
      <li key={key} className="dp-req-row">
        <label htmlFor={id} className="dp-req-label">
          {display}
          <span className="dp-req-star" aria-hidden>
            *
          </span>
        </label>
        <span className={invalid ? "dp-req-field is-invalid" : "dp-req-field"}>
          <span className="dp-req-prefix" aria-hidden>
            {symbol}
          </span>
          <input
            ref={(el) => {
              requiredRefs.current[key] = el;
            }}
            id={id}
            className="dp-req-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => onRequiredPrice(key, e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => setTouched((prev) => ({ ...prev, [key]: true }))}
            disabled={busy}
            aria-required
            aria-invalid={invalid}
            aria-label={format(t.detail.servicePriceAria, { service: label })}
          />
        </span>
      </li>
    );
  }

  /**
   * Only what the card behind this screen does NOT already show — its price, its exact place in
   * line, where it came from. Two per row, label above value: six stacked full-width rows pushed
   * the last fact under the footer on a phone.
   */
  const facts: { key: string; label: string; value: ReactNode }[] = [
    { key: "pos", label: t.detail.position, value: `#${card.position}` },
    { key: "seat", label: t.detail.seat, value: card.seatName ?? t.common.dash },
    { key: "service", label: t.detail.service, value: card.service || t.common.dash },
    {
      key: "price",
      label: t.detail.price,
      value: billing ? priceLabel(billing) : error ? t.common.dash : <Skeleton width={64} height={15} />,
    },
    { key: "wait", label: t.detail.estWait, value: card.rightText },
    { key: "source", label: t.detail.source, value: source },
  ];
  if (card.visitorType) {
    facts.push({
      key: "visitor",
      label: t.detail.visitorType,
      value: card.visitorType === "mr" ? t.queue.mr : t.queue.patient,
    });
  }
  const pairs: [(typeof facts)[number], (typeof facts)[number] | undefined][] = [];
  for (let i = 0; i < facts.length; i += 2) pairs.push([facts[i], facts[i + 1]]);

  const noShowButton = (
    <button type="button" className="ss-btn outline block" disabled={busy} onClick={() => act("no-show")}>
      {running === "no-show" ? <Spinner size={16} /> : <Icon name="x" size={16} />}
      {t.detail.markNoShow}
    </button>
  );

  return (
    <OverlayPortal>
      <div
        className="dp-root"
        // Only a press that both starts and ends on the dimmed backdrop closes (tablet/desktop;
        // on a phone the page covers it). Releasing a text selection outside the dialog must not
        // dismiss it mid-edit.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          className="dp"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <header className="dp-top">
            <button type="button" className="dp-close" onClick={onClose} aria-label={t.detail.close}>
              {/* A back chevron on the phone's full-screen page, an × on the dialog. The classes sit
                  on wrappers: Icon's own inline `display: block` beat a class on the svg, so both
                  icons used to show at every width. */}
              <span className="dp-icon-back">
                <Icon name="chevronLeft" size={22} />
              </span>
              <span className="dp-icon-x">
                <Icon name="x" size={20} />
              </span>
            </button>
            <h2 id={titleId} className="dp-title">
              {t.detail.customer}
            </h2>
          </header>

          <div ref={scrollRef} className={inService ? "dp-scroll has-checkout" : "dp-scroll"}>
            <div className="dp-hero">
              <span className="dp-avatar" aria-hidden>
                {card.initials}
              </span>
              <p className="dp-name">{card.name}</p>
              <span className={`dp-status ${inService ? "serving" : "waiting"}`}>
                <span className="dp-status-dot" aria-hidden />
                {inService ? t.detail.statusInService : t.detail.statusWaiting}
              </span>
            </div>

            {/* The facts card only while they are waiting. Once they are in the chair the
                checkout below owns the screen — amount, add-ons, bill — and it already prints
                the service and the price, so a facts card would just push the amount box down.
                That state keeps one muted line. */}
            {inService ? (
              <p className="dp-line">{[card.seatName, card.service, source].filter(Boolean).join(" · ")}</p>
            ) : (
              <div className="dp-info">
                {pairs.map(([left, right]) => (
                  <div key={left.key} className="dp-info-row">
                    <div className="dp-info-cell">
                      <span className="dp-info-label">{left.label}</span>
                      <span className="dp-info-value">{left.value}</span>
                    </div>
                    <div className="dp-info-cell">
                      {right ? (
                        <>
                          <span className="dp-info-label">{right.label}</span>
                          <span className="dp-info-value">{right.value}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {inService ? (
              <section className="dp-checkout" aria-label={t.detail.amount}>
                <p className="dp-label">{t.detail.amount}</p>
                {/* The hint changes with the mode: a fixed service's box is already right and
                    only needs correcting; a range's band is what the customer was quoted. */}
                <p className="dp-hint">
                  {billing?.servicePriceType === "range" && billing.serviceMaxAmount
                    ? format(t.detail.amountHintRange, {
                        range: formatServicePrice({
                          price: billing.serviceAmount,
                          priceType: "range",
                          priceMax: billing.serviceMaxAmount,
                        }),
                      })
                    : billing?.servicePriceType === "unset"
                      ? t.detail.amountHintUnpriced
                      : t.detail.amountHint}
                </p>

                <div className="dp-amount">
                  {/* The store's own symbol, off the billing DTO (it carries business.currency).
                      Blank until billing lands — the box is disabled until then anyway, and a
                      guessed ₹ is exactly what a USD store used to see here. */}
                  <span className="dp-amount-prefix" aria-hidden>
                    {symbol}
                  </span>
                  <input
                    className="dp-amount-input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    // Editable only once the suggestion has landed, so a fast typist cannot have
                    // their figure overwritten by the response arriving a moment later.
                    disabled={!billing}
                    aria-label={t.detail.amount}
                  />
                  {!billing && !error ? <Spinner size={16} /> : null}
                </div>

                {/* Add-ons sit under the amount so their effect on the price is visible in the
                    same glance as the click that caused it. */}
                {addOns.length > 0 ? (
                  <div className="dp-chips">
                    {addOns.map((a) => {
                      // On = already on this visit, whether added here or booked with it.
                      const on = !!billing && isExtraOn(billing.extras, a.label);
                      return (
                        <button
                          key={a.label}
                          type="button"
                          className={on ? "dp-chip is-selected" : "dp-chip"}
                          aria-pressed={on}
                          disabled={busy || !billing}
                          onClick={() => onChip(a.label, a.minutes)}
                          aria-label={format(on ? t.detail.removeExtra : t.detail.addExtra, {
                            label: a.label,
                            minutes: a.minutes,
                          })}
                        >
                          <Icon name={on ? "check" : a.icon} size={16} />
                          <span>{a.label}</span>
                          <span className="dp-chip-mins">{format(t.detail.extendMins, { mins: a.minutes })}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {billing ? (
                  <ul className="dp-breakdown">
                    {/* The booked service on its own line — by its own name, since the add-ons
                        are itemised below it. With no price, the line is where it gets one. */}
                    {serviceName ? (
                      billing.servicePriceType === "unset" ? (
                        requiredRow(SERVICE_KEY, serviceName)
                      ) : (
                        <li>
                          <span>{serviceName}</span>
                          <span>
                            {formatServicePrice({
                              price: billing.serviceAmount,
                              priceType: billing.servicePriceType,
                              priceMax: billing.serviceMaxAmount,
                            })}
                          </span>
                        </li>
                      )
                    ) : null}
                    {billing.extras.map((x) =>
                      x.priceRequired ? (
                        requiredRow(x.id, x.label, format(t.detail.extraLine, { label: x.label, minutes: x.minutes }))
                      ) : (
                        <li key={x.id}>
                          <span>{format(t.detail.extraLine, { label: x.label, minutes: x.minutes })}</span>
                          <span>{formatMoney({ ...billing.extrasAmount, amount: x.pricePaise })}</span>
                        </li>
                      ),
                    )}
                    {/* The server's figure, only once the box no longer matches it (a corrected
                        fixed price) — otherwise it would just repeat the total below. */}
                    {suggestionDiffers(amount, billing) && billing.suggestedAmount ? (
                      <li className="total">
                        <span>{t.detail.suggested}</span>
                        <span>{formatMoney(billing.suggestedAmount)}</span>
                      </li>
                    ) : null}
                    {/* The box, live: exactly what Complete will charge. */}
                    <li className="grand">
                      <span>{t.detail.totalToCharge}</span>
                      <span>
                        {totalPaise !== null
                          ? formatMoney({ ...billing.serviceAmount, amount: totalPaise })
                          : t.common.dash}
                      </span>
                    </li>
                  </ul>
                ) : error ? null : (
                  // Roughly the height of the real breakdown, so nothing jumps when it lands.
                  <div className="dp-breakdown-loading">
                    <Skeleton height={12} width="60%" />
                    <Skeleton height={12} width="45%" />
                  </div>
                )}
              </section>
            ) : null}
            <div ref={endRef} className="dp-scroll-end" aria-hidden />
          </div>

          <div className={raised ? "dp-footer is-raised" : "dp-footer"}>
            {error ? (
              <p className="ss-error" role="alert">
                {error}
              </p>
            ) : null}

            {inService ? (
              <>
                {/* Why Complete is disabled, and a way straight to the fix. */}
                {missing.length > 0 ? (
                  <button type="button" className="dp-req-hint" onClick={focusFirstMissing}>
                    <Icon name="alertTriangle" size={16} />
                    <span>{format(t.detail.priceRequiredHint, { services: missing.join(", ") })}</span>
                  </button>
                ) : null}
                {/* Red, matching the board's End — it is the same action. */}
                <button
                  type="button"
                  className="ss-btn danger lg block"
                  onClick={onComplete}
                  disabled={busy || !ready}
                >
                  {running === "checkout" ? <Spinner size={16} /> : null}
                  {t.detail.completeAndNext}
                </button>
                {noShowButton}
              </>
            ) : waiting ? (
              <>
                {otherSeats.length > 0 ? (
                  <>
                    <p className="dp-label">{t.detail.moveSeat}</p>
                    <div className="dp-chips">
                      {otherSeats.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="dp-chip"
                          disabled={busy}
                          onClick={() => act("reassign", { staffId: s.id })}
                        >
                          {/* The chair's own colour, as on its seat board. */}
                          <span className={`dp-chip-dot seat-avatar-${s.colorToken || "secondary"}`} aria-hidden />
                          <span>{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {seatBusy ? (
                  <p className="dp-note">
                    {format(t.detail.seatBusy, {
                      seat: card.seatName ?? t.detail.seatBusyFallback,
                      name: seatGroup?.servingName || t.detail.someone,
                    })}
                  </p>
                ) : null}

                <button
                  type="button"
                  className="ss-btn success lg block"
                  onClick={() => act("start")}
                  disabled={busy || seatBusy}
                >
                  {running === "start" ? <Spinner size={16} /> : null}
                  {t.detail.startService}
                </button>
                {noShowButton}
              </>
            ) : null}
          </div>
        </div>
      </div>
      {/* The add-on price popup: always empty, so the price on the visit is the one somebody
          typed for this customer, not a platform-wide default (docs/checkout-add-ons.md). */}
      {pricePrompt && billing ? (
        <ConfirmDialog
          key={pricePrompt.label}
          open
          title={format(t.detail.addOnPriceTitle, { label: pricePrompt.label })}
          body={format(t.detail.addOnPriceBody, { minutes: pricePrompt.minutes })}
          confirmLabel={t.detail.addOnPriceConfirm}
          input={{
            label: t.detail.addOnPriceLabel,
            prefix: currencySymbol(billing.serviceAmount.currency),
            inputMode: "decimal",
            validate: (value) => (parseRupees(value) === null ? t.detail.addOnPriceInvalid : null),
          }}
          onConfirm={onAddOnPrice}
          onCancel={() => setPricePrompt(null)}
        />
      ) : null}
    </OverlayPortal>
  );
}
