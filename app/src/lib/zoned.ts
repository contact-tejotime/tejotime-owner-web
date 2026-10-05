/**
 * The STORE's clock, not the phone's.
 *
 * Every appointment instant (a UTC timestamp from the API) used to be printed on the phone's own
 * timezone. An owner whose phone is set to another zone — travelling, or a store abroad — saw every
 * booking hours off, and the calendar put late-evening bookings on the wrong day. Owner-web has
 * always used the store's timezone (`GET /business` → `timezone`); `/auth/me` now carries it for
 * every role, so the app does too.
 *
 * `Intl.DateTimeFormat` with a `timeZone` does the conversion. Hermes ships Intl on both platforms,
 * but it is the native one underneath (Foundation on iOS, java.text/ICU on Android), so anything it
 * refuses — an unknown zone, a build without `formatToParts` — falls back to the phone's clock,
 * which is exactly what the app did before. Never worse than before, right whenever Intl works.
 *
 * The store's zone is module state rather than an argument threaded through every formatter: the
 * mappers run inside the store's loaders, which already know who is signed in, and there is only
 * ever one store per session. The store sets it from login, `/auth/me` and `GET /business`, before
 * any appointment is mapped, and clears it on sign-out.
 */

export interface ZonedParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** 0–23. */
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

let storeTimeZone: string | null = null;

/** Set by the store whenever it learns the signed-in store's IANA zone; null on sign-out. */
export function setStoreTimeZone(tz: string | null | undefined): void {
  storeTimeZone = tz && typeof tz === 'string' ? tz : null;
}

export function getStoreTimeZone(): string | null {
  return storeTimeZone;
}

/** One formatter per zone — building an Intl formatter is the expensive part. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (formatters.has(tz)) return formatters.get(tz)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    if (typeof f.formatToParts !== 'function') f = null;
  } catch {
    f = null; // unknown zone, or an Intl without timeZone support
  }
  formatters.set(tz, f);
  return f;
}

function deviceParts(d: Date): ZonedParts {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    weekday: d.getDay(),
  };
}

/**
 * The calendar parts of an instant on the store's clock (or `tz`, when given). Falls back to the
 * phone's clock when there is no zone yet or Intl cannot convert to it.
 */
export function zonedParts(value: string | Date, tz: string | null = storeTimeZone): ZonedParts {
  const d = value instanceof Date ? value : new Date(value);
  if (!tz || Number.isNaN(d.getTime())) return deviceParts(d);
  const f = formatterFor(tz);
  if (!f) return deviceParts(d);
  try {
    const parts: Record<string, number> = {};
    for (const p of f.formatToParts(d)) {
      if (p.type !== 'literal') parts[p.type] = Number(p.value);
    }
    const { year, month, day, minute } = parts;
    // Some engines print midnight as "24" with hour12:false.
    const hour = parts.hour === 24 ? 0 : parts.hour;
    if ([year, month, day, hour, minute].some((n) => n == null || !Number.isFinite(n))) return deviceParts(d);
    // The weekday from the calendar date itself, not from a localised weekday name.
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { year, month, day, hour, minute, weekday };
  } catch {
    return deviceParts(d);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of an instant on the store's calendar — the key the calendar groups bookings by. */
export function storeDayKey(value: string | Date): string {
  const p = zonedParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Today on the store's calendar. */
export function storeTodayKey(): string {
  return storeDayKey(new Date());
}

/**
 * An instant's store-local time, printed in the phone's own locale style ("10:00 AM", or "10:00"
 * on a 24-hour phone) — the hour and minute are the store's, the formatting is the owner's.
 */
export function storeTimeLabel(value: string | Date): string {
  const p = zonedParts(value);
  return new Date(2000, 0, 1, p.hour, p.minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A store-local "YYYY-MM-DD" as a Date at the phone's local noon — for locale date labels only. */
export function dayKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}
