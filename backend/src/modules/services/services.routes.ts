import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../db/supabase';
import { money } from '../../domain/money';
import { COLOR_TOKENS } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
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
  validate({ query: z.object({ active: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    let q = supabase.from('service').select('*').eq('business_id', req.principal!.businessId);
    if (req.query.active === 'true') q = q.eq('is_active', true);
    const { data } = await q.order('position');
    res.json({ data: (data ?? []).map(serviceDTO) });
  }),
);

servicesRouter.post(
  '/',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ body: upsertSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { data, error } = await supabase
      .from('service')
      .insert({
        business_id: req.principal!.businessId,
        name: b.name,
        duration_minutes: b.durationMinutes,
        price_paise: b.priceAmount,
        color_token: b.colorToken,
        position: b.position ?? 0,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(serviceDTO(data));
  }),
);

servicesRouter.patch(
  '/:id',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
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
    const { data, error } = await supabase
      .from('service')
      .update(row)
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Errors.notFound('Service not found');
    res.json(serviceDTO(data));
  }),
);

servicesRouter.delete(
  '/:id',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('service')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Errors.notFound('Service not found');
    res.json({ ok: true });
  }),
);
