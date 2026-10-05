"use client";

import { useRouter } from "next/navigation";
import { format, t } from "@/i18n";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { useBookingSheets } from "@/components/series/BookingSheets";
import { Spinner } from "@/components/Skeleton";
import { showToast } from "@/lib/toast";

type Action = "check-in" | "no-show" | "skip" | "cancel";

/** The two actions that ask first, and the app's words for each (app/src/i18n/en.json). */
type Confirmed = "skip" | "cancel";

const CONFIRM: Record<Confirmed, { title: string; body: string; yes: string; no: string; done: string }> = {
  skip: {
    title: t.series.skipConfirmTitle,
    body: t.series.skipConfirmBody,
    yes: t.series.skip,
    no: t.confirm.cancel,
    done: t.series.visitSkipped,
  },
  cancel: {
    title: t.appointments.cancelConfirmTitle,
    body: t.appointments.cancelConfirmBody,
    yes: t.appointments.cancelBooking,
    no: t.appointments.keepBooking,
    done: t.appointments.bookingCancelled,
  },
};

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
 *
 * The extra icon button follows the app's rule — before the booking's time: Skip for a visit of a
 * repeating booking, Cancel for a one-off; after it: the no-show ×. The page decides which one
 * (at most one per row), so the row keeps its shape. Skip and Cancel ask first — one stray click
 * would otherwise drop someone's visit — and neither texts the customer (owner-side cancels never
 * have), which is why both confirms say "let them know".
 *
 * Reschedule (Phase 2) is a second icon button on any booking still ahead, one-off or series: it
 * opens the Reschedule sheet of the page's BookingSheetsHost. Without a host it is left out.
 */
export function AppointmentRowActions({
  id,
  name,
  showNoShow = false,
  showSkip = false,
  showCancel = false,
  reschedule = null,
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
  /** A series visit still ahead — the page decides (`isSkippable` in lib/series.ts). */
  showSkip?: boolean;
  /** A one-off booking still ahead — the page decides (`isCancellable` in lib/series.ts). */
  showCancel?: boolean;
  /** Offer Reschedule: the booking's start and stylist, which the picker starts from. */
  reschedule?: { startAt: string; staffId: string | null } | null;
  /** Where to go after a successful check-in (the app opens Home); null refreshes in place. */
  afterCheckIn?: string | null;
}) {
  const router = useRouter();
  // `router.refresh()` / `push()` are async; the transition keeps the button busy until the fresh
  // page has actually landed, so it cannot be clicked twice into a 409.
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState<Confirmed | null>(null);
  const sheets = useBookingSheets();
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
        showToast(next === "no-show" ? t.appointments.markedNoShow : CONFIRM[next].done, "success");
        startTransition(() => router.refresh());
      }
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setInFlight(false);
      if (next === "skip" || next === "cancel") setConfirming(null);
    }
  }

  const ask = confirming ? CONFIRM[confirming] : null;

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
      {reschedule && sheets ? (
        <button
          type="button"
          className="appt-item-noshow appt-item-skip"
          disabled={busy}
          onClick={() =>
            sheets.pick({ kind: "move", appointmentId: id, startAt: reschedule.startAt, staffId: reschedule.staffId }, name)
          }
          title={t.reschedule.action}
          aria-label={t.reschedule.action}
          aria-haspopup="dialog"
        >
          <Icon name="calendarClock" size={15} />
        </button>
      ) : null}
      {showSkip ? (
        <button
          type="button"
          className="appt-item-noshow appt-item-skip"
          disabled={busy}
          aria-busy={busy && action === "skip"}
          onClick={() => setConfirming("skip")}
          title={t.appointments.skipVisit}
          aria-label={t.appointments.skipVisit}
        >
          {busy && action === "skip" ? <Spinner size={13} /> : <Icon name="skipForward" size={15} />}
        </button>
      ) : null}
      {showCancel ? (
        <button
          type="button"
          className="appt-item-noshow appt-item-cancel"
          disabled={busy}
          aria-busy={busy && action === "cancel"}
          onClick={() => setConfirming("cancel")}
          title={t.appointments.cancelBooking}
          aria-label={t.appointments.cancelBooking}
        >
          {busy && action === "cancel" ? <Spinner size={13} /> : <Icon name="calendarX" size={15} />}
        </button>
      ) : null}
      {confirming && ask ? (
        <ConfirmDialog
          key={`${confirming}-${id}`}
          open
          title={ask.title}
          body={ask.body}
          confirmLabel={ask.yes}
          cancelLabel={ask.no}
          destructive={confirming === "cancel"}
          busy={busy}
          onConfirm={() => act(confirming)}
          onCancel={() => {
            if (!busy) setConfirming(null);
          }}
        />
      ) : null}
    </>
  );
}
