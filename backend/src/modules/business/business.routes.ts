import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as business from './business.service';

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    category: z.string().max(80).optional(),
    area: z.string().max(120).optional(),
    address: z.string().max(300).optional(),
    city: z.string().max(80).optional(),
    tagline: z.string().max(160).optional(),
    description: z.string().max(2000).optional(),
    establishedYear: z.coerce.number().int().min(1900).max(2100).optional(),
    logoUrl: z.string().url().optional(),
    heroImageUrl: z.string().url().optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict();

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

businessRouter.get('/', limiters.ownerRead, asyncHandler(async (req, res) => {
  res.json(await business.getBusiness(req.principal!.businessId));
}));

businessRouter.patch(
  '/',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ body: patchSchema }),
  asyncHandler(async (req, res) => {
    res.json(await business.updateBusiness(req.principal!.businessId, req.body));
  }),
);

businessRouter.put(
  '/hours',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ body: hoursSchema }),
  asyncHandler(async (req, res) => {
    res.json(await business.setHours(req.principal!.businessId, req.body.hours));
  }),
);

businessRouter.put(
  '/amenities',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({ body: amenitiesSchema }),
  asyncHandler(async (req, res) => {
    res.json(await business.setAmenities(req.principal!.businessId, req.body.amenities));
  }),
);

businessRouter.get('/qr', limiters.ownerRead, asyncHandler(async (req, res) => {
  res.json(await business.getQr(req.principal!.businessId));
}));
