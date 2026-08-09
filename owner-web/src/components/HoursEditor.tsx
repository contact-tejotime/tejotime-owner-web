"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Spinner } from "@/components/Skeleton";

type Row = { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `09:00:00` from Postgres → `09:00` for <input type="time">, and back. */
const toInput = (t: string | null) => (t ? t.slice(0, 5) : "");
const toApi = (t: string) => (t ? `${t}:00`.slice(0, 8) : null);

/**
 * Weekly hours.
 *
 * `PUT /business/hours` is a FULL REPLACE of all seven rows, so the editor always sends a
 * complete week — a business that has never set hours starts from a default rather than
 * submitting a partial set the backend would treat as "these are the only days".
 */
export function HoursEditor({ hours }: { hours: Row[] }) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: 7 }, (_, d) => {
      const found = hours.find((h) => h.dayOfWeek === d);
      return found ?? { dayOfWeek: d, opensAt: "09:00:00", closesAt: "18:00:00", isClosed: d === 0 };
    }),
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  function patch(day: number, next: Partial<Row>) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.dayOfWeek === day ? { ...r, ...next } : r)));
  }

  async function save() {
    setError("");
    setInFlight(true);
    try {
      const res = await fetch("/api/business/hours", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hours: rows.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            opensAt: r.isClosed ? null : toApi(toInput(r.opensAt)),
            closesAt: r.isClosed ? null : toApi(toInput(r.closesAt)),
            isClosed: r.isClosed,
          })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "Could not save your hours.");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div className="section">
      {rows.map((r) => (
        <div key={r.dayOfWeek} className="field">
          <label>{DAYS[r.dayOfWeek]}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
              <input
                type="checkbox"
                checked={r.isClosed}
                onChange={(e) => patch(r.dayOfWeek, { isClosed: e.target.checked })}
              />
              Closed
            </label>
            <input
              type="time"
              value={toInput(r.opensAt)}
              disabled={r.isClosed}
              onChange={(e) => patch(r.dayOfWeek, { opensAt: toApi(e.target.value) })}
            />
            <span>to</span>
            <input
              type="time"
              value={toInput(r.closesAt)}
              disabled={r.isClosed}
              onChange={(e) => patch(r.dayOfWeek, { closesAt: toApi(e.target.value) })}
            />
          </div>
        </div>
      ))}

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}
      {saved ? <p className="hint">Saved.</p> : null}

      <button type="button" className="btn" onClick={save} disabled={busy}>
        {busy ? (
          <>
            <Spinner size={14} />
            Saving…
          </>
        ) : (
          "Save hours"
        )}
      </button>
    </div>
  );
}
