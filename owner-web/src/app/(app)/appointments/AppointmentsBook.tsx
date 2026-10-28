"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { NewAppointmentSheet } from "@/components/NewAppointmentSheet";
import type { PickerContext } from "@/lib/series";
import type { ServiceRow } from "@/lib/server-api";

/**
 * The Appointments header action: "+" books an appointment (owner, 2026-10-28,
 * docs/owner-book-appointment.md). It used to open Add walk-in — the wrong thing on a tab of
 * bookings; walk-ins are added from Home's live queue card, which keeps its own sheet.
 *
 * Shown only with `appointments: manage`, the API's own gate for booking. On success the sheet has
 * toasted "Visit booked"; this closes it and refreshes the page in a transition, so the new booking
 * appears in Today.
 */
export function AppointmentsBook({
  picker,
  services,
  category,
  countryCode,
}: {
  picker: PickerContext;
  services: ServiceRow[];
  category?: string | null;
  countryCode?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* `.icon-btn` like every other web header action. */}
      <button
        type="button"
        className="icon-btn"
        aria-label={t.appointments.bookAppointment}
        title={t.appointments.bookAppointment}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={20} />
      </button>

      {/* Mounted only while open, so every field starts fresh. */}
      {open ? (
        <NewAppointmentSheet
          onClose={() => setOpen(false)}
          onBooked={() => {
            setOpen(false);
            startTransition(() => router.refresh());
          }}
          picker={picker}
          services={services}
          category={category}
          countryCode={countryCode}
        />
      ) : null}
    </>
  );
}
