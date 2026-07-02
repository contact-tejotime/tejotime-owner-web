import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as pub from './public.service';

const slugParam = z.object({ slug: z.string().min(1).max(80) });
const ticketParam = z.object({ ticketId: z.string().uuid() });

const joinSchema = z
  .object({
    serviceId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(4).max(20),
    preferredStaffId: z.string().optional(),
  })
  .strict();

const bookSchema = joinSchema.extend({ slotStart: z.string().datetime() }).strict();

export const publicRouter = Router();

publicRouter.get(
  '/businesses/:slug',
  limiters.publicRead,
  validate({ params: slugParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getMicrosite(req.params.slug));
  }),
);

publicRouter.get(
  '/businesses/:slug/availability',
  limiters.publicRead,
  validate({ params: slugParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getAvailability(req.params.slug));
  }),
);

publicRouter.get(
  '/businesses/:slug/staff',
  limiters.publicRead,
  validate({ params: slugParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getStaffAvailability(req.params.slug));
  }),
);

publicRouter.get(
  '/businesses/:slug/slots',
  limiters.publicRead,
  validate({
    params: slugParam,
    query: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      serviceId: z.string().uuid().optional(),
      staffId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await pub.getSlots(
        req.params.slug,
        req.query.date as string,
        req.query.serviceId as string | undefined,
        req.query.staffId as string | undefined,
      ),
    );
  }),
);

publicRouter.post(
  '/businesses/:slug/queue',
  limiters.publicWrite,
  validate({ params: slugParam, body: joinSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await pub.joinQueue(req.params.slug, req.body));
  }),
);

publicRouter.post(
  '/businesses/:slug/appointments',
  limiters.publicWrite,
  validate({ params: slugParam, body: bookSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await pub.bookSlot(req.params.slug, req.body));
  }),
);

publicRouter.get(
  '/tickets/:ticketId',
  limiters.publicRead,
  validate({ params: ticketParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getTicket(req.params.ticketId));
  }),
);

publicRouter.delete(
  '/tickets/:ticketId',
  limiters.publicWrite,
  validate({ params: ticketParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.leaveTicket(req.params.ticketId));
  }),
);
