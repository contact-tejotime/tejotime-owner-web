import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool';
import { servicePricing } from '../../domain/money';
import { WRITABLE_SERVICE_PRICE_TYPES } from '../../domain/enums';
import { COLOR_TOKENS } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';

function serviceDTO(s: any) {
  const pricing = servicePricing(s, s.currency);
  return {
    id: s.id,
    name: s.name,
    durationMinutes: s.duration_minutes,
    // `price` keeps its old meaning for a fixed service and becomes the range MINIMUM for a
    // banded one, so a client built before pricing modes still renders a sensible figure
    // instead of nothing. `priceType` is what a current client branches on.
    price: pricing.price,
    priceType: pricing.priceType,
    priceMax: pricing.priceMax,
    colorToken: s.color_token,
    isActive: s.is_active,
    position: s.position,
  };
}

/**
 * Pricing arrives as a triple: the mode, the amount (fixed price, or the range floor) and —
 * for a range only — the ceiling. All in paise, like every other amount crossing this API.
 *
 * `unset` is absent on purpose. It exists in the database only to describe the rows that
 * predate pricing modes (migration 0024); an owner who opens one of those has to choose a real
 * mode before it will save, which is the whole point of recording it rather than guessing.
 */
const priceFields = {
  priceType: z.enum(WRITABLE_SERVICE_PRICE_TYPES).default('fixed'),
  priceAmount: z.coerce.number().int().min(1).max(100_000_000),
  priceMaxAmount: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
};

/**
 * The database check constraint refuses a malformed band anyway; catching it here turns a 500
 * into the 400 with a field name that the form can actually point at.
 */
function checkPriceShape(
  v: { priceType?: string; priceAmount?: number; priceMaxAmount?: number | null },
  ctx: z.RefinementCtx,
) {
  if (v.priceType === 'range') {
    if (v.priceMaxAmount == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMaxAmount'], message: 'Enter a maximum price' });
    } else if (v.priceAmount != null && v.priceMaxAmount < v.priceAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceMaxAmount'],
        message: 'Maximum price must be at least the minimum',
      });
    }
  } else if (v.priceType === 'fixed' && v.priceMaxAmount != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMaxAmount'], message: 'A fixed price has no maximum' });
  }
}

const upsertBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    durationMinutes: z.coerce.number().int().min(1).max(600),
    ...priceFields,
    colorToken: z.enum(COLOR_TOKENS),
    position: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const upsertSchema = upsertBody.superRefine(checkPriceShape);

/**
 * PATCH is partial, but pricing is not: the three fields only make sense together, and zod
 * cannot see the row on disk to fill in the halves a caller left out. Sending any one of them
 * therefore means sending the mode and the amount too — every editor already does, and the
 * alternative is a read-modify-write that races another save.
 */
const patchSchema = upsertBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .superRefine((v, ctx) => {
    const touched = v.priceType !== undefined || v.priceAmount !== undefined || v.priceMaxAmount !== undefined;
    if (!touched) return;
    if (v.priceType === undefined || v.priceAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceType'],
        message: 'Send priceType and priceAmount together when changing a price',
      });
      return;
    }
    checkPriceShape(v, ctx);
  });

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
    const columns = [
      'business_id',
      'name',
      'duration_minutes',
      'price_paise',
      'price_type',
      'price_max_paise',
      'color_token',
      'position',
    ];
    const params: any[] = [
      req.principal!.businessId,
      b.name,
      b.durationMinutes,
      b.priceAmount,
      b.priceType,
      b.priceType === 'range' ? b.priceMaxAmount : null,
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
    // The three pricing columns move as one — patchSchema guarantees mode + amount arrive
    // together, so a fixed service can never keep a stale ceiling from a previous range.
    if (b.priceType !== undefined) {
      row.price_paise = b.priceAmount;
      row.price_type = b.priceType;
      row.price_max_paise = b.priceType === 'range' ? b.priceMaxAmount : null;
    }
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
