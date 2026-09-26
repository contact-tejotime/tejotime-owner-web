import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { t, format } from '@/i18n';
import { api } from '@/lib/api';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5_000_000;

export type UploadAssetType = 'logo' | 'hero' | 'about' | 'gallery' | 'avatar';

/**
 * Smallest photo each slot accepts, in px. Hand-mirror of `minWidth`/`minHeight` in the web
 * cropper's CROP_CONFIG (admin-panel/src/components/image-crop/assets.ts) — change the two
 * together. Below this the microsite stretches the photo and it looks soft.
 */
const MIN_SIZE: Record<UploadAssetType, { width: number; height: number }> = {
  logo: { width: 400, height: 400 },
  hero: { width: 1600, height: 1200 },
  about: { width: 1600, height: 900 },
  gallery: { width: 1080, height: 1080 },
  avatar: { width: 400, height: 400 },
};

type PickOptions = {
  aspect?: [number, number];
  allowsEditing?: boolean;
};

/**
 * Pick an image from the library and upload it via the backend's signed-URL flow.
 * Returns the public URL, or null if the user canceled / denied permission.
 */
export async function pickAndUploadImage(
  assetType: UploadAssetType,
  opts: PickOptions = {},
): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(t.upload.permissionTitle, t.upload.permissionBody);
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: opts.allowsEditing ?? false,
    aspect: opts.aspect,
    quality: 0.98,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];

  // With allowsEditing the picker reports the cropped size, which is the one that matters. A
  // zero/missing size (some Android providers) is let through rather than blocking every upload.
  const min = MIN_SIZE[assetType];
  if (asset.width && asset.height && (asset.width < min.width || asset.height < min.height)) {
    Alert.alert(
      t.upload.tooSmallTitle,
      format(t.upload.tooSmallBody, {
        size: `${asset.width}×${asset.height}`,
        min: `${min.width}×${min.height}`,
      }),
    );
    return null;
  }

  const contentType = ALLOWED_TYPES.has(asset.mimeType ?? '') ? (asset.mimeType as string) : 'image/jpeg';

  const file = new File(asset.uri);
  const byteSize = asset.fileSize ?? file.size;
  if (byteSize > MAX_BYTES) {
    Alert.alert(t.upload.tooLargeTitle, t.upload.tooLargeBody);
    return null;
  }

  const { uploadUrl, publicUrl } = await api.signUpload({ assetType, contentType, byteSize });

  const put = await file.upload(uploadUrl, {
    httpMethod: 'PUT',
    headers: { 'content-type': contentType },
  });
  if (put.status < 200 || put.status >= 300) throw new Error(format(t.errors.uploadFailed, { status: put.status }));

  return publicUrl;
}

/** Square avatar upload used by staff editor. */
export async function pickAndUploadAvatar(): Promise<string | null> {
  return pickAndUploadImage('avatar', { aspect: [1, 1], allowsEditing: true });
}
