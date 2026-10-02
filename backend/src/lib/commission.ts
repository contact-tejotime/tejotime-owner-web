/**
 * The shaping behind the commission reports — pure, no env and no pool, so it is unit-tested as
 * is (tests/unit/commission-summary.test.ts).
 *
 * The money itself is NOT computed here. Every visit's rate and commission come out of the
 * `visit_commission` view (migration 0034), which applies the rate of the visit's own store-local
 * day and rounds per visit. This file only groups those already-priced rows into the periods a
 * person reads ("₹4,000 × 20% · ₹6,000 × 30%") and adds them up, so a total is always the sum of
 * the lines it is made of — never revenue × today's rate.
 *
 * All amounts are integer minor units (paise); dates are `YYYY-MM-DD` store-local days.
 */

/** One `group by staff_id, rate_bp, rate_from` row out of `visit_commission` for a window. */
export interface CommissionBucket {
  staffId: string | null;
  rateBp: number | null;
  /** The day the rate in force began; null for visits before the stylist's first rate. */
  rateFrom: string | null;
  visits: number;
  revenue: number;
  commission: number;
}

/** A row of `staff_commission_rate`. */
export interface RateRow {
  staffId: string;
  rateBp: number;
  effectiveFrom: string;
}

export interface StaffRef {
  id: string;
  name: string;
  isActive: boolean;
}

/** A run of consecutive days paid at one rate, inside the report window. */
export interface Segment {
  rateBp: number | null;
  from: string;
  to: string;
  visits: number;
  revenue: number;
  commission: number;
}

export interface StaffCommission {
  staffId: string;
  name: string;
  isActive: boolean;
  visits: number;
  revenue: number;
  commission: number;
  /** Visits with no rate in force — they earn nothing, and the report says so. */
  unratedVisits: number;
  currentRateBp: number | null;
  currentRateFrom: string | null;
  /** The next scheduled change. Owners only — null in a stylist's own view. */
  nextRate: { rateBp: number; from: string } | null;
  segments: Segment[];
}

export interface CommissionSummary {
  totals: { visits: number; revenue: number; commission: number; salonKeeps: number | null };
  staff: StaffCommission[];
  /** Visits with no stylist (a store with no chairs, or a chair since deleted). Owners only. */
  unassigned: { visits: number; revenue: number } | null;
}

/** `YYYY-MM-DD` ± n days, on the UTC calendar — no timezone, no DST. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/**
 * Turn one stylist's buckets into dated periods, clipped to the window.
 *
 * A period starts on its rate's first day (or the window's first day, if that is later) and ends
 * the day before the NEXT rate begins — taken from the rate rows, not from the visits, so a rate
 * that was in force for a few days with no visits still closes the period before it correctly.
 *
 * @param rates this stylist's rate rows, any order; rows after the window are ignored.
 */
export function buildSegments(
  buckets: CommissionBucket[],
  rates: RateRow[],
  window: { from: string; to: string },
): Segment[] {
  const starts = rates
    .map((r) => r.effectiveFrom)
    .filter((d) => d <= window.to)
    .sort();

  return buckets
    .map((b): Segment => {
      let from: string;
      let to: string;
      if (b.rateFrom == null) {
        // Visits before the stylist's first rate: from the window's start until that rate.
        from = window.from;
        to = starts.length ? shiftDay(starts[0]!, -1) : window.to;
      } else {
        from = later(b.rateFrom, window.from);
        const next = starts.find((d) => d > b.rateFrom!);
        to = next ? shiftDay(next, -1) : window.to;
      }
      to = earlier(to, window.to);
      if (to < from) to = from;
      return {
        rateBp: b.rateBp,
        from,
        to,
        visits: b.visits,
        revenue: b.revenue,
        commission: b.commission,
      };
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** The rate in force on `today`, and the first change after it. */
export function currentAndNext(rates: RateRow[], today: string) {
  const sorted = [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const past = sorted.filter((r) => r.effectiveFrom <= today);
  const current = past[past.length - 1] ?? null;
  const next = sorted.find((r) => r.effectiveFrom > today) ?? null;
  return { current, next };
}

/**
 * The commission report for a window.
 *
 * @param staff  every stylist that could appear; active ones always do (with zeros), inactive
 *               ones only if they have visits in the window — a stylist removed mid-period still
 *               did that period's work.
 * @param scope  'self' is a stylist reading their own earnings: no "salon keeps", no unassigned
 *               bucket, no upcoming rate change.
 */
export function summarizeCommission(input: {
  buckets: CommissionBucket[];
  staff: StaffRef[];
  rates: RateRow[];
  window: { from: string; to: string };
  today: string;
  scope: 'store' | 'self';
}): CommissionSummary {
  const { buckets, staff, rates, window, today, scope } = input;

  const byStaff = new Map<string, CommissionBucket[]>();
  for (const b of buckets) {
    if (b.staffId == null) continue;
    const list = byStaff.get(b.staffId) ?? [];
    list.push(b);
    byStaff.set(b.staffId, list);
  }
  const ratesByStaff = new Map<string, RateRow[]>();
  for (const r of rates) {
    const list = ratesByStaff.get(r.staffId) ?? [];
    list.push(r);
    ratesByStaff.set(r.staffId, list);
  }

  const rows: StaffCommission[] = staff
    .filter((s) => s.isActive || byStaff.has(s.id))
    .map((s) => {
      const own = byStaff.get(s.id) ?? [];
      const ownRates = ratesByStaff.get(s.id) ?? [];
      const { current, next } = currentAndNext(ownRates, today);
      return {
        staffId: s.id,
        name: s.name,
        isActive: s.isActive,
        visits: total(own, (b) => b.visits),
        revenue: total(own, (b) => b.revenue),
        commission: total(own, (b) => b.commission),
        unratedVisits: total(own.filter((b) => b.rateBp == null), (b) => b.visits),
        currentRateBp: current?.rateBp ?? null,
        currentRateFrom: current?.effectiveFrom ?? null,
        nextRate: scope === 'store' && next ? { rateBp: next.rateBp, from: next.effectiveFrom } : null,
        segments: buildSegments(own, ownRates, window),
      };
    });

  const revenue = total(buckets, (b) => b.revenue);
  const commission = total(buckets, (b) => b.commission);
  const loose = buckets.filter((b) => b.staffId == null);

  return {
    totals: {
      visits: total(buckets, (b) => b.visits),
      revenue,
      commission,
      salonKeeps: scope === 'store' ? revenue - commission : null,
    },
    staff: rows,
    unassigned:
      scope === 'store'
        ? { visits: total(loose, (b) => b.visits), revenue: total(loose, (b) => b.revenue) }
        : null,
  };
}

function total<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}
