import { Router } from 'express';
import { z } from 'zod';
import { one } from '../../db/pool';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { requireOwnRow, requirePermission, scopeStaffId } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as appts from './appointments.service';
import * as reschedule from './reschedule.service';
import * as series from './series.service';
import { changeSchema, moveSchema, seriesSlotsQuery, slotsQuery } from './series.schemas';

async function businessTz(businessId: string): Promise<string | undefined> {
  const data = await one('select timezone from business where id = $1', [businessId]);
  return data?.timezone;
}

export const appointmentsRouter = Router();
appointmentsRouter.use(authenticate);

appointmentsRouter.get(
  '/',
  limiters.ownerRead,
  requirePermission('appointments'),
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
        staffId: scopeStaffId(req.principal!),
        tz,
      }),
    );
  }),
);

appointmentsRouter.post(
  '/',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
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

// ---- Recurring series (docs/recurring-appointments.md) ----
//
// Registered BEFORE '/:id': that route would otherwise match the literal "series" and its UUID
// validation would answer 400 for every one of these paths.

const seriesParam = z.object({ id: z.string().uuid() });

/** The Regulars list. A staff login sees only its own chair's series. */
appointmentsRouter.get(
  '/series',
  limiters.ownerRead,
  requirePermission('appointments'),
  validate({
    query: z.object({ status: z.enum(['open', 'active', 'paused', 'ended', 'cancelled', 'all']).optional() }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await series.listSeries(req.principal!.businessId, {
        status: req.query.status as 'open' | undefined,
        staffId: scopeStaffId(req.principal!),
      }),
    );
  }),
);

/** Needs attention: series dates the job could not book. */
appointmentsRouter.get(
  '/series/issues',
  limiters.ownerRead,
  requirePermission('appointments'),
  asyncHandler(async (req, res) => {
    res.json(await series.listIssues(req.principal!.businessId, scopeStaffId(req.principal!)));
  }),
);

appointmentsRouter.post(
  '/series/issues/:issueId/resolve',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ issueId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    res.json(
      await series.resolveIssue(
        req.principal!.businessId,
        req.params.issueId,
        req.principal!.userId,
        scopeStaffId(req.principal!),
      ),
    );
  }),
);

appointmentsRouter.get(
  '/series/:id',
  limiters.ownerRead,
  requirePermission('appointments'),
  validate({ params: seriesParam }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(await series.getSeries(req.principal!.businessId, req.params.id));
  }),
);

appointmentsRouter.post(
  '/series/:id/pause',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: seriesParam }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(await series.pauseSeries(req.principal!.businessId, req.params.id));
  }),
);

appointmentsRouter.post(
  '/series/:id/resume',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({
    params: seriesParam,
    // Optional new stylist: a UUID, or 'any' for no preference. Required by the service when the
    // series was paused because its stylist left.
    body: z.object({ staffId: z.union([z.literal('any'), z.string().uuid()]).optional() }).strict(),
  }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(await series.resumeSeries(req.principal!.businessId, req.params.id, req.body.staffId));
  }),
);

appointmentsRouter.post(
  '/series/:id/cancel',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: seriesParam }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(await series.cancelSeries(req.principal!.businessId, req.params.id));
  }),
);

// ---- Phase 2: change all future visits, Book another time ----

/** Times a series visit could take on a day — a change's new time, a conflict's choice, Book another time. */
appointmentsRouter.get(
  '/series/:id/slots',
  limiters.ownerRead,
  requirePermission('appointments', 'manage'),
  validate({ params: seriesParam, query: seriesSlotsQuery }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(await series.ownerSeriesSlots(req.principal!.businessId, req.params.id, req.query as any));
  }),
);

/** What "change all future visits" would do — each date's fate and the dates that need a choice. */
appointmentsRouter.post(
  '/series/:id/preview-change',
  limiters.ownerRead,
  requirePermission('appointments', 'manage'),
  validate({ params: seriesParam, body: changeSchema }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(await series.previewChangeByOwner(req.principal!.businessId, req.params.id, req.body));
  }),
);

/** Change all future visits (new time and/or stylist). 409 CHANGE_CONFLICTS lists dates needing a choice. */
appointmentsRouter.patch(
  '/series/:id',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: seriesParam, body: changeSchema }),
  requireOwnRow('appointment_series'),
  asyncHandler(async (req, res) => {
    res.json(
      await series.changeSeriesByOwner(req.principal!.businessId, req.params.id, req.body, scopeStaffId(req.principal!)),
    );
  }),
);

/** "Book another time" for a Needs-attention date. Seat-scoped in the service (no `:id` for requireOwnRow). */
appointmentsRouter.post(
  '/series/issues/:issueId/book',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ issueId: z.string().uuid() }), body: moveSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await series.bookIssue(
        req.principal!.businessId,
        req.params.issueId,
        req.body,
        req.principal!.userId,
        scopeStaffId(req.principal!),
      ),
    );
  }),
);

appointmentsRouter.get(
  '/:id',
  limiters.ownerRead,
  requirePermission('appointments'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  requireOwnRow('appointment'),
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
      seriesId: data.series_id ?? null,
      cancelReason: data.cancel_reason ?? null,
      rescheduledAt: data.rescheduled_at ?? null,
    });
  }),
);

appointmentsRouter.post(
  '/:id/check-in',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  requireOwnRow('appointment'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await appts.checkIn(req.principal!.businessId, req.params.id));
  }),
);

appointmentsRouter.post(
  '/:id/cancel',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  requireOwnRow('appointment'),
  asyncHandler(async (req, res) => {
    res.json(await appts.setStatus(req.principal!.businessId, req.params.id, 'cancelled'));
  }),
);

/** Times this booking could move to on a day (owner window: up to today+60). */
appointmentsRouter.get(
  '/:id/slots',
  limiters.ownerRead,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }), query: slotsQuery }),
  requireOwnRow('appointment'),
  asyncHandler(async (req, res) => {
    res.json(await reschedule.ownerSlotsForAppointment(req.principal!.businessId, req.params.id, req.query as any));
  }),
);

/** Move any booking — one-off or series — to a free time. A staff login stays on its own chair. */
appointmentsRouter.post(
  '/:id/reschedule',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }), body: moveSchema }),
  requireOwnRow('appointment'),
  asyncHandler(async (req, res) => {
    res.json(
      await reschedule.rescheduleByOwner(req.principal!.businessId, req.params.id, req.body, scopeStaffId(req.principal!)),
    );
  }),
);

/** Skip one visit of a series; the rest of the series is untouched. */
appointmentsRouter.post(
  '/:id/skip',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  requireOwnRow('appointment'),
  asyncHandler(async (req, res) => {
    res.json(await series.skipVisit(req.principal!.businessId, req.params.id));
  }),
);

appointmentsRouter.post(
  '/:id/no-show',
  limiters.ownerWrite,
  requirePermission('appointments', 'manage'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  requireOwnRow('appointment'),
  asyncHandler(async (req, res) => {
    res.json(await appts.setStatus(req.principal!.businessId, req.params.id, 'no_show'));
  }),
);
