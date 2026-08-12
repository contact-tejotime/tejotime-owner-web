import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { businessDayRange, businessMonthRange, dayjs } from '../../lib/time';
import { env } from '../../config/env';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { limiters } from '../../middleware/rate-limit';
import { requirePermission, scopeStaffId } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

const rangeQuery = z.object({
  range: z.enum(['today', 'month']).default('today'),
});

type ReportRange = 'today' | 'month';

function resolveReportWindow(tz: string | undefined, range: ReportRange) {
  const zone = tz || env.DEFAULT_TIMEZONE;
  if (range === 'month') {
    const m = businessMonthRange(zone);
    return { startIso: m.startIso, endIso: m.endIso, periodLabel: m.periodLabel, range };
  }
  const d = businessDayRange(zone);
  return {
    startIso: d.startIso,
    endIso: d.endIso,
    periodLabel: dayjs().tz(zone).format('ddd, D MMM YYYY'),
    range,
  };
}

dashboardRouter.get(
  '/summary',
  limiters.ownerRead,
  requirePermission('dashboard'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    const range = (req.query.range as ReportRange) ?? 'today';
    const biz = await one('select timezone, currency from business where id = $1', [businessId]);
    const tz = biz?.timezone;
    const { startIso, endIso, periodLabel } = resolveReportWindow(tz, range);

    // A staff login gets its own window, not the shop's. Same KPIs, narrowed by seat —
    // otherwise "dashboard: view" would hand every chair the business's revenue.
    // All three tables carry staff_id, so this stays one round trip each.
    const seat = scopeStaffId(req.principal!);
    const seatFilter = seat ? ' and staff_id = $4' : '';
    const seatParam = seat ? [seat] : [];

    // Postgres can aggregate these directly, so each KPI is one round trip instead
    // of pulling the day's rows back to count them in JS.
    // activeNow / waitingNow remain a live queue snapshot (not month aggregates).
    const [apptCount, activeCounts, completedTotals] = await Promise.all([
      one<{ count: number }>(
        `select count(*)::int as count
           from appointment
          where business_id = $1 and scheduled_start_at >= $2 and scheduled_start_at <= $3${seatFilter}`,
        [businessId, startIso, endIso, ...seatParam],
      ),
      one<{ active: number; waiting: number }>(
        `select count(*)::int as active,
                count(*) filter (where status = 'waiting')::int as waiting
           from queue_entry
          where business_id = $1 and status = any($2::queue_status[])${seat ? ' and staff_id = $3' : ''}`,
        [businessId, ['waiting', 'in_service'], ...seatParam],
      ),
      one<{ completed: number; revenue: string }>(
        `select count(*)::int as completed, coalesce(sum(amount_paise), 0)::bigint as revenue
           from visit
          where business_id = $1 and completed_at >= $2 and completed_at <= $3${seatFilter}`,
        [businessId, startIso, endIso, ...seatParam],
      ),
    ]);

    const activeNow = activeCounts?.active ?? 0;
    const waiting = activeCounts?.waiting ?? 0;
    const completed = completedTotals?.completed ?? 0;
    const revenue = Number(completedTotals?.revenue ?? 0);

    res.json({
      range,
      periodLabel,
      date: startIso.slice(0, 10),
      kpis: {
        todaysAppointments: apptCount?.count ?? 0,
        activeNow,
        waitingNow: waiting,
        checkInCount: activeNow,
        completed,
        revenue: money(revenue, biz?.currency),
      },
      // Deltas require a comparison window (docs/17 Q33) — omitted until defined.
      deltas: {},
    });
  }),
);

/**
 * Per-chair breakdown for store-wide roles. Staff logins are chair-scoped on /summary
 * and must not pull colleagues' numbers here.
 */
dashboardRouter.get(
  '/by-staff',
  limiters.ownerRead,
  requirePermission('dashboard'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const principal = req.principal!;
    if (scopeStaffId(principal)) {
      throw Errors.forbidden('Staff reports are limited to your own chair');
    }

    const businessId = principal.businessId;
    const range = (req.query.range as ReportRange) ?? 'today';
    const biz = await one('select timezone, currency from business where id = $1', [businessId]);
    const tz = biz?.timezone;
    const currency = biz?.currency;
    const { startIso, endIso, periodLabel } = resolveReportWindow(tz, range);

    const rows = await many<{
      id: string;
      name: string;
      appointments: number;
      completed: number;
      revenue: string;
    }>(
      `select s.id,
              s.name,
              coalesce(a.appointments, 0)::int as appointments,
              coalesce(v.completed, 0)::int as completed,
              coalesce(v.revenue, 0)::bigint as revenue
         from staff s
         left join (
           select staff_id, count(*)::int as appointments
             from appointment
            where business_id = $1
              and scheduled_start_at >= $2
              and scheduled_start_at <= $3
            group by staff_id
         ) a on a.staff_id = s.id
         left join (
           select staff_id,
                  count(*)::int as completed,
                  coalesce(sum(amount_paise), 0)::bigint as revenue
             from visit
            where business_id = $1
              and completed_at >= $2
              and completed_at <= $3
            group by staff_id
         ) v on v.staff_id = s.id
        where s.business_id = $1 and s.is_active = true
        order by s.position, s.name`,
      [businessId, startIso, endIso],
    );

    res.json({
      range,
      periodLabel,
      data: rows.map((r) => ({
        staffId: r.id,
        name: r.name,
        appointments: r.appointments,
        completed: r.completed,
        revenue: money(Number(r.revenue), currency),
      })),
    });
  }),
);
