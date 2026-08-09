import { Router } from 'express';
import { z } from 'zod';
import { exec, many, one } from '../../db/pool';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { requirePermission } from '../../middleware/require-permission';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  limiters.ownerRead,
  requirePermission('notifications'),
  validate({ query: z.object({ unread: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    const unreadOnly = req.query.unread === 'true' ? ' and read_at is null' : '';
    const data = await many(
      `select * from notification where business_id = $1${unreadOnly} order by created_at desc limit 50`,
      [businessId],
    );

    const countRow = await one<{ count: number }>(
      'select count(*)::int as count from notification where business_id = $1 and read_at is null',
      [businessId],
    );

    res.json({
      data: data.map((n) => ({
        id: n.id,
        template: n.template,
        body: n.body,
        channel: n.channel,
        status: n.status,
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
      unreadCount: countRow?.count ?? 0,
    });
  }),
);

notificationsRouter.post(
  '/read',
  limiters.ownerWrite,
  requirePermission('notifications'),
  validate({ body: z.object({ ids: z.array(z.string().uuid()).optional() }).strict() }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    const params: unknown[] = [new Date().toISOString(), businessId];
    let idFilter = '';
    if (req.body.ids?.length) {
      params.push(req.body.ids);
      idFilter = ` and id = any($${params.length}::uuid[])`;
    }
    await exec(
      `update notification set read_at = $1 where business_id = $2 and read_at is null${idFilter}`,
      params,
    );
    res.json({ ok: true });
  }),
);
