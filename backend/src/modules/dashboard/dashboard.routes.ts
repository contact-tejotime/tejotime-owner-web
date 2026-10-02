import { Router } from 'express';
import { many, one } from '../../db/pool';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { ReportQuery, reportQuerySchema, resolveReportWindow } from '../../lib/report-window';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { limiters } from '../../middleware/rate-limit';
import { requirePermission, scopeStaffId } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// `?range=today|week|month|custom&from=&to=` — resolved in the store's timezone by
// lib/report-window, the same window the commission reports use, so the revenue on Reports and
// the commission beside it always cover the same days. Windows are half-open (`< endIso`).
// Deliberately NOT built on the visit_commission view (migration 0034): Reports keeps working on
// a backend that is briefly ahead of its schema.

dashboardRouter.get(
  '/summary',
  limiters.ownerRead,
  requirePermission('dashboard'),
  validate({ query: reportQuerySchema }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    const biz = await one('select timezone, currency from business where id = $1', [businessId]);
    const w = resolveReportWindow(biz?.timezone, req.query as unknown as ReportQuery);

    // A staff login gets its own window, not the shop's. Same KPIs, narrowed by seat —
    // otherwise "dashboard: view" would hand every chair the business's revenue.
    // All three tables carry staff_id, so this stays one round trip each.
    const seat = scopeStaffId(req.principal!);
    const seatFilter = seat ? ' and staff_id = $4' : '';
    const seatParam = seat ? [seat] : [];

    // Postgres can aggregate these directly, so each KPI is one round trip instead
    // of pulling the day's rows back to count them in JS.
    // activeNow / waitingNow remain a live queue snapshot (not period aggregates).
    const [apptCount, activeCounts, completedTotals] = await Promise.all([
      one<{ count: number }>(
        `select count(*)::int as count
           from appointment
          where business_id = $1 and scheduled_start_at >= $2 and scheduled_start_at < $3${seatFilter}`,
        [businessId, w.startIso, w.endIso, ...seatParam],
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
          where business_id = $1 and completed_at >= $2 and completed_at < $3${seatFilter}`,
        [businessId, w.startIso, w.endIso, ...seatParam],
      ),
    ]);

    const activeNow = activeCounts?.active ?? 0;
    const waiting = activeCounts?.waiting ?? 0;
    const completed = completedTotals?.completed ?? 0;
    const revenue = Number(completedTotals?.revenue ?? 0);

    res.json({
      range: w.range,
      periodLabel: w.periodLabel,
      from: w.from,
      to: w.to,
      today: w.today,
      // Kept for older clients; the store-local first day (it used to be the UTC date of the
      // window's start — yesterday, for an Indian store).
      date: w.from,
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
  validate({ query: reportQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = req.principal!;
    if (scopeStaffId(principal)) {
      throw Errors.forbidden('Staff reports are limited to your own chair');
    }

    const businessId = principal.businessId;
    const biz = await one('select timezone, currency from business where id = $1', [businessId]);
    const currency = biz?.currency;
    const w = resolveReportWindow(biz?.timezone, req.query as unknown as ReportQuery);

    const rows = await many<{
      id: string;
      name: string;
      is_active: boolean;
      appointments: number;
      completed: number;
      revenue: string;
    }>(
      `select s.id,
              s.name,
              s.is_active,
              coalesce(a.appointments, 0)::int as appointments,
              coalesce(v.completed, 0)::int as completed,
              coalesce(v.revenue, 0)::bigint as revenue
         from staff s
         left join (
           select staff_id, count(*)::int as appointments
             from appointment
            where business_id = $1
              and scheduled_start_at >= $2
              and scheduled_start_at < $3
            group by staff_id
         ) a on a.staff_id = s.id
         left join (
           select staff_id,
                  count(*)::int as completed,
                  coalesce(sum(amount_paise), 0)::bigint as revenue
             from visit
            where business_id = $1
              and completed_at >= $2
              and completed_at < $3
            group by staff_id
         ) v on v.staff_id = s.id
        -- A stylist removed mid-period still did that period's work: listing only active rows
        -- made their revenue vanish from this breakdown while it still counted in /summary.
        where s.business_id = $1
          and (s.is_active or a.staff_id is not null or v.staff_id is not null)
        order by s.position, s.name`,
      [businessId, w.startIso, w.endIso],
    );

    res.json({
      range: w.range,
      periodLabel: w.periodLabel,
      from: w.from,
      to: w.to,
      today: w.today,
      data: rows.map((r) => ({
        staffId: r.id,
        name: r.name,
        isActive: r.is_active,
        appointments: r.appointments,
        completed: r.completed,
        revenue: money(Number(r.revenue), currency),
      })),
    });
  }),
);
