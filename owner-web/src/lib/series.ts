import { t, format } from "@/i18n";

import { appointmentTime } from "./appointments";
import type {
  AppointmentRow,
  SeriesIssueReason,
  SeriesPauseReason,
  SeriesRow,
  SeriesStatus,
} from "./server-api";

/**
 * Words for a repeating booking (docs/recurring-appointments.md), shared by the Regulars list, the
 * Needs attention card and the series sheet.
 *
 * A plain module, like lib/appointments.ts: Server Components format the lists, the sheet formats
 * on the client, and a function exported from a `"use client"` file would reach the server as a
 * client reference that throws when called.
 *
 * The app (app/, iOS + Android) words these from the same spec — keep the two in step.
 */

/** "Every week", "Every 2 weeks", … for whole weeks; "Every 18 days" otherwise. */
export function everyLabel(everyDays: number): string {
  if (everyDays % 7 === 0) {
    const weeks = everyDays / 7;
    return weeks === 1 ? t.series.everyWeek : format(t.series.everyWeeks, { n: weeks });
  }
  return format(t.series.everyDays, { n: everyDays });
}

/** A store-local "HH:mm" as "10:00 AM". The series stores a wall time, never an instant. */
export function clockLabel(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? t.hours.am : t.hours.pm}`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: part("weekday"), day: part("day"), month: part("month"), year: part("year") };
}

function currentYear(zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(new Date());
}

/**
 * "Sat 24 Oct" — the booking page's own wording for series dates — with the year added only when
 * it is not this year in the store, since an "Until" date can sit up to a year out.
 */
function joinDay(p: ReturnType<typeof dateParts>, zone: string): string {
  const base = `${p.weekday} ${p.day} ${p.month}`;
  return p.year && p.year !== currentYear(zone) ? `${base} ${p.year}` : base;
}

/**
 * A store-local "YYYY-MM-DD" (a rule date). Read as a UTC calendar date so neither the server's
 * clock nor the viewer's can shift it a day.
 */
export function dateLabel(ymd: string, zone: string): string {
  const m = DATE_ONLY.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return joinDay(dateParts(d, "UTC"), zone);
}

/** An instant as "Sat 24 Oct, 10:00 AM" on the store's clock. */
export function whenLabel(iso: string | null | undefined, zone: string): string {
  if (!iso) return t.common.dash;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t.common.dash;
  return `${joinDay(dateParts(d, zone), zone)}, ${appointmentTime(iso, zone)}`;
}

/**
 * "Every 2 weeks · Sat 10:00 AM". The weekday only for whole weeks: every 18 days lands on a
 * different weekday each time, so naming the first one would mislead.
 */
export function rhythmLabel(s: Pick<SeriesRow, "everyDays" | "anchorDate" | "startTime">): string {
  const time = clockLabel(s.startTime);
  if (s.everyDays % 7 !== 0) return `${everyLabel(s.everyDays)} · ${time}`;
  const m = DATE_ONLY.exec(s.anchorDate);
  const weekday = m
    ? dateParts(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), "UTC").weekday
    : "";
  return `${everyLabel(s.everyDays)} · ${weekday ? `${weekday} ` : ""}${time}`;
}

/** "Until cancelled" / "6 visits · last on Sat 19 Dec" / "Until Sat 3 Oct 2027". */
export function endLabel(s: Pick<SeriesRow, "end" | "lastDate">, zone: string): string {
  switch (s.end.type) {
    case "count":
      return format(t.series.endCount, {
        n: s.end.count,
        date: s.lastDate ? dateLabel(s.lastDate, zone) : t.common.dash,
      });
    case "until":
      return format(t.series.endUntil, { date: dateLabel(s.end.date, zone) });
    default:
      return t.series.untilCancelled;
  }
}

/**
 * The stylist, or "Any stylist". A series whose chosen stylist has since left (`staffLocked` with
 * no name) is NOT "any stylist" — it is paused waiting for the owner to pick someone — so it says so.
 */
export function stylistLabel(s: Pick<SeriesRow, "staffName" | "staffLocked">): string {
  if (s.staffName) return s.staffName;
  return s.staffLocked ? t.series.reason.stylist_unavailable : t.series.anyStylist;
}

/** "Next: Sat 24 Oct, 10:00 AM", or "No visit booked yet". */
export function nextLabel(s: Pick<SeriesRow, "nextVisitAt">, zone: string): string {
  return s.nextVisitAt ? format(t.series.next, { when: whenLabel(s.nextVisitAt, zone) }) : t.series.noVisitBooked;
}

export function seriesStatusLabel(status: SeriesStatus): string {
  return t.series.status[status] ?? status;
}

/** The paused line. A null reason (a row paused before reasons existed) still reads "Paused". */
export function pauseLabel(reason: SeriesPauseReason | null): string {
  return reason ? (t.series.pauseReason[reason] ?? t.series.status.paused) : t.series.status.paused;
}

export function issueReasonLabel(reason: SeriesIssueReason): string {
  return t.series.reason[reason] ?? reason;
}

/**
 * The status a visit row shows: a series visit that was skipped is `cancelled` with
 * `cancelReason: "skipped"`, and reads "Skipped" — the owner did not cancel anything.
 */
export function visitStatusKey(a: Pick<AppointmentRow, "status" | "cancelReason">): string {
  return a.status === "cancelled" && a.cancelReason === "skipped" ? "skipped" : a.status;
}

/**
 * A series visit that can still be skipped — the API's own rule (`skipVisitRow`): still booked
 * (pending / confirmed) and not started yet. `now` is passed in so a page reads the clock once.
 */
export function isSkippable(a: AppointmentRow, now: number): boolean {
  return (
    !!a.seriesId &&
    (a.status === "pending" || a.status === "confirmed") &&
    Date.parse(a.scheduledStartAt) > now
  );
}

/**
 * A one-off booking that can still be cancelled from its row — the app's rule for the row action
 * (app/src/components/appointments/AppointmentListItem.tsx): before the booking's time, a series
 * visit gets Skip and anything else gets Cancel; once the time has passed it is a no-show instead.
 * Still booked (pending / confirmed) only — the same statuses the row offers "Add to queue" for.
 */
export function isCancellable(a: AppointmentRow, now: number): boolean {
  return (
    !a.seriesId &&
    (a.status === "pending" || a.status === "confirmed") &&
    Date.parse(a.scheduledStartAt) > now
  );
}

/**
 * A booking the owner can move from its row (Phase 2): still booked and not started yet — the same
 * "before its time" the row uses for Skip and Cancel. The API also allows an earlier booking of
 * the store's today; the row does not offer that, because once its time has passed the row's job
 * is the no-show, as on the app.
 */
export function isReschedulable(a: AppointmentRow, now: number): boolean {
  return (a.status === "pending" || a.status === "confirmed") && Date.parse(a.scheduledStartAt) > now;
}

/** The store-local "YYYY-MM-DD" an instant falls on. */
export function zonedYmd(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 0 = Sunday … 6 = Saturday for a store-local "YYYY-MM-DD" (business_hour.day_of_week). */
export function weekdayOf(ymd: string): number {
  const m = DATE_ONLY.exec(ymd);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : -1;
}

/**
 * Weekdays the store is shut (0 = Sunday), from its hours — so an empty day in a picker can say
 * "Closed this day" rather than "No free times". Empty when the hours could not be read.
 */
export function closedWeekdays(
  hours: { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean }[] | null | undefined,
): number[] {
  if (!hours?.length) return [];
  const open = new Set(hours.filter((h) => !h.isClosed && h.opensAt && h.closesAt).map((h) => h.dayOfWeek));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d));
}

/**
 * Everything a time picker needs to know about the store, handed down from the page once.
 *
 * - `staff`: the stylists a booking may be moved to — a staff login gets only its own chair,
 *   because the API refuses to move a booking to anyone else's (403).
 * - `allowAny`: "Any stylist" — off for a staff login for the same reason.
 * - `closedDays`: weekdays the store is shut (from its hours), so an empty day can say "Closed
 *   this day" rather than "No free times". Empty when the hours could not be read — every empty
 *   day then just says there are no free times.
 */
export interface PickerContext {
  zone: string;
  staff: { id: string; name: string; colorToken: string }[];
  allowAny: boolean;
  closedDays: number[];
}

/**
 * A dialable `tel:` link. Stored numbers carry their country code with or without the "+" (two
 * historical writers; CLAUDE.md §6), and "9198…" without it dials as a local number — so a
 * number longer than a national one gets the "+" back. Nothing is texted to the customer for a
 * skip, pause or cancel (decided with the client), which is why every series surface has Call.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const dial = phone.replace(/[^\d+]/g, "");
  if (!dial) return null;
  if (dial.startsWith("+")) return `tel:${dial}`;
  return `tel:${dial.length > 10 ? "+" : ""}${dial}`;
}
