import { t, format } from "@/i18n";
import type { RepeatRule } from "@/lib/api";

/**
 * Wording and date arithmetic for repeating bookings (docs/recurring-appointments.md), shared by
 * the booking modal and the manage page so "every 2 weeks" reads the same on both.
 */

/** Bounds the API enforces (backend lib/recurrence.ts SERIES_LIMITS). Mirrored so the form can say
 *  what is wrong before a round trip; the server's own 400 message is still what wins. */
export const REPEAT_LIMITS = {
  minEveryDays: 7,
  maxEveryDays: 90,
  minCount: 2,
  maxCount: 26,
  maxEndDays: 365,
} as const;

/** The manage token's shape (backend SERIES_TOKEN_RE). Anything else can never open a booking. */
export const SERIES_TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;

/**
 * "every week" / "every 2 weeks" / "every 18 days". A multiple of 7 is said in weeks because that
 * is how people think of it — and only a multiple of 7 keeps landing on the same weekday.
 */
export function rhythmLabel(everyDays: number, title = false): string {
  const tpl = title ? t.microsite.repeat.rhythmTitle : t.microsite.repeat.rhythm;
  if (everyDays === 7) return tpl.week;
  if (everyDays % 7 === 0) return format(tpl.weeks, { n: everyDays / 7 });
  return format(tpl.days, { n: everyDays });
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a store-local calendar date ("YYYY-MM-DD") AS that date.
 *
 * Not `new Date("2026-10-10")`: that is UTC midnight, which a viewer west of UTC sees as the 9th,
 * and not a store-timezone conversion either — the value is already the store's date and has no
 * instant to convert. Noon UTC, formatted in UTC, cannot roll to a neighbouring day anywhere.
 */
export function formatYmd(
  ymd: string,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
): string {
  const m = YMD_RE.exec(ymd);
  if (!m) return ymd;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

/**
 * An instant on the STORE's clock — a regular in another zone (or travelling) must still read the
 * time the salon expects them. Falls back to the viewer's zone if the store's is missing/invalid.
 */
export function formatInZone(iso: string, tz: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(iso).toLocaleString(undefined, tz ? { ...opts, timeZone: tz } : opts);
  } catch {
    return new Date(iso).toLocaleString(undefined, opts);
  }
}

/** "10:00" (store clock, possibly "10:00:00") → "10:00 AM" in the viewer's locale, unshifted. */
export function formatTimeOfDay(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  return new Date(Date.UTC(2000, 0, 1, +m[1], +m[2])).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * `ymd` plus `n` calendar days, built from LOCAL date parts — never `toISOString()`, which is the
 * UTC day and would hand anyone east of UTC yesterday before dawn (CLAUDE.md §7).
 */
export function addDaysYmd(ymd: string, n: number): string {
  const m = YMD_RE.exec(ymd);
  if (!m) return ymd;
  const d = new Date(+m[1], +m[2] - 1, +m[3] + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * How many visits a rule makes, first included — null when it never ends. Mirrors the backend's
 * `totalVisits` (lib/recurrence.ts), where the visits are every `everyDays` from `anchorYmd`.
 */
export function ruleTotalVisits(rule: RepeatRule, anchorYmd: string): number | null {
  if (rule.end.type === "never") return null;
  if (rule.end.type === "count") return rule.end.count;
  const a = YMD_RE.exec(anchorYmd);
  const b = YMD_RE.exec(rule.end.date);
  if (!a || !b) return null;
  // Calendar days in UTC, which has no daylight saving to make a day 23 or 25 hours long.
  const days = Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000);
  return Math.floor(days / rule.everyDays) + 1;
}
