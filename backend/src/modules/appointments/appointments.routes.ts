import { Router } from 'express';
import { z } from 'zod';
import { one } from '../../db/pool';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as appts from './appointments.service';

async function businessTz(businessId: string): Promise<string | undefined> {
  const data = await one('select timezone from business where id = $1', [businessId]);
  return data?.timezone;
}

export const appointmentsRouter = Router();
appointmentsRouter.use(authenticate);

appointmentsRouter.get(
  '/',
  limiters.ownerRead,
  validate({
    query: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        // Must match the appointment_status enum — an unknown value now reaches
        // Postgres and errors, where PostgREST used to quietly return no rows.
        status: z.enum(['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show']).optional(),
      })
      .refine((q) => !!q.from === !!q.to, { message: 'from and to must be provided together' })
      .refine((q) => !q.from || !q.to || q.to >= q.from, { message: 'to must not be before from' })
      .refine(
        (q) => !q.from || !q.to || (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86_400_000 <= 45,
        { message: 'from/to range must not exceed 45 days' },
      ),
  }),
  asyncHandler(async (req, res) => {
    const tz = await businessTz(req.principal!.businessId);
    res.json(
      await appts.listAppointments(req.principal!.businessId, {
        date: req.query.date as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
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
    const data = await one('select * from appointment where id = $1 and business_id = $2', [
      req.params.id,
      req.principal!.businessId,
    ]);
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
