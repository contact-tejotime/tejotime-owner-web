import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as pub from './public.service';

const slugParam = z.object({ slug: z.string().min(1).max(80) });
const phoneParam = z.object({ phone: z.string().regex(/^\d{7,15}$/) });
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

const trackSchema = z.object({ phone: z.string().trim().min(4).max(20) }).strict();

export const publicRouter = Router();

publicRouter.get(
  '/businesses/:slug',
  limiters.publicRead,
  validate({ params: slugParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getMicrosite(req.params.slug));
  }),
);

// Live vCard (.vcf): rebuilt from the current business row on every request, so a scanned
// QR always saves the latest contact details. The QR image itself only needs the stable URL.
publicRouter.get(
  '/businesses/:slug/vcard',
  limiters.publicRead,
  validate({ params: slugParam }),
  asyncHandler(async (req, res) => {
    const vcf = await pub.getVCard(req.params.slug);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    // `?open=1` → inline, so a phone hands the .vcf straight to the OS and opens the Add-Contact
    // card directly (customer microsite, no download-then-open detour). Default stays `attachment`
    // so the admin "Download vCard" button and any other caller still get a saved file.
    const inline = req.query.open === '1' || req.query.open === 'true';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${req.params.slug}.vcf"`);
    // Never let a phone/browser/CDN serve a stale contact — every scan re-fetches the
    // latest details, so owner edits show up immediately on the next save-to-contacts.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.send(vcf);
  }),
);

// Phone-keyed microsite: the customer-facing URL is www.tejotime.com/<phone> where <phone>
// is the business's full international number (country_code + national number, digits only).
// This 2-segment path can't collide with the 1-segment '/businesses/:slug'.
publicRouter.get(
  '/businesses/by-phone/:phone',
  limiters.publicRead,
  validate({ params: phoneParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getMicrositeByPhone(req.params.phone));
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

// Track my turn: resolve the caller's active ticket for today from their phone number.
// Verified by the demo OTP on the client (see plan); revisit auth when real OTP ships.
publicRouter.post(
  '/businesses/:slug/track',
  limiters.publicWrite,
  validate({ params: slugParam, body: trackSchema }),
  asyncHandler(async (req, res) => {
    res.json(await pub.trackByPhone(req.params.slug, req.body));
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
