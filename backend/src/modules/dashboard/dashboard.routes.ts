import { Router } from 'express';
import { one } from '../../db/pool';
import { money } from '../../domain/money';
import { businessDayRange } from '../../lib/time';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { limiters } from '../../middleware/rate-limit';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get(
  '/summary',
  limiters.ownerRead,
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    const biz = await one('select timezone, currency from business where id = $1', [businessId]);
    const tz = biz?.timezone;
    const { startIso, endIso } = businessDayRange(tz);

    // Postgres can aggregate these directly, so each KPI is one round trip instead
    // of pulling the day's rows back to count them in JS.
    const [apptCount, activeCounts, completedTotals] = await Promise.all([
      one<{ count: number }>(
        `select count(*)::int as count
           from appointment
          where business_id = $1 and scheduled_start_at >= $2 and scheduled_start_at <= $3`,
        [businessId, startIso, endIso],
      ),
      one<{ active: number; waiting: number }>(
        `select count(*)::int as active,
                count(*) filter (where status = 'waiting')::int as waiting
           from queue_entry
          where business_id = $1 and status = any($2::queue_status[])`,
        [businessId, ['waiting', 'in_service']],
      ),
      one<{ completed: number; revenue: string }>(
        `select count(*)::int as completed, coalesce(sum(amount_paise), 0)::bigint as revenue
           from visit
          where business_id = $1 and completed_at >= $2 and completed_at <= $3`,
        [businessId, startIso, endIso],
      ),
    ]);

    const activeNow = activeCounts?.active ?? 0;
    const waiting = activeCounts?.waiting ?? 0;
    const completed = completedTotals?.completed ?? 0;
    const revenue = Number(completedTotals?.revenue ?? 0);

    res.json({
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
