import { Router } from 'express';
import { supabase } from '../../db/supabase';
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
    const { data: biz } = await supabase.from('business').select('timezone, currency').eq('id', businessId).maybeSingle();
    const tz = biz?.timezone;
    const { startIso, endIso } = businessDayRange(tz);

    const [apptCount, activeRows, completedRows] = await Promise.all([
      supabase
        .from('appointment')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('scheduled_start_at', startIso)
        .lte('scheduled_start_at', endIso),
      supabase
        .from('queue_entry')
        .select('status')
        .eq('business_id', businessId)
        .in('status', ['waiting', 'in_service']),
      supabase
        .from('visit')
        .select('amount_paise')
        .eq('business_id', businessId)
        .gte('completed_at', startIso)
        .lte('completed_at', endIso),
    ]);

    const active = activeRows.data ?? [];
    const waiting = active.filter((e) => e.status === 'waiting').length;
    const completedList = completedRows.data ?? [];
    const revenue = completedList.reduce((sum, v) => sum + Number(v.amount_paise ?? 0), 0);

    res.json({
      date: startIso.slice(0, 10),
      kpis: {
        todaysAppointments: apptCount.count ?? 0,
        activeNow: active.length,
        waitingNow: waiting,
        checkInCount: active.length,
        completed: completedList.length,
        revenue: money(revenue, biz?.currency),
      },
      // Deltas require a comparison window (docs/17 Q33) — omitted until defined.
      deltas: {},
    });
  }),
);
