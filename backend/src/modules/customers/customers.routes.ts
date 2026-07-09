import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../db/supabase';
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
  const { data } = await supabase.from('business').select('currency').eq('id', businessId).maybeSingle();
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

    const countQ = supabase
      .from('customer')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId);
    if (search) countQ.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    const { count: total } = await countQ;

    const shownLimit = plan === 'free' ? env.FREE_PLAN_CUSTOMER_LIMIT : limit;
    let dataQ = supabase
      .from('customer')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(shownLimit);
    if (search) dataQ = dataQ.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    const { data } = await dataQ;

    const rows = data ?? [];
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
    const { data } = await supabase
      .from('customer')
      .select('*')
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .maybeSingle();
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
    const { data, error } = await supabase
      .from('customer')
      .insert({
        business_id: req.principal!.businessId,
        name: req.body.name,
        phone,
        is_vip: req.body.isVip,
        notes: req.body.notes ?? null,
      })
      .select()
      .single();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw Errors.conflict('CUSTOMER_EXISTS', 'A customer with this phone already exists');
      }
      throw new Error(error.message);
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
    const row: Record<string, any> = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) row.name = req.body.name;
    if (req.body.isVip !== undefined) row.is_vip = req.body.isVip;
    if (req.body.notes !== undefined) row.notes = req.body.notes;
    const { data, error } = await supabase
      .from('customer')
      .update(row)
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Errors.notFound('Customer not found');
    res.json(customerDTO(data, await businessCurrency(req.principal!.businessId)));
  }),
);

customersRouter.get(
  '/:id/visits',
  limiters.ownerRead,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const [{ data }, currency] = await Promise.all([
      supabase
        .from('visit')
        .select('*')
        .eq('business_id', req.principal!.businessId)
        .eq('customer_id', req.params.id)
        .order('completed_at', { ascending: false })
        .limit(100),
      businessCurrency(req.principal!.businessId),
    ]);
    res.json({
      data: (data ?? []).map((v) => ({
        id: v.id,
        serviceName: v.service_name,
        amount: money(Number(v.amount_paise ?? 0), currency),
        completedAt: v.completed_at,
      })),
    });
  }),
);
