import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool';
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
    avatarUrl: s.avatar_url ?? null,
  };
}

const upsertSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    roleLabel: z.string().max(60).optional(),
    colorToken: z.enum(COLOR_TOKENS).default('secondary'),
    acceptsWalkIns: z.boolean().default(true),
    position: z.coerce.number().int().min(0).optional(),
    photoUrl: z.string().url().max(500).nullable().optional(),
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
    const where = ['business_id = $1'];
    if (req.query.active === 'true') where.push('is_active = true');
    const data = await many(
      `select * from staff where ${where.join(' and ')} order by position`,
      [req.principal!.businessId],
    );
    res.json({ data: data.map(staffDTO) });
  }),
);

staffRouter.post(
  '/',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ body: upsertSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await one(
      `insert into staff (business_id, name, role_label, color_token, accepts_walk_ins, position, avatar_url)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        req.principal!.businessId,
        b.name,
        b.roleLabel ?? null,
        b.colorToken,
        b.acceptsWalkIns,
        b.position ?? 0,
        b.photoUrl ?? null,
      ],
    );
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
    if (b.photoUrl !== undefined) row.avatar_url = b.photoUrl;
    // Only the keys the caller supplied are assigned; column names are literals, never request data.
    const columns = Object.keys(row);
    const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const data = await one(
      `update staff set ${sets}
        where id = $${columns.length + 1} and business_id = $${columns.length + 2}
        returning *`,
      [...Object.values(row), req.params.id, req.principal!.businessId],
    );
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
    const active = await one<{ count: number }>(
      `select count(*)::int as count from queue_entry
        where business_id = $1 and staff_id = $2 and status = any($3::queue_status[])`,
      [req.principal!.businessId, req.params.id, ['waiting', 'in_service']],
    );
    if ((active?.count ?? 0) > 0) throw Errors.conflict('SEAT_HAS_ACTIVE_ENTRIES', 'Seat has active queue entries');
    const data = await one(
      `update staff set is_active = false, updated_at = $1
        where id = $2 and business_id = $3
        returning *`,
      [new Date().toISOString(), req.params.id, req.principal!.businessId],
    );
    if (!data) throw Errors.notFound('Staff not found');
    res.json({ ok: true });
  }),
);
