import { describe, expect, it } from 'vitest';
import {
  addDays,
  datesBetween,
  hasDatesAfter,
  horizonDate,
  judgeDate,
  lastDate,
  nextDates,
  occurrenceAt,
  occurrenceStart,
  occurrenceIndex,
  firstDateAfter,
  isRuleDate,
  projectedBookings,
  ruleProblem,
  seriesWindowDays,
  storeDate,
  storeTime,
  totalVisits,
  type SeriesRule,
} from '../../src/lib/recurrence';
import type { SlotInput } from '../../src/lib/booking-slots';

/**
 * Recurring appointments — the pure date arithmetic (docs/recurring-appointments.md). No DB, no
 * env. The guarantee that matters most is the horizon: every series visit must exist before any
 * other customer can see its date on the booking page.
 */

const fortnightly: SeriesRule = { anchorDate: '2026-10-10', everyDays: 14, end: { type: 'never' } };
const LISA = 'lisa';
const JOHN = 'john';

describe('the horizon keeps a regular’s slot out of the public’s reach', () => {
  it('books up to today+20 for the 14-day public window', () => {
    expect(seriesWindowDays(14)).toBe(21);
    expect(horizonDate('2026-10-03', 14)).toBe('2026-10-23');
  });

  it('moves with the window — never a hard-coded 20', () => {
    expect(horizonDate('2026-10-03', 30)).toBe('2026-11-08'); // today + 36
  });

  it('creates each visit 7 days before the public can see its date (the plan’s worked example)', () => {
    // Booked Sat 3 Oct for Sat 10 Oct, every 2 weeks, never ends.
    const publicLastDay = (today: string) => addDays(today, 14 - 1);
    for (const date of ['2026-10-24', '2026-11-07', '2026-11-21']) {
      const createdOn = addDays(date, -20);
      const publicSeesOn = addDays(date, -13);
      // On the day it is created, the date is inside the job's horizon …
      expect(datesBetween(fortnightly, addDays(date, -1), horizonDate(createdOn, 14))).toEqual([date]);
      // … the day before, it was not yet …
      expect(datesBetween(fortnightly, addDays(date, -1), horizonDate(addDays(createdOn, -1), 14))).toEqual([]);
      // … and the public window only reaches it a week later.
      expect(publicLastDay(publicSeesOn)).toBe(date);
      expect(publicLastDay(addDays(publicSeesOn, -1)) < date).toBe(true);
    }
    expect(addDays('2026-10-24', -20)).toBe('2026-10-04');
    expect(addDays('2026-10-24', -13)).toBe('2026-10-11');
  });
});

describe('rule dates', () => {
  it('steps every N calendar days from the first visit', () => {
    expect(datesBetween(fortnightly, '2026-10-10', '2026-11-21')).toEqual(['2026-10-24', '2026-11-07', '2026-11-21']);
    expect(datesBetween(fortnightly, '2026-10-09', '2026-10-10')).toEqual(['2026-10-10']);
    expect(nextDates(fortnightly, '2026-10-10', 2)).toEqual(['2026-10-24', '2026-11-07']);
  });

  it('crosses month and year ends', () => {
    const r: SeriesRule = { anchorDate: '2026-12-20', everyDays: 18, end: { type: 'never' } };
    expect(nextDates(r, '2026-12-20', 2)).toEqual(['2027-01-07', '2027-01-25']);
  });

  it('"after X visits" counts the first visit and stops there', () => {
    const r: SeriesRule = { ...fortnightly, end: { type: 'count', count: 3 } };
    expect(occurrenceAt(r, 2)).toBe('2026-11-07');
    expect(occurrenceAt(r, 3)).toBeNull();
    expect(lastDate(r)).toBe('2026-11-07');
    expect(totalVisits(r)).toBe(3);
    expect(hasDatesAfter(r, '2026-10-24')).toBe(true);
    expect(hasDatesAfter(r, '2026-11-07')).toBe(false);
  });

  it('"on a date" includes that date and nothing after', () => {
    const r: SeriesRule = { anchorDate: '2026-10-10', everyDays: 18, end: { type: 'until', date: '2026-12-01' } };
    expect(datesBetween(r, '2026-10-09', '2027-12-31')).toEqual(['2026-10-10', '2026-10-28', '2026-11-15']);
    expect(lastDate(r)).toBe('2026-11-15');
    expect(totalVisits(r)).toBe(3);
  });

  it('a series that never ends has no last date', () => {
    expect(lastDate(fortnightly)).toBeNull();
    expect(totalVisits(fortnightly)).toBeNull();
    expect(hasDatesAfter(fortnightly, '2030-01-01')).toBe(true);
  });
});

describe('store-local time', () => {
  it('keeps 10:00 AM at 10:00 AM across a US daylight-saving change', () => {
    // US clocks go back on Sun 1 Nov 2026: 10:00 is 14:00Z before and 15:00Z after.
    expect(occurrenceStart('2026-10-31', '10:00', 'America/New_York').toISOString()).toBe('2026-10-31T14:00:00.000Z');
    expect(occurrenceStart('2026-11-07', '10:00', 'America/New_York').toISOString()).toBe('2026-11-07T15:00:00.000Z');
  });

  it('accepts Postgres’ HH:mm:ss and reads an instant back on the store’s clock', () => {
    const at = occurrenceStart('2026-10-10', '10:30:00', 'Asia/Kolkata');
    expect(at.toISOString()).toBe('2026-10-10T05:00:00.000Z');
    expect(storeTime(at, 'Asia/Kolkata')).toBe('10:30');
    // 00:30 in India is still the previous day in UTC — the store's date wins.
    expect(storeDate('2026-10-09T19:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-10');
  });
});

describe('ruleProblem — what a customer may ask for', () => {
  const today = '2026-10-03';
  it('accepts the client’s options', () => {
    for (const everyDays of [7, 14, 21, 28, 18, 90]) {
      expect(ruleProblem({ ...fortnightly, everyDays }, today)).toBeNull();
    }
    expect(ruleProblem({ ...fortnightly, end: { type: 'count', count: 26 } }, today)).toBeNull();
    expect(ruleProblem({ ...fortnightly, end: { type: 'until', date: '2027-10-03' } }, today)).toBeNull();
  });

  it('refuses intervals outside 7–90 days', () => {
    expect(ruleProblem({ ...fortnightly, everyDays: 6 }, today)).toMatch(/7 to 90/);
    expect(ruleProblem({ ...fortnightly, everyDays: 91 }, today)).toMatch(/7 to 90/);
    expect(ruleProblem({ ...fortnightly, everyDays: 14.5 }, today)).toMatch(/7 to 90/);
  });

  it('refuses a count outside 2–26', () => {
    expect(ruleProblem({ ...fortnightly, end: { type: 'count', count: 1 } }, today)).toMatch(/2 to 26/);
    expect(ruleProblem({ ...fortnightly, end: { type: 'count', count: 27 } }, today)).toMatch(/2 to 26/);
  });

  it('refuses an end more than a year out, or one that leaves no second visit', () => {
    expect(ruleProblem({ ...fortnightly, end: { type: 'until', date: '2027-10-05' } }, today)).toMatch(/one year/);
    expect(ruleProblem({ ...fortnightly, end: { type: 'until', date: '2026-10-23' } }, today)).toMatch(/two visits/);
    expect(ruleProblem({ ...fortnightly, end: { type: 'until', date: '2026-10-24' } }, today)).toBeNull();
  });
});

describe('judgeDate — the same rule public booking uses', () => {
  const base = (over: Partial<SlotInput> = {}): SlotInput => ({
    date: '2026-10-24',
    tz: 'Asia/Kolkata',
    hours: { opensAt: '10:00:00', closesAt: '20:00:00', isClosed: false },
    durationMin: 30,
    stepMin: 30,
    now: new Date('2026-10-04T00:00:00.000Z'),
    windowDays: seriesWindowDays(14),
    bookings: [],
    activeStaffIds: [LISA, JOHN],
    staffId: LISA,
    ...over,
  });
  const tenAm = '2026-10-24T04:30:00.000Z'; // 10:00 IST

  it('books a free time 20 days out — which the public window would refuse', () => {
    expect(judgeDate(base(), tenAm, { staffLocked: true })).toBe('ok');
    expect(judgeDate(base({ windowDays: 14 }), tenAm, { staffLocked: true })).toBe('outside_hours');
  });

  it('skips a closed day and anything already past', () => {
    expect(judgeDate(base({ hours: { opensAt: null, closesAt: null, isClosed: true } }), tenAm, { staffLocked: true })).toBe('closed');
    expect(judgeDate(base({ hours: null }), tenAm, { staffLocked: true })).toBe('closed');
    expect(judgeDate(base({ now: new Date('2026-10-24T05:00:00.000Z') }), tenAm, { staffLocked: true })).toBe('past');
  });

  it('tells a taken time from one the hours no longer allow', () => {
    const lisaBusy = { start: tenAm, end: '2026-10-24T05:00:00.000Z', staffId: LISA };
    expect(judgeDate(base({ bookings: [lisaBusy] }), tenAm, { staffLocked: true })).toBe('taken');
    // "Any stylist": John is free, so the same time still books.
    expect(judgeDate(base({ bookings: [lisaBusy], staffId: null }), tenAm, { staffLocked: false })).toBe('ok');
    expect(judgeDate(base({ hours: { opensAt: '12:00:00', closesAt: '20:00:00', isClosed: false } }), tenAm, { staffLocked: true })).toBe(
      'outside_hours',
    );
  });

  it('flags a chosen stylist who has left, instead of treating them as "any"', () => {
    expect(judgeDate(base({ activeStaffIds: [JOHN] }), tenAm, { staffLocked: true })).toBe('stylist_unavailable');
    expect(judgeDate(base({ staffId: null }), tenAm, { staffLocked: true })).toBe('stylist_unavailable');
  });
});

describe('Phase 2 — a change re-anchors the rule without losing a date', () => {
  it('from the change date on, the re-anchored rule has exactly the old dates — for every interval', () => {
    for (const everyDays of [7, 10, 14, 18, 21, 28, 45, 90]) {
      const old: SeriesRule = { anchorDate: '2026-10-03', everyDays, end: { type: 'never' } };
      for (const k of [1, 2, 5]) {
        const fromDate = occurrenceAt(old, k)!;
        expect(occurrenceIndex(old, fromDate)).toBe(k);
        const changed: SeriesRule = { ...old, anchorDate: fromDate, startIndex: k };
        expect(nextDates(changed, addDays(fromDate, -1), 8)).toEqual(nextDates(old, addDays(fromDate, -1), 8));
      }
    }
  });

  it('a count series still ends at its ORIGINAL total after a change (anchor_index)', () => {
    const old: SeriesRule = { anchorDate: '2026-10-03', everyDays: 14, end: { type: 'count', count: 6 } };
    const changed: SeriesRule = { ...old, anchorDate: occurrenceAt(old, 2)!, startIndex: 2 };
    expect(lastDate(changed)).toBe(lastDate(old));
    expect(totalVisits(changed)).toBe(6);
    expect(datesBetween(changed, '2026-01-01', '2027-12-31')).toEqual(datesBetween(old, occurrenceAt(old, 1)!, '2027-12-31'));
    // The very last date as the change point leaves exactly one.
    const last: SeriesRule = { ...old, anchorDate: occurrenceAt(old, 5)!, startIndex: 5 };
    expect(datesBetween(last, '2026-01-01', '2027-12-31')).toEqual([lastDate(old)]);
  });

  it('an "until" series counts its earlier visits too', () => {
    const old: SeriesRule = { anchorDate: '2026-10-10', everyDays: 18, end: { type: 'until', date: '2026-12-01' } };
    const changed: SeriesRule = { ...old, anchorDate: '2026-10-28', startIndex: 1 };
    expect(totalVisits(changed)).toBe(totalVisits(old));
  });

  it('knows which dates are the rule’s, and the next one after a cursor', () => {
    expect(isRuleDate(fortnightly, '2026-10-24')).toBe(true);
    expect(isRuleDate(fortnightly, '2026-10-25')).toBe(false);
    expect(isRuleDate(fortnightly, '2026-10-09')).toBe(false); // before the first visit
    expect(occurrenceIndex({ ...fortnightly, end: { type: 'count', count: 2 } }, '2026-11-07')).toBeNull(); // past the end
    expect(firstDateAfter(fortnightly, '2026-10-24')).toBe('2026-11-07');
    expect(firstDateAfter(fortnightly, '2026-10-23')).toBe('2026-10-24');
  });
});

describe('projectedBookings — a regular’s not-yet-booked date counts as taken for edits', () => {
  const base = {
    id: 's-1',
    status: 'active',
    rule: fortnightly,
    startTime: '10:00',
    generatedThrough: '2026-10-24',
    staffId: LISA,
    staffLocked: true,
    staffActive: true,
    minutes: 45,
  };
  const TZ = 'Asia/Kolkata';

  it('projects a rule date past the cursor, with the series’ own length and stylist', () => {
    const [p] = projectedBookings([base], '2026-11-07', TZ);
    expect(p.start.toISOString()).toBe('2026-11-07T04:30:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-07T05:15:00.000Z');
    expect(p.staffId).toBe(LISA);
  });

  it('leaves out dates already booked, non-rule dates, paused series and departed stylists', () => {
    expect(projectedBookings([base], '2026-10-24', TZ)).toEqual([]); // on the cursor: a real row exists
    expect(projectedBookings([base], '2026-11-08', TZ)).toEqual([]); // not a rule date
    expect(projectedBookings([{ ...base, status: 'paused' }], '2026-11-07', TZ)).toEqual([]);
    expect(projectedBookings([{ ...base, staffActive: false }], '2026-11-07', TZ)).toEqual([]);
    expect(projectedBookings([{ ...base, rule: { ...fortnightly, end: { type: 'count', count: 3 } } }], '2026-11-21', TZ)).toEqual([]);
  });

  it('keeps store-local time across a US daylight-saving change', () => {
    const us = { ...base, rule: { ...fortnightly, anchorDate: '2026-10-24' }, generatedThrough: '2026-10-24' };
    const [p] = projectedBookings([us], '2026-11-07', 'America/New_York');
    expect(p.start.toISOString()).toBe('2026-11-07T15:00:00.000Z'); // 10:00 EST
  });
});
