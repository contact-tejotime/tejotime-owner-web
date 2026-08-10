"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Icon } from "@/components/Icon";
import { QueueBoard } from "@/components/QueueBoard";
import type { SeatGroup, ServiceRow, StaffRow } from "@/lib/server-api";

/**
 * Home quick actions + live queue. Owns the walk-in sheet so "Add walk-in" and the board
 * chip open the same bottom sheet (same flow as the Expo app).
 */
export function HomeQueueSection({
  seats,
  staff,
  services,
  showQr,
  singleChair = false,
  category,
}: {
  seats: SeatGroup[];
  staff: StaffRow[];
  services: ServiceRow[];
  showQr: boolean;
  /** Staff / one-seat shops — tighter layout, no redundant seat filter chips. */
  singleChair?: boolean;
  category?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [manuallyOpen, setManuallyOpen] = useState(false);

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

  const soloAction = !showQr;

  return (
    <>
      <h2 className="home-section-title">Quick actions</h2>
      <div className={`home-actions${soloAction ? " home-actions-solo" : ""}`}>
        <button type="button" className="btn home-action-primary" onClick={() => setWalkInOpen(true)}>
          <Icon name="plus" size={18} color="#fff" />
          Add walk-in
        </button>
        {showQr ? (
          <Link href="/settings" className="btn secondary home-action-secondary">
            <Icon name="qrCode" size={18} />
            Contact QR
          </Link>
        ) : null}
      </div>

      <h2 className="home-section-title">{singleChair ? "Your queue" : "Queue"}</h2>
      <QueueBoard
        initialSeats={seats}
        staff={staff}
        services={services}
        walkInOpen={walkInOpen}
        onWalkInOpenChange={setWalkInOpen}
        singleChair={singleChair}
        category={category}
      />
    </>
  );
}
