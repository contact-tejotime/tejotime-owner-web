"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { useState, useTransition } from "react";

/**
 * Check-in moves a booking into the live queue via the backend's `appointment_check_in` RPC,
 * which allocates the token and seat. Only offered while the booking is still `booked` —
 * checking in twice is a 409 the customer shouldn't have to see.
 */
export function AppointmentActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;
  const [error, setError] = useState("");

  if (status !== "booked") return null;

  async function act(action: "check-in" | "cancel" | "no-show") {
    setInFlight(true);
    setError("");
    try {
      const res = await fetch(`/api/appointments/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? t.common.thatDidntWork);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(t.appointments.networkError);
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act("check-in")}>
        {t.appointments.checkIn}
      </button>
      <button
        type="button"
        className="btn secondary btn-sm"
        disabled={busy}
        onClick={() => act("no-show")}
      >
        {t.appointments.noShow}
      </button>
      {error ? <span className="hint" role="alert">{error}</span> : null}
    </div>
  );
}
