import { describe, expect, it } from 'vitest';
import { computeSlots, isBookable, type SlotInput } from '../../src/lib/booking-slots';

/**
 * The single "can this time be booked?" rule shared by GET /slots and POST /appointments.
 * Each case below is a defect QA reproduced on 30 Sep 2026 against the old exact-start logic.
 * Clock frozen by passing `now` — no timers, no DB.
 */

const TZ = 'Asia/Kolkata';
const JOHN = 'st-john';
const LISA = 'st-lisa';
const MIKE = 'st-mike';
// Wed 30 Sep 2026, 16:30 IST.
const NOW = new Date('2026-09-30T11:00:00.000Z');
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

function input(over: Partial<SlotInput> = {}): SlotInput {
  return {
    date: '2026-10-05', // Monday
    tz: TZ,
    hours: { opensAt: '10:00:00', closesAt: '20:00:00', isClosed: false },
    durationMin: 30,
    stepMin: 30,
    now: NOW,
    windowDays: 14,
    bookings: [],
    activeStaffIds: [JOHN, LISA, MIKE],
    staffId: null,
    ...over,
  };
}
const labels = (i: SlotInput) => computeSlots(i).map((s) => s.label);

describe('computeSlots — grid and hours', () => {
  it('offers 10:00 AM … 7:30 PM for a 30-minute visit on an open Monday', () => {
    const l = labels(input());
    expect(l[0]).toBe('10:00 AM');
    expect(l.at(-1)).toBe('7:30 PM');
    expect(l).toHaveLength(20);
  });

  it('the last start leaves room for the whole visit (120 min → 6:00 PM)', () => {
    expect(labels(input({ durationMin: 120 })).at(-1)).toBe('6:00 PM');
  });

  it('a closed day, a missing hours row, or missing times offer nothing', () => {
    expect(computeSlots(input({ hours: { opensAt: '10:00', closesAt: '20:00', isClosed: true } }))).toEqual([]);
    expect(computeSlots(input({ hours: null }))).toEqual([]);
    expect(computeSlots(input({ hours: { opensAt: null, closesAt: null, isClosed: false } }))).toEqual([]);
  });

  it('times already passed today are not offered', () => {
    const l = labels(input({ date: '2026-09-30' }));
    expect(l[0]).toBe('5:00 PM'); // 16:30 now → first future start
  });
});

describe('computeSlots — booking window', () => {
  it('yesterday offers nothing', () => {
    expect(computeSlots(input({ date: '2026-09-29' }))).toEqual([]);
  });
  it('day 13 (Tue 13 Oct) is bookable, day 14 (Wed 14 Oct) is not', () => {
    expect(computeSlots(input({ date: '2026-10-13' })).length).toBeGreaterThan(0);
    expect(computeSlots(input({ date: '2026-10-14' }))).toEqual([]);
  });
  it('six weeks out (QA booked 30 Nov) offers nothing', () => {
    expect(computeSlots(input({ date: '2026-11-30' }))).toEqual([]);
  });
});

describe('computeSlots — overlap and capacity', () => {
  it('a 90-min booking at 10:00 blocks that stylist until 11:30 (QA: 10:30 was bookable)', () => {
    const bookings = [{ start: ist('2026-10-05', '10:00'), end: ist('2026-10-05', '11:30'), staffId: LISA }];
    const lisa = labels(input({ bookings, staffId: LISA }));
    expect(lisa).not.toContain('10:00 AM');
    expect(lisa).not.toContain('10:30 AM');
    expect(lisa).not.toContain('11:00 AM');
    expect(lisa).toContain('11:30 AM');
    // Another stylist is unaffected.
    expect(labels(input({ bookings, staffId: JOHN }))).toContain('10:30 AM');
  });

  it('"No preference" keeps a time while any stylist is free (QA: one booking hid it for all)', () => {
    const bookings = [{ start: ist('2026-10-05', '13:00'), end: ist('2026-10-05', '13:30'), staffId: JOHN }];
    expect(labels(input({ bookings }))).toContain('1:00 PM');
  });

  it('"No preference" is full only when every stylist is taken', () => {
    const at = (s: string | null) => ({ start: ist('2026-10-05', '13:00'), end: ist('2026-10-05', '13:30'), staffId: s });
    expect(labels(input({ bookings: [at(JOHN), at(LISA), at(MIKE)] }))).not.toContain('1:00 PM');
  });

  it('a booking with no stylist still uses one unit of capacity', () => {
    const at = (s: string | null) => ({ start: ist('2026-10-05', '13:00'), end: ist('2026-10-05', '13:30'), staffId: s });
    const bookings = [at(JOHN), at(LISA), at(null)];
    // Mike looks free, but the stylist-less booking needs him — so he cannot take a second one.
    expect(labels(input({ bookings, staffId: MIKE }))).not.toContain('1:00 PM');
  });

  it('a store with no stylists runs one lane (capacity 1)', () => {
    const bookings = [{ start: ist('2026-10-05', '12:00'), end: ist('2026-10-05', '12:30'), staffId: null }];
    const l = labels(input({ activeStaffIds: [], bookings }));
    expect(l).not.toContain('12:00 PM');
    expect(l).toContain('12:30 PM');
  });

  it('an inactive or foreign stylist has no times at all', () => {
    expect(computeSlots(input({ staffId: 'st-from-another-store' }))).toEqual([]);
  });
});

describe('isBookable — the booking endpoint check', () => {
  it('accepts an offered time and rejects taken, off-grid, past, closed and out-of-hours times', () => {
    const bookings = [{ start: ist('2026-10-05', '11:00'), end: ist('2026-10-05', '11:30'), staffId: LISA }];
    const i = input({ bookings, staffId: LISA });
    expect(isBookable(i, ist('2026-10-05', '11:30'))).toBe(true);
    expect(isBookable(i, ist('2026-10-05', '11:00'))).toBe(false); // taken
    expect(isBookable(i, ist('2026-10-05', '11:15'))).toBe(false); // off the 30-min grid
    expect(isBookable(input({ date: '2026-09-29' }), ist('2026-09-29', '11:00'))).toBe(false); // past
    expect(isBookable(input({ date: '2026-10-04', hours: { opensAt: '10:00', closesAt: '20:00', isClosed: true } }), ist('2026-10-04', '12:00'))).toBe(false); // Sunday closed
    expect(isBookable(input(), ist('2026-10-05', '23:00'))).toBe(false); // 11 PM
  });
});
