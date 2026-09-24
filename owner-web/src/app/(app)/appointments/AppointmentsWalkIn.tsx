"use client";

import { useState } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { WalkInSheet } from "@/components/WalkInSheet";
import type { SeatGroup, ServiceRow, StaffRow } from "@/lib/server-api";

/**
 * The app's Appointments header action: a "+" that opens the walk-in sheet right here
 * (`store.openWalkin`), for the customer who turns up without a booking while the owner is looking
 * at the day's bookings. Same sheet as Home's, so seats, services and validation match.
 *
 * `category` is not optional in practice: without it a Hospital store's sheet never asks MR or
 * Patient (and the API refuses the join), and a Hospital/Restaurant with no services is told to
 * pick one. `seats` gives each seat its load line and "Any seat" the right soonest-free name.
 *
 * On success the sheet itself toasts "Added to queue" / "Added as next" (as the app's `addWalkin`
 * does); this only closes it. The page lists bookings, not the queue, so there is nothing to refresh.
 */
export function AppointmentsWalkIn({
  staff,
  services,
  seats,
  category,
}: {
  staff: StaffRow[];
  services: ServiceRow[];
  seats: SeatGroup[];
  category?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* `.icon-btn` like every other web header action (Home's bell), rather than the app's
          rounded-square IconButton: the header's look belongs to the shared header. */}
      <button
        type="button"
        className="icon-btn"
        aria-label={t.appointments.addWalkIn}
        title={t.appointments.addWalkIn}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={20} />
      </button>

      {/* Mounted only while open — see WalkInSheet for why. */}
      {open ? (
        <WalkInSheet
          onClose={() => setOpen(false)}
          staff={staff}
          services={services}
          seats={seats}
          category={category}
          onAdded={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
