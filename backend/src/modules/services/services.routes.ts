import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool';
import { money } from '../../domain/money';
import { COLOR_TOKENS } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';

function serviceDTO(s: any) {
  return {
    id: s.id,
    name: s.name,
    durationMinutes: s.duration_minutes,
    price: money(s.price_paise, s.currency),
    colorToken: s.color_token,
    isActive: s.is_active,
    position: s.position,
  };
}

const upsertSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    durationMinutes: z.coerce.number().int().min(1).max(600),
    priceAmount: z.coerce.number().int().min(0),
    colorToken: z.enum(COLOR_TOKENS),
    position: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const patchSchema = upsertSchema.partial().extend({ isActive: z.boolean().optional() }).strict();

export const servicesRouter = Router();
servicesRouter.use(authenticate);

servicesRouter.get(
  '/',
  limiters.ownerRead,
  requireAnyPermission([
    ['services', 'view'],
    ['queue', 'view'],
    ['appointments', 'view'],
  ]),
  validate({ query: z.object({ active: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    const where = ['business_id = $1'];
    if (req.query.active === 'true') where.push('is_active = true');
    const data = await many(
      `select * from service where ${where.join(' and ')} order by position`,
      [req.principal!.businessId],
    );
    res.json({ data: data.map(serviceDTO) });
  }),
);

servicesRouter.post(
  '/',
  limiters.ownerWrite,
  requirePermission('services', 'manage'),
  validate({ body: upsertSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    // New services inherit the business currency (per-store setting; column default is INR).
    const biz = await one('select currency from business where id = $1', [req.principal!.businessId]);
    const columns = ['business_id', 'name', 'duration_minutes', 'price_paise', 'color_token', 'position'];
    const params: any[] = [
      req.principal!.businessId,
      b.name,
      b.durationMinutes,
      b.priceAmount,
      b.colorToken,
      b.position ?? 0,
    ];
    if (biz?.currency) {
      columns.push('currency');
      params.push(biz.currency);
    }
    const data = await one(
      `insert into service (${columns.join(', ')})
       values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
       returning *`,
      params,
    );
    res.status(201).json(serviceDTO(data));
  }),
);

servicesRouter.patch(
  '/:id',
  limiters.ownerWrite,
  requirePermission('services', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }), body: patchSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const row: Record<string, any> = { updated_at: new Date().toISOString() };
    if (b.name !== undefined) row.name = b.name;
    if (b.durationMinutes !== undefined) row.duration_minutes = b.durationMinutes;
    if (b.priceAmount !== undefined) row.price_paise = b.priceAmount;
    if (b.colorToken !== undefined) row.color_token = b.colorToken;
    if (b.position !== undefined) row.position = b.position;
    if (b.isActive !== undefined) row.is_active = b.isActive;
    // Only the keys the caller supplied are assigned; column names are literals, never request data.
    const columns = Object.keys(row);
    const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const data = await one(
      `update service set ${sets}
        where id = $${columns.length + 1} and business_id = $${columns.length + 2}
        returning *`,
      [...Object.values(row), req.params.id, req.principal!.businessId],
    );
    if (!data) throw Errors.notFound('Service not found');
    res.json(serviceDTO(data));
  }),
);

servicesRouter.delete(
  '/:id',
  limiters.ownerWrite,
  requirePermission('services', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const data = await one(
      `update service set is_active = false, updated_at = $1
        where id = $2 and business_id = $3
        returning *`,
      [new Date().toISOString(), req.params.id, req.principal!.businessId],
    );
    if (!data) throw Errors.notFound('Service not found');
    res.json({ ok: true });
  }),
);
