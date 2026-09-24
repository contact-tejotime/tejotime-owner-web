"use client";

import { useRef, useState } from "react";
import { t, format } from "@/i18n";

import { Spinner } from "@/components/Skeleton";
import { SbEmpty } from "@/components/store-settings/ui";
import { ACCEPT_ATTR, CHECKERBOARD, ImageCropModal, ImagePreviewModal, useImageCropQueue } from "@/components/image-crop";

export interface GalleryImage {
  url: string;
  alt?: string | null;
}

/**
 * The store's photo gallery, drawn as the app's: one row per photo — the thumbnail beside its
 * buttons — then "Add photo". Two rows sit side by side from a tablet up.
 *
 * Order is the array order and it is what the microsite renders, so moving a photo is a real
 * edit rather than a display preference — hence buttons rather than a drag surface, which would
 * need a pointer and be unusable on the phone most owners run this on. A phone gets exactly the
 * app's pair (Move up, Remove, stacked beside the thumbnail); from a tablet up the web keeps the
 * Move down it had before the port, so a photo can go either way in one click.
 *
 * Uploads go through owner-web's `/api/upload` proxy: the token is attached server-side and the
 * bytes are PUT to storage from there, so the browser never holds a storage credential.
 *
 * Selecting photos does not upload them. Each one is framed in the shared crop modal at the
 * gallery's own square ratio and uploaded as it is applied, one at a time, so nothing reaches
 * storage un-cropped and skipping a photo leaves the rest of the batch running.
 */
export function GalleryEditor({
  images,
  onChange,
  max = 7,
}: {
  images: GalleryImage[];
  onChange: (next: GalleryImage[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Index of the photo open in the viewer; null when closed.
  const [preview, setPreview] = useState<number | null>(null);

  const clearPicker = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const crop = useImageCropQueue({
    assetType: "gallery",
    onError: setError,
    onDone: clearPicker,
    onCropped: async (file) => {
      setBusy(true);
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("assetType", "gallery");
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.publicUrl) {
          setError(json?.error?.message ?? format(t.gallery.uploadFailed, { name: file.name }));
          return;
        }
        // Appended per photo rather than at the end of the batch: each crop is a separate
        // action, so a later failure must not discard what already uploaded.
        onChange([...images, { url: json.publicUrl as string, alt: null }]);
      } catch {
        setError(t.gallery.networkError);
      } finally {
        setBusy(false);
      }
    },
  });

  function addFiles(files: FileList) {
    setError("");
    const room = max - images.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (chosen.length < files.length) {
      setError(format(t.gallery.maxSkipped, { max }));
    }
    if (!chosen.length || crop.enqueue(chosen) === 0) clearPicker();
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  const full = images.length >= max;

  return (
    <>
      {images.length === 0 ? (
        <SbEmpty compact icon="grid" title={t.gallery.empty} />
      ) : (
        <ul className="sb-gallery">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="sb-gallery-row">
              <button
                type="button"
                className="sb-gallery-thumb"
                onClick={() => setPreview(i)}
                aria-label={t.imagePreview.open}
                title={t.imagePreview.open}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt ?? ""} style={CHECKERBOARD} />
              </button>
              <div className="sb-gallery-actions">
                {i > 0 ? (
                  <button type="button" className="sb-btn sb-btn--secondary sb-btn--sm" onClick={() => move(i, i - 1)}>
                    {t.gallery.moveUp}
                  </button>
                ) : null}
                {i < images.length - 1 ? (
                  <button
                    type="button"
                    className="sb-btn sb-btn--secondary sb-btn--sm sb-gallery-down"
                    onClick={() => move(i, i + 1)}
                  >
                    {t.gallery.moveDown}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="sb-btn sb-btn--secondary sb-btn--sm"
                  onClick={() => onChange(images.filter((_, idx) => idx !== i))}
                  aria-label={t.gallery.removePhoto}
                >
                  {t.gallery.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="sb-actions-row">
        <button
          type="button"
          className="sb-btn sb-btn--secondary"
          onClick={() => inputRef.current?.click()}
          disabled={busy || full}
          title={full ? format(t.gallery.full, { max }) : undefined}
        >
          {/* Label only, as the app's "Add photo" — the spinner stands in while a photo uploads. */}
          {busy ? <Spinner size={14} /> : null}
          {busy ? t.gallery.uploading : t.gallery.add}
        </button>
      </div>
      {/* Owner-web's own count + file rules; the app's gallery shows neither. */}
      <p className="sb-caption">{format(t.gallery.counter, { count: images.length, max })}</p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
        }}
      />

      {error ? (
        <p className="sb-error" role="alert">
          {error}
        </p>
      ) : null}

      {preview !== null && images[preview] ? (
        <ImagePreviewModal
          images={images.map((g) => g.url)}
          index={preview}
          onIndexChange={setPreview}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {crop.request ? (
        <ImageCropModal
          request={crop.request}
          busy={crop.busy || busy}
          onApply={crop.apply}
          onCancel={crop.cancelCurrent}
        />
      ) : null}
    </>
  );
}
