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
import { requirePermission, scopeStaffId } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { getLivePlan } from '../subscription/subscription.service';
import { followupSchema } from './due.schemas';
import * as due from './due.service';

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
  requirePermission('customers'),
  validate({
    query: z.object({
      search: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const businessId = req.principal!.businessId;
    /*
     * Every plan sees its whole customer book (2026-10-28, docs/customer-list-no-limit.md). A free
     * store used to get only its latest FREE_PLAN_CUSTOMER_LIMIT (2) and an "Upgrade to Premium"
     * prompt for the rest. `plan` and `meta.lockedCount` (now always 0) stay in the payload because
     * app builds already in owners' hands read both.
     */
    const plan = await getLivePlan(businessId);
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

    const rows = await many(
      `select * from customer
        where ${whereSql}
        order by created_at desc
        limit $${filterParams.length + 1}`,
      [...filterParams, limit],
    );

    const totalN = total ?? rows.length;
    const currency = await businessCurrency(businessId);

    res.json({
      data: rows.map((c) => customerDTO(c, currency)),
      plan,
      meta: { shown: rows.length, total: totalN, lockedCount: 0, limit },
      nextCursor: null,
    });
  }),
);

// ---- "Due to come back" (docs/customer-due-list.md) ----
//
// Registered BEFORE '/:id': that route validates its param as a uuid and would answer 400 for the
// literal "due". The logic lives in due.service.ts; these handlers only wire it up.

/** The call list. A staff login sees only customers whose last visit was in its chair. */
customersRouter.get(
  '/due',
  limiters.ownerRead,
  requirePermission('customers'),
  asyncHandler(async (req, res) => {
    res.json(await due.listDue(req.principal!.businessId, scopeStaffId(req.principal!)));
  }),
);

/** What a call achieved: no answer / call back on a day / not interested. */
customersRouter.put(
  '/:id/followup',
  limiters.ownerWrite,
  requirePermission('customers', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }), body: followupSchema }),
  asyncHandler(async (req, res) => {
    res.json(
      await due.setFollowup(
        req.principal!.businessId,
        req.params.id,
        req.body,
        req.principal!.userId,
        scopeStaffId(req.principal!),
      ),
    );
  }),
);

/** Undo a logged outcome — the customer is back on the list if still due. */
customersRouter.delete(
  '/:id/followup',
  limiters.ownerWrite,
  requirePermission('customers', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await due.clearFollowup(req.principal!.businessId, req.params.id, scopeStaffId(req.principal!));
    res.json({ ok: true });
  }),
);

customersRouter.get(
  '/:id',
  limiters.ownerRead,
  requirePermission('customers'),
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
  requirePermission('customers', 'manage'),
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
  requirePermission('customers', 'manage'),
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
  requirePermission('customers'),
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
        // What the customer tipped (0046). Not part of `amount`, which stays the bill; a refunded
        // card visit gave its tip back with the rest.
        tip: money(v.refunded_at != null ? 0 : Number(v.tip_paise ?? 0), currency),
        // "Paid by" (0042); null for visits from before the question. A refunded card visit
        // (0043) stays listed but no longer counts as money taken.
        paymentMethod: v.payment_method ?? null,
        refunded: v.refunded_at != null,
        completedAt: v.completed_at,
      })),
    });
  }),
);
