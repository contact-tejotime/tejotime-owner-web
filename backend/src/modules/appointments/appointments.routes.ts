import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../db/supabase';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as appts from './appointments.service';

async function businessTz(businessId: string): Promise<string | undefined> {
  const { data } = await supabase.from('business').select('timezone').eq('id', businessId).maybeSingle();
  return data?.timezone;
}

export const appointmentsRouter = Router();
appointmentsRouter.use(authenticate);

appointmentsRouter.get(
  '/',
  limiters.ownerRead,
  validate({
    query: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const tz = await businessTz(req.principal!.businessId);
    res.json(
      await appts.listAppointments(req.principal!.businessId, {
        date: req.query.date as string | undefined,
        status: req.query.status as string | undefined,
        tz,
      }),
    );
  }),
);

appointmentsRouter.post(
  '/',
  limiters.ownerWrite,
  validate({
    body: z
      .object({
        customerName: z.string().trim().min(1).max(80),
        customerPhone: z.string().trim().max(20).optional().nullable(),
        serviceId: z.string().uuid().optional().nullable(),
        staffId: z.string().uuid().optional().nullable(),
        scheduledStartAt: z.string().datetime(),
        notes: z.string().max(1000).optional().nullable(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await appts.createAppointment(req.principal!.businessId, req.body));
  }),
);

appointmentsRouter.get(
  '/:id',
  limiters.ownerRead,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { data } = await supabase
      .from('appointment')
      .select('*')
      .eq('id', req.params.id)
      .eq('business_id', req.principal!.businessId)
      .maybeSingle();
    if (!data) throw Errors.notFound('Appointment not found');
    res.json({
      id: data.id,
      customerName: data.customer_name,
      serviceName: data.service_name,
      staffId: data.staff_id,
      scheduledStartAt: data.scheduled_start_at,
      status: data.status,
      source: data.source,
      queueEntryId: data.queue_entry_id,
    });
  }),
);

appointmentsRouter.post(
  '/:id/check-in',
  limiters.ownerWrite,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await appts.checkIn(req.principal!.businessId, req.params.id));
  }),
);

appointmentsRouter.post(
  '/:id/cancel',
  limiters.ownerWrite,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    res.json(await appts.setStatus(req.principal!.businessId, req.params.id, 'cancelled'));
  }),
);

appointmentsRouter.post(
  '/:id/no-show',
  limiters.ownerWrite,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    res.json(await appts.setStatus(req.principal!.businessId, req.params.id, 'no_show'));
  }),
);
