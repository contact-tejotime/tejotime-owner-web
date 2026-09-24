"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";
import { UNASSIGNED_GROUP_ID } from "@/components/LiveQueueCard";
import { OverlayPortal } from "@/components/OverlayPortal";
import { Skeleton, Spinner } from "@/components/Skeleton";
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
 *                 breakdown · Complete & start next · Mark no-show
 *
 * ONE screen, not a wizard. An in-service customer's amount, add-ons and complete button are one
 * decision: you are looking at the person in the chair working out what to charge them.
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
 */

interface Billing {
  serviceAmount: Money;
  /** The booked service's pricing mode — see backend/src/domain/money.ts `servicePricing`. */
  servicePriceType: ServicePriceType;
  /** Ceiling of a range-priced service. Null for a fixed one. */
  serviceMaxAmount: Money | null;
  extrasAmount: Money;
  /**
   * What to pre-fill. NULL for a range-priced or unpriced service: there is no honest figure
   * to seed the box with, and seeding the floor is exactly how a band's minimum gets banked as
   * the day's takings. The API refuses a checkout with no amount for these too.
   */
  suggestedAmount: Money | null;
  amountRequired: boolean;
  extras: { id: string; label: string; minutes: number; pricePaise: number }[];
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
  const addOns = extrasForCategory(category);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onEscape = useEffectEvent(() => onClose());

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
        // Pre-fill with what the shop would charge today, so the common case is one tap. A
        // range-priced service has no such figure and deliberately starts empty — the whole
        // point of the mode is that someone has to look at the customer and decide.
        setAmount(json.suggestedAmount ? rupees(json.suggestedAmount.amount) : "");
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
   * Record an add-on and move the amount by exactly its price.
   *
   * The delta is taken from the server's recomputed suggestion rather than re-syncing the whole
   * box to it — otherwise adding a shave would silently discard an amount the user had already
   * typed by hand, which is the one thing they are here to do.
   */
  async function addExtra(label: string, minutes: number) {
    const before = billing?.suggestedAmount?.amount ?? null;
    const ok = await send("extend", `/api/queue/${entryId}/extend`, { label, minutes });
    if (!ok) return;
    onChanged();
    const res = await fetch(`/api/queue/${entryId}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as Billing;
    setBilling(next);
    // With no suggestion on either side (a range-priced service) there is no delta to apply —
    // the add-on's own price is still shown in the breakdown below, so the person typing can
    // see it and decide. Nudging a hand-typed figure by a number we did not derive would be
    // worse than leaving it alone.
    if (before == null || next.suggestedAmount == null) return;
    const delta = (next.suggestedAmount.amount - before) / 100;
    setAmount((prev) => {
      const current = Number(prev);
      return Number.isFinite(current) && prev.trim() !== ""
        ? String(current + delta)
        : rupees(next.suggestedAmount!.amount);
    });
  }

  async function onComplete() {
    // Empty is never a valid bill. It reads as "not decided yet", which for a range-priced
    // service is the state this box exists to get out of — and the API rejects it anyway.
    if (amount.trim() === "") {
      setError(billing?.amountRequired ? t.detail.amountRequired : t.detail.errAmount);
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError(t.detail.errAmount);
      return;
    }
    // Rupees in the box, paise on the wire — money crosses the API as an integer minor unit,
    // and Math.round keeps 249.99 from arriving as 24998.999999999996.
    await act("checkout", { amountPaise: Math.round(value * 100) });
  }

  // Real chairs only: the seatless "Any"/"Waiting" group is not a seat the API can reassign to.
  const otherSeats = seats.filter((s) => s.id !== card.seatId && s.id !== UNASSIGNED_GROUP_ID);
  const seatGroup = card.seatId ? seats.find((s) => s.id === card.seatId) : undefined;
  // One person per chair: the API refuses a second start with SEAT_BUSY. Saying so up front, and
  // offering the move, beats a red error after the click — the app disables it the same way.
  const seatBusy = waiting && !!seatGroup?.serving;
  const source = card.online ? t.queue.online : t.queue.walkIn;

  /**
   * Only what the card behind this screen does NOT already show — its price, its exact place in
   * line, where it came from. Two per row, label above value: six stacked full-width rows pushed
   * the last fact under the footer on a phone.
   */
  const facts: { key: string; label: string; value: ReactNode }[] = [
    { key: "pos", label: t.detail.position, value: `#${card.position}` },
    { key: "seat", label: t.detail.seat, value: card.seatName ?? t.common.dash },
    { key: "service", label: t.detail.service, value: card.service ?? t.common.dash },
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
              {/* A back chevron on the phone's full-screen page, an × on the dialog. */}
              <Icon name="chevronLeft" size={22} className="dp-icon-back" />
              <Icon name="x" size={20} className="dp-icon-x" />
            </button>
            <h2 id={titleId} className="dp-title">
              {t.detail.customer}
            </h2>
          </header>

          <div className="dp-scroll">
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

            {/* The facts card only while they are waiting. Once they are in the chair the footer
                owns the screen — amount, add-ons, breakdown, two buttons — and it already prints
                the service and the price, so a facts card would just push the amount box under
                the fold. That state keeps one muted line. */}
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
          </div>

          <div className="dp-footer">
            {error ? (
              <p className="ss-error" role="alert">
                {error}
              </p>
            ) : null}

            {inService ? (
              <>
                <p className="dp-label">{t.detail.amount}</p>
                {/* The hint changes with the mode: a fixed service's box is already right and
                    only needs correcting; a range's is empty, and the band the customer was
                    quoted is what they need to see while filling it in. */}
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
                  <span className="dp-amount-prefix" aria-hidden>
                    ₹
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
                    {addOns.map((a) => (
                      <button
                        key={a.label}
                        type="button"
                        className="dp-chip"
                        disabled={busy || !billing}
                        onClick={() => addExtra(a.label, a.minutes)}
                        aria-label={format(t.detail.addExtra, { label: a.label, minutes: a.minutes })}
                      >
                        <Icon name={a.icon} size={16} />
                        <span>{a.label}</span>
                        <span className="dp-chip-mins">{format(t.detail.extendMins, { mins: a.minutes })}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {billing ? (
                  <ul className="dp-breakdown">
                    <li>
                      <span>{card.service ?? t.detail.service}</span>
                      <span>
                        {formatServicePrice({
                          price: billing.serviceAmount,
                          priceType: billing.servicePriceType,
                          priceMax: billing.serviceMaxAmount,
                        })}
                      </span>
                    </li>
                    {billing.extras.map((x) => (
                      <li key={x.id}>
                        <span>{format(t.detail.extraLine, { label: x.label, minutes: x.minutes })}</span>
                        <span>{formatMoney({ ...billing.extrasAmount, amount: x.pricePaise })}</span>
                      </li>
                    ))}
                    {/* No suggested total for a range: printing one would be the derived figure
                        this mode exists to stop anybody reaching for. */}
                    {billing.suggestedAmount ? (
                      <li className="total">
                        <span>{t.detail.suggested}</span>
                        <span>{formatMoney(billing.suggestedAmount)}</span>
                      </li>
                    ) : null}
                  </ul>
                ) : error ? null : (
                  // Roughly the height of the real breakdown, so nothing jumps when it lands.
                  <div className="dp-breakdown-loading">
                    <Skeleton height={12} width="60%" />
                    <Skeleton height={12} width="45%" />
                  </div>
                )}

                {/* Red, matching the board's End — it is the same action. */}
                <button type="button" className="ss-btn danger lg block" onClick={onComplete} disabled={busy}>
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
    </OverlayPortal>
  );
}

/** Paise → a plain rupee string for the input. Whole rupees; nobody types paise at a counter. */
function rupees(paise: number): string {
  return String(Math.round(paise / 100));
}
