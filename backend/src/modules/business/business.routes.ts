import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/require-permission';
import { isOwnerRole } from '../../domain/permissions';
import { Errors } from '../../domain/errors';

/** Owner / co-owner only. The service re-checks; this gives a clear 403 before validation. */
function requireOwnerRole(req: any, _res: any, next: any) {
  if (!req.principal) return next(Errors.unauthenticated());
  if (!isOwnerRole(req.principal.role)) {
    return next(Errors.forbidden('Only the business owner can change how the store is presented'));
  }
  next();
}
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as business from './business.service';

/** A social profile URL, or '' to clear it. Mirrors the admin panel's rule exactly. */
const socialUrl = z.union([z.string().url().max(300), z.literal('')]).optional();

/**
 * Partial update of the owner's own store.
 *
 * Every key stays optional so the Expo app's `{ name, address }` patch keeps working unchanged.
 * The service decides which of these a given role may actually write — a staff member with
 * `profile: manage` is refused the public-face fields rather than having them dropped silently.
 */
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    category: z.string().max(80).optional(),
    area: z.string().max(120).optional(),
    address: z.string().max(300).optional(),
    city: z.string().max(80).optional(),
    tagline: z.string().max(160).optional(),
    heroSubtitle: z.string().max(200).optional(),
    statValue: z.string().max(40).optional(),
    statLabel: z.string().max(60).optional(),
    description: z.string().max(2000).optional(),
    aboutHeading: z.string().max(160).optional(),
    // null / '' clears the year (owner emptied the field).
    establishedYear: z
      .union([z.coerce.number().int().min(1900).max(2100), z.null(), z.literal('')])
      .optional(),
    // '' clears the image the same way social URLs clear.
    logoUrl: z.union([z.string().url(), z.literal('')]).optional(),
    heroImageUrl: z.union([z.string().url(), z.literal('')]).optional(),
    aboutImageUrl: z.union([z.string().url(), z.literal('')]).optional(),
    instagramUrl: socialUrl,
    facebookUrl: socialUrl,
    twitterUrl: socialUrl,
    linkedinUrl: socialUrl,
    payments: z.array(z.string().min(1).max(40)).max(10).optional(),
    faqs: z.array(z.object({ q: z.string().min(1).max(200), a: z.string().min(1).max(1000) })).max(20).optional(),
    reviews: z
      .array(
        z.object({
          stars: z.coerce.number().min(0).max(5),
          text: z.string().min(1).max(600),
          authorName: z.string().min(1).max(80),
        }),
      )
      .max(20)
      .optional(),
    themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected #RRGGBB hex color').optional(),
    /**
     * Full microsite appearance. Partial on purpose — an absent modifier means "whatever this
     * preset ships with", which is how switching preset picks up its own radius/shadow rather
     * than dragging the previous one's along. Unions mirrored from the frontend engine; the
     * backend cannot import from frontend/, which is outside its Docker build context.
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
        brandInk: z.enum(['auto', 'white', 'dark']),
      })
      .partial()
      .optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict();

const gallerySchema = z.object({
  images: z
    .array(z.object({ url: z.string().url().max(500), alt: z.string().max(160).nullable().optional() }))
    .max(24),
});

const hoursSchema = z.object({
  hours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        opensAt: z.string().nullable().optional(),
        closesAt: z.string().nullable().optional(),
        isClosed: z.boolean().default(false),
      }),
    )
    .max(7),
});

const amenitiesSchema = z.object({ amenities: z.array(z.string().min(1).max(60)).max(30) });

export const businessRouter = Router();
businessRouter.use(authenticate);

businessRouter.get('/', limiters.ownerRead, requirePermission('profile'), asyncHandler(async (req, res) => {
  res.json(await business.getBusiness(req.principal!.businessId));
}));

businessRouter.patch(
  '/',
  limiters.ownerWrite,
  requirePermission('profile', 'manage'),
  validate({ body: patchSchema }),
  asyncHandler(async (req, res) => {
    // businessId comes from the token — a client can only ever edit its own store.
    res.json(
      await business.updateBusiness(req.principal!.businessId, req.body, {
        isOwner: isOwnerRole(req.principal!.role),
      }),
    );
  }),
);

/**
 * Replace the gallery. Owner-role only for the same reason the hero and About images are: the
 * gallery is the store's public shopfront, not an operational setting.
 */
businessRouter.put(
  '/gallery',
  limiters.ownerWrite,
  requirePermission('profile', 'manage'),
  requireOwnerRole,
  validate({ body: gallerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await business.setGallery(req.principal!.businessId, req.body.images));
  }),
);

businessRouter.put(
  '/hours',
  limiters.ownerWrite,
  requirePermission('hours', 'manage'),
  validate({ body: hoursSchema }),
  asyncHandler(async (req, res) => {
    res.json(await business.setHours(req.principal!.businessId, req.body.hours));
  }),
);

/** Owner-role only: amenities are shopfront copy, not an operational setting. */
businessRouter.put(
  '/amenities',
  limiters.ownerWrite,
  requirePermission('profile', 'manage'),
  requireOwnerRole,
  validate({ body: amenitiesSchema }),
  asyncHandler(async (req, res) => {
    res.json(await business.setAmenities(req.principal!.businessId, req.body.amenities));
  }),
);

businessRouter.get('/qr', limiters.ownerRead, requirePermission('profile'), asyncHandler(async (req, res) => {
  res.json(await business.getQr(req.principal!.businessId));
}));
