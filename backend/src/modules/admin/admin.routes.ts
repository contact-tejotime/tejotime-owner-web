import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { Errors } from '../../domain/errors';
import { COLOR_TOKENS } from '../../config/constants';
import { MAX_IMAGE_BYTES, signUpload } from '../../integrations/storage';
import { verifyAdminToken } from '../auth/token.service';
import * as admin from './admin.service';

/**
 * Provisioning + management API for the admin panel. Every route except the OTP login pair is
 * gated by an admin JWT (minted by verify-otp, sent as `Authorization: Bearer`). The mobile is
 * re-checked against the `admins` allow-list on each request so removing an admin revokes access.
 */
async function requireAdminAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(Errors.unauthenticated());
  try {
    const claims = verifyAdminToken(header.slice(7).trim());
    if (claims.typ !== 'admin') return next(Errors.unauthenticated());
    if (!(await admin.isKnownAdmin(claims.sub))) return next(Errors.unauthenticated('Admin no longer authorized'));
    req.admin = { mobile: claims.sub };
    next();
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') return next(Errors.tokenExpired());
    next(Errors.unauthenticated('Invalid token'));
  }
}

const timeStr = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM')
  .nullable()
  .optional();

/** The store fields shared by create + update (everything except the owner login). */
const storeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().max(80).optional(),
  area: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  tagline: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  aboutHeading: z.string().max(160).optional(),
  heroImageUrl: z.string().url().max(500).optional(),
  aboutImageUrl: z.string().url().max(500).optional(),
  establishedYear: z.coerce.number().int().min(1900).max(2100).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  reviewCount: z.coerce.number().int().min(0).optional(),
  payments: z.array(z.string().min(1).max(40)).max(10).optional(),
  timezone: z.string().max(64).optional(),
  countryCode: z.string().regex(/^\d{1,4}$/, 'Digits only'),
  phoneNumber: z.string().regex(/^\d{6,14}$/, 'Digits only'),
  hours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        opensAt: timeStr,
        closesAt: timeStr,
        isClosed: z.boolean().default(false),
      }),
    )
    .max(7)
    .default([]),
  amenities: z.array(z.string().min(1).max(60)).max(30).default([]),
  gallery: z
    .array(z.object({ url: z.string().url().max(500), alt: z.string().max(120).nullable().optional() }))
    .max(30)
    .default([]),
  services: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        durationMinutes: z.coerce.number().int().min(1).max(600),
        priceRupees: z.coerce.number().min(0).max(1_000_000),
        colorToken: z.enum(COLOR_TOKENS).default('secondary'),
      }),
    )
    .min(1, 'Add at least one service')
    .max(50),
  staff: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        roleLabel: z.string().max(80).nullable().optional(),
        colorToken: z.enum(COLOR_TOKENS).default('secondary'),
      }),
    )
    .min(1, 'Add at least one staff member')
    .max(50),
  faqs: z
    .array(z.object({ q: z.string().trim().min(1).max(200), a: z.string().trim().min(1).max(1000) }))
    .max(30)
    .default([]),
});

const createSchema = storeFieldsSchema
  .extend({
    owner: z.object({
      password: z.string().min(6).max(72),
      phone: z.string().regex(/^\d{7,15}$/).optional(),
    }),
  })
  .strict();

const updateSchema = storeFieldsSchema.strict();
const idParam = z.object({ id: z.string().uuid() });

const requestOtpSchema = z.object({ mobile: z.string().min(6).max(20) }).strict();
const verifyOtpSchema = z.object({ mobile: z.string().min(6).max(20), otp: z.string().min(1).max(10) }).strict();

const uploadSignSchema = z
  .object({
    assetType: z.enum(['hero', 'about', 'gallery', 'logo']),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    byteSize: z.coerce.number().int().positive().max(MAX_IMAGE_BYTES),
  })
  .strict();

export const adminRouter = Router();

// ---- Admin-panel login (mobile + OTP) — PUBLIC (no JWT exists yet) ----
// Rate-limited; the demo OTP logic lives in admin.service.ts. verify-otp mints the admin JWT.
adminRouter.post(
  '/auth/request-otp',
  limiters.otp,
  validate({ body: requestOtpSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.requestAdminOtp(req.body.mobile));
  }),
);

adminRouter.post(
  '/auth/verify-otp',
  limiters.login,
  validate({ body: verifyOtpSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.verifyAdminOtp(req.body.mobile, req.body.otp));
  }),
);

// Everything below requires a valid admin JWT.
adminRouter.use(requireAdminAuth);

// Signed upload URL for admin-panel photo uploads (stores are provisioned before an owner
// exists, so keys aren't tenant-scoped — they live under admin/<assetType>/).
adminRouter.post(
  '/uploads/sign',
  limiters.ownerWrite,
  validate({ body: uploadSignSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.body.byteSize > MAX_IMAGE_BYTES) throw Errors.validation('File too large (max 5MB)');
    const { uploadUrl, publicUrl } = await signUpload(req.body.contentType, `admin/${req.body.assetType}`);
    res.json({ uploadUrl, publicUrl });
  }),
);

adminRouter.get(
  '/lookups',
  limiters.ownerRead,
  validate({ query: z.object({ type: z.string().min(1).max(60) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.listLookups(req.query.type as string));
  }),
);

adminRouter.get(
  '/businesses',
  limiters.ownerRead,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await admin.listBusinesses());
  }),
);

adminRouter.get(
  '/businesses/:id',
  limiters.ownerRead,
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.getBusinessDetail(req.params.id));
  }),
);

adminRouter.post(
  '/businesses',
  limiters.ownerWrite,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await admin.createBusiness(req.body));
  }),
);

adminRouter.put(
  '/businesses/:id',
  limiters.ownerWrite,
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.updateBusiness(req.params.id, req.body));
  }),
);
