"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { SubpageSwitch } from "@/components/SubpageSwitch";
import { showToast } from "@/lib/toast";
import "@/styles/settings-a.css";

type ApiRow = { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean };

/** One day as the editor holds it. Times are 24h `HH:MM`; only the labels are 12h. */
type Day = { dayOfWeek: number; open: boolean; from: string; to: string };

/** Sunday-first, indexed by the backend's `dayOfWeek` (0 = Sunday). */
const DAY_NAMES = t.hours.days;

/** Monday first, as on the app (`app/src/lib/hours.ts` DISPLAY_ORDER). */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** What a closed day opens with when it is switched on — the app's DEFAULT_FROM / DEFAULT_TO. */
const DEFAULT_FROM = "09:00";
const DEFAULT_TO = "21:00";

/** 06:00 … 23:30 in 30-minute steps — the app's TIME_OPTIONS, so both pickers offer the same list. */
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 23; h++) {
    for (const m of ["00", "30"]) out.push(`${String(h).padStart(2, "0")}:${m}`);
  }
  return out;
})();

const toHHMM = (v: string | null) => (v ? v.slice(0, 5) : "");

/** `HH:MM` → `9:00 AM`, the label the app shows. */
function label12(v: string): string {
  const [hStr, mStr = "00"] = v.split(":");
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return v;
  return `${((h + 11) % 12) + 1}:${mStr} ${h < 12 ? t.hours.am : t.hours.pm}`;
}

/**
 * API rows → the seven display rows, Monday first. A day with no row, or a row missing either
 * time, is CLOSED — the app's rule (`mapHours`). The web used to pre-fill a missing week as open
 * 9–6 Monday to Saturday; with saving on every change that would publish hours the owner never
 * chose the moment they touched any one day.
 */
function fromApi(rows: ApiRow[]): Day[] {
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  return DISPLAY_ORDER.map((dayOfWeek) => {
    const r = byDay.get(dayOfWeek);
    if (r && !r.isClosed && r.opensAt && r.closesAt) {
      return { dayOfWeek, open: true, from: toHHMM(r.opensAt), to: toHHMM(r.closesAt) };
    }
    return { dayOfWeek, open: false, from: DEFAULT_FROM, to: DEFAULT_TO };
  });
}

/** `PUT /business/hours` is a FULL REPLACE of the week, so every save sends all seven rows. */
function toApi(days: Day[]): ApiRow[] {
  return days.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    opensAt: d.open ? `${d.from}:00` : null,
    closesAt: d.open ? `${d.to}:00` : null,
    isClosed: !d.open,
  }));
}

/**
 * Weekly hours — the app's Working hours screen (`app/src/app/(app)/settings/hours.tsx`).
 *
 * Every change saves itself, as on the app; there is no Save button. Saves are SERIAL: an edit
 * made while one is in flight waits, and only the newest week is sent next. Each save replaces
 * the whole week, so two in flight at once could land out of order and leave the older week
 * standing. A failed save puts back the last week the server accepted and says why.
 */
export function HoursEditor({ hours, canEdit }: { hours: ApiRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [days, setDays] = useState<Day[]>(() => fromApi(hours));
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  /** The week the server last accepted — what a failed save rolls back to. */
  const confirmed = useRef<Day[]>(days);
  /** The newest week not yet sent. */
  const queued = useRef<Day[] | null>(null);
  const running = useRef(false);

  async function put(week: Day[]): Promise<string | null> {
    try {
      const res = await fetch("/api/business/hours", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: toApi(week) }),
      });
      if (res.ok) return null;
      const json = await res.json().catch(() => ({}));
      return json?.error?.message ?? t.hours.errSave;
    } catch {
      return t.hours.networkError;
    }
  }

  async function flush() {
    if (running.current) return;
    running.current = true;
    setStatus("saving");
    let failed = false;
    while (queued.current) {
      const week = queued.current;
      queued.current = null;
      const error = await put(week);
      if (error) {
        failed = true;
        // Anything queued behind a failure was built on the week that just failed.
        queued.current = null;
        setDays(confirmed.current);
        showToast(error, "error");
        break;
      }
      confirmed.current = week;
    }
    running.current = false;
    setStatus(failed ? "idle" : "saved");
    // Re-render the server tree so the cached business read (and the microsite's hours) agree.
    startTransition(() => router.refresh());
  }

  function update(dayOfWeek: number, patch: Partial<Day>) {
    if (!canEdit) return;
    const next = days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d));
    setDays(next);
    queued.current = next;
    void flush();
  }

  return (
    <>
      {canEdit ? null : <p className="sa-lead">{t.hours.readOnly}</p>}
      <div className="sa-card">
        {days.map((d) => {
          const name = DAY_NAMES[d.dayOfWeek];
          return (
            <div key={d.dayOfWeek} className="sa-hours-row">
              {/* Day and switch share a line; the times get their own below it on a phone. */}
              <div className="sa-hours-top">
                <span className="sa-hours-day">{name}</span>
                <SubpageSwitch
                  checked={d.open}
                  disabled={!canEdit}
                  label={format(t.hours.openLabel, { day: name })}
                  onChange={(open) => update(d.dayOfWeek, { open })}
                />
              </div>
              {d.open ? (
                <div className="sa-hours-times">
                  <TimeSelect
                    value={d.from}
                    label={format(t.hours.opensLabel, { day: name })}
                    disabled={!canEdit}
                    onChange={(from) => update(d.dayOfWeek, { from })}
                  />
                  <span className="sa-hours-sep" aria-hidden>
                    {t.hours.separator}
                  </span>
                  <TimeSelect
                    value={d.to}
                    label={format(t.hours.closesLabel, { day: name })}
                    disabled={!canEdit}
                    onChange={(to) => update(d.dayOfWeek, { to })}
                  />
                </div>
              ) : (
                <span className="sa-hours-closed">{t.hours.closed}</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="sa-footnote">{t.hours.note}</p>
      <p className="sa-status" role="status" aria-live="polite">
        {status === "saving" ? (
          <>
            <Spinner size={12} />
            {t.common.savingEllipsis}
          </>
        ) : status === "saved" ? (
          t.hours.saved
        ) : null}
      </p>
    </>
  );
}

/**
 * The app's TimeSelect chip. The native <select> lies invisibly over it, so a phone opens its own
 * picker and a keyboard can reach and change it.
 */
function TimeSelect({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  // A time saved off the half-hour grid (09:15, or a 05:00 opening set before this picker) stays
  // in the list. Without it the select would show the first option and the next save would
  // silently move the store's hours.
  const options = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [...TIME_OPTIONS, value].sort();
  return (
    <div className={`sa-time${disabled ? " is-disabled" : ""}`}>
      <span className="sa-time-value">{label12(value)}</span>
      {/* Wrapped: Icon sets an inline `color: currentColor`, which would beat a class on the svg. */}
      <span className="sa-time-chevron" aria-hidden>
        <Icon name="chevronDown" size={14} />
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {label12(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
