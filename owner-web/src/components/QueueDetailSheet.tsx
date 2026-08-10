"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { Skeleton, Spinner } from "@/components/Skeleton";
import { formatMoney } from "@/lib/format";
import { extrasForCategory } from "@/lib/service-extras";
import { showToast } from "@/lib/toast";
import type { Money, QueueCard, SeatGroup } from "@/lib/server-api";

/**
 * The sheet behind a queue card — the web twin of the app's Customer sheet.
 *
 * ONE sheet, not a wizard. An in-service customer shows the amount, the add-ons and the complete
 * button together, because they are one decision: you are looking at the person in the chair and
 * working out what to charge them.
 *
 * It renders IMMEDIATELY from the card the board already has. Only the price waits on the
 * network, behind a skeleton — the previous version showed an almost-empty box reading
 * "Customer / Loading…" for the whole round trip, which read as a broken dialog.
 *
 * The seat/service/source/position grid is deliberately gone. It restated what the card behind
 * the sheet already showed, and pushed the one thing you opened the sheet for — the price —
 * below the fold on a phone.
 *
 * Why the amount is here at all: `visit.amount_paise` feeds customer lifetime spend and every
 * revenue KPI, and it used to be written from the BOOKED service alone, so a customer who came
 * for a beard trim and also had a haircut was banked at the beard-trim price.
 */

interface Billing {
  serviceAmount: Money;
  extrasAmount: Money;
  suggestedAmount: Money;
  extras: { id: string; label: string; minutes: number; pricePaise: number }[];
}

const TOASTS: Record<string, string> = {
  start: "Service started",
  checkout: "Checked out",
  "no-show": "Marked as a no-show",
  reassign: "Moved to another seat",
};

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Rupees as typed. A string so the field can be empty mid-edit. */
  const [amount, setAmount] = useState("");
  const addOns = extrasForCategory(category);

  const entryId = card.id;
  const inService = card.status === "in_service";

  /**
   * The two things every dialog is expected to do. Subscribing to a browser event is exactly
   * what an effect is for, so this one is not doing anything the setState rule objects to.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind the modal from scrolling under the user's finger.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/queue/${entryId}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setError(json?.error?.message ?? "Could not load the price for this customer.");
          return;
        }
        setBilling(json as Billing);
        // Pre-fill with what the shop would charge today, so the common case is one tap.
        setAmount(rupees(json.suggestedAmount?.amount ?? 0));
      } catch {
        if (alive) setError("Could not reach the server.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [entryId]);

  async function send(path: string, body?: unknown, fallback = "That didn't work.") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? fallback);
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, body?: unknown) {
    const ok = await send(`/api/queue/${entryId}/${action}`, body);
    if (ok) {
      showToast(TOASTS[action] ?? "Done", "success");
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
    const before = billing?.suggestedAmount.amount ?? 0;
    const ok = await send(`/api/queue/${entryId}/extend`, { label, minutes });
    if (!ok) return;
    onChanged();
    const res = await fetch(`/api/queue/${entryId}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as Billing;
    setBilling(next);
    const delta = (next.suggestedAmount.amount - before) / 100;
    setAmount((prev) => {
      const current = Number(prev);
      return Number.isFinite(current)
        ? String(current + delta)
        : rupees(next.suggestedAmount.amount);
    });
  }

  async function onComplete() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter the amount to charge.");
      return;
    }
    // Rupees in the box, paise on the wire — money crosses the API as an integer minor unit,
    // and Math.round keeps 249.99 from arriving as 24998.999999999996.
    await act("checkout", { amountPaise: Math.round(value * 100) });
  }

  const otherSeats = seats.filter((s) => s.id !== card.seatId);

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      // Only a click that both starts and ends on the backdrop itself closes — otherwise
      // releasing a text selection outside the card would dismiss the sheet mid-edit.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header className="sheet-head">
          <div className="sheet-title">
            <h2>{card.name}</h2>
            <p className="sheet-sub-text">
              {[card.seatName, card.service, card.rightText].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        {error ? (
          <div className="alert err" role="alert">
            {error}
          </div>
        ) : null}

        {inService ? (
          <>
            <div className="checkout-block">
              <h3>Amount to charge</h3>
              <p className="field-hint">Edit if the final bill is different.</p>

              <div className="amount-row">
                <span className="amount-prefix">₹</span>
                <input
                  className="amount-input"
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
                  aria-label="Amount to charge"
                />
                {!billing ? <Spinner size={16} /> : null}
              </div>

              {/* Add-ons sit under the amount so their effect on the price is visible in the
                  same glance as the tap that caused it. Icon + minutes only — label is in
                  the title/aria for screen readers and long-press tooltips. */}
              <div className="addon-row">
                {addOns.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className="addon-chip addon-chip-icon"
                    disabled={busy || !billing}
                    onClick={() => addExtra(a.label, a.minutes)}
                    title={`${a.label} · +${a.minutes}m`}
                    aria-label={`Add ${a.label}, +${a.minutes} minutes`}
                  >
                    <Icon name="plus" size={14} />
                    <Icon name={a.icon} size={15} />
                    <span className="addon-mins">+{a.minutes}m</span>
                  </button>
                ))}
              </div>

              {billing ? (
                <ul className="amount-breakdown">
                  <li>
                    <span>{card.service ?? "Service"}</span>
                    <span>{formatMoney(billing.serviceAmount)}</span>
                  </li>
                  {billing.extras.map((x) => (
                    <li key={x.id}>
                      <span>
                        {x.label} · +{x.minutes}m
                      </span>
                      <span>{formatMoney({ ...billing.extrasAmount, amount: x.pricePaise })}</span>
                    </li>
                  ))}
                  <li className="total">
                    <span>Suggested</span>
                    <span>{formatMoney(billing.suggestedAmount)}</span>
                  </li>
                </ul>
              ) : (
                // Roughly the height of the real breakdown, so nothing jumps when it lands.
                <div className="amount-breakdown-loading">
                  <Skeleton height={13} width="60%" />
                  <Skeleton height={13} width="45%" />
                </div>
              )}
            </div>

            {/* Red, matching the board's Check out — it is the same action. */}
            <button type="button" className="btn danger block btn-xl" onClick={onComplete} disabled={busy}>
              {busy ? <Spinner size={16} /> : null}
              Complete &amp; start next
            </button>
          </>
        ) : (
          <>
            {otherSeats.length > 0 ? (
              <div className="addon-block">
                <h3>Move to another seat</h3>
                <div className="addon-row">
                  {otherSeats.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="addon-chip"
                      disabled={busy}
                      onClick={() => act("reassign", { staffId: s.id })}
                    >
                      <span>{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className="btn success block btn-xl"
              onClick={() => act("start")}
              disabled={busy}
            >
              {busy ? <Spinner size={16} /> : null}
              Start service
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Paise → a plain rupee string for the input. Whole rupees; nobody types paise at a counter. */
function rupees(paise: number): string {
  return String(Math.round(paise / 100));
}
