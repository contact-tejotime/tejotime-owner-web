import { describe, expect, it } from 'vitest';
import {
  CommissionBucket,
  RateRow,
  buildSegments,
  currentAndNext,
  shiftDay,
  summarizeCommission,
} from '../../src/lib/commission';

/**
 * The shaping of the commission report, from rows the `visit_commission` view has already priced
 * (each visit at the rate of its own day — that part is proved against Postgres by
 * scripts/smoke-commission-db.mjs). Pure: no env, no pool.
 *
 * The fixture is the owner's own example: John earns 20% from 02/10/2026 and 30% from 16/10/2026.
 */

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const JOHN_RATES: RateRow[] = [
  { staffId: 'john', rateBp: 2000, effectiveFrom: '2026-10-02' },
  { staffId: 'john', rateBp: 3000, effectiveFrom: '2026-10-16' },
];

/** John's October, as the view groups it: one row per (stylist, rate period). */
const JOHN_OCTOBER: CommissionBucket[] = [
  { staffId: 'john', rateBp: 3000, rateFrom: '2026-10-16', visits: 2, revenue: 101005, commission: 30302 },
  { staffId: 'john', rateBp: null, rateFrom: null, visits: 1, revenue: 50000, commission: 0 },
  { staffId: 'john', rateBp: 2000, rateFrom: '2026-10-02', visits: 2, revenue: 150000, commission: 30000 },
];

describe('rate periods', () => {
  it('splits the month where the rate changed: no rate 01→01, 20% 02→15, 30% 16→31', () => {
    expect(buildSegments(JOHN_OCTOBER, JOHN_RATES, OCTOBER)).toEqual([
      { rateBp: null, from: '2026-10-01', to: '2026-10-01', visits: 1, revenue: 50000, commission: 0 },
      { rateBp: 2000, from: '2026-10-02', to: '2026-10-15', visits: 2, revenue: 150000, commission: 30000 },
      { rateBp: 3000, from: '2026-10-16', to: '2026-10-31', visits: 2, revenue: 101005, commission: 30302 },
    ]);
  });

  it('ends a period where the NEXT rate starts, even if that rate had no visits', () => {
    const rates = [...JOHN_RATES, { staffId: 'john', rateBp: 2500, effectiveFrom: '2026-10-10' }];
    const twenty = buildSegments(JOHN_OCTOBER, rates, OCTOBER).find((s) => s.rateBp === 2000)!;
    expect(twenty).toMatchObject({ from: '2026-10-02', to: '2026-10-09' });
  });

  it('clips periods to the window on both sides', () => {
    const rates: RateRow[] = [
      { staffId: 'a', rateBp: 4000, effectiveFrom: '2026-09-01' }, // began before the window
      { staffId: 'a', rateBp: 4500, effectiveFrom: '2026-11-05' }, // begins after it
    ];
    const buckets: CommissionBucket[] = [
      { staffId: 'a', rateBp: 4000, rateFrom: '2026-09-01', visits: 3, revenue: 90000, commission: 36000 },
    ];
    expect(buildSegments(buckets, rates, OCTOBER)).toEqual([
      { rateBp: 4000, from: '2026-10-01', to: '2026-10-31', visits: 3, revenue: 90000, commission: 36000 },
    ]);
  });

  it('knows the rate in force today and the next scheduled change', () => {
    const rates = [...JOHN_RATES, { staffId: 'john', rateBp: 3500, effectiveFrom: '2026-11-01' }];
    expect(currentAndNext(rates, '2026-10-20')).toMatchObject({
      current: { rateBp: 3000, effectiveFrom: '2026-10-16' },
      next: { rateBp: 3500, effectiveFrom: '2026-11-01' },
    });
    expect(currentAndNext(rates, '2026-10-16').current?.rateBp).toBe(3000); // its first day counts
    expect(currentAndNext(rates, '2026-10-01').current).toBeNull();
  });

  it('shifts calendar days without a timezone', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('the report', () => {
  const staff = [
    { id: 'john', name: 'John', isActive: true },
    { id: 'lisa', name: 'Lisa', isActive: true },
    { id: 'gone', name: 'Removed, no visits', isActive: false },
    { id: 'left', name: 'Left mid-month', isActive: false },
  ];
  const buckets: CommissionBucket[] = [
    ...JOHN_OCTOBER,
    { staffId: 'left', rateBp: 1000, rateFrom: '2026-09-01', visits: 1, revenue: 20000, commission: 2000 },
    { staffId: null, rateBp: null, rateFrom: null, visits: 2, revenue: 70000, commission: 0 },
  ];
  const rates: RateRow[] = [
    ...JOHN_RATES,
    { staffId: 'john', rateBp: 3500, effectiveFrom: '2026-11-01' },
    { staffId: 'left', rateBp: 1000, effectiveFrom: '2026-09-01' },
  ];

  it("adds up an owner's view: totals are the sum of the lines, and salon keeps the rest", () => {
    const r = summarizeCommission({ buckets, staff, rates, window: OCTOBER, today: '2026-10-20', scope: 'store' });

    expect(r.totals).toEqual({
      visits: 8,
      revenue: 391005,
      commission: 62302,
      salonKeeps: 391005 - 62302,
    });
    expect(r.unassigned).toEqual({ visits: 2, revenue: 70000 });

    const john = r.staff.find((s) => s.staffId === 'john')!;
    expect(john).toMatchObject({
      visits: 5,
      revenue: 301005,
      commission: 60302, // ₹100 + ₹200 + ₹300 + ₹3.02 — NOT October revenue × today's 30%
      unratedVisits: 1,
      currentRateBp: 3000,
      currentRateFrom: '2026-10-16',
      nextRate: { rateBp: 3500, from: '2026-11-01' },
    });
    expect(john.commission).not.toBe(Math.round(john.revenue * 0.3));
    expect(john.segments.map((s) => s.rateBp)).toEqual([null, 2000, 3000]);
  });

  it('keeps every active stylist, and a removed one only if they worked in the period', () => {
    const r = summarizeCommission({ buckets, staff, rates, window: OCTOBER, today: '2026-10-20', scope: 'store' });
    expect(r.staff.map((s) => s.staffId)).toEqual(['john', 'lisa', 'left']);
    expect(r.staff.find((s) => s.staffId === 'lisa')).toMatchObject({ visits: 0, commission: 0, currentRateBp: null });
    expect(r.staff.find((s) => s.staffId === 'left')).toMatchObject({ isActive: false, commission: 2000 });
  });

  it("a stylist's own view shows their money and nothing about the shop's", () => {
    const own = buckets.filter((b) => b.staffId === 'john');
    const r = summarizeCommission({
      buckets: own,
      staff: [staff[0]!],
      rates: rates.filter((x) => x.staffId === 'john'),
      window: OCTOBER,
      today: '2026-10-20',
      scope: 'self',
    });
    expect(r.totals).toEqual({ visits: 5, revenue: 301005, commission: 60302, salonKeeps: null });
    expect(r.unassigned).toBeNull();
    expect(r.staff[0]!.nextRate).toBeNull(); // an upcoming change is the owner's business until it starts
  });
});
