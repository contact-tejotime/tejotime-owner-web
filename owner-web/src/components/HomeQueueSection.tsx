"use client";

import { useEffect, useState } from "react";
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
}: {
  seats: SeatGroup[];
  staff: StaffRow[];
  services: ServiceRow[];
  showQr: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [walkInOpen, setWalkInOpen] = useState(false);

  // Deep link / bookmark: /dashboard?walkin=1 opens the sheet once, then clears the query.
  useEffect(() => {
    if (searchParams.get("walkin") !== "1") return;
    setWalkInOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("walkin");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  return (
    <>
      <h2 className="home-section-title">Quick actions</h2>
      <div className="home-actions">
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

      <h2 className="home-section-title">Queue</h2>
      <QueueBoard
        initialSeats={seats}
        staff={staff}
        services={services}
        walkInOpen={walkInOpen}
        onWalkInOpenChange={setWalkInOpen}
      />
    </>
  );
}
