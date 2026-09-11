import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as pub from './public.service';
import { chatWithPlatform, chatWithStore } from './chat.service';
import { countryFromHeaders, recordConsent } from './consent.service';
import { MAX_SERVICES_PER_VISIT } from '../../config/constants';
import { env } from '../../config/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const slugParam = z.object({ slug: z.string().min(1).max(80) });
const phoneParam = z.object({ phone: z.string().regex(/^\d{7,15}$/) });
const ticketParam = z.object({ ticketId: z.string().uuid() });

/**
 * A visit can carry several services ("haircut AND a hair spa").
 *
 * `serviceIds` is the current field; `serviceId` is kept because it is what every already-shipped
 * client sends — a stale microsite bundle or an older build of the Expo app must keep working.
 * When both arrive, `serviceIds` wins and `serviceId` is folded in as the first entry.
 */
const serviceSelection = {
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).max(MAX_SERVICES_PER_VISIT).optional(),
};

const joinSchema = z
  .object({
    ...serviceSelection,
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(4).max(20),
    preferredStaffId: z.string().optional(),
    visitorType: z.enum(['mr', 'patient']).optional(),
  })
  .strict();

const bookSchema = joinSchema.extend({ slotStart: z.string().datetime() }).strict();

const trackSchema = z.object({ phone: z.string().trim().min(4).max(20) }).strict();

const inquirySchema = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1).max(300),
    phone: z.string().trim().min(4).max(20),
  })
  .strict();

/**
 * Cookie-consent record. `.strict()` so an unexpected field is a 400 rather than being quietly
 * dropped — notably `countryCode`, which a client must NOT be able to supply: the server derives
 * it from the edge headers instead (see consent.service.ts).
 */
const consentSchema = z
  .object({
    visitorId: z.string().uuid(),
    necessary: z.literal(true),
    analytics: z.boolean(),
    marketing: z.boolean(),
    preferences: z.boolean(),
    timestamp: z.string().datetime(),
    policyVersion: z.string().trim().min(1).max(40),
  })
  .strict();

/** Slug or digits-only full phone — see `resolveBusinessByKey`. */
const keyParam = z.object({ key: z.string().trim().min(1).max(80) });

/**
 * Chat is stateless on the server, so the client carries the recent turns. A turn may be one
 * of the bot's own replies (an hours list runs longer than a customer message), hence the looser
 * per-turn cap; the count is bounded by CHATBOT_MAX_HISTORY. `sessionId` is only for log
 * correlation — nothing is keyed on it.
 */
const chatTurnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2_000),
  })
  .strict();
const chatSchema = z
  .object({
    message: z.string().trim().min(1).max(env.CHATBOT_MAX_MESSAGE_CHARS),
    sessionId: z.string().uuid(),
    history: z.array(chatTurnSchema).max(env.CHATBOT_MAX_HISTORY).optional(),
  })
  .strict();

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
      // Comma-separated because this is a query string. The slot LENGTH is the sum of the chosen
      // services, so a haircut + spa books a 90-minute hole rather than a 30-minute one that the
      // next customer would then be offered on top of.
      serviceIds: z
        .string()
        .optional()
        .transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
        .refine((v) => !v || (v.length <= MAX_SERVICES_PER_VISIT && v.every((x) => UUID_RE.test(x))), {
          message: 'serviceIds must be up to 10 comma-separated UUIDs',
        }),
      staffId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(
      await pub.getSlots(
        req.params.slug,
        req.query.date as string,
        (req.query.serviceIds as unknown as string[] | undefined) ??
          (req.query.serviceId ? [req.query.serviceId as string] : undefined),
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

// Microsite help chat. Read-only — it answers from FAQs and public facts and may point at the
// page's Join / Book / Track / Call buttons, but never joins, books or checks anyone out.
// Its own limiter: free text that may fan out to a metered LLM free tier is the most
// abuse-prone public write there is. 404 (CHATBOT_DISABLED) while the flag is off.
publicRouter.post(
  '/businesses/:key/chat',
  limiters.publicChat,
  validate({ params: keyParam, body: chatSchema }),
  asyncHandler(async (req, res) => {
    res.json(await chatWithStore(req.params.key, req.body));
  }),
);

// Is the help chat switched on at all? The marketing landing page is statically rendered and
// has no business payload to carry the flag, so it asks here on mount and stays hidden unless
// this says yes (and if the call fails, it also stays hidden). Cheap, cacheable, no secrets.
publicRouter.get(
  '/chat/status',
  limiters.publicRead,
  asyncHandler(async (_req, res) => {
    res.json({ enabled: env.CHATBOT_ENABLED });
  }),
);

// Cookie consent audit log. Fire-and-forget from the browser: the banner never awaits this and
// never surfaces a failure, because the visitor's own cookie already governs behaviour. 204 so
// there is no body for a client to depend on.
publicRouter.post(
  '/consent',
  limiters.consent,
  validate({ body: consentSchema }),
  asyncHandler(async (req, res) => {
    await recordConsent(req.body, countryFromHeaders(req));
    res.status(204).end();
  }),
);

// Marketing-site help chat (tejotime.com/). No business key: it answers about the PRODUCT —
// what TejoTime is, who it is for, what it costs — from a fixed fact sheet, and points at the
// landing page's own sections and its Request-access CTA. Read-only, same as the store chat.
// Declared before '/businesses/:key/chat' is irrelevant (different shape), but it shares that
// route's limiter and body schema so the two surfaces cannot drift apart.
publicRouter.post(
  '/chat',
  limiters.publicChat,
  validate({ body: chatSchema }),
  asyncHandler(async (req, res) => {
    res.json(await chatWithPlatform(req.body));
  }),
);

// Public "Request access" lead capture from the marketing site — no business context yet,
// so this is the only fully-anonymous write in the public API (see the dedicated `inquiries`
// rate-limit bucket).
publicRouter.post(
  '/inquiries',
  limiters.inquiries,
  validate({ body: inquirySchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await pub.submitInquiry(req.body));
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
