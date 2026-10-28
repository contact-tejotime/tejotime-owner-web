import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/lib/recurrence';
import {
  DUE_RULES,
  compareDue,
  dueTiming,
  followupHides,
  rhythmOf,
  type DueSortable,
  type Rhythm,
} from '../../src/lib/due-back';

/**
 * "Due to come back" — the pure rules (docs/customer-due-list.md). No DB, no env. The owner's
 * request this pins: a regular is someone whose gaps sit inside a band ("15 to 25 days"), not on
 * one exact number.
 */

/** Visit days starting at `start`, each next one `gap` days after the last. */
function visits(start: string, ...gaps: number[]): string[] {
  const out = [start];
  for (const g of gaps) out.push(addDays(out[out.length - 1], g));
  return out;
}

describe('rhythmOf — who is a regular', () => {
  it.each([
    { gaps: [18, 23, 20], usual: 20, band: [15, 25], regular: true },
    { gaps: [15, 25], usual: 20, band: [15, 25], regular: true },
    { gaps: [20, 21, 45], usual: 21, band: [16, 26], regular: true }, // 45 is the one forgiven outlier
    { gaps: [10, 40, 22], usual: 22, band: [17, 27], regular: false }, // two outside
    { gaps: [14, 26], usual: 20, band: [15, 25], regular: false }, // two gaps: nothing is forgiven
  ])('gaps $gaps → regular: $regular', ({ gaps, usual, band, regular }) => {
    const r = rhythmOf(visits('2026-06-01', ...gaps));
    if (!regular) {
      expect(r).toBeNull();
      return;
    }
    expect(r).not.toBeNull();
    expect(r!.usualDays).toBe(usual);
    expect([r!.bandMin, r!.bandMax]).toEqual(band);
  });

  it('needs three visit days', () => {
    expect(rhythmOf([])).toBeNull();
    expect(rhythmOf(visits('2026-06-01', 20))).toBeNull();
    expect(rhythmOf(visits('2026-06-01', 20, 20))).toMatchObject({ usualDays: 20, outlierForgiven: false });
  });

  it('counts two visits on one day as one, and does not care about input order', () => {
    const days = visits('2026-06-01', 20, 20);
    expect(rhythmOf([days[2], days[0], days[1], days[1]])).toMatchObject({ usualDays: 20, gaps: [20, 20] });
    // Same-day duplicates only: still two visit days, not a regular.
    expect(rhythmOf(['2026-06-01', '2026-06-01', '2026-06-21'])).toBeNull();
  });

  it('judges only the recent gaps — one long gap years ago does not rule out a regular', () => {
    const r = rhythmOf(visits('2025-01-01', 120, 20, 20, 20, 20, 20));
    expect(r).toMatchObject({ usualDays: 20, gaps: [20, 20, 20, 20, 20], outlierForgiven: false });
  });

  it('forgives one outlier with three gaps, but not two', () => {
    expect(rhythmOf(visits('2026-01-01', 20, 20, 60))).toMatchObject({ outlierForgiven: true });
    // Median 60 → band 45–75: 20 and 100 both fall outside.
    expect(rhythmOf(visits('2026-01-01', 20, 60, 100))).toBeNull();
  });

  it('rounds a half-day median up and keeps both band edges inclusive', () => {
    expect(rhythmOf(visits('2026-06-01', 20, 21))).toMatchObject({ usualDays: 21, bandMin: 16, bandMax: 26 });
    // 15 and 26 → median 20.5 → 21, band 16–26: 15 is outside, two gaps, so not a regular.
    expect(rhythmOf(visits('2026-06-01', 15, 26))).toBeNull();
    // usual 20: 25 inside, 26 outside.
    expect(rhythmOf(visits('2026-06-01', 20, 20, 25))).toMatchObject({ outlierForgiven: false });
    expect(rhythmOf(visits('2026-06-01', 20, 20, 26))).toMatchObject({ outlierForgiven: true });
  });

  it('never narrows the band below ±3 days', () => {
    expect(rhythmOf(visits('2026-06-01', 8, 8))).toMatchObject({ usualDays: 8, bandMin: 5, bandMax: 11 });
    expect(rhythmOf(visits('2026-06-01', 13, 13))).toMatchObject({ usualDays: 13, bandMin: 10, bandMax: 16 });
    expect(rhythmOf(visits('2026-06-01', 40, 40))).toMatchObject({ usualDays: 40, bandMin: 30, bandMax: 50 });
  });

  it(`leaves out rhythms shorter than ${DUE_RULES.minUsualDays} days`, () => {
    expect(rhythmOf(visits('2026-06-01', 6, 6, 6))).toBeNull();
    expect(rhythmOf(visits('2026-06-01', 7, 7, 7))).toMatchObject({ usualDays: 7, bandMin: 4, bandMax: 10 });
  });

  it('works across month and year ends', () => {
    expect(rhythmOf(['2025-12-12', '2026-01-01', '2026-01-21'])).toMatchObject({
      usualDays: 20,
      lastVisit: '2026-01-21',
    });
  });
});

describe('dueTiming — when the customer is listed', () => {
  // Last visit 1 Oct, usual 20, band 15–25: expected 21 Oct, listed from 19 Oct, overdue from
  // 27 Oct, not back for a while from 11 Nov.
  const r = rhythmOf(visits('2026-08-22', 20, 20))!;

  it('has the expected rhythm under test', () => {
    expect(r).toMatchObject({ lastVisit: '2026-10-01', usualDays: 20, bandMin: 15, bandMax: 25 });
  });

  it.each([
    ['2026-10-18', null],
    ['2026-10-19', 'due_soon'],
    ['2026-10-21', 'due_soon'],
    ['2026-10-26', 'due_soon'],
    ['2026-10-27', 'overdue'],
    ['2026-11-10', 'overdue'],
    ['2026-11-11', 'lapsed'],
    [addDays('2026-10-01', 180), 'lapsed'],
    [addDays('2026-10-01', 181), null],
  ])('on %s → %s', (today, status) => {
    const t = dueTiming(r, today);
    expect(t?.status ?? null).toBe(status);
  });

  it('reports the dates the screens print', () => {
    expect(dueTiming(r, '2026-10-20')).toEqual({
      status: 'due_soon',
      expectedDate: '2026-10-21',
      callFrom: '2026-10-19',
      overdueAfter: '2026-10-26',
      lapsedAfter: '2026-11-10',
      daysSinceLast: 19,
    });
  });
});

describe('followupHides — logged call outcomes', () => {
  const last = '2026-10-01';

  it('shows a customer with no outcome', () => {
    expect(followupHides(null, last, '2026-10-20')).toBeNull();
  });

  it('hides a snooze until its day, which shows them again', () => {
    const f = { outcome: 'no_answer' as const, snoozeUntil: '2026-10-21', aboutLastVisit: last };
    expect(followupHides(f, last, '2026-10-20')).toBe('snoozed');
    expect(followupHides(f, last, '2026-10-21')).toBeNull();
    const later = { outcome: 'call_later' as const, snoozeUntil: '2026-11-02', aboutLastVisit: last };
    expect(followupHides(later, last, '2026-11-01')).toBe('snoozed');
  });

  it('drops a snooze once a newer visit exists — a fresh cycle', () => {
    const f = { outcome: 'call_later' as const, snoozeUntil: '2026-11-30', aboutLastVisit: last };
    expect(followupHides(f, '2026-10-22', '2026-11-10')).toBeNull();
  });

  it('keeps "not interested" through a newer visit until it is undone', () => {
    const f = { outcome: 'not_interested' as const, snoozeUntil: null, aboutLastVisit: last };
    expect(followupHides(f, '2026-10-22', '2026-11-10')).toBe('not_interested');
  });
});

describe('compareDue — call order', () => {
  const row = (o: Partial<DueSortable>): DueSortable => ({
    status: 'due_soon',
    expectedDate: '2026-10-21',
    lastVisit: '2026-10-01',
    name: 'A',
    customerId: 'c1',
    ...o,
  });

  it('puts overdue first, then due soon, then not back for a while', () => {
    const list = [
      row({ status: 'lapsed', customerId: 'l' }),
      row({ status: 'due_soon', customerId: 'd' }),
      row({ status: 'overdue', customerId: 'o' }),
    ].sort(compareDue);
    expect(list.map((x) => x.customerId)).toEqual(['o', 'd', 'l']);
  });

  it('orders by expected day, lapsed by most recent visit, then name and id', () => {
    const due = [
      row({ expectedDate: '2026-10-22', customerId: 'b' }),
      row({ expectedDate: '2026-10-21', customerId: 'a' }),
    ].sort(compareDue);
    expect(due.map((x) => x.customerId)).toEqual(['a', 'b']);

    const lapsed = [
      row({ status: 'lapsed', lastVisit: '2026-06-01', customerId: 'old' }),
      row({ status: 'lapsed', lastVisit: '2026-08-01', customerId: 'recent' }),
    ].sort(compareDue);
    expect(lapsed.map((x) => x.customerId)).toEqual(['recent', 'old']);

    const ties = [row({ name: 'zoe', customerId: 'z' }), row({ name: 'Amy', customerId: 'y' }), row({ name: 'amy', customerId: 'x' })].sort(
      compareDue,
    );
    expect(ties.map((x) => x.customerId)).toEqual(['x', 'y', 'z']);
  });
});

// Type-level: the rhythm the service builds rows from.
export type _R = Rhythm;
