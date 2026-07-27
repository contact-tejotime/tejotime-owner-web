import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

/**
 * S3-compatible object storage (Railway Buckets), shared by the owner uploads
 * route and the admin panel's provisioning uploads.
 *
 * The bucket is PRIVATE — Railway has no public-object mode — so we never hand
 * out a bucket URL directly. Writes use a short-lived signed PUT the client
 * uploads to; reads go through this API's GET /media/* route, which redirects to
 * a freshly signed GET. That keeps the URL we persist in the database stable
 * forever while the bytes still stream straight from the bucket.
 */

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Max image size accepted for a signed upload (bytes). */
export const MAX_IMAGE_BYTES = 5_000_000;

/** Public path prefix served by the media router. */
export const MEDIA_PATH = '/media';

/** The permanent, database-safe URL for an object key. */
export function mediaUrl(fileKey: string): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, '')}${MEDIA_PATH}/${fileKey}`;
}

export interface SignedUpload {
  uploadUrl: string; // absolute — the client PUTs the file bytes here
  fileKey: string;
  publicUrl: string; // stable /media/... URL, safe to persist
}

/** Create a signed upload URL for a new object at `<keyPrefix>/<uuid>.<ext>`. */
export async function signUpload(contentType: string, keyPrefix: string): Promise<SignedUpload> {
  const ext = IMAGE_MIME_EXT[contentType];
  if (!ext) throw new Error('Unsupported content type');

  const fileKey = `${keyPrefix}/${randomUUID()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: fileKey, ContentType: contentType }),
    { expiresIn: env.S3_UPLOAD_URL_TTL },
  );

  return { uploadUrl, fileKey, publicUrl: mediaUrl(fileKey) };
}

/** Sign a short-lived GET for an existing object — used by the /media redirect. */
export function signDownload(fileKey: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: fileKey }), {
    expiresIn: env.S3_DOWNLOAD_URL_TTL,
  });
}
