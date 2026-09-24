"use client";

import { useRouter } from "next/navigation";
import { format, t } from "@/i18n";
import { useState, useTransition } from "react";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { showToast } from "@/lib/toast";

type Action = "check-in" | "no-show";

/**
 * The right-hand side of an Appointments row (see `AppointmentListItem`): the app's ghost
 * "Add to queue" button, plus a web-only no-show shortcut.
 *
 * Check-in moves a booking into the live queue via the backend's `appointment_check_in` RPC, which
 * allocates the token and seat. Afterwards the app toasts "{name} added to queue" and opens Home,
 * where the new ticket is — `afterCheckIn` does the same here. Without it the page just refreshes
 * and the row moves to "Checked in or closed".
 *
 * Failures are toasts, as on the app. An inline error line under the button (what this file used
 * to render) would push the row out of shape and outlive the next refresh.
 *
 * The caller decides eligibility (`isCheckInEligible` in lib/appointments.ts). This file's older
 * `AppointmentActions` (a stacked Check in / No-show pair gated on a `"booked"` status the API
 * never sends) was removed once neither Appointments nor the Calendar rendered it any more.
 */
export function AppointmentRowActions({
  id,
  name,
  showNoShow = false,
  afterCheckIn = null,
}: {
  id: string;
  /** The customer, for the toast and the no-show button's accessible name. */
  name: string;
  /**
   * The web keeps a no-show shortcut the app has never had. It is shown only once the booking's
   * time has come (the page decides), because a future booking can't have been missed yet — and
   * it keeps every upcoming row exactly as the app draws it: one button.
   */
  showNoShow?: boolean;
  /** Where to go after a successful check-in (the app opens Home); null refreshes in place. */
  afterCheckIn?: string | null;
}) {
  const router = useRouter();
  // `router.refresh()` / `push()` are async; the transition keeps the button busy until the fresh
  // page has actually landed, so it cannot be clicked twice into a 409.
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const busy = inFlight || isPending;

  async function act(next: Action) {
    setAction(next);
    setInFlight(true);
    try {
      const res = await fetch(`/api/appointments/${encodeURIComponent(id)}/${next}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const fallback = next === "check-in" ? t.appointments.couldNotCheckIn : t.common.thatDidntWork;
        showToast(json?.error?.message ?? fallback, "error");
        return;
      }
      if (next === "check-in") {
        showToast(format(t.appointments.addedToQueueName, { name }), "success");
        startTransition(() => {
          if (afterCheckIn) router.push(afterCheckIn);
          else router.refresh();
        });
      } else {
        showToast(t.appointments.markedNoShow, "success");
        startTransition(() => router.refresh());
      }
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="appt-item-checkin"
        disabled={busy}
        aria-busy={busy && action === "check-in"}
        onClick={() => act("check-in")}
      >
        {busy && action === "check-in" ? <Spinner size={14} /> : null}
        {t.appointments.addToQueue}
      </button>
      {showNoShow ? (
        <button
          type="button"
          className="appt-item-noshow"
          disabled={busy}
          aria-busy={busy && action === "no-show"}
          onClick={() => act("no-show")}
          title={t.appointments.markNoShow}
          aria-label={format(t.appointments.markNoShowAria, { name })}
        >
          {busy && action === "no-show" ? <Spinner size={13} /> : <Icon name="x" size={16} />}
        </button>
      ) : null}
    </>
  );
}
