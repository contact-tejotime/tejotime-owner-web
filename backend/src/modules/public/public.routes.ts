import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as pub from './public.service';
import * as series from '../appointments/series.service';
import { chatWithPlatform, chatWithStore } from './chat.service';
import { countryFromHeaders, recordConsent } from './consent.service';
import { MAX_SERVICES_PER_VISIT } from '../../config/constants';
import { env } from '../../config/env';
import { SERIES_LIMITS } from '../../lib/recurrence';
import { changeSchema, moveSchema, publicSeriesSlotsQuery, slotsQuery } from '../appointments/series.schemas';

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
    // 'any' or a UUID. A free string used to reach Postgres as-is, where a malformed id became a
    // 500 (22P02). Whether the id is an active stylist of THIS store is checked in the service.
    preferredStaffId: z.union([z.literal('any'), z.string().uuid()]).optional(),
    visitorType: z.enum(['mr', 'patient']).optional(),
    // Optional, default false: missing/old clients must never become "yes, text them".
    smsOptIn: z.boolean().optional().default(false),
    // The separate post-visit review box (marketing). Same default-false rule.
    reviewSmsOptIn: z.boolean().optional().default(false),
  })
  .strict();

/**
 * "Repeat this booking?" — every N days, until an end (docs/recurring-appointments.md). The bounds
 * here are the shape; `ruleProblem` re-checks them with the dates in hand (an "until" that leaves
 * no second visit, an end more than a year out).
 */
const repeatSchema = z
  .object({
    everyDays: z.number().int().min(SERIES_LIMITS.minEveryDays).max(SERIES_LIMITS.maxEveryDays),
    end: z.discriminatedUnion('type', [
      z.object({ type: z.literal('never') }).strict(),
      z.object({ type: z.literal('count'), count: z.number().int().min(SERIES_LIMITS.minCount).max(SERIES_LIMITS.maxCount) }).strict(),
      z.object({ type: z.literal('until'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
    ]),
  })
  .strict();

const bookSchema = joinSchema.extend({ slotStart: z.string().datetime(), repeat: repeatSchema.optional() }).strict();

const seriesPreviewSchema = z
  .object({
    ...serviceSelection,
    preferredStaffId: z.union([z.literal('any'), z.string().uuid()]).optional(),
    slotStart: z.string().datetime(),
    repeat: repeatSchema,
  })
  .strict();

/**
 * The series manage token (16 url-safe chars) rides in a header, never the URL, so it stays out of
 * request logs — the customer's link carries it after `#`, which a browser never sends either.
 * Anything malformed cannot match, so it is dropped here and answered as "not found".
 */
const SERIES_TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
const seriesToken = (raw: string | undefined) => (raw && SERIES_TOKEN_RE.test(raw) ? raw : undefined);

const trackSchema = z.object({ phone: z.string().trim().min(4).max(20) }).strict();

/**
 * My appointments lookup — a full international number only (a leading +, 8–15 digits).
 * normalizePhone reads a bare 10-digit number as +1 (US). That was harmless while the lookup only
 * showed bookings. Now it returns the keys that move and cancel them, so an Indian "9876543210"
 * must not open a stranger's +1 9876543210 bookings. The booking page always sends +<cc><number>.
 */
const lookupSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .max(24)
      .refine((v) => /^\+[\d\s().-]+$/.test(v) && /^\d{8,15}$/.test(v.replace(/\D/g, '')), {
        message: 'Enter the number with its country code',
      }),
  })
  .strict();

const appointmentParam = z.object({ appointmentId: z.string().uuid() });
// The key is 24 hex chars (a truncated HMAC); anything else cannot verify, so reject it at the edge.
const appointmentKeyField = z.string().regex(/^[0-9a-f]{24}$/);
const appointmentKeyHeader = (raw: string | undefined) =>
  raw && appointmentKeyField.safeParse(raw).success ? raw : undefined;
const cancelAppointmentSchema = z.object({ key: appointmentKeyField }).strict();
const rescheduleAppointmentSchema = moveSchema.extend({ key: appointmentKeyField }).strict();

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

// Backs the review SMS short link www.tejotime.com/<phone>/r: the frontend route reads this and
// 302s to it. 404 when the store is unknown or has no link (the route then falls back to the
// store page). no-store so an owner's edit applies on the very next click.
publicRouter.get(
  '/businesses/by-phone/:phone/review-link',
  limiters.publicRead,
  validate({ params: phoneParam }),
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(await pub.getReviewLinkByPhone(req.params.phone));
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

// What a repeat rule would book — the dates the customer sees before confirming. Read-only, so
// the read limiter, even though the rule travels in a body.
publicRouter.post(
  '/businesses/:slug/series-preview',
  limiters.publicRead,
  validate({ params: slugParam, body: seriesPreviewSchema }),
  asyncHandler(async (req, res) => {
    res.json(await pub.previewSeries(req.params.slug, req.body));
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

// My appointments: upcoming bookings for a phone at this store, WITH the keys and series token that
// move and cancel them. Client decision, 2026-10-05 (docs/customer-my-appointments.md): the phone
// alone is enough, from any device. publicWrite, like /track, because it is a phone-number lookup
// and must not be cheap to enumerate.
publicRouter.post(
  '/businesses/:slug/appointments/lookup',
  limiters.publicWrite,
  validate({ params: slugParam, body: lookupSchema }),
  asyncHandler(async (req, res) => {
    res.json(await pub.lookupAppointments(req.params.slug, req.body));
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
    // The ticket key rides in a header (not the URL) so it never lands in request logs.
    const raw = req.get('x-ticket-key');
    res.json(await pub.leaveTicket(req.params.ticketId, raw && /^[0-9a-f]{24}$/.test(raw) ? raw : undefined));
  }),
);

// Appointment self-service, keyed by the appointmentKey. The booking response hands it to the
// booking browser, and the phone lookup above hands it to any device. On a read the key travels in a
// header, not the query string, so it never lands in request logs. A missing or wrong key is a 404
// (not 403), so ids cannot be probed.
publicRouter.get(
  '/appointments/:appointmentId',
  limiters.publicRead,
  validate({ params: appointmentParam }),
  asyncHandler(async (req, res) => {
    res.json(await pub.getPublicAppointment(req.params.appointmentId, appointmentKeyHeader(req.get('x-appointment-key'))));
  }),
);

// Moving a booking — a one-off, or one visit of a series — to a free time today … today+20, the
// same range as the series manage page.
publicRouter.get(
  '/appointments/:appointmentId/slots',
  limiters.publicRead,
  validate({ params: appointmentParam, query: slotsQuery }),
  asyncHandler(async (req, res) => {
    res.json(
      await pub.publicAppointmentSlots(
        req.params.appointmentId,
        appointmentKeyHeader(req.get('x-appointment-key')),
        req.query as any,
      ),
    );
  }),
);

publicRouter.post(
  '/appointments/:appointmentId/reschedule',
  limiters.publicWrite,
  validate({ params: appointmentParam, body: rescheduleAppointmentSchema }),
  asyncHandler(async (req, res) => {
    res.json(await pub.reschedulePublicAppointment(req.params.appointmentId, req.body));
  }),
);

publicRouter.post(
  '/appointments/:appointmentId/cancel',
  limiters.publicWrite,
  validate({ params: appointmentParam, body: cancelAppointmentSchema }),
  asyncHandler(async (req, res) => {
    res.json(await pub.cancelPublicAppointment(req.params.appointmentId, req.body.key));
  }),
);

// Recurring series self-service, keyed by the manage token (X-Series-Token). The token comes from
// the booking screen, the confirmation SMS, or the My appointments phone lookup (client decision,
// 2026-10-05). A missing or wrong token is a 404, so tokens cannot be probed.
publicRouter.get(
  '/series',
  limiters.publicRead,
  asyncHandler(async (req, res) => {
    res.json(await series.getSeriesByToken(seriesToken(req.get('x-series-token'))));
  }),
);

publicRouter.post(
  '/series/visits/:appointmentId/skip',
  limiters.publicWrite,
  validate({ params: appointmentParam }),
  asyncHandler(async (req, res) => {
    res.json(await series.skipVisitByToken(seriesToken(req.get('x-series-token')), req.params.appointmentId));
  }),
);

publicRouter.post(
  '/series/cancel',
  limiters.publicWrite,
  asyncHandler(async (req, res) => {
    res.json(await series.cancelSeriesByToken(seriesToken(req.get('x-series-token'))));
  }),
);

// Phase 2 — move one visit, change all future visits (same token rule). The customer's range is
// today … today+20, the job's horizon, where every series date is already booked.
publicRouter.get(
  '/series/slots',
  limiters.publicRead,
  validate({ query: publicSeriesSlotsQuery }),
  asyncHandler(async (req, res) => {
    res.json(await series.seriesSlotsByToken(seriesToken(req.get('x-series-token')), req.query as any));
  }),
);

publicRouter.post(
  '/series/visits/:appointmentId/reschedule',
  limiters.publicWrite,
  validate({ params: appointmentParam, body: moveSchema }),
  asyncHandler(async (req, res) => {
    res.json(
      await series.rescheduleVisitByToken(seriesToken(req.get('x-series-token')), req.params.appointmentId, req.body),
    );
  }),
);

// Read-only, so the read limiter, though the request travels in a body.
publicRouter.post(
  '/series/preview-change',
  limiters.publicRead,
  validate({ body: changeSchema }),
  asyncHandler(async (req, res) => {
    res.json(await series.previewChangeByToken(seriesToken(req.get('x-series-token')), req.body));
  }),
);

publicRouter.post(
  '/series/change',
  limiters.publicWrite,
  validate({ body: changeSchema }),
  asyncHandler(async (req, res) => {
    res.json(await series.changeSeriesByToken(seriesToken(req.get('x-series-token')), req.body));
  }),
);
