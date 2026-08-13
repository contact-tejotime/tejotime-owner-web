import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { t, format } from '@/i18n';
import { api } from '@/lib/api';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5_000_000;

export type UploadAssetType = 'logo' | 'hero' | 'about' | 'gallery' | 'avatar';

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
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
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
