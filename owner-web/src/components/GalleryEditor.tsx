"use client";

import { useRef, useState } from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { ACCEPT_ATTR, CHECKERBOARD, ImageCropModal, ImagePreviewModal, useImageCropQueue } from "@/components/image-crop";

export interface GalleryImage {
  url: string;
  alt?: string | null;
}

/**
 * The store's photo gallery.
 *
 * Order is the array order and it is what the microsite renders, so moving a photo is a real
 * edit rather than a display preference — hence the arrows rather than a drag surface, which
 * would need a pointer and would be unusable on the phone most owners run this on.
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

  return (
    <div>
      {images.length === 0 ? (
        <p className="field-hint">{t.gallery.empty}</p>
      ) : (
        <ul className="gallery-grid">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="gallery-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt ?? ""}
                role="button"
                tabIndex={0}
                aria-label={t.imagePreview.open}
                title={t.imagePreview.open}
                onClick={() => setPreview(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreview(i);
                  }
                }}
                style={{ ...CHECKERBOARD, cursor: "zoom-in" }}
              />
              <div className="gallery-item-bar">
                <button
                  type="button"
                  className="gallery-btn"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={t.gallery.moveEarlier}
                  title={t.gallery.moveEarlier}
                >
                  <Icon name="chevronLeft" size={14} />
                </button>
                <button
                  type="button"
                  className="gallery-btn"
                  onClick={() => move(i, i + 1)}
                  disabled={i === images.length - 1}
                  aria-label={t.gallery.moveLater}
                  title={t.gallery.moveLater}
                >
                  <Icon name="chevronRight" size={14} />
                </button>
                <button
                  type="button"
                  className="gallery-btn danger"
                  onClick={() => onChange(images.filter((_, idx) => idx !== i))}
                  aria-label={t.gallery.removePhoto}
                  title={t.gallery.remove}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="gallery-actions">
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy || images.length >= max}
        >
          {busy ? <Spinner size={13} /> : <Icon name="plus" size={14} />}
          {busy ? t.gallery.uploading : t.gallery.add}
        </button>
        <span className="field-hint">
          {format(t.gallery.counter, { count: images.length, max })}
        </span>
      </div>

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
        <p className="field-hint" role="alert" style={{ color: "var(--error)" }}>
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
    </div>
  );
}
