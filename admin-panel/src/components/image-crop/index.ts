/**
 * Crop-before-upload, shared by every image field in this app.
 *
 * GENERATED MIRROR NOTICE — admin-panel/src/components/image-crop is the source of truth.
 * owner-web/src/components/image-crop is a verbatim copy kept in step by
 * `node scripts/sync-image-crop.mjs` (see that file for why the duplication exists).
 * Never hand-edit the mirror.
 */
export { ACCEPT_ATTR, ALLOWED_TYPES, CHECKERBOARD, CROP_CONFIG, MAX_BYTES, checkerBehind, cropConfigFor, rejectFile } from "./assets";
export type { CropAssetType, CropConfig, FileRejection } from "./assets";
export { ImageCropModal } from "./ImageCropModal";
export { ImagePreviewModal } from "./ImagePreviewModal";
export type { CropRequest } from "./ImageCropModal";
export { useImageCropQueue } from "./useImageCropQueue";
export type { CropQueueOptions } from "./useImageCropQueue";
