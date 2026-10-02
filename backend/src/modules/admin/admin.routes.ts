import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { Errors } from '../../domain/errors';
import { WRITABLE_SERVICE_PRICE_TYPES } from '../../domain/enums';
import { MAX_IMAGE_BYTES, signUpload } from '../../integrations/storage';
import { verifyAdminToken } from '../auth/token.service';
import { reviewUrl } from '../business/review-url.schema';
import { isValidTimezone } from '../../lib/phone-timezone';
import { isoDateSchema } from '../../lib/report-window';
import * as admin from './admin.service';
import * as analytics from './admin-analytics.service';
import * as inquiries from './admin-inquiries.service';
import { importStoreFromLink } from './store-import.service';
import * as drafts from './store-draft.service';

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
    // The row, not the token, is the source of truth for role and for still being allowed in:
    // tokens live 12h, and a demotion or deactivation has to bite on the very next request.
    const identity = await admin.getActiveAdminByMobile(claims.sub);
    if (!identity) return next(Errors.unauthenticated('Admin no longer authorized'));
    req.admin = { id: identity.id, mobile: identity.mobile, role: identity.role };
    next();
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') return next(Errors.tokenExpired());
    next(Errors.unauthenticated('Invalid token'));
  }
}

/** The admin on the request. Only ever called downstream of requireAdminAuth. */
function currentAdmin(req: Request): admin.AdminIdentity {
  const a = req.admin!;
  return { id: a.id, mobile: a.mobile, name: '', role: a.role };
}

/** Platform-wide surfaces an employee has no business seeing at all. */
function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (req.admin?.role !== 'owner') return next(Errors.forbidden('Owner access required'));
  next();
}

/**
 * Store-level authorization for every `/businesses/:id*` route.
 *
 * Denial is a 404, not a 403: a 403 would confirm that the id names a real store, turning this
 * endpoint into an oracle an employee could walk to enumerate the platform. "Not found" is the
 * same answer they get for a uuid that never existed.
 */
async function requireStoreAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (await admin.adminCanAccessBusiness(currentAdmin(req), req.params.id)) return next();
    next(Errors.notFound('Store not found'));
  } catch (err) {
    next(err);
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
  category: z.string().trim().min(1, 'Category is required').max(80),
  area: z.string().trim().min(1, 'Area is required').max(120),
  address: z.string().trim().min(1, 'Address is required').max(300),
  city: z.string().trim().min(1, 'City is required').max(80),
  tagline: z.string().trim().min(1, 'Tagline is required').max(160),
  heroSubtitle: z.string().max(200).optional(),
  statValue: z.string().max(40).optional(),
  statLabel: z.string().max(60).optional(),
  description: z.string().trim().min(1, 'Description is required').max(2000),
  aboutHeading: z.string().trim().min(1, 'About heading is required').max(160),
  heroImageUrl: z.string().url().max(500).optional(),
  aboutImageUrl: z.string().url().max(500).optional(),
  logoUrl: z.string().url().max(500).optional(),
  establishedYear: z.coerce.number().int().min(1900).max(2100).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  reviewCount: z.coerce.number().int().min(0).optional(),
  payments: z.array(z.string().min(1).max(60)).max(15).optional(),
  /**
   * Social profile URLs. `.url()` rejects a bare handle like "@tejotime" — these render as
   * links on a customer-facing page, so a value that cannot be clicked is worse than none.
   * `''` is allowed so the admin can clear a field; the service maps it to NULL.
   */
  instagramUrl: z.union([z.string().url().max(300), z.literal('')]).optional(),
  facebookUrl: z.union([z.string().url().max(300), z.literal('')]).optional(),
  twitterUrl: z.union([z.string().url().max(300), z.literal('')]).optional(),
  linkedinUrl: z.union([z.string().url().max(300), z.literal('')]).optional(),
  yelpUrl: z.union([z.string().url().max(300), z.literal('')]).optional(),
  googleReviewUrl: reviewUrl,
  // '' = "decide from the phone number" (the admin form's Automatic option); anything else must
  // be a real IANA zone, because dayjs.tz throws on a bad one and would take the microsite down.
  timezone: z
    .union([z.literal(''), z.string().max(64).refine(isValidTimezone, 'Unknown timezone')])
    .optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Expected ISO 4217 code').optional(),
  /** Per-store brand/accent hex for the customer microsite (#RRGGBB). */
  themeColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Expected #RRGGBB hex color')
    .optional(),
  /**
   * Full microsite theme config (stored as jsonb). Every field is optional so partial
   * saves are safe — the frontend theme engine fills any gap from the preset's defaults.
   * The id unions are mirrored here deliberately: the backend must not import from
   * frontend/, which is outside its Docker build context.
   */
  theme: z
    .object({
      preset: z.enum(['minimal', 'luxury', 'modern', 'bold', 'medical', 'warm']),
      mode: z.enum(['light', 'dark', 'auto']),
      brand: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected #RRGGBB hex color'),
      radius: z.enum(['sharp', 'medium', 'rounded']),
      shadow: z.enum(['none', 'soft', 'premium']),
      density: z.enum(['comfortable', 'compact']),
      animation: z.enum(['subtle', 'normal', 'rich']),
      heroVariant: z.enum(['split-classic', 'editorial', 'split-modern', 'full-bleed', 'trust', 'cozy']),
      accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected #RRGGBB hex color'),
      button: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected #RRGGBB hex color'),
      brandInk: z.enum(['auto', 'white', 'dark']),
    })
    .partial()
    .optional(),
  isActive: z.boolean().optional(),
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
    .max(7)
    .default([]),
  services: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(80),
          durationMinutes: z.coerce.number().int().min(1).max(600),
          // A zero used to mean "we'll fill the price in later" and shipped to customers as
          // "$0", so a positive figure is required for the two priced modes. Leaving a service
          // unpriced is now a deliberate mode of its own (`unset`) rather than a zero: the
          // microsite shows no price for it, and the owner types the amount at checkout.
          priceRupees: z.coerce.number().min(0).max(1_000_000).optional(),
          priceType: z.enum(WRITABLE_SERVICE_PRICE_TYPES).default('fixed'),
          /** Range ceiling, in rupees like `priceRupees`. Required for, and only for, a range. */
          priceMaxRupees: z.coerce.number().positive().max(1_000_000).nullable().optional(),
        })
        .superRefine((v, ctx) => {
          if (v.priceType !== 'unset' && !(v.priceRupees != null && v.priceRupees > 0)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceRupees'], message: 'Enter a price' });
          }
          if (v.priceType === 'range') {
            if (v.priceMaxRupees == null) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMaxRupees'], message: 'Enter a maximum price' });
            } else if (v.priceRupees != null && v.priceMaxRupees < v.priceRupees) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['priceMaxRupees'],
                message: 'Maximum price must be at least the minimum',
              });
            }
          } else if (v.priceMaxRupees != null) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceMaxRupees'], message: 'Only a price range has a maximum' });
          }
        }),
    )
    .max(50)
    .default([]),
  staff: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        roleLabel: z.string().max(80).nullable().optional(),
        avatarUrl: z.string().url().max(500).nullable().optional(),
      }),
    )
    .max(50)
    .default([]),
  faqs: z
    .array(z.object({ q: z.string().trim().min(1).max(200), a: z.string().trim().min(1).max(1000) }))
    .max(30)
    .default([]),
  reviews: z
    .array(
      z.object({
        stars: z.coerce.number().int().min(1).max(5),
        text: z.string().trim().min(1).max(1000),
        authorName: z.string().trim().min(1).max(120),
      }),
    )
    .max(50)
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
const resetOwnerPasswordSchema = z.object({ password: z.string().min(6).max(72) }).strict();
const idParam = z.object({ id: z.string().uuid() });

/**
 * A parked Create store form. `data` is deliberately loose — a draft is by definition incomplete
 * (no name, no phone, half a services list), so the storeFieldsSchema rules must NOT apply; they
 * run when the draft is finally submitted as a store. The size cap is what keeps it honest: a
 * real form is a few KB (images are URLs), so 256 KB is generous, and well under the 1 MB body
 * limit in app.ts.
 */
const MAX_DRAFT_BYTES = 256 * 1024;
const draftBodySchema = z
  .object({
    data: z
      .record(z.unknown())
      .refine((d) => Buffer.byteLength(JSON.stringify(d), 'utf8') <= MAX_DRAFT_BYTES, 'Draft is too large'),
  })
  .strict();
const customerVisitsParams = z.object({ id: z.string().uuid(), customerId: z.string().uuid() });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const dateRangeQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });

const requestOtpSchema = z.object({ mobile: z.string().min(6).max(20) }).strict();
const verifyOtpSchema = z.object({ mobile: z.string().min(6).max(20), otp: z.string().min(1).max(10) }).strict();
const loginSchema = z
  .object({ mobile: z.string().min(6).max(20), password: z.string().min(1).max(200) })
  .strict();

/**
 * Team management. `role` is absent by design — this endpoint only ever mints employees, so the
 * panel cannot be used to create a second owner even if the session is stolen.
 */
const createAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    mobile: z.string().regex(/^\d{6,20}$/, 'Digits only, including country code'),
    password: z.string().min(6).max(72),
  })
  .strict();

const updateAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    password: z.string().min(6).max(72).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const uploadSignSchema = z
  .object({
    assetType: z.enum(['hero', 'about', 'gallery', 'logo', 'avatar']),
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

// Mobile + shared static password login (mints the admin JWT).
adminRouter.post(
  '/auth/login',
  limiters.login,
  validate({ body: loginSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.loginAdmin(req.body.mobile, req.body.password));
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

// Read a business's web page and propose form values for the admin to review. Read-only: it
// writes nothing. Open to employees as well as owners — both can create stores.
adminRouter.post(
  '/store-import',
  limiters.storeImport,
  validate({ body: z.object({ url: z.string().trim().min(1).max(2048) }).strict() }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await importStoreFromLink(req.body.url));
  }),
);

// ---- Create store drafts. Private to the admin who saved them (owner or employee alike); a
// draft that is not yours is a 404. See store-draft.service.ts. ----

adminRouter.get(
  '/store-drafts',
  limiters.ownerRead,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await drafts.listDrafts(currentAdmin(req).id) });
  }),
);

adminRouter.get(
  '/store-drafts/:id',
  limiters.ownerRead,
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await drafts.getDraft(currentAdmin(req).id, req.params.id));
  }),
);

adminRouter.post(
  '/store-drafts',
  limiters.ownerWrite,
  validate({ body: draftBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await drafts.createDraft(currentAdmin(req).id, req.body.data));
  }),
);

adminRouter.put(
  '/store-drafts/:id',
  limiters.ownerWrite,
  validate({ params: idParam, body: draftBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await drafts.updateDraft(currentAdmin(req).id, req.params.id, req.body.data));
  }),
);

adminRouter.delete(
  '/store-drafts/:id',
  limiters.ownerWrite,
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    await drafts.deleteDraft(currentAdmin(req).id, req.params.id);
    res.status(204).end();
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
  validate({ query: z.object({ withMetrics: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentAdmin(req);
    res.json(await admin.listBusinesses(Boolean(req.query.withMetrics), me.role === 'owner' ? null : me.id));
  }),
);

/**
 * Who am I. The panel needs the role to decide which nav to render, and the JWT deliberately
 * does not carry one — a role baked into a 12h token would keep a demoted employee on the
 * owner's navigation until it expired.
 */
adminRouter.get(
  '/me',
  limiters.ownerRead,
  asyncHandler(async (req: Request, res: Response) => {
    const me = req.admin!;
    const identity = await admin.getActiveAdminByMobile(me.mobile);
    res.json({ id: me.id, mobile: me.mobile, role: me.role, name: identity?.name ?? '' });
  }),
);

// ---- Team: the owner managing platform employees. Owner-only, 403 otherwise. ----

adminRouter.get(
  '/admins',
  limiters.ownerRead,
  requireOwner,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await admin.listAdmins());
  }),
);

adminRouter.post(
  '/admins',
  limiters.ownerWrite,
  requireOwner,
  validate({ body: createAdminSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await admin.createEmployeeAdmin(req.body));
  }),
);

adminRouter.patch(
  '/admins/:id',
  limiters.ownerWrite,
  requireOwner,
  validate({ params: idParam, body: updateAdminSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.updateEmployeeAdmin(req.params.id, req.body));
  }),
);

// ---- Analytics (read-only, cross-tenant) — see admin-analytics.service.ts ----

adminRouter.get(
  '/analytics/overview',
  limiters.ownerRead,
  asyncHandler(async (req: Request, res: Response) => {
    // Owners get null (the whole platform); an employee gets their own store ids, including the
    // empty array — which the service reads as "zeroes", not "no filter".
    res.json(await analytics.getPlatformOverview(await admin.allowedBusinessIds(currentAdmin(req))));
  }),
);

// ---- Inquiries (read-only, platform-wide "Request access" leads) ----
// Owner-only: leads belong to the platform, not to whoever happens to have onboarded a store.

adminRouter.get(
  '/inquiries',
  limiters.ownerRead,
  requireOwner,
  validate({ query: dateRangeQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await inquiries.listInquiries(req.query.from as string | undefined, req.query.to as string | undefined));
  }),
);

adminRouter.get(
  '/businesses/:id/analytics',
  limiters.ownerRead,
  validate({ params: idParam, query: z.object({ range: z.enum(['30d', '90d']).default('90d') }) }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await analytics.getStoreAnalytics(req.params.id, req.query.range as '30d' | '90d'));
  }),
);

adminRouter.get(
  '/businesses/:id/customers',
  limiters.ownerRead,
  validate({
    params: idParam,
    query: z.object({
      search: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await analytics.listStoreCustomers(
        req.params.id,
        req.query.search as string | undefined,
        Number(req.query.limit ?? 200),
      ),
    );
  }),
);

adminRouter.get(
  '/businesses/:id/customers/:customerId/visits',
  limiters.ownerRead,
  validate({ params: customerVisitsParams }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await analytics.listCustomerVisits(req.params.id, req.params.customerId));
  }),
);

adminRouter.get(
  '/businesses/:id/visits',
  limiters.ownerRead,
  validate({ params: idParam, query: dateRangeQuery }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await analytics.listStoreVisits(
        req.params.id,
        req.query.from as string | undefined,
        req.query.to as string | undefined,
      ),
    );
  }),
);

// Read-only: the store's commission by stylist for a date range. Admins never set rates — that is
// the store owner's decision (owner-web / app, `PUT /commission/rates/:staffId`).
adminRouter.get(
  '/businesses/:id/commission',
  limiters.ownerRead,
  validate({ params: idParam, query: z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() }) }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await analytics.getStoreCommission(
        req.params.id,
        req.query.from as string | undefined,
        req.query.to as string | undefined,
      ),
    );
  }),
);

adminRouter.get(
  '/businesses/:id/appointments',
  limiters.ownerRead,
  validate({
    params: idParam,
    query: dateRangeQuery.extend({
      status: z.enum(['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show']).optional(),
    }),
  }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await analytics.listStoreAppointments(req.params.id, {
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        status: req.query.status as string | undefined,
      }),
    );
  }),
);

adminRouter.get(
  '/businesses/:id',
  limiters.ownerRead,
  validate({ params: idParam }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.getBusinessDetail(req.params.id));
  }),
);

adminRouter.post(
  '/businesses',
  limiters.ownerWrite,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // Stamped with the creator, which is what makes it visible to an employee afterwards.
    res.status(201).json(await admin.createBusiness(req.body, currentAdmin(req).id));
  }),
);

adminRouter.put(
  '/businesses/:id',
  limiters.ownerWrite,
  validate({ params: idParam }),
  requireStoreAccess,
  // A homepage demo store can't be disabled. Checked before the body schema so a bare
  // `{ isActive: false }` gets the 409 that says why — and so a broken check fails validation
  // instead of writing (updateBusiness re-checks with the full body).
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (req.body?.isActive === false) await admin.assertStoreCanBeDisabled(req.params.id);
    next();
  }),
  validate({ body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.updateBusiness(req.params.id, req.body));
  }),
);

adminRouter.post(
  '/businesses/:id/owner/password',
  limiters.ownerWrite,
  validate({ params: idParam, body: resetOwnerPasswordSchema }),
  requireStoreAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await admin.resetBusinessOwnerPassword(req.params.id, req.body.password));
  }),
);
