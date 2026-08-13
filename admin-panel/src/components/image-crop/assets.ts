/**
 * Per-slot crop geometry and the upload rules the crop flow has to respect.
 *
 * The ratios are NOT invented here — each one is read off the geometry the microsite already
 * renders that slot at, so what the owner crops is what the live site shows. Every one of these
 * images is painted with `background-size: cover`, which means the browser was already cropping
 * them; this just moves the decision from the browser to the person who owns the shop.
 *
 *   logo     1:1    header mark, 40x40 `object-fit: contain` (MicrositeClient)
 *   hero     4:3    hero image column, `minHeight: clamp(280px, 46vw, 460px)` beside the copy
 *   about    16:9   about panel, ~560x260 when paired with the story text
 *   gallery  1:1    `.ttMosaic` cells — `grid-auto-rows: 220px` x `minmax(230px, 1fr)` (salon.css)
 *   avatar   1:1    staff photo, always rendered in a circle
 *
 * ALLOWED / MAX_BYTES mirror the upload proxy in `app/api/upload/route.ts`. Kept in sync by
 * hand: the route is the authority and rejects anything that slips past the client.
 */

export type CropAssetType = "logo" | "hero" | "about" | "gallery" | "avatar";

export type CropConfig = {
  /** width / height of the crop frame. */
  aspect: number;
  /** Longest edge of the exported image, in px. Bounds the upload size. */
  maxWidth: number;
  maxHeight: number;
};

/*
 * The max edges are a CEILING, never a target: cropToFile also caps output at the real source
 * pixels behind the crop, so a small photo is stored at its own resolution rather than being
 * interpolated up to these numbers. That makes it safe to size them for the worst case — a 3x
 * display — instead of the average one.
 *
 *   hero     ~660 CSS px wide on the desktop layout, x3 DPR ≈ 1980
 *   about    ~560 CSS px, x3 ≈ 1680  (16:9 puts the constraint on width)
 *   gallery  ~474 CSS px for the 2x2 feature cell, x3 ≈ 1422
 *   logo     40 CSS px, x3 = 120 — 512 is already far past what it can show
 */
const SQUARE = { aspect: 1, maxWidth: 1440, maxHeight: 1440 };

export const CROP_CONFIG: Record<CropAssetType, CropConfig> = {
  logo: { aspect: 1, maxWidth: 512, maxHeight: 512 },
  hero: { aspect: 4 / 3, maxWidth: 2000, maxHeight: 1500 },
  about: { aspect: 16 / 9, maxWidth: 1920, maxHeight: 1080 },
  gallery: SQUARE,
  avatar: { aspect: 1, maxWidth: 512, maxHeight: 512 },
};

/** Falls back to a square for any slot not listed, rather than throwing mid-upload. */
export function cropConfigFor(assetType: string): CropConfig {
  return CROP_CONFIG[assetType as CropAssetType] ?? SQUARE;
}

/** Mirrors the upload proxy. */
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPT_ATTR = ALLOWED_TYPES.join(",");
export const MAX_BYTES = 5_000_000;

export type FileRejection = "type" | "size";

/** Client-side gate so an invalid file never reaches the cropper or the network. */
export function rejectFile(file: File): FileRejection | null {
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > MAX_BYTES) return "size";
  return null;
}

/**
 * Classic alpha checkerboard, used behind any image that may carry transparency.
 *
 * Logos are the reason. A PNG with a transparent background and dark ink dropped straight onto a
 * dark overlay is close to invisible, and against a flat white panel there is no way to tell
 * "transparent" from "white background" — which matters, because those two produce very different
 * results on a themed microsite. The checker answers both at a glance.
 *
 * Deliberately fixed light greys rather than theme tokens: a transparency checker is a convention,
 * not part of the palette, and it has to stay readable under a dark overlay in either theme.
 */
export const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #dde3ea 25%, transparent 25%, transparent 75%, #dde3ea 75%)," +
    "linear-gradient(45deg, #dde3ea 25%, transparent 25%, transparent 75%, #dde3ea 75%)",
  backgroundSize: "18px 18px",
  backgroundPosition: "0 0, 9px 9px",
};

const CHECKER_LAYERS =
  "linear-gradient(45deg, #dde3ea 25%, transparent 25%, transparent 75%, #dde3ea 75%)," +
  "linear-gradient(45deg, #dde3ea 25%, transparent 25%, transparent 75%, #dde3ea 75%)";

/**
 * Checkerboard composed BEHIND a photo, for the thumbnail boxes that paint their image as a
 * `background-image` rather than an <img>. Pass no url to get the bare checker.
 */
export function checkerBehind(url?: string): React.CSSProperties {
  if (!url) return { ...CHECKERBOARD };
  return {
    backgroundColor: "#ffffff",
    backgroundImage: `url(${url}), ${CHECKER_LAYERS}`,
    backgroundSize: "cover, 18px 18px, 18px 18px",
    backgroundPosition: "center, 0 0, 9px 9px",
    backgroundRepeat: "no-repeat, repeat, repeat",
  };
}
