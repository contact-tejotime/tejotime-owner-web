import { many, one } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { money } from '../../domain/money';
import { Errors } from '../../domain/errors';
import { businessDayRange, dayjs, lastVisitLabel } from '../../lib/time';

/**
 * Cross-tenant analytics for the admin panel. Read-only: grouped aggregates come
 * from the SQL functions in db/migrations/0010_admin_analytics.sql, row lists
 * from plain queries. Platform-wide numbers use
 * env.DEFAULT_TIMEZONE; per-store numbers use that business's own timezone.
 */

const DEMO_SLUG = 'demo-store';
const LIST_LIMIT = 500;

interface BusinessLite {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
}

async function getBusinessLite(id: string): Promise<BusinessLite> {
  const data = await one('select id, name, slug, timezone, currency from business where id = $1', [id]);
  if (!data) throw Errors.notFound('Store not found');
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    timezone: data.timezone ?? env.DEFAULT_TIMEZONE,
    currency: data.currency ?? env.DEFAULT_CURRENCY,
  };
}

interface DailyRow {
  /** `date` column — pg hands this back as a JS Date at local midnight. */
  day: string | Date;
  visits: number;
  revenue_paise: number;
}

/** Calendar date of a `date` column, whichever representation the driver returned. */
function dayKey(day: string | Date): string {
  return day instanceof Date ? dayjs(day).format('YYYY-MM-DD') : String(day).slice(0, 10);
}

/** Zero-fill a daily series so every day in [firstDay, firstDay + days) has a point. */
function fillDays(firstDay: dayjs.Dayjs, days: number, rows: DailyRow[], currency: string) {
  const byDay = new Map(rows.map((r) => [dayKey(r.day), r]));
  return Array.from({ length: days }, (_, i) => {
    const date = firstDay.add(i, 'day').format('YYYY-MM-DD');
    const row = byDay.get(date);
    return {
      date,
      visits: Number(row?.visits ?? 0),
      revenue: money(Number(row?.revenue_paise ?? 0), currency),
    };
  });
}

/** UTC ISO bounds for the window of `days` calendar days ending today (inclusive), in tz. */
function trailingWindow(tz: string, days: number) {
  const firstDay = dayjs().tz(tz).subtract(days - 1, 'day').startOf('day');
  const { endIso } = businessDayRange(tz);
  return { firstDay, startIso: firstDay.utc().toISOString(), endIso };
}

/** Today's calendar date in tz (NOT startIso.slice(0,10), which is the UTC date). */
function todayDate(tz: string): string {
  return dayjs().tz(tz).format('YYYY-MM-DD');
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Platform overview — GET /admin/analytics/overview
// ---------------------------------------------------------------------------

/**
 * An employee who has not created a store yet. Shaped exactly like the real payload so the
 * dashboard renders its normal zero state instead of erroring on missing keys.
 */
function emptyOverview(tz: string) {
  return {
    date: todayDate(tz),
    stores: { total: 0, active: 0, inactive: 0 },
    totalCustomers: 0,
    today: { visits: 0, onlineBookings: 0 },
    storesByCity: [] as { city: string | null; count: number }[],
    storesByCategory: [] as { category: string | null; count: number }[],
  };
}

/**
 * @param allowedIds `null` = the whole platform (owner). An array restricts every figure to that
 *   employee's stores. An EMPTY array is meaningful and must not be confused with null — it is a
 *   brand-new employee, and the honest answer is zeroes, not the platform totals.
 */
export async function getPlatformOverview(allowedIds: string[] | null = null) {
  const tz = env.DEFAULT_TIMEZONE;
  const today = businessDayRange(tz);

  if (allowedIds?.length === 0) return emptyOverview(tz);

  // No cross-store revenue here: stores can use different currencies, so money
  // aggregates are meaningless platform-wide. Today's window of admin_daily_revenue
  // is queried only for its (demo-excluded) visit count.
  //
  // The RPCs are platform-wide by construction: admin_store_metrics() takes no argument and
  // admin_daily_revenue(null, …) spans every business. Both are therefore narrowed here rather
  // than trusted — the metrics rows by id, and today's revenue by asking per store, which reuses
  // the RPC's own definition of a visit instead of re-deriving it in a second query that could
  // drift from it.
  const [allBusinesses, metricRows, todayRows] = await Promise.all([
    many(
      `select id, name, slug, city, category, is_active
         from business
        where ($1::uuid[] is null or id = any($1::uuid[]))`,
      [allowedIds],
    ),
    callRpc<any[]>('admin_store_metrics', {}),
    allowedIds === null
      ? callRpc<DailyRow[]>('admin_daily_revenue', {
          p_business_id: null,
          p_tz: tz,
          p_start: today.startIso,
          p_end: today.endIso,
        })
      : Promise.all(
          allowedIds.map((id) =>
            callRpc<DailyRow[]>('admin_daily_revenue', {
              p_business_id: id,
              p_tz: tz,
              p_start: today.startIso,
              p_end: today.endIso,
            }),
          ),
        ).then((perStore) => perStore.flat()),
  ]);

  const demoId = allBusinesses.find((b) => b.slug === DEMO_SLUG)?.id ?? null;
  const businesses = allBusinesses.filter((b) => b.slug !== DEMO_SLUG);
  const visibleIds = new Set(businesses.map((b) => b.id as string));

  // Online bookings today — appointments booked from the microsite, demo excluded.
  const bookingParams: unknown[] = [today.startIso, today.endIso, allowedIds];
  let demoExclusion = '';
  if (demoId) {
    bookingParams.push(demoId);
    demoExclusion = ` and business_id <> $${bookingParams.length}`;
  }
  const bookingsRow = await one<{ count: number }>(
    `select count(*)::int as count from appointment
      where source = 'online'
        and scheduled_start_at >= $1
        and scheduled_start_at <= $2
        and ($3::uuid[] is null or business_id = any($3::uuid[]))${demoExclusion}`,
    bookingParams,
  );
  const onlineBookings = bookingsRow?.count ?? 0;

  // admin_store_metrics() covers every store on the platform, so drop anything outside the
  // caller's scope before a single figure is summed. Left untouched for the owner: their totals
  // have always counted every metrics row, and narrowing it here would quietly restate the
  // headline numbers on their dashboard.
  const metrics = allowedIds === null ? (metricRows ?? []) : (metricRows ?? []).filter((m) => visibleIds.has(m.business_id));
  const activeCount = businesses.filter((b) => b.is_active).length;
  const totalCustomers = metrics.reduce((sum, m) => sum + Number(m.customers_count ?? 0), 0);

  const countBy = (key: 'city' | 'category') => {
    const counts = new Map<string | null, number>();
    for (const b of businesses) {
      const value = b[key] ?? null;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ [key]: value, count }))
      .sort((a, b) => b.count - a.count);
  };

  const todayVisits = (todayRows ?? []).reduce((sum, r) => sum + Number(r.visits ?? 0), 0);

  return {
    date: todayDate(tz),
    stores: {
      total: businesses.length,
      active: activeCount,
      inactive: businesses.length - activeCount,
    },
    totalCustomers,
    today: {
      visits: todayVisits,
      onlineBookings: onlineBookings ?? 0,
    },
    storesByCity: countBy('city'),
    storesByCategory: countBy('category'),
  };
}

// ---------------------------------------------------------------------------
// Store analytics — GET /admin/businesses/:id/analytics?range=30d|90d
// ---------------------------------------------------------------------------

export async function getStoreAnalytics(id: string, range: '30d' | '90d') {
  const biz = await getBusinessLite(id);
  const tz = biz.timezone;
  const days = range === '30d' ? 30 : 90;
  const { firstDay, startIso, endIso } = trailingWindow(tz, days);
  const today = businessDayRange(tz);

  const [apptCount, queueCount, todayVisitRows, totalsRows, dailyRows, sourceRows, serviceRows, staffRows] =
    await Promise.all([
      one<{ count: number }>(
        `select count(*)::int as count from appointment
          where business_id = $1 and scheduled_start_at >= $2 and scheduled_start_at <= $3`,
        [id, today.startIso, today.endIso],
      ),
      one<{ count: number }>(
        `select count(*)::int as count from queue_entry
          where business_id = $1 and status in ('waiting', 'in_service')`,
        [id],
      ),
      many(
        `select amount_paise from visit
          where business_id = $1 and completed_at >= $2 and completed_at <= $3`,
        [id, today.startIso, today.endIso],
      ),
      callRpc<any[]>('admin_business_totals', { p_business_id: id }),
      callRpc<DailyRow[]>('admin_daily_revenue', {
        p_business_id: id,
        p_tz: tz,
        p_start: startIso,
        p_end: endIso,
      }),
      callRpc<any[]>('admin_visit_sources', { p_business_id: id, p_start: startIso, p_end: endIso }),
      callRpc<any[]>('admin_top_services', { p_business_id: id, p_start: startIso, p_end: endIso, p_limit: 5 }),
      callRpc<any[]>('admin_top_staff', { p_business_id: id, p_start: startIso, p_end: endIso, p_limit: 5 }),
    ]);

  const todayRevenue = todayVisitRows.reduce((sum, v) => sum + Number(v.amount_paise ?? 0), 0);

  const totals = totalsRows?.[0] ?? {};
  const customers = Number(totals.customers_count ?? 0);
  const visits = Number(totals.visits_count ?? 0);
  const revenue = Number(totals.revenue_paise ?? 0);

  const sources = new Map((sourceRows ?? []).map((r) => [r.source, Number(r.cnt ?? 0)]));

  return {
    range,
    from: firstDay.format('YYYY-MM-DD'),
    to: todayDate(tz),
    timezone: tz,
    today: {
      appointments: apptCount?.count ?? 0,
      activeQueue: queueCount?.count ?? 0,
      completed: todayVisitRows.length,
      revenue: money(todayRevenue, biz.currency),
    },
    allTime: {
      customers,
      visits,
      revenue: money(revenue, biz.currency),
      avgTicket: money(visits > 0 ? revenue / visits : 0, biz.currency),
      repeatRate: ratio(Number(totals.repeat_customers ?? 0), customers),
      vipCount: Number(totals.vip_count ?? 0),
    },
    revenueByDay: fillDays(firstDay, days, dailyRows ?? [], biz.currency),
    visitSources: {
      walkIn: sources.get('walk_in') ?? 0,
      online: sources.get('online') ?? 0,
    },
    topServices: (serviceRows ?? []).map((r) => ({
      name: r.service_name,
      visits: Number(r.visits ?? 0),
      revenue: money(Number(r.revenue_paise ?? 0), biz.currency),
    })),
    topStaff: (staffRows ?? []).map((r) => ({
      id: r.staff_id,
      name: r.staff_name,
      visits: Number(r.visits ?? 0),
      revenue: money(Number(r.revenue_paise ?? 0), biz.currency),
    })),
  };
}

// ---------------------------------------------------------------------------
// Customers — GET /admin/businesses/:id/customers[?search=&limit=]
// ---------------------------------------------------------------------------

export async function listStoreCustomers(id: string, search: string | undefined, limit: number) {
  const biz = await getBusinessLite(id);
  const cleanSearch = search?.replace(/[%,()]/g, ' ').trim();

  // One shared predicate so the count and the page can never drift apart.
  const params: unknown[] = [id];
  let searchFilter = '';
  if (cleanSearch) {
    params.push(`%${cleanSearch}%`);
    searchFilter = ` and (name ilike $${params.length} or phone ilike $${params.length})`;
  }
  const where = `where business_id = $1${searchFilter}`;

  const [totalRow, rows] = await Promise.all([
    one<{ count: number }>(`select count(*)::int as count from customer ${where}`, params),
    many(`select * from customer ${where} order by created_at desc limit ${limit}`, params),
  ]);
  const total = totalRow?.count;
  return {
    data: rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      isVip: c.is_vip,
      visitsCount: c.visits_count,
      lastVisitAt: c.last_visit_at,
      lastVisitLabel: lastVisitLabel(c.last_visit_at, biz.timezone),
      totalSpend: money(Number(c.total_spend_paise ?? 0), biz.currency),
      notes: c.notes ?? null,
      createdAt: c.created_at,
    })),
    meta: { shown: rows.length, total: total ?? rows.length },
  };
}

// ---------------------------------------------------------------------------
// Customer visit history — GET /admin/businesses/:id/customers/:customerId/visits
// ---------------------------------------------------------------------------

export async function listCustomerVisits(id: string, customerId: string) {
  const biz = await getBusinessLite(id);
  const customer = await one('select id from customer where id = $1 and business_id = $2', [customerId, id]);
  if (!customer) throw Errors.notFound('Customer not found');

  const [visits, staffNames] = await Promise.all([
    many(
      `select * from visit
        where business_id = $1 and customer_id = $2
        order by completed_at desc
        limit 100`,
      [id, customerId],
    ),
    getStaffNames(id),
  ]);

  return {
    data: (visits ?? []).map((v) => ({
      id: v.id,
      serviceName: v.service_name ?? null,
      staffName: staffNames.get(v.staff_id) ?? null,
      amount: money(Number(v.amount_paise ?? 0), biz.currency),
      completedAt: v.completed_at,
    })),
  };
}

async function getStaffNames(businessId: string): Promise<Map<string, string>> {
  const rows = await many('select id, name from staff where business_id = $1', [businessId]);
  return new Map(rows.map((s) => [s.id, s.name]));
}

// ---------------------------------------------------------------------------
// Visit ledger — GET /admin/businesses/:id/visits[?from=&to=]
// ---------------------------------------------------------------------------

export async function listStoreVisits(id: string, from: string | undefined, to: string | undefined) {
  const biz = await getBusinessLite(id);
  const tz = biz.timezone;

  const toDate = to ?? dayjs().tz(tz).format('YYYY-MM-DD');
  const fromDate = from ?? dayjs.tz(toDate, tz).subtract(29, 'day').format('YYYY-MM-DD');
  const spanDays = dayjs(toDate).diff(dayjs(fromDate), 'day');
  if (spanDays < 0) throw Errors.validation('`from` must be on or before `to`');
  if (spanDays > 366) throw Errors.validation('Date range too large (max 366 days)');

  const startIso = businessDayRange(tz, fromDate).startIso;
  const endIso = businessDayRange(tz, toDate).endIso;

  const window = 'where business_id = $1 and completed_at >= $2 and completed_at <= $3';
  const [totalRow, rows, dailyRows, staffNames] = await Promise.all([
    one<{ count: number }>(`select count(*)::int as count from visit ${window}`, [id, startIso, endIso]),
    many(`select * from visit ${window} order by completed_at desc limit ${LIST_LIMIT}`, [id, startIso, endIso]),
    callRpc<DailyRow[]>('admin_daily_revenue', {
      p_business_id: id,
      p_tz: tz,
      p_start: startIso,
      p_end: endIso,
    }),
    getStaffNames(id),
  ]);

  // Resolve customer names in one query; visits with no CRM record are walk-ins.
  const customerIds = [...new Set(rows.map((v) => v.customer_id).filter(Boolean))];
  const customerNames = new Map<string, string>();
  if (customerIds.length > 0) {
    const customers = await many('select id, name from customer where id = any($1::uuid[])', [customerIds]);
    for (const c of customers) customerNames.set(c.id, c.name);
  }

  // Summary comes from the SQL aggregate so it covers the full range even when
  // the row list is truncated at LIST_LIMIT.
  const summaryVisits = (dailyRows ?? []).reduce((sum, r) => sum + Number(r.visits ?? 0), 0);
  const summaryRevenue = (dailyRows ?? []).reduce((sum, r) => sum + Number(r.revenue_paise ?? 0), 0);

  return {
    from: fromDate,
    to: toDate,
    data: rows.map((v) => ({
      id: v.id,
      customerId: v.customer_id ?? null,
      customerName: (v.customer_id && customerNames.get(v.customer_id)) || 'Walk-in',
      serviceName: v.service_name ?? null,
      staffName: staffNames.get(v.staff_id) ?? null,
      amount: money(Number(v.amount_paise ?? 0), biz.currency),
      completedAt: v.completed_at,
    })),
    summary: {
      visits: summaryVisits,
      revenue: money(summaryRevenue, biz.currency),
      avgTicket: money(summaryVisits > 0 ? summaryRevenue / summaryVisits : 0, biz.currency),
    },
    meta: { shown: rows.length, total: totalRow?.count ?? rows.length, limit: LIST_LIMIT },
  };
}

// ---------------------------------------------------------------------------
// Bookings — GET /admin/businesses/:id/appointments[?from=&to=&status=]
// ---------------------------------------------------------------------------

export async function listStoreAppointments(
  id: string,
  opts: { from?: string; to?: string; status?: string },
) {
  const biz = await getBusinessLite(id);
  const tz = biz.timezone;

  // Default window covers recent history plus the upcoming week.
  const fromDate = opts.from ?? dayjs().tz(tz).subtract(30, 'day').format('YYYY-MM-DD');
  const toDate = opts.to ?? dayjs().tz(tz).add(7, 'day').format('YYYY-MM-DD');
  const spanDays = dayjs(toDate).diff(dayjs(fromDate), 'day');
  if (spanDays < 0) throw Errors.validation('`from` must be on or before `to`');
  if (spanDays > 366) throw Errors.validation('Date range too large (max 366 days)');

  const startIso = businessDayRange(tz, fromDate).startIso;
  const endIso = businessDayRange(tz, toDate).endIso;

  const params: unknown[] = [id, startIso, endIso];
  let statusFilter = '';
  if (opts.status) {
    params.push(opts.status);
    statusFilter = ` and status = $${params.length}`;
  }

  const [rows, statRows, staffNames] = await Promise.all([
    many(
      `select * from appointment
        where business_id = $1 and scheduled_start_at >= $2 and scheduled_start_at <= $3${statusFilter}
        order by scheduled_start_at desc
        limit ${LIST_LIMIT}`,
      params,
    ),
    callRpc<any[]>('admin_appointment_stats', { p_business_id: id, p_start: startIso, p_end: endIso }),
    getStaffNames(id),
  ]);

  const byStatus = { pending: 0, confirmed: 0, checkedIn: 0, completed: 0, cancelled: 0, noShow: 0 };
  const bySource = { online: 0, owner: 0 };
  const statusKey: Record<string, keyof typeof byStatus> = {
    pending: 'pending',
    confirmed: 'confirmed',
    checked_in: 'checkedIn',
    completed: 'completed',
    cancelled: 'cancelled',
    no_show: 'noShow',
  };
  for (const r of statRows ?? []) {
    const cnt = Number(r.cnt ?? 0);
    const key = statusKey[r.status];
    if (key) byStatus[key] += cnt;
    if (r.source === 'online') bySource.online += cnt;
    else if (r.source === 'owner') bySource.owner += cnt;
  }
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  // Rate definitions:
  //  - noShowRate: no-shows as a share of appointments that reached their slot
  //    (completed + checked-in + no-show) — cancelled and still-open ones excluded.
  //  - completionRate: appointments that arrived (completed + checked-in) over all booked.
  //  - onlineShare: microsite bookings over all booked.
  const arrived = byStatus.completed + byStatus.checkedIn;

  return {
    from: fromDate,
    to: toDate,
    data: rows.map((a) => ({
      id: a.id,
      customerName: a.customer_name,
      customerPhone: a.customer_phone ?? null,
      serviceName: a.service_name ?? null,
      staffName: staffNames.get(a.staff_id) ?? null,
      scheduledStartAt: a.scheduled_start_at,
      status: a.status,
      source: a.source,
    })),
    stats: {
      total,
      byStatus,
      bySource,
      noShowRate: ratio(byStatus.noShow, arrived + byStatus.noShow),
      completionRate: ratio(arrived, total),
      onlineShare: ratio(bySource.online, total),
    },
    meta: { shown: rows.length, limit: LIST_LIMIT },
  };
}
