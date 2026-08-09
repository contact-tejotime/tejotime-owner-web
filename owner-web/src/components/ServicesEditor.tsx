"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Icon } from "@/components/Icon";
import { formatMoney } from "@/lib/format";
import type { ServiceRow } from "@/lib/server-api";
import { Spinner } from "@/components/Skeleton";

/**
 * Service menu editor.
 *
 * Prices go over the wire as `priceAmount` in MINOR UNITS (paise) — the backend writes it
 * straight into `price_paise`. The form takes rupees, so it multiplies by 100 on the way out
 * and `formatMoney` divides on the way back.
 *
 * `colorToken` is required by the backend's strict create schema; "secondary" is the same
 * default the mobile app and the seed use.
 */
export function ServicesEditor({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [mins, setMins] = useState("30");
  const [rupees, setRupees] = useState("");
  const [error, setError] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  async function send(url: string, method: string, body?: unknown) {
    setError("");
    setInFlight(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "That didn't work.");
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setInFlight(false);
    }
  }

  async function add() {
    if (!name.trim()) return setError("Give the service a name.");
    const ok = await send("/api/services", "POST", {
      name: name.trim(),
      durationMinutes: Number(mins) || 30,
      priceAmount: Math.round((Number(rupees) || 0) * 100),
      colorToken: "secondary",
    });
    if (ok) {
      setName("");
      setRupees("");
      setMins("30");
    }
  }

  return (
    <div className="section">
      <h2>Current services</h2>
      {services.length === 0 ? (
        <p className="empty">No services yet. Add your first below.</p>
      ) : (
        <ul className="home-queue-list">
          {services.map((s) => (
            <li key={s.id} className="home-queue-card">
              <div className="title">{s.name}</div>
              <div className="meta">
                {s.durationMinutes} min · {formatMoney(s.price)}
              </div>
              <button
                type="button"
                className="btn secondary btn-sm"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={() => send(`/api/services/${s.id}`, "DELETE")}
              >
                <Icon name="trash" size={14} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 24 }}>Add a service</h2>
      <div className="field">
        <label htmlFor="sv-name">Name</label>
        <input id="sv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Haircut" />
      </div>
      <div className="field">
        <label htmlFor="sv-mins">Duration (minutes)</label>
        <input id="sv-mins" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="sv-price">Price (₹)</label>
        <input
          id="sv-price"
          inputMode="numeric"
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          placeholder="300"
        />
      </div>

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}

      <button type="button" className="btn" onClick={add} disabled={busy}>
        {busy ? (
          <>
            <Spinner size={14} />
            Saving…
          </>
        ) : (
          "Add service"
        )}
      </button>
    </div>
  );
}
