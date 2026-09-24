"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";

import { QueueDetailSheet } from "@/components/QueueDetailSheet";
import type { QueueCard, SeatGroup } from "@/lib/server-api";
import { gridColumnVars } from "./columns";

/** The chair colours the web draws (`.seat-avatar-*` on Home); anything else falls back to secondary. */
const SEAT_COLORS = new Set(["primary", "secondary", "amber500", "green500"]);

/**
 * Reports' queue preview — the first few tickets, drawn as the app's `QueueCard`: position badge,
 * name (with the hospital visitor badge), a seat-coloured dot with "seat · service", and the ETA.
 *
 * A card opens the customer sheet, as a tap does on the app (`store.openDetail`), rather than
 * sending the owner to Home to find the same person again. "View all" is still the way to Home.
 */
export function ReportQueuePreview({
  cards,
  seats,
  category,
}: {
  cards: QueueCard[];
  /** Every seat this login can see — the sheet offers them as reassignment targets. */
  seats: SeatGroup[];
  /** Business category — gates checkout add-on chips in the sheet. */
  category?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [openCard, setOpenCard] = useState<QueueCard | null>(null);

  return (
    <>
      <ul className="rp-queue-list" style={gridColumnVars(cards.length)}>
        {cards.map((card) => {
          const active = card.status === "in_service";
          const seatColor = SEAT_COLORS.has(card.seatColor) ? card.seatColor : "secondary";
          return (
            <li key={card.id}>
              <button
                type="button"
                className={`rp-qcard${active ? " is-active" : ""}`}
                onClick={() => setOpenCard(card)}
              >
                <span className="rp-qcard-num" aria-hidden>
                  {card.position}
                </span>
                <span className="rp-qcard-body">
                  <span className="rp-qcard-name-row">
                    <span className="rp-qcard-name">{card.name}</span>
                    {card.visitorType ? (
                      <span className={`rp-badge ${card.visitorType === "mr" ? "is-info" : "is-secondary"}`}>
                        {card.visitorType === "mr" ? t.stats.visitorMr : t.stats.visitorPatient}
                      </span>
                    ) : null}
                  </span>
                  <span className="rp-qcard-sub">
                    <span className={`rp-qcard-dot rp-seat-${seatColor}`} aria-hidden />
                    <span className="rp-qcard-sub-text">
                      {[card.seatName, card.service].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </span>
                <span className="rp-qcard-right">
                  <span className="rp-qcard-status" aria-hidden />
                  {card.rightText}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {openCard ? (
        <QueueDetailSheet
          card={openCard}
          seats={seats}
          category={category}
          onClose={() => setOpenCard(null)}
          onChanged={() => startTransition(() => router.refresh())}
        />
      ) : null}
    </>
  );
}
