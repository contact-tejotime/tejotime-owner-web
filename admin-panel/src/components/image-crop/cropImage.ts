/**
 * Canvas export for the cropper.
 *
 * The modal and this file share one transform model, so what the user frames is exactly what
 * gets written. In viewport (CSS px) terms:
 *
 *   baseScale  = cover-fit of the rotated image into the crop frame  (zoom 1 == exactly covers)
 *   totalScale = baseScale * zoom
 *   the image is drawn centred, offset by `offset`, rotated, then scaled
 *
 * Export maps viewport px to output px with a single factor, so the maths below is the same as
 * the preview's CSS transform — no second implementation to drift.
 */
import type { CropConfig } from "./assets";

/**
 * Lossy encode quality. 0.92 is the usual "visually indistinguishable" mark for a re-encode —
 * 0.9 starts to show ringing on flat colour and skin, and above ~0.95 the file grows fast for no
 * visible gain. PNG ignores this and stays lossless.
 */
const QUALITY = 0.92;

export type CropTransform = {
  /** Pan in viewport px, from the centre of the crop frame. */
  offset: { x: number; y: number };
  zoom: number;
  /** Degrees, always a multiple of 90. */
  rotation: number;
};

/** Natural size of the image after `rotation` is applied. */
export function rotatedSize(width: number, height: number, rotation: number) {
  const quarter = Math.abs(rotation % 180) === 90;
  return { width: quarter ? height : width, height: quarter ? width : height };
}

/** Zoom 1 == the rotated image exactly covers the frame; never smaller, so there are no gaps. */
export function coverScale(
  natural: { width: number; height: number },
  frame: { width: number; height: number },
  rotation: number,
): number {
  const r = rotatedSize(natural.width, natural.height, rotation);
  if (!r.width || !r.height) return 1;
  return Math.max(frame.width / r.width, frame.height / r.height);
}

/** How far the image may pan before an edge would enter the frame. */
export function panBounds(
  natural: { width: number; height: number },
  frame: { width: number; height: number },
  transform: CropTransform,
) {
  const r = rotatedSize(natural.width, natural.height, transform.rotation);
  const scale = coverScale(natural, frame, transform.rotation) * transform.zoom;
  return {
    x: Math.max(0, (r.width * scale - frame.width) / 2),
    y: Math.max(0, (r.height * scale - frame.height) / 2),
  };
}

/** Keep the frame covered — clamps pan to the current bounds. */
export function clampOffset(
  natural: { width: number; height: number },
  frame: { width: number; height: number },
  transform: CropTransform,
): { x: number; y: number } {
  const b = panBounds(natural, frame, transform);
  return {
    x: Math.min(b.x, Math.max(-b.x, transform.offset.x)),
    y: Math.min(b.y, Math.max(-b.y, transform.offset.y)),
  };
}

/**
 * Output canvas size: the slot's aspect, capped by its max edge AND by the real number of source
 * pixels inside the crop frame.
 *
 * That second cap matters. Without it a 400x300 photo dropped into the hero slot would be
 * exported at 1600x1200 — four times the pixels, none of them real, and a much bigger file for a
 * blurrier result. Capping at the source keeps small images exactly as sharp as they arrived and
 * only ever downsamples big ones.
 *
 * @param availableSourcePx source pixels spanning the frame's width; omit to use the cap alone.
 */
export function outputSize(config: CropConfig, availableSourcePx?: number) {
  let width = config.maxWidth;
  if (availableSourcePx && availableSourcePx > 0) {
    width = Math.min(width, Math.max(1, Math.round(availableSourcePx)));
  }
  let height = Math.round(width / config.aspect);
  if (height > config.maxHeight) {
    height = config.maxHeight;
    width = Math.round(height * config.aspect);
  }
  return { width, height };
}

/**
 * Halve an image repeatedly until one more halving would pass the target scale.
 *
 * A single drawImage that shrinks by more than ~2x samples too few source pixels per output
 * pixel, which shows up as aliasing on hair, brick, stripes and text. Successive halving is the
 * standard fix: every step averages 4 pixels into 1, so nothing is skipped. `imageSmoothingQuality
 * = "high"` alone does not cover large ratios in every browser.
 *
 * Returns the source unchanged when no pre-pass is needed.
 */
function prescale(
  image: CanvasImageSource & { width?: number; height?: number },
  naturalWidth: number,
  naturalHeight: number,
  targetScale: number,
): CanvasImageSource {
  if (targetScale >= 0.5 || targetScale <= 0) return image;

  let src: CanvasImageSource = image;
  let w = naturalWidth;
  let h = naturalHeight;

  // Stop while still >= the target, so the final drawImage only ever shrinks by < 2x.
  while (w / 2 >= naturalWidth * targetScale && w > 2 && h > 2) {
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.floor(w / 2));
    next.height = Math.max(1, Math.floor(h / 2));
    const nctx = next.getContext("2d");
    if (!nctx) break;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(src, 0, 0, next.width, next.height);
    src = next;
    w = next.width;
    h = next.height;
  }
  return src;
}

/**
 * Render the framed region to a File.
 *
 * Keeps the source mime so a transparent PNG logo stays transparent; anything else would put a
 * black box behind the mark. JPEG gets a white matte for the same reason in reverse — it has no
 * alpha, and unpainted canvas exports as black.
 */
export async function cropToFile(
  image: HTMLImageElement,
  frame: { width: number; height: number },
  transform: CropTransform,
  config: CropConfig,
  source: File,
): Promise<File> {
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const scale = coverScale(natural, frame, transform.rotation) * transform.zoom;
  // Source pixels spanning the frame — the true resolution behind this crop.
  const out = outputSize(config, frame.width / scale);

  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-unavailable");

  const type = source.type === "image/png" ? "image/png" : source.type === "image/webp" ? "image/webp" : "image/jpeg";
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // viewport px -> output px. Frame and output share an aspect, so one factor covers both axes.
  const f = out.width / frame.width;
  // Composite image px -> output px. Below 0.5 the draw needs a halving pre-pass.
  const total = scale * f;
  const drawSrc = prescale(image, natural.width, natural.height, total);
  // The pre-pass returns either the original <img> or a smaller canvas; both expose width/height.
  const sw = drawSrc === image ? natural.width : (drawSrc as HTMLCanvasElement).width;
  const sh = drawSrc === image ? natural.height : (drawSrc as HTMLCanvasElement).height;
  // Whatever the pre-pass already removed, the final draw must not repeat.
  const residual = total * (natural.width / sw);

  ctx.translate(out.width / 2, out.height / 2);
  ctx.translate(transform.offset.x * f, transform.offset.y * f);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(residual, residual);
  ctx.drawImage(drawSrc, -sw / 2, -sh / 2);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/png" ? undefined : QUALITY),
  );
  if (!blob) throw new Error("encode-failed");

  return new File([blob], renameForType(source.name, type), { type, lastModified: Date.now() });
}

/** Keep the original stem, correct the extension when the encoder changed the format. */
function renameForType(name: string, type: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "") || "image";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `${stem}.${ext}`;
}
