import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../db/supabase';
import { COLOR_TOKENS } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';

function staffDTO(s: any) {
  return {
    id: s.id,
    name: s.name,
    roleLabel: s.role_label,
    colorToken: s.color_token,
    acceptsWalkIns: s.accepts_walk_ins,
    isActive: s.is_active,
    position: s.position,
    userId: s.user_id,
  };
}

const upsertSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    roleLabel: z.string().max(60).optional(),
    colorToken: z.enum(COLOR_TOKENS).default('secondary'),
    acceptsWalkIns: z.boolean().default(true),
    position: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const patchSchema = upsertSchema.partial().extend({ isActive: z.boolean().optional() }).strict();

export const staffRouter = Router();
staffRouter.use(authenticate);

staffRouter.get(
  '/',
  limiters.ownerRead,
  validate({ query: z.object({ active: z.enum(['true', 'false']).optional() }) }),
  asyncHandler(async (req, res) => {
    let q = supabase.from('staff').select('*').eq('business_id', req.principal!.businessId);
    if (req.query.active === 'true') q = q.eq('is_active', true);
    const { data } = await q.order('position');
    res.json({ data: (data ?? []).map(staffDTO) });
  }),
);

staffRouter.post(
  '/',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ body: upsertSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const { data, error } = await supabase
      .from('staff')
      .insert({
        business_id: req.principal!.businessId,
        name: b.name,
        role_label: b.roleLabel ?? null,
        color_token: b.colorToken,
        accepts_walk_ins: b.acceptsWalkIns,
        position: b.position ?? 0,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(staffDTO(data));
  }),
);

staffRouter.patch(
  '/:id',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ params: z.object({ id: z.string().uuid() }), body: patchSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const row: Record<string, any> = { updated_at: new Date().toISOString() };
    if (b.name !== undefined) row.name = b.name;
    if (b.roleLabel !== undefined) row.role_label = b.roleLabel;
    if (b.colorToken !== undefined) row.color_token = b.colorToken;
    if (b.acceptsWalkIns !== undefined) row.accepts_walk_ins = b.acceptsWalkIns;
    if (b.position !== undefined) row.position = b.position;
    if (b.isActive !== undefined) row.is_active = b.isActive;
    const { data, error } = await supabase
      .from('staff')
      .update(row)
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Errors.notFound('Staff not found');
    res.json(staffDTO(data));
  }),
);

staffRouter.delete(
  '/:id',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    // Guard: a seat with active queue entries cannot be deactivated.
    const { count } = await supabase
      .from('queue_entry')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', req.principal!.businessId)
      .eq('staff_id', req.params.id)
      .in('status', ['waiting', 'in_service']);
    if ((count ?? 0) > 0) throw Errors.conflict('SEAT_HAS_ACTIVE_ENTRIES', 'Seat has active queue entries');
    const { data, error } = await supabase
      .from('staff')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Errors.notFound('Staff not found');
    res.json({ ok: true });
  }),
);
