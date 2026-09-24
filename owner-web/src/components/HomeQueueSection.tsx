"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LiveQueueCard } from "@/components/LiveQueueCard";
import { QueueBoard } from "@/components/QueueBoard";
import type { SeatGroup, ServiceRow, StaffRow } from "@/lib/server-api";

/**
 * Home's live card + seat boards, the same blocks as the app's Home (docs/mobile-home-screen.md).
 * Owns the walk-in sheet so the card's "Add walk-in" and an empty seat's shortcut open the same
 * sheet — the latter with its seat already chosen.
 */
export function HomeQueueSection({
  seats,
  staff,
  services,
  showQr,
  singleChair = false,
  category,
  cardUrl,
  storeName,
}: {
  seats: SeatGroup[];
  staff: StaffRow[];
  services: ServiceRow[];
  showQr: boolean;
  /** Staff / one-seat shops — no seat filter chips (nothing to filter). */
  singleChair?: boolean;
  category?: string | null;
  /** Public booking chooser URL encoded into the Contact QR (from GET /business/qr). */
  cardUrl?: string | null;
  storeName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [walkInSeat, setWalkInSeat] = useState<string | null>(null);

  /**
   * Deep link / bookmark: /dashboard?walkin=1 opens the sheet.
   *
   * DERIVED from the URL rather than copied into state by an effect. The effect version set
   * state and navigated on the same pass, so the sheet opened a frame late and — because
   * clearing the query re-ran the effect — could re-open itself after the user dismissed it.
   * Reading the URL directly means there is only ever one source of truth for "is it open".
   */
  const deepLinked = searchParams.get("walkin") === "1";
  const walkInOpen = manuallyOpen || deepLinked;

  /** Closing has to drop the query too, or the deep link would immediately re-open the sheet. */
  const setWalkInOpen = (next: boolean) => {
    setManuallyOpen(next);
    if (!next && deepLinked) {
      const qs = new URLSearchParams(searchParams.toString());
      qs.delete("walkin");
      const rest = qs.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
    }
  };

  const qrReady = showQr && !!cardUrl;

  /** An empty seat's shortcut opens the same sheet with that seat already chosen. */
  const openWalkIn = (seatId: string | null = null) => {
    setWalkInSeat(seatId);
    setWalkInOpen(true);
  };

  return (
    <>
      <LiveQueueCard
        seats={seats}
        onAddWalkIn={() => openWalkIn()}
        cardUrl={qrReady ? cardUrl : null}
        storeName={storeName || t.dashboard.storeFallback}
      />

      <QueueBoard
        initialSeats={seats}
        staff={staff}
        services={services}
        walkInOpen={walkInOpen}
        walkInSeatId={walkInSeat}
        onWalkInOpenChange={setWalkInOpen}
        onAddWalkInTo={openWalkIn}
        singleChair={singleChair}
        category={category}
      />
    </>
  );
}
