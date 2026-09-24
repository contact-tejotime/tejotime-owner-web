"use client";

import { Fragment } from "react";
import { t } from "@/i18n";

import { Icon, type IconName } from "@/components/Icon";
import { StoreBookingQr } from "@/components/StoreBookingQr";
import type { SeatGroup } from "@/lib/server-api";

/** The backend's id for the seatless group (`queue-engine.ts`): "Waiting" or "Any". */
export const UNASSIGNED_GROUP_ID = "__unassigned__";

/**
 * The live picture of the shop, in the three numbers an owner acts on, plus the one thing they do
 * most from Home: add a walk-in. The web twin of the app's `components/home/LiveQueueCard.tsx`
 * (docs/mobile-home-screen.md) — same numbers, same rules, same wording.
 *
 * - **Waiting:** across every seat this login can see (a staff login sees only its own chair).
 * - **In service:** people being served, not busy seats — a staffless business has one shared
 *   group that can serve several at once.
 * - **Walk-in wait:** what someone walking in now would wait on the soonest seat. "Now" while any
 *   seat is empty. Built from the same per-seat `clearMinutes` as the seat boards.
 *
 * On a phone and tablet it is the app's card, drawn on the store's brand colour with the brand's
 * ink (`--text-on-brand`), dimmed with `color-mix`, never a fixed white: in dark mode the brand
 * turns light and its ink turns dark. On desktop (>=1025px) the same markup becomes a header row
 * plus three separate cards, at the owner's request: one banner the full width of a monitor spread
 * three numbers a screen apart across a slab of brand colour.
 * It replaces the old "Quick actions" row and the queue's own Walk-in chip, which offered the same
 * action twice.
 */
export function LiveQueueCard({
  seats,
  onAddWalkIn,
  cardUrl,
  storeName,
}: {
  seats: SeatGroup[];
  onAddWalkIn: () => void;
  /** Booking QR target. Omitted when this login can't see the profile. */
  cardUrl?: string | null;
  storeName: string;
}) {
  const waiting = seats.reduce((n, g) => n + g.waitingCount, 0);
  const inService = seats.reduce((n, g) => n + g.cards.filter((c) => c.status === "in_service").length, 0);
  // The "Any" group holds tickets whose seat was deleted. Nobody new is placed there, so it can't
  // be the soonest seat — unless it is the only group (a business with no staff at all).
  const real = seats.filter((g) => g.id !== UNASSIGNED_GROUP_ID);
  const pool = real.length ? real : seats;
  const soonest = pool.length ? Math.min(...pool.map((g) => (g.empty ? 0 : g.clearMinutes))) : null;
  // The unit rides beside the figure at a smaller size, so the three figures read as a set.
  const walkInWait =
    soonest === null
      ? { value: "—" }
      : soonest <= 0
        ? { value: t.dashboard.waitNow }
        : { value: String(soonest), unit: t.dashboard.waitUnitMin };

  // `icon` is drawn only on desktop, where the figures become three cards (see globals.css).
  const stats: { key: string; icon: IconName; label: string; value: string; unit?: string }[] = [
    { key: "waiting", icon: "users", label: t.dashboard.statWaiting, value: String(waiting) },
    { key: "service", icon: "user", label: t.dashboard.statInService, value: String(inService) },
    { key: "wait", icon: "clock", label: t.dashboard.statWalkInWait, ...walkInWait },
  ];

  return (
    <section className="live-card" aria-label={t.dashboard.liveQueue}>
      <div className="live-card-top">
        <span className="live-card-eyebrow">
          {/* Static on purpose: an infinite pulse keeps the page from ever going idle. */}
          <span className="live-card-dot" aria-hidden />
          {t.dashboard.liveQueue}
        </span>
        <button type="button" className="live-card-cta" onClick={onAddWalkIn} aria-label={t.dashboard.addWalkIn}>
          <Icon name="plus" size={16} />
          {t.queue.walkIn}
        </button>
        {cardUrl ? (
          <StoreBookingQr cardUrl={cardUrl} storeName={storeName} buttonClassName="live-card-qr" />
        ) : null}
      </div>

      <div className="live-card-stats">
        {stats.map((st, i) => (
          <Fragment key={st.key}>
            {i > 0 ? <span className="live-card-divider" aria-hidden /> : null}
            {/* `kpi-card*`: the desktop card shared with Reports (globals.css) — no effect on a phone. */}
            <div
              className="live-card-stat kpi-card"
              role="group"
              aria-label={`${st.label}: ${st.value}${st.unit ? ` ${st.unit}` : ""}`}
            >
              <span className="live-card-icon kpi-card-icon" aria-hidden>
                <Icon name={st.icon} size={20} />
              </span>
              <span className="live-card-stat-text kpi-card-text">
                <span className="live-card-value kpi-card-value" aria-hidden>
                  {st.value}
                  {st.unit ? <span className="live-card-unit">{st.unit}</span> : null}
                </span>
                <span className="live-card-label kpi-card-label" aria-hidden>
                  {st.label}
                </span>
              </span>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
