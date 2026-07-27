import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { env } from '../../config/env';
import { signDownload } from '../../integrations/storage';

/**
 * Public read path for uploaded images. The bucket is private, so this mints a
 * short-lived signed GET and redirects to it — the bytes come straight from the
 * bucket, and the URL persisted in the database (`/media/<key>`) never expires.
 */
export const mediaRouter = Router();

// Mirrors the key prefixes minted in uploads.routes.ts and admin.routes.ts, so a
// caller can't probe arbitrary bucket keys through this endpoint.
const KEY_PATTERN = /^(?:logo|hero|gallery|avatar|admin)\/[A-Za-z0-9_\-/]+\.(?:jpg|png|webp)$/;

mediaRouter.get(
  '/*',
  asyncHandler(async (req, res) => {
    const fileKey = decodeURIComponent(req.params[0] ?? '');
    if (!KEY_PATTERN.test(fileKey)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }

    const signed = await signDownload(fileKey);
    // Let clients reuse the redirect for a while, but always expire it well
    // before the signature it points at goes stale.
    res.set('Cache-Control', `public, max-age=${Math.floor(env.S3_DOWNLOAD_URL_TTL / 2)}`);
    res.redirect(302, signed);
  }),
);
