import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../db/supabase';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  limiters.ownerRead,
  validate({ query: z.object({ unread: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    let q = supabase.from('notification').select('*').eq('business_id', businessId);
    if (req.query.unread === 'true') q = q.is('read_at', null);
    const { data } = await q.order('created_at', { ascending: false }).limit(50);

    const { count } = await supabase
      .from('notification')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .is('read_at', null);

    res.json({
      data: (data ?? []).map((n) => ({
        id: n.id,
        template: n.template,
        body: n.body,
        channel: n.channel,
        status: n.status,
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
      unreadCount: count ?? 0,
    });
  }),
);

notificationsRouter.post(
  '/read',
  limiters.ownerWrite,
  validate({ body: z.object({ ids: z.array(z.string().uuid()).optional() }).strict() }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    let q = supabase
      .from('notification')
      .update({ read_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .is('read_at', null);
    if (req.body.ids?.length) q = q.in('id', req.body.ids);
    await q;
    res.json({ ok: true });
  }),
);
