"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/Button";
import type { Slot } from "@/lib/api";
import { storeDays } from "@/lib/booking-days";
import { t, format } from "@/i18n";

/**
 * Pick a free time for a repeating booking (docs/recurring-appointments.md, Phase 2): a strip of
 * the STORE's days, optional stylist chips, and the day's free times.
 *
 * The days come from the API's `today` / `lastDay` and every time from a slots endpoint, already
 * on the store's clock — this component never reads the device clock or builds an instant, so a
 * customer travelling (or with a wrong phone clock) still picks the salon's times.
 *
 * The booking modal keeps its own strip this phase (lowest risk); both build their chips from
 * lib/booking-days.ts.
 */

const P = t.microsite.slotPicker;

export interface PickedSlot {
  startAt: string;
  /** The slot's own label ("10:30 AM"), already in the store's zone. */
  label: string;
  /** The store-local day it is on. */
  date: string;
  /** The stylist the times were loaded for: "any", an id, or undefined (keep the current one). */
  staffId: string | undefined;
}

const fieldLabel: CSSProperties = {
  font: "var(--fw-bold) 12px/1 var(--font-sans)",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: "0 0 9px",
};
const chip = (on: boolean): CSSProperties => ({
  cursor: "pointer",
  font: "var(--fw-semibold) 13px/1 var(--font-sans)",
  padding: "8px 13px",
  borderRadius: "calc(10px * var(--radius-scale, 1))",
  transition: "all .15s ease",
  ...(on
    ? { background: "var(--primary)", color: "var(--text-on-brand, #fff)", border: "1.5px solid var(--primary)" }
    : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }),
});
const note: CSSProperties = { font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: 0 };

export default function SlotPicker({
  today,
  lastDay,
  initialDate,
  showDays = true,
  closedWeekdays = [],
  staffOptions,
  staffId,
  currentStaffId,
  load,
  value,
  onChange,
  refreshKey = 0,
}: {
  /** Store-local range from the API ("YYYY-MM-DD"), both ends included. */
  today: string;
  lastDay: string;
  /** The day shown first; pulled into range if it falls outside it. */
  initialDate: string;
  /** False pins the picker to `initialDate` (a change's new time must be on its first date). */
  showDays?: boolean;
  /** Weekdays the store never opens — greyed in the strip. */
  closedWeekdays?: number[];
  /** Show "Any stylist" + these as chips; omit to hide them and load for `staffId` as given. */
  staffOptions?: { id: string; name: string }[];
  /** With chips: the stylist chosen first ("any" or an id). Without: the stylist to load for. */
  staffId?: string;
  /** Which chip is the current stylist ("any" or an id) — it gets a "(current)" label. */
  currentStaffId?: string | null;
  /** Load one day's free times. Must be stable (useCallback): it is an effect dependency. */
  load: (date: string, staffId: string | undefined) => Promise<Slot[]>;
  /** The chosen slot's `startAt`, or null. */
  value: string | null;
  /** A day or stylist change clears the choice (its times no longer apply), so this gets null then. */
  onChange: (pick: PickedSlot | null) => void;
  /** Bump to reload the current day — e.g. after the API said the chosen time was just taken. */
  refreshKey?: number;
}) {
  const clamp = (d: string) => (d < today ? today : d > lastDay ? lastDay : d);
  const [date, setDate] = useState(() => clamp(initialDate));
  const [pickedStaff, setPickedStaff] = useState<string>(() => staffId ?? "any");
  const [retry, setRetry] = useState(0);
  const effectiveStaff = staffOptions ? pickedStaff : staffId;

  const days = useMemo(() => storeDays(today, lastDay, today, closedWeekdays), [today, lastDay, closedWeekdays]);
  const day = days.find((d) => d.ymd === date);

  // Tagged answers: only the answer for the request on screen is shown, so a slow response for a
  // day the customer has already tapped past can never paint over the current one.
  const requestKey = `${date}|${effectiveStaff ?? ""}|${refreshKey}|${retry}`;
  const [result, setResult] = useState<{ key: string; slots: Slot[]; error: boolean } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    load(date, effectiveStaff)
      .then((slots) => {
        if (seq.current === mine) setResult({ key: requestKey, slots, error: false });
      })
      .catch(() => {
        if (seq.current === mine) setResult({ key: requestKey, slots: [], error: true });
      });
  }, [requestKey, load, date, effectiveStaff]);
  const current = result?.key === requestKey ? result : null;

  // Bring the chosen day into view once — a conflict three weeks out would otherwise sit off-screen.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const on = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip && on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2;
    // Mount only: later taps are already in view.
  }, []);

  const pickDay = (ymd: string) => {
    if (ymd === date) return;
    setDate(ymd);
    onChange(null);
  };
  const pickStaff = (id: string) => {
    if (id === pickedStaff) return;
    setPickedStaff(id);
    onChange(null);
  };

  return (
    <div>
      {staffOptions && (
        <div style={{ marginBottom: 14 }}>
          <div style={fieldLabel}>{P.stylist}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[{ id: "any", name: P.anyStylist }, ...staffOptions].map((c) => (
              <button key={c.id} type="button" aria-pressed={pickedStaff === c.id} onClick={() => pickStaff(c.id)} style={{ ...chip(pickedStaff === c.id), borderRadius: 999 }}>
                {c.id === currentStaffId ? format(t.microsite.series.currentStylist, { name: c.name }) : c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showDays && (
        <div
          ref={stripRef}
          style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 12, scrollbarWidth: "thin", WebkitOverflowScrolling: "touch" }}
        >
          {days.map((d) => {
            const on = d.ymd === date;
            return (
              <button
                key={d.ymd}
                type="button"
                disabled={d.closed}
                aria-pressed={on}
                aria-label={d.closed ? `${d.full} — ${t.microsite.join.dayClosed}` : d.full}
                onClick={() => pickDay(d.ymd)}
                style={{
                  flex: "0 0 auto",
                  minWidth: 58,
                  padding: "7px 9px",
                  textAlign: "center",
                  borderRadius: "calc(10px * var(--radius-scale, 1))",
                  fontFamily: "var(--font-sans)",
                  cursor: d.closed ? "not-allowed" : "pointer",
                  opacity: d.closed ? 0.4 : 1,
                  transition: "all .15s ease",
                  ...(on
                    ? { background: "var(--primary)", color: "var(--text-on-brand, #fff)", border: "1.5px solid var(--primary)" }
                    : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }),
                }}
              >
                <span style={{ display: "block", font: "var(--fw-semibold) 11px/1.3 var(--font-sans)", opacity: 0.85 }}>{d.weekday}</span>
                <span style={{ display: "block", font: "var(--fw-bold) 15px/1.25 var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>{d.dayNum}</span>
                <span style={{ display: "block", font: "var(--fw-medium) 10.5px/1.3 var(--font-sans)", opacity: 0.75 }}>
                  {d.closed ? t.microsite.join.dayClosed : d.month}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!current ? (
        <p aria-live="polite" style={note}>
          {P.loading}
        </p>
      ) : current.error ? (
        <div>
          <p style={{ ...note, marginBottom: 8 }}>{P.error}</p>
          <Button variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
            {P.retry}
          </Button>
        </div>
      ) : current.slots.length === 0 ? (
        <p style={note}>{format(day?.closed ? P.closedDay : P.empty, { date: day?.full ?? date })}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {current.slots.map((s) => (
            <button
              key={s.startAt}
              type="button"
              aria-pressed={value === s.startAt}
              onClick={() => onChange({ startAt: s.startAt, label: s.label, date, staffId: effectiveStaff })}
              style={chip(value === s.startAt)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
