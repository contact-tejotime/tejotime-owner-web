import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * The one rule for "can this time be booked?" — used both to LIST times (GET /slots) and to
 * ACCEPT a booking (POST /appointments, re-run inside a per-store lock). Pure: no DB, no env.
 *
 * It exists because the two used to disagree. The list only hid a time whose *start* exactly
 * matched a booking, and the booking endpoint checked nothing at all, so QA (30 Sep 2026) booked
 * the same slot twice from two browsers, a 10:30 on top of a 10:00–11:30 Hair Color, and times in
 * the past, on a closed Sunday, at 11 PM, and six weeks out. Listing and accepting through the
 * same function is what keeps "offered" and "allowed" from drifting apart again.
 *
 * Capacity model (overlap-aware, not exact-start):
 *  - a store can serve as many overlapping bookings as it has active stylists (a store with no
 *    stylists runs one shared lane: capacity 1);
 *  - a named stylist additionally cannot hold two overlapping bookings;
 *  - bookings with no stylist ("no preference", owner bookings without a chair) still use up one
 *    unit of the store's capacity, so they can never be silently double-counted.
 */

export interface SlotBooking {
  start: Date | string;
  end: Date | string;
  staffId: string | null;
}

export interface SlotHours {
  /** 'HH:mm' or 'HH:mm:ss', store-local. */
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export interface SlotInput {
  /** YYYY-MM-DD, store-local. */
  date: string;
  tz: string;
  /** The store's hours for that weekday; null when the store has no row for it. */
  hours: SlotHours | null;
  durationMin: number;
  stepMin: number;
  now: Date;
  /** Bookable days from today, today included (14 → today … today+13). */
  windowDays: number;
  /** Pending/confirmed bookings that touch the day. */
  bookings: SlotBooking[];
  activeStaffIds: string[];
  /** A named stylist, or null/undefined/'any' for no preference. */
  staffId?: string | null;
}

export interface Slot {
  startAt: string;
  label: string;
}

export function computeSlots(i: SlotInput): Slot[] {
  const h = i.hours;
  if (!h || h.isClosed || !h.opensAt || !h.closesAt) return [];

  const today = dayjs(i.now).tz(i.tz).startOf('day');
  const day = dayjs.tz(i.date, i.tz).startOf('day');
  const dayIndex = day.diff(today, 'day');
  if (dayIndex < 0 || dayIndex >= i.windowDays) return [];

  const staffId = i.staffId && i.staffId !== 'any' ? i.staffId : null;
  // A stylist who is not (or no longer) active at this store has no times at all.
  if (staffId && !i.activeStaffIds.includes(staffId)) return [];

  const capacity = Math.max(1, i.activeStaffIds.length);
  const bookings = i.bookings.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
    staffId: b.staffId,
  }));

  const open = dayjs.tz(`${i.date} ${h.opensAt}`, i.tz);
  const close = dayjs.tz(`${i.date} ${h.closesAt}`, i.tz);
  const nowMs = i.now.getTime();
  const duration = Math.max(1, i.durationMin);
  const step = Math.max(1, i.stepMin);

  const slots: Slot[] = [];
  for (let cursor = open; !cursor.add(duration, 'minute').isAfter(close); cursor = cursor.add(step, 'minute')) {
    const s = cursor.valueOf();
    const e = cursor.add(duration, 'minute').valueOf();
    if (s <= nowMs) continue;
    const overlapping = bookings.filter((b) => b.start < e && s < b.end);
    if (overlapping.length >= capacity) continue;
    if (staffId && overlapping.some((b) => b.staffId === staffId)) continue;
    slots.push({ startAt: new Date(s).toISOString(), label: cursor.format('h:mm A') });
  }
  return slots;
}

/** True when `startIso` is one of the times computeSlots would offer for the same input. */
export function isBookable(i: SlotInput, startIso: string): boolean {
  const want = new Date(startIso).toISOString();
  return computeSlots(i).some((s) => s.startAt === want);
}
