import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { MAX_IMAGE_BYTES, signUpload } from '../../integrations/storage';

const ASSET_TYPES = ['logo', 'hero', 'about', 'gallery', 'avatar'] as const;

export const uploadsRouter = Router();
uploadsRouter.use(authenticate);

uploadsRouter.post(
  '/sign',
  limiters.ownerWrite,
  // An avatar belongs to the staff screen and everything else to the business profile, so the
  // permission this needs depends on what is being uploaded rather than on the route.
  requireAnyPermission([
    ['profile', 'manage'],
    ['staff', 'manage'],
  ]),
  validate({
    body: z
      .object({
        assetType: z.enum(ASSET_TYPES),
        contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        byteSize: z.coerce.number().int().positive().max(MAX_IMAGE_BYTES),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.byteSize > MAX_IMAGE_BYTES) throw Errors.validation('File too large (max 5MB)');
    // Tenant-scoped key prefix — businessId comes from the token, never client input.
    const result = await signUpload(req.body.contentType, `${req.body.assetType}/${req.principal!.businessId}`);
    res.json({ uploadUrl: result.uploadUrl, fileKey: result.fileKey, publicUrl: result.publicUrl });
  }),
);
