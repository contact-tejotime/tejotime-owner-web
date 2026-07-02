import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../db/supabase';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';

const ASSET_TYPES = ['logo', 'hero', 'gallery', 'avatar'] as const;
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const { data } = await supabase.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
  if (!data) {
    await supabase.storage.createBucket(env.SUPABASE_STORAGE_BUCKET, { public: true });
  }
  bucketEnsured = true;
}

export const uploadsRouter = Router();
uploadsRouter.use(authenticate);

uploadsRouter.post(
  '/sign',
  limiters.ownerWrite,
  authorize('owner', 'manager'),
  validate({
    body: z
      .object({
        assetType: z.enum(ASSET_TYPES),
        contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        byteSize: z.coerce.number().int().positive().max(env.SUPABASE_STORAGE_BUCKET ? 20_000_000 : 5_000_000),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.byteSize > 5_000_000) throw Errors.validation('File too large (max 5MB)');
    await ensureBucket();
    const ext = MIME_EXT[req.body.contentType];
    const key = `${req.body.assetType}/${req.principal!.businessId}/${randomUUID()}.${ext}`;

    const { data, error } = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .createSignedUploadUrl(key);
    if (error) throw new Error(error.message);

    const publicUrl = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(key).data.publicUrl;
    res.json({ uploadUrl: data.signedUrl, token: data.token, fileKey: key, publicUrl });
  }),
);
