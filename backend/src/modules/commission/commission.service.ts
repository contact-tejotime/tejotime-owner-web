import { exec, many, one } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { Principal } from '../../http/types';
import {
  CommissionBucket,
  RateRow,
  Segment,
  StaffRef,
  buildSegments,
  shiftDay,
  summarizeCommission,
} from '../../lib/commission';
import { ReportQuery, addDays, businessToday, resolveReportWindow } from '../../lib/report-window';

/**
 * Commission reports and pay rates. See docs/staff-commission.md and migration 0034.
 *
 * Every figure here is read through the `visit_commission` view, which prices each visit at the
 * rate of its own store-local day — so "20% from 02/10, 30% from 16/10" pays the first fortnight
 * at 20% in every report, forever, however many times the rate changes afterwards. History stays
 * that way because this module is the only writer of rates and refuses any day already over.
 *
 * Dates go in and out as `YYYY-MM-DD` text: `date` columns are always selected `::text`, because
 * db/pool registers no type parser and node-pg would otherwise hand back a JS Date at the API
 * server's local midnight — a day early on any machine east of UTC.
 */

/** How far ahead a change of rate can be scheduled. */
const MAX_SCHEDULE_DAYS = 365;

interface Store {
  timezone: string;
  currency: string;
}

async function loadStore(businessId: string): Promise<Store> {
  const row = await one<{ timezone: string | null; currency: string | null }>(
    'select timezone, currency from business where id = $1',
    [businessId],
  );
  if (!row) throw Errors.notFound('Business not found');
  return {
    timezone: row.timezone || env.DEFAULT_TIMEZONE,
    currency: row.currency || env.DEFAULT_CURRENCY,
  };
}

/** Every visit in [startIso, endIso), priced by the view and grouped into rate periods. */
async function loadBuckets(
  businessId: string,
  startIso: string,
  endIso: string,
  staffId: string | null,
): Promise<CommissionBucket[]> {
  const rows = await many<{
    staff_id: string | null;
    rate_bp: number | null;
    rate_from: string | null;
    visits: number;
    revenue: string;
    commission: string;
  }>(
    `select vc.staff_id,
            vc.rate_bp,
            vc.rate_from::text as rate_from,
            count(*)::int as visits,
            coalesce(sum(vc.amount_paise), 0)::bigint as revenue,
            coalesce(sum(vc.commission_paise), 0)::bigint as commission
       from visit_commission vc
      where vc.business_id = $1
        and vc.completed_at >= $2
        and vc.completed_at < $3${staffId ? ' and vc.staff_id = $4' : ''}
      group by vc.staff_id, vc.rate_bp, vc.rate_from`,
    staffId ? [businessId, startIso, endIso, staffId] : [businessId, startIso, endIso],
  );
  return rows.map((r) => ({
    staffId: r.staff_id,
    rateBp: r.rate_bp,
    rateFrom: r.rate_from,
    visits: Number(r.visits),
    revenue: Number(r.revenue),
    commission: Number(r.commission),
  }));
}

async function loadRates(businessId: string, staffId: string | null): Promise<RateRow[]> {
  const rows = await many<{ staff_id: string; rate_bp: number; effective_from: string }>(
    `select staff_id, rate_bp, effective_from::text as effective_from
       from staff_commission_rate
      where business_id = $1${staffId ? ' and staff_id = $2' : ''}
      order by staff_id, effective_from`,
    staffId ? [businessId, staffId] : [businessId],
  );
  return rows.map((r) => ({ staffId: r.staff_id, rateBp: r.rate_bp, effectiveFrom: r.effective_from }));
}

async function loadStaff(businessId: string, staffId: string | null): Promise<StaffRef[]> {
  const rows = await many<{ id: string; name: string; is_active: boolean }>(
    `select id, name, is_active
       from staff
      where business_id = $1${staffId ? ' and id = $2' : ''}
      order by position, name`,
    staffId ? [businessId, staffId] : [businessId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
}

function segmentDTO(seg: Segment, currency: string) {
  return {
    rateBp: seg.rateBp,
    from: seg.from,
    to: seg.to,
    visits: seg.visits,
    revenue: money(seg.revenue, currency),
    commission: money(seg.commission, currency),
  };
}

/**
 * The commission report for a period.
 *
 * @param scopeStaff a staff login's own chair — it reads only its own earnings, with no "salon
 *   keeps", no unassigned visits and no upcoming rate change — or null for the whole store
 *   (owners, and the admin panel's read-only view).
 */
export async function summary(businessId: string, query: Partial<ReportQuery>, scopeStaff: string | null) {
  const store = await loadStore(businessId);
  const w = resolveReportWindow(store.timezone, query);
  const [buckets, staff, rates] = await Promise.all([
    loadBuckets(businessId, w.startIso, w.endIso, scopeStaff),
    loadStaff(businessId, scopeStaff),
    loadRates(businessId, scopeStaff),
  ]);
  const scope = scopeStaff ? 'self' : 'store';
  const s = summarizeCommission({ buckets, staff, rates, window: w, today: w.today, scope });
  const m = (amount: number) => money(amount, store.currency);

  return {
    range: w.range,
    from: w.from,
    to: w.to,
    today: w.today,
    periodLabel: w.periodLabel,
    scope,
    totals: {
      visits: s.totals.visits,
      revenue: m(s.totals.revenue),
      commission: m(s.totals.commission),
      salonKeeps: s.totals.salonKeeps == null ? null : m(s.totals.salonKeeps),
    },
    staff: s.staff.map((row) => ({
      staffId: row.staffId,
      name: row.name,
      isActive: row.isActive,
      visits: row.visits,
      revenue: m(row.revenue),
      commission: m(row.commission),
      unratedVisits: row.unratedVisits,
      currentRateBp: row.currentRateBp,
      currentRateFrom: row.currentRateFrom,
      nextRate: row.nextRate,
      segments: row.segments.map((seg) => segmentDTO(seg, store.currency)),
    })),
    unassigned: s.unassigned ? { visits: s.unassigned.visits, revenue: m(s.unassigned.revenue) } : null,
  };
}

/**
 * One stylist's visits in a period, each with the rate of its day and what it earned.
 * The caller has already decided whose visits these may be (a staff login: only its own).
 */
export async function visits(
  businessId: string,
  query: Partial<ReportQuery>,
  staffId: string,
  opts: { limit: number; includeCustomerName: boolean },
) {
  const store = await loadStore(businessId);
  const w = resolveReportWindow(store.timezone, query);
  const person = await one<{ id: string; name: string; is_active: boolean }>(
    'select id, name, is_active from staff where id = $1 and business_id = $2',
    [staffId, businessId],
  );
  if (!person) throw Errors.notFound('Staff member not found');

  const [rows, buckets, rates] = await Promise.all([
    many<{
      visit_id: string;
      completed_at: string;
      local_date: string;
      local_time: string;
      service_name: string | null;
      customer_name: string | null;
      amount_paise: string;
      rate_bp: number | null;
      commission_paise: string | null;
    }>(
      `select vc.visit_id,
              vc.completed_at,
              vc.local_date::text as local_date,
              to_char(vc.local_at, 'HH24:MI') as local_time,
              vc.service_name,
              coalesce(c.name, q.customer_name) as customer_name,
              vc.amount_paise,
              vc.rate_bp,
              vc.commission_paise
         from visit_commission vc
         left join queue_entry q on q.id = vc.queue_entry_id and q.business_id = vc.business_id
         left join customer c on c.id = vc.customer_id and c.business_id = vc.business_id
        where vc.business_id = $1
          and vc.staff_id = $2
          and vc.completed_at >= $3
          and vc.completed_at < $4
        order by vc.completed_at desc
        limit $5`,
      [businessId, staffId, w.startIso, w.endIso, opts.limit],
    ),
    loadBuckets(businessId, w.startIso, w.endIso, staffId),
    loadRates(businessId, staffId),
  ]);
  const m = (amount: number) => money(amount, store.currency);
  const totalVisits = buckets.reduce((n, b) => n + b.visits, 0);

  return {
    range: w.range,
    from: w.from,
    to: w.to,
    today: w.today,
    periodLabel: w.periodLabel,
    staff: { staffId: person.id, name: person.name, isActive: person.is_active },
    totals: {
      visits: totalVisits,
      revenue: m(buckets.reduce((n, b) => n + b.revenue, 0)),
      commission: m(buckets.reduce((n, b) => n + b.commission, 0)),
    },
    segments: buildSegments(buckets, rates, w).map((seg) => segmentDTO(seg, store.currency)),
    data: rows.map((r) => ({
      id: r.visit_id,
      completedAt: r.completed_at,
      // Store-local labels from the database, so no client has to know the store's timezone.
      localDate: r.local_date,
      localTime: r.local_time,
      serviceName: r.service_name ?? null,
      // Who sat in the chair is customer data: left out for a login without the customer book.
      customerName: opts.includeCustomerName ? (r.customer_name ?? null) : undefined,
      amount: m(Number(r.amount_paise)),
      rateBp: r.rate_bp ?? null,
      commission: r.commission_paise == null ? null : m(Number(r.commission_paise)),
    })),
    meta: { shown: rows.length, total: totalVisits, limit: opts.limit },
  };
}

// ---------------------------------------------------------------------------
// Rates — owners only (the routes enforce it)
// ---------------------------------------------------------------------------

interface RateItem {
  rateBp: number;
  from: string;
  /** Last day this rate applies, or null while it is the latest. */
  to: string | null;
  /** Today's and future rows can still be replaced or removed; earlier days are locked. */
  editable: boolean;
}

/** A stylist's rate rows (ascending) split into what is in force, what is coming and what was. */
function rateView(rates: RateRow[], today: string) {
  const sorted = [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const items: RateItem[] = sorted.map((r, i) => {
    const next = sorted[i + 1];
    return {
      rateBp: r.rateBp,
      from: r.effectiveFrom,
      to: next ? shiftDay(next.effectiveFrom, -1) : null,
      editable: r.effectiveFrom >= today,
    };
  });
  const started = items.filter((i) => i.from <= today);
  return {
    current: started[started.length - 1] ?? null,
    upcoming: items.filter((i) => i.from > today),
    // Most recent first; a long-serving stylist's whole career is not needed on one sheet.
    history: started.slice(0, -1).reverse().slice(0, 12),
  };
}

export async function listRates(businessId: string) {
  const store = await loadStore(businessId);
  const today = businessToday(store.timezone);
  const [staff, rates] = await Promise.all([
    many<{ id: string; name: string }>(
      'select id, name from staff where business_id = $1 and is_active order by position, name',
      [businessId],
    ),
    loadRates(businessId, null),
  ]);
  return {
    today,
    data: staff.map((s) => ({
      staffId: s.id,
      name: s.name,
      ...rateView(
        rates.filter((r) => r.staffId === s.id),
        today,
      ),
    })),
  };
}

/** The stylist being changed, with the store's today. Removed or foreign chairs are a 404. */
async function staffForWrite(businessId: string, staffId: string) {
  const row = await one<{ id: string; name: string; is_active: boolean; timezone: string | null }>(
    `select s.id, s.name, s.is_active, b.timezone
       from staff s
       join business b on b.id = s.business_id
      where s.id = $1 and s.business_id = $2`,
    [staffId, businessId],
  );
  if (!row || !row.is_active) throw Errors.notFound('Staff member not found');
  return { id: row.id, name: row.name, today: businessToday(row.timezone) };
}

async function rateEntry(businessId: string, staff: { id: string; name: string; today: string }) {
  const rates = await loadRates(businessId, staff.id);
  return {
    today: staff.today,
    data: { staffId: staff.id, name: staff.name, ...rateView(rates, staff.today) },
  };
}

/** A day already over keeps the rate it was paid at — that is the whole point of dated rates. */
const rateLocked = () =>
  Errors.conflict('COMMISSION_RATE_LOCKED', 'That day is over — a rate can start today or later');

/**
 * Set a stylist's rate from a day (default: the store's today). Saving again for the same day
 * replaces it — and since today is not over, today's visits so far are re-priced with it.
 */
export async function setRate(
  principal: Principal,
  staffId: string,
  body: { rateBp: number; effectiveFrom?: string },
) {
  const staff = await staffForWrite(principal.businessId, staffId);
  const from = body.effectiveFrom ?? staff.today;
  if (from < staff.today) throw rateLocked();
  if (from > addDays(staff.today, MAX_SCHEDULE_DAYS)) {
    throw Errors.validation('A rate can be scheduled at most a year ahead');
  }
  await exec(
    `insert into staff_commission_rate (business_id, staff_id, rate_bp, effective_from, set_by_user_id)
     values ($1, $2, $3, $4::date, $5)
     on conflict (staff_id, effective_from)
     do update set rate_bp = excluded.rate_bp,
                   set_by_user_id = excluded.set_by_user_id,
                   updated_at = now()`,
    [principal.businessId, staffId, body.rateBp, from, principal.userId],
  );
  return rateEntry(principal.businessId, staff);
}

/** Remove a rate that has not started yet (a scheduled change), or today's. */
export async function deleteRate(principal: Principal, staffId: string, effectiveFrom: string) {
  const staff = await staffForWrite(principal.businessId, staffId);
  if (effectiveFrom < staff.today) throw rateLocked();
  const removed = await exec(
    'delete from staff_commission_rate where business_id = $1 and staff_id = $2 and effective_from = $3::date',
    [principal.businessId, staffId, effectiveFrom],
  );
  if (!removed) throw Errors.notFound('No rate starts on that day');
  return rateEntry(principal.businessId, staff);
}
