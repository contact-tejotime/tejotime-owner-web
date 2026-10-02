import { describe, expect, it } from 'vitest';
import {
  CommissionBucket,
  RateRow,
  buildSegments,
  currentAndNext,
  shiftDay,
  staffRateWrite,
  summarizeCommission,
} from '../../src/lib/commission';

/**
 * The shaping of the commission report, from rows the `visit_commission` view has already priced
 * (each visit at the rate in force at checkout — that part is proved against Postgres by
 * scripts/smoke-commission-db.mjs). Pure: no env, no pool.
 *
 * Instants are UTC. October's window is the half-open UTC month used below, not a store timezone.
 * The 1pm case is the one that used to be wrong: a rate saved at 13:00 must not pay 11:00.
 */

const OCTOBER = { startIso: '2026-10-01T00:00:00.000Z', endIso: '2026-11-01T00:00:00.000Z' };
const AT_20 = '2026-10-02T00:00:00.000Z';
const AT_30 = '2026-10-16T00:00:00.000Z';
const JOHN_RATES: RateRow[] = [
  { staffId: 'john', rateBp: 2000, effectiveFrom: AT_20 },
  { staffId: 'john', rateBp: 3000, effectiveFrom: AT_30 },
];

/** John's October, as the view groups it: one row per (stylist, rate period). */
const JOHN_OCTOBER: CommissionBucket[] = [
  { staffId: 'john', rateBp: 3000, rateFrom: AT_30, visits: 2, revenue: 101005, commission: 30302 },
  { staffId: 'john', rateBp: null, rateFrom: null, visits: 1, revenue: 50000, commission: 0 },
  { staffId: 'john', rateBp: 2000, rateFrom: AT_20, visits: 2, revenue: 150000, commission: 30000 },
];

/** 2 Oct, store in UTC for this fixture: 11:00 unrated, 20% from 13:00, 30% from 16:00. */
const DAY = { startIso: '2026-10-02T00:00:00.000Z', endIso: '2026-10-03T00:00:00.000Z' };
const AT_1PM = '2026-10-02T13:00:00.000Z';
const AT_4PM = '2026-10-02T16:00:00.000Z';
const SAME_DAY_RATES: RateRow[] = [
  { staffId: 'john', rateBp: 2000, effectiveFrom: AT_1PM },
  { staffId: 'john', rateBp: 3000, effectiveFrom: AT_4PM },
];
const SAME_DAY: CommissionBucket[] = [
  { staffId: 'john', rateBp: null, rateFrom: null, visits: 2, revenue: 200000, commission: 0 },
  { staffId: 'john', rateBp: 2000, rateFrom: AT_1PM, visits: 2, revenue: 200000, commission: 40000 },
  { staffId: 'john', rateBp: 3000, rateFrom: AT_4PM, visits: 1, revenue: 100000, commission: 30000 },
];

describe('rate periods', () => {
  it('splits the month where the rate changed, ending each period when the next one starts', () => {
    expect(buildSegments(JOHN_OCTOBER, JOHN_RATES, OCTOBER)).toEqual([
      { rateBp: null, from: OCTOBER.startIso, to: AT_20, visits: 1, revenue: 50000, commission: 0 },
      { rateBp: 2000, from: AT_20, to: AT_30, visits: 2, revenue: 150000, commission: 30000 },
      { rateBp: 3000, from: AT_30, to: OCTOBER.endIso, visits: 2, revenue: 101005, commission: 30302 },
    ]);
  });

  it('a rate saved at 1pm does not cover the morning, and a 4pm change does not reprice 1pm–4pm', () => {
    expect(buildSegments(SAME_DAY, SAME_DAY_RATES, DAY)).toEqual([
      { rateBp: null, from: DAY.startIso, to: AT_1PM, visits: 2, revenue: 200000, commission: 0 },
      { rateBp: 2000, from: AT_1PM, to: AT_4PM, visits: 2, revenue: 200000, commission: 40000 },
      { rateBp: 3000, from: AT_4PM, to: DAY.endIso, visits: 1, revenue: 100000, commission: 30000 },
    ]);
    expect(currentAndNext(SAME_DAY_RATES, '2026-10-02T12:00:00.000Z').current).toBeNull();
    expect(currentAndNext(SAME_DAY_RATES, '2026-10-02T14:00:00.000Z')).toMatchObject({
      current: { rateBp: 2000, effectiveFrom: AT_1PM },
      next: { rateBp: 3000, effectiveFrom: AT_4PM },
    });
    expect(currentAndNext(SAME_DAY_RATES, '2026-10-02T17:00:00.000Z').current?.rateBp).toBe(3000);
  });

  it('ends a period where the NEXT rate starts, even if that rate had no visits', () => {
    const at10 = '2026-10-10T00:00:00.000Z';
    const rates = [...JOHN_RATES, { staffId: 'john', rateBp: 2500, effectiveFrom: at10 }];
    const twenty = buildSegments(JOHN_OCTOBER, rates, OCTOBER).find((s) => s.rateBp === 2000)!;
    expect(twenty).toMatchObject({ from: AT_20, to: at10 });
  });

  it('clips periods to the window on both sides', () => {
    const rates: RateRow[] = [
      { staffId: 'a', rateBp: 4000, effectiveFrom: '2026-09-01T00:00:00.000Z' },
      { staffId: 'a', rateBp: 4500, effectiveFrom: '2026-11-05T00:00:00.000Z' },
    ];
    const buckets: CommissionBucket[] = [
      { staffId: 'a', rateBp: 4000, rateFrom: '2026-09-01T00:00:00.000Z', visits: 3, revenue: 90000, commission: 36000 },
    ];
    expect(buildSegments(buckets, rates, OCTOBER)).toEqual([
      { rateBp: 4000, from: OCTOBER.startIso, to: OCTOBER.endIso, visits: 3, revenue: 90000, commission: 36000 },
    ]);
  });

  it('knows the rate in force at an instant and the next scheduled change', () => {
    const at35 = '2026-11-01T00:00:00.000Z';
    const rates = [...JOHN_RATES, { staffId: 'john', rateBp: 3500, effectiveFrom: at35 }];
    expect(currentAndNext(rates, '2026-10-20T12:00:00.000Z')).toMatchObject({
      current: { rateBp: 3000, effectiveFrom: AT_30 },
      next: { rateBp: 3500, effectiveFrom: at35 },
    });
    expect(currentAndNext(rates, AT_30).current?.rateBp).toBe(3000); // its first instant counts
    expect(currentAndNext(rates, '2026-10-01T12:00:00.000Z').current).toBeNull();
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
    { staffId: 'left', rateBp: 1000, rateFrom: '2026-09-01T00:00:00.000Z', visits: 1, revenue: 20000, commission: 2000 },
    { staffId: null, rateBp: null, rateFrom: null, visits: 2, revenue: 70000, commission: 0 },
  ];
  const rates: RateRow[] = [
    ...JOHN_RATES,
    { staffId: 'john', rateBp: 3500, effectiveFrom: '2026-11-01T00:00:00.000Z' },
    { staffId: 'left', rateBp: 1000, effectiveFrom: '2026-09-01T00:00:00.000Z' },
  ];
  const NOW = '2026-10-20T12:00:00.000Z';

  it("adds up an owner's view: totals are the sum of the lines, and salon keeps the rest", () => {
    const r = summarizeCommission({ buckets, staff, rates, window: OCTOBER, now: NOW, scope: 'store' });

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
      currentRateFrom: AT_30,
      nextRate: { rateBp: 3500, from: '2026-11-01T00:00:00.000Z' },
    });
    expect(john.commission).not.toBe(Math.round(john.revenue * 0.3));
    expect(john.segments.map((s) => s.rateBp)).toEqual([null, 2000, 3000]);
  });

  it('keeps every active stylist, and a removed one only if they worked in the period', () => {
    const r = summarizeCommission({ buckets, staff, rates, window: OCTOBER, now: NOW, scope: 'store' });
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
      now: NOW,
      scope: 'self',
    });
    expect(r.totals).toEqual({ visits: 5, revenue: 301005, commission: 60302, salonKeeps: null });
    expect(r.unassigned).toBeNull();
    expect(r.staff[0]!.nextRate).toBeNull(); // an upcoming change is the owner's business until it starts
  });
});

describe('admin staff commission box', () => {
  it('writes a rate only when the percent is new', () => {
    expect(staffRateWrite(null, null)).toBe('skip'); // blank, and they have no rate yet
    expect(staffRateWrite(null, 2000)).toBe('insert');
    expect(staffRateWrite(null, 0)).toBe('insert'); // 0% is a real rate, not "no rate"
    expect(staffRateWrite(2000, 2000)).toBe('skip'); // saving the rest of the store must not add a row
    expect(staffRateWrite(2000, 3000)).toBe('insert');
    expect(staffRateWrite(2000, 0)).toBe('insert');
    expect(staffRateWrite(2000, null)).toBe('refuse'); // a started rate cannot be cleared
    expect(staffRateWrite(0, null)).toBe('refuse');
    expect(staffRateWrite(0, 0)).toBe('skip');
  });
});
