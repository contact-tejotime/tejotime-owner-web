import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool';
import { env } from '../../config/env';
import { money } from '../../domain/money';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { lastVisitLabel } from '../../lib/time';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { getLivePlan } from '../subscription/subscription.service';

function customerDTO(c: any, currency: string) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    isVip: c.is_vip,
    visitsCount: c.visits_count,
    lastVisitAt: c.last_visit_at,
    lastVisitLabel: lastVisitLabel(c.last_visit_at),
    totalSpend: money(Number(c.total_spend_paise ?? 0), currency),
    notes: c.notes ?? null,
  };
}

/** The business's per-store currency, stamped onto every Money in this router. */
async function businessCurrency(businessId: string): Promise<string> {
  const data = await one<{ currency: string }>('select currency from business where id = $1', [businessId]);
  return data?.currency ?? env.DEFAULT_CURRENCY;
}

export const customersRouter = Router();
customersRouter.use(authenticate);

customersRouter.get(
  '/',
  limiters.ownerRead,
  validate({
    query: z.object({
      search: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    const plan = await getLivePlan(businessId); // authoritative — reflects a just-completed upgrade
    const search = (req.query.search as string | undefined)?.replace(/[%,()]/g, ' ').trim();
    const limit = Number(req.query.limit ?? 100);

    // Shared predicate so the count and the page stay in sync.
    const where: string[] = ['business_id = $1'];
    const filterParams: unknown[] = [businessId];
    if (search) {
      filterParams.push(`%${search}%`);
      where.push(`(name ilike $${filterParams.length} or phone ilike $${filterParams.length})`);
    }
    const whereSql = where.join(' and ');

    const countRow = await one<{ count: number }>(
      `select count(*)::int as count from customer where ${whereSql}`,
      filterParams,
    );
    const total = countRow?.count;

    const shownLimit = plan === 'free' ? env.FREE_PLAN_CUSTOMER_LIMIT : limit;
    const rows = await many(
      `select * from customer
        where ${whereSql}
        order by created_at desc
        limit $${filterParams.length + 1}`,
      [...filterParams, shownLimit],
    );

    const totalN = total ?? rows.length;
    const lockedCount = plan === 'free' ? Math.max(0, totalN - rows.length) : 0;
    const currency = await businessCurrency(businessId);

    res.json({
      data: rows.map((c) => customerDTO(c, currency)),
      plan,
      meta: { shown: rows.length, total: totalN, lockedCount, limit: shownLimit },
      nextCursor: null,
    });
  }),
);

customersRouter.get(
  '/:id',
  limiters.ownerRead,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const data = await one('select * from customer where id = $1 and business_id = $2', [
      req.params.id,
      req.principal!.businessId,
    ]);
    if (!data) throw Errors.notFound('Customer not found');
    res.json(customerDTO(data, await businessCurrency(req.principal!.businessId)));
  }),
);

customersRouter.post(
  '/',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({
    body: z
      .object({
        name: z.string().trim().min(1).max(80),
        phone: z.string().trim().min(4).max(20),
        isVip: z.boolean().optional().default(false),
        notes: z.string().max(1000).optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw Errors.validation('Invalid phone number', [{ field: 'phone', message: 'Invalid phone number' }]);
    let data;
    try {
      data = await one(
        `insert into customer (business_id, name, phone, is_vip, notes)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [req.principal!.businessId, req.body.name, phone, req.body.isVip, req.body.notes ?? null],
      );
    } catch (error: any) {
      if (/duplicate key|unique/i.test(error?.message ?? '')) {
        throw Errors.conflict('CUSTOMER_EXISTS', 'A customer with this phone already exists');
      }
      throw error;
    }
    res.status(201).json(customerDTO(data, await businessCurrency(req.principal!.businessId)));
  }),
);

customersRouter.patch(
  '/:id',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        isVip: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    // Only the keys the caller actually sent are written — everything else stays put.
    const params: unknown[] = [new Date().toISOString()];
    const sets: string[] = ['updated_at = $1'];
    if (req.body.name !== undefined) sets.push(`name = $${params.push(req.body.name)}`);
    if (req.body.isVip !== undefined) sets.push(`is_vip = $${params.push(req.body.isVip)}`);
    if (req.body.notes !== undefined) sets.push(`notes = $${params.push(req.body.notes)}`);
    const idParam = params.push(req.params.id);
    const bizParam = params.push(req.principal!.businessId);
    const data = await one(
      `update customer set ${sets.join(', ')}
        where id = $${idParam} and business_id = $${bizParam}
        returning *`,
      params,
    );
    if (!data) throw Errors.notFound('Customer not found');
    res.json(customerDTO(data, await businessCurrency(req.principal!.businessId)));
  }),
);

customersRouter.get(
  '/:id/visits',
  limiters.ownerRead,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const [data, currency] = await Promise.all([
      many(
        `select * from visit
          where business_id = $1 and customer_id = $2
          order by completed_at desc
          limit 100`,
        [req.principal!.businessId, req.params.id],
      ),
      businessCurrency(req.principal!.businessId),
    ]);
    res.json({
      data: data.map((v) => ({
        id: v.id,
        serviceName: v.service_name,
        amount: money(Number(v.amount_paise ?? 0), currency),
        completedAt: v.completed_at,
      })),
    });
  }),
);
