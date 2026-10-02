/**
 * The shaping behind the commission reports — pure, no env and no pool, so it is unit-tested as
 * is (tests/unit/commission-summary.test.ts).
 *
 * The money itself is NOT computed here. Every visit's rate and commission come out of the
 * `visit_commission` view (migration 0035), which applies the latest rate whose start instant is
 * at or before the visit's checkout and rounds per visit. This file only groups those
 * already-priced rows into the periods a person reads ("₹4,000 × 20% · ₹6,000 × 30%") and adds
 * them up, so a total is always the sum of the lines it is made of — never revenue × the rate
 * in force now.
 *
 * All amounts are integer minor units (paise). Rate instants are UTC ISO strings
 * (`2026-10-02T07:30:00.000Z`), which sort lexicographically. The service turns them into
 * store-local wall times before they reach a client.
 */

/** One `group by staff_id, rate_bp, rate_from` row out of `visit_commission` for a window. */
export interface CommissionBucket {
  staffId: string | null;
  rateBp: number | null;
  /** UTC instant the rate in force began; null for visits before the stylist's first rate. */
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

/** One stretch paid at one rate, inside the report window. `from`/`to` are UTC instants; `to` is exclusive. */
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
 * Turn one stylist's buckets into periods, clipped to the half-open window `[startIso, endIso)`.
 *
 * A period starts at its rate's instant (or the window's start, if that is later) and ends at
 * the NEXT rate's instant — taken from the rate rows, not from the visits, so a rate that was in
 * force with no visits still closes the period before it. Visits before the first rate run from
 * the window's start up to that instant.
 *
 * @param rates this stylist's rate rows, any order; a rate that starts at or after `endIso` is ignored.
 */
export function buildSegments(
  buckets: CommissionBucket[],
  rates: RateRow[],
  window: { startIso: string; endIso: string },
): Segment[] {
  const starts = rates
    .map((r) => r.effectiveFrom)
    .filter((d) => d < window.endIso)
    .sort();

  return buckets
    .map((b): Segment => {
      let from: string;
      let to: string;
      if (b.rateFrom == null) {
        from = window.startIso;
        to = starts.length ? starts[0]! : window.endIso;
      } else {
        from = later(b.rateFrom, window.startIso);
        const next = starts.find((d) => d > b.rateFrom!);
        to = next ?? window.endIso;
      }
      to = earlier(to, window.endIso);
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

/** The rate in force at `now`, and the first change after it. An instant equal to `now` is current. */
export function currentAndNext(rates: RateRow[], now: string) {
  const sorted = [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const past = sorted.filter((r) => r.effectiveFrom <= now);
  const current = past[past.length - 1] ?? null;
  const next = sorted.find((r) => r.effectiveFrom > now) ?? null;
  return { current, next };
}

/**
 * What an admin store save should do with one stylist's commission box.
 *
 * `nextBp` null is a blank field (no rate). A blank field on a stylist who has no rate yet
 * writes nothing. A blank field on a stylist whose rate has already started is refused — that
 * row is history, and 0% is how an admin says "earn nothing from now on". The same percent as
 * the rate in force writes nothing, so saving hours or a photo does not add another identical
 * row. A different percent inserts one row at now(); a future rate the owner already scheduled
 * is not this decision and is left where it is.
 */
export type StaffRateWrite = 'skip' | 'insert' | 'refuse';

export function staffRateWrite(currentBp: number | null, nextBp: number | null): StaffRateWrite {
  if (nextBp == null) return currentBp == null ? 'skip' : 'refuse';
  if (currentBp === nextBp) return 'skip';
  return 'insert';
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
  window: { startIso: string; endIso: string };
  /** UTC instant "now", so a rate saved at 1pm is not current at 11am. */
  now: string;
  scope: 'store' | 'self';
}): CommissionSummary {
  const { buckets, staff, rates, window, now, scope } = input;

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
      const { current, next } = currentAndNext(ownRates, now);
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
