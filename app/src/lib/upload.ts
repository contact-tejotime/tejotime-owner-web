import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { api } from '@/lib/api';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5_000_000;

/**
 * Pick a square image from the library and upload it to object storage via the
 * backend's signed-URL flow. Returns the public URL, or null if the user canceled
 * or denied permission. Throws on sign/upload failure (caller should toast).
 */
export async function pickAndUploadAvatar(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo library access to add a staff photo.');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const contentType = ALLOWED_TYPES.has(asset.mimeType ?? '') ? (asset.mimeType as string) : 'image/jpeg';

  // Reference the picked file on disk — reading it into a Blob via fetch().blob() throws
  // on-device ("Creating blobs from 'ArrayBuffer' ... are not supported"), so upload straight
  // from the file instead of buffering it in memory first.
  const file = new File(asset.uri);
  const byteSize = asset.fileSize ?? file.size;
  if (byteSize > MAX_BYTES) {
    Alert.alert('Photo too large', 'Please choose an image under 5 MB.');
    return null;
  }

  // 1) Signed upload URL from the backend (tenant-scoped by the auth token).
  const { uploadUrl, publicUrl } = await api.signUpload({ assetType: 'avatar', contentType, byteSize });

  // 2) PUT the bytes to object storage (mirrors the admin-panel upload proxy). The
  // signed URL covers content-type, so no extra headers — an unsigned one breaks it.
  const put = await file.upload(uploadUrl, {
    httpMethod: 'PUT',
    headers: { 'content-type': contentType },
  });
  if (put.status < 200 || put.status >= 300) throw new Error(`Upload failed (${put.status})`);

  return publicUrl;
}
