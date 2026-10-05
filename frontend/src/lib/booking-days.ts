import { t } from "@/i18n";

/**
 * Day-strip arithmetic shared by the booking modal (MicrositeClient) and the repeating-booking
 * picker (SlotPicker). Two builders on purpose, because they answer different questions:
 *
 *  - `viewerBookDays` — the booking modal's strip, from the VIEWER's clock. Unchanged behaviour,
 *    moved here from MicrositeClient so the two strips share one chip shape.
 *  - `storeDays` — the manage page's strip, from the API's `today` / `lastDay`. Those are already
 *    store-local dates, so no device clock or timezone is involved: a customer abroad still sees
 *    the salon's days (docs/recurring-appointments.md, Phase 2).
 */

/** One chip in a day strip. */
export interface DayChip {
  /** "YYYY-MM-DD". */
  ymd: string;
  /** The store never opens this weekday — shown greyed, not hidden, so the strip reads as a calendar. */
  closed: boolean;
  /** "Today" / "Tomorrow" / "Mon". */
  weekday: string;
  dayNum: number;
  /** "Oct". */
  month: string;
  /** "Mon, 5 Oct" — for labels and aria. */
  full: string;
}

/**
 * YYYY-MM-DD in the VIEWER's timezone.
 *
 * NOT `toISOString().slice(0, 10)`, which is the UTC date. A customer in IST opening the page at
 * 2am would have asked the API for *yesterday's* slots, been handed a day that had already
 * ended, and been told no appointments were available. Local date parts are what the shop and
 * the customer both mean by "today".
 */
export function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The booking modal's bookable days, starting today on the viewer's clock.
 *
 * Weekdays the store never opens are shown greyed rather than hidden, so the strip reads as a
 * calendar ("closed Sundays") instead of silently skipping a date the customer was looking for.
 * `hasHours` gates that the same way the walk-in controls are gated: a store that never
 * configured hours reports every day closed, and hiding every date would leave nothing to book.
 */
export function viewerBookDays(
  count: number,
  hours: { dayOfWeek: number; isClosed: boolean }[],
  hasHours: boolean,
): DayChip[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const closedDay = hours.find((h) => h.dayOfWeek === d.getDay())?.isClosed ?? false;
    return {
      ymd: localYmd(d),
      closed: hasHours && closedDay,
      weekday:
        i === 0
          ? t.microsite.join.dayToday
          : i === 1
            ? t.microsite.join.dayTomorrow
            : d.toLocaleDateString(undefined, { weekday: "short" }),
      dayNum: d.getDate(),
      month: d.toLocaleDateString(undefined, { month: "short" }),
      full: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
    };
  });
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date as a Date at noon UTC — formatted in UTC it can never roll to a neighbouring day. */
function ymdNoonUtc(ymd: string): Date | null {
  const m = YMD_RE.exec(ymd);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
}

/** Weekday (0 = Sunday, like `business_hour.day_of_week`) of a calendar date. */
export function weekdayOfYmd(ymd: string): number {
  return ymdNoonUtc(ymd)?.getUTCDay() ?? -1;
}

/**
 * The store-local days `from` … `to`, inclusive, as chips; "Today" / "Tomorrow" are relative to
 * `today` (the API's, never the device's). Calendar arithmetic in UTC, which has no daylight saving
 * to make a day 23 or 25 hours long. Capped as a guard against a bad range.
 */
export function storeDays(from: string, to: string, today: string, closedWeekdays: number[] = [], max = 62): DayChip[] {
  const start = ymdNoonUtc(from);
  const end = ymdNoonUtc(to);
  const todayAt = ymdNoonUtc(today)?.getTime() ?? NaN;
  if (!start || !end) return [];
  const out: DayChip[] = [];
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
  for (let i = 0, d = start; d.getTime() <= end.getTime() && i < max; i += 1, d = new Date(d.getTime() + 86_400_000)) {
    out.push({
      ymd: d.toISOString().slice(0, 10), // safe here: d is noon UTC on the store's calendar date
      closed: closedWeekdays.includes(d.getUTCDay()),
      weekday:
        d.getTime() === todayAt
          ? t.microsite.join.dayToday
          : d.getTime() === todayAt + 86_400_000
            ? t.microsite.join.dayTomorrow
            : fmt(d, { weekday: "short" }),
      dayNum: d.getUTCDate(),
      month: fmt(d, { month: "short" }),
      full: fmt(d, { weekday: "short", day: "numeric", month: "short" }),
    });
  }
  return out;
}

/** The store-local calendar date an instant falls on, "YYYY-MM-DD". Falls back to the viewer's zone. */
export function ymdInZone(iso: string, tz: string | null | undefined): string {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return localYmd(d);
  }
}
