import { randomUUID } from 'node:crypto';
import { supabase } from '../db/supabase';
import { env } from '../config/env';

/**
 * Supabase Storage helpers, shared by the owner uploads route and the admin panel's
 * provisioning uploads. Serving is via public URLs (the bucket is created public); writes
 * use short-lived signed upload URLs so the client PUTs bytes straight to Storage.
 */

export const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Max image size accepted for a signed upload (bytes). */
export const MAX_IMAGE_BYTES = 5_000_000;

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const { data } = await supabase.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
  if (!data) {
    await supabase.storage.createBucket(env.SUPABASE_STORAGE_BUCKET, { public: true });
  }
  bucketEnsured = true;
}

export interface SignedUpload {
  uploadUrl: string; // absolute — the client PUTs the file bytes here
  token: string;
  fileKey: string;
  publicUrl: string;
}

/**
 * Create a signed upload URL for a new object at `<keyPrefix>/<uuid>.<ext>`.
 * `data.signedUrl` from supabase-js is a relative path, so we return an absolute URL the
 * caller can PUT to directly.
 */
export async function signUpload(contentType: string, keyPrefix: string): Promise<SignedUpload> {
  const ext = IMAGE_MIME_EXT[contentType];
  if (!ext) throw new Error('Unsupported content type');
  await ensureBucket();

  const fileKey = `${keyPrefix}/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).createSignedUploadUrl(fileKey);
  if (error || !data) throw new Error(error?.message ?? 'Failed to sign upload');

  const signed = data.signedUrl;
  const uploadUrl = signed.startsWith('http')
    ? signed
    : `${env.SUPABASE_URL}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
  const publicUrl = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(fileKey).data.publicUrl;

  return { uploadUrl, token: data.token, fileKey, publicUrl };
}
