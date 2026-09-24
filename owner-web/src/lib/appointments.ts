import { t } from "@/i18n";

/**
 * Appointment rules shared by the Appointments screen and anything else that lists bookings.
 *
 * A plain module on purpose, not part of a `"use client"` file: the eligibility rule is read by
 * Server Components too, and a function exported from a client module arrives on the server as a
 * client reference that throws when called.
 */

/**
 * Only a booking still waiting to arrive can be checked into the queue. Once it is checked in,
 * finished, cancelled or a no-show, the row shows its status instead — the same rule as the app's
 * `AppointmentListItem` (`CHECK_IN_ELIGIBLE`), in the backend's words (`pending` is the app's
 * "upcoming").
 *
 * The web used to test for `"booked"`, a status the backend has never sent (see
 * backend/src/domain/enums.ts APPOINTMENT_STATUSES), so check-in was never offered anywhere on
 * the web. Keep this list to real enum values.
 */
export const CHECK_IN_ELIGIBLE: ReadonlySet<string> = new Set(["pending", "confirmed"]);

export function isCheckInEligible(status: string): boolean {
  return CHECK_IN_ELIGIBLE.has(status);
}

/** The store's clock when its settings can't be read (a staff login without `profile`). */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** A usable IANA zone: an unknown name throws in Intl, and a bad store setting must not 500 a page. */
export function safeTimeZone(zone: string | null | undefined): string {
  if (!zone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * "10:30 AM" on the store's clock.
 *
 * `lib/format`'s `formatTime` uses the process's zone, which is right in a browser and wrong in a
 * Server Component: Railway's clock is UTC, so a 10:30 booking in Mumbai rendered as 5:00 AM.
 */
export function appointmentTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return t.common.dash;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t.common.dash;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

/**
 * "Thursday, 24 September" on the store's clock — the app's Appointments subtitle
 * (`weekday: 'long', day: 'numeric', month: 'long'`). Assembled from parts so the day comes before
 * the month whatever Intl's en-US ordering is, as the app shows it.
 */
export function longDayLabel(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")}`;
}
