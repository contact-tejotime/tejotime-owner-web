"use client";

import { useRef, useState } from "react";
import { t } from "@/i18n";

import { Spinner } from "@/components/Skeleton";
import { ACCEPT_ATTR, CHECKERBOARD, ImageCropModal, ImagePreviewModal, useImageCropQueue } from "@/components/image-crop";

/**
 * One picture: preview, crop, upload, remove — drawn as the app's `ImagePickerRow` (label, hint, a
 * full-width preview once there is a picture, then "Add photo" / "Change" and "Remove").
 *
 * Uploads go through owner-web's existing `/api/upload` proxy, which signs with the owner's
 * token server-side and PUTs the bytes to storage — the browser never sees a storage
 * credential. Only the returned public URL is handed back to the form, so the field's value is
 * always something the microsite can actually render.
 *
 * Picking a file does not upload it. The file is validated, framed in the shared crop modal at
 * the slot's own aspect ratio, and only the cropped result is sent. The current picture stays
 * put until that upload succeeds, so cancelling or failing never blanks an existing image.
 */
export function ImageField({
  label,
  assetType,
  value,
  onChange,
  hint,
}: {
  label: string;
  /** Must be one of the slots the upload proxy allows: logo | hero | about | gallery | avatar. */
  assetType: "logo" | "hero" | "about" | "gallery";
  value: string;
  onChange: (url: string) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  const clearPicker = () => {
    // Clear the picker so choosing the SAME file again still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  };

  const crop = useImageCropQueue({
    assetType,
    onError: setError,
    onDone: clearPicker,
    onCropped: async (file) => {
      setBusy(true);
      setError("");
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("assetType", assetType);
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.publicUrl) {
          setError(json?.error?.message ?? t.imageField.errUpload);
          return;
        }
        onChange(json.publicUrl as string);
      } catch {
        setError(t.imageField.networkError);
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <div className="sb-image">
      <span className="sb-image-label">{label}</span>
      {hint ? <p className="sb-caption">{hint}</p> : null}

      {value ? (
        <button
          type="button"
          // A logo is cropped square; shown `cover` in the wide preview it would lose its edges.
          className={`sb-image-preview${assetType === "logo" ? " is-contain" : ""}`}
          onClick={() => setPreview(true)}
          aria-label={t.imagePreview.open}
          title={t.imagePreview.open}
        >
          {/* Checker sits on the <img> itself, so it shows through transparent pixels. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" style={CHECKERBOARD} />
          {busy ? (
            <span className="sb-image-busy">
              <Spinner size={18} />
            </span>
          ) : null}
        </button>
      ) : null}

      <div className="sb-actions-row">
        <button
          type="button"
          className="sb-btn sb-btn--secondary"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Spinner size={14} /> : null}
          {value ? t.imageField.replace : t.imageField.upload}
        </button>
        {value ? (
          <button type="button" className="sb-btn sb-btn--secondary" onClick={() => onChange("")} disabled={busy}>
            {t.imageField.remove}
          </button>
        ) : null}
      </div>
      {/* Owner-web's own line: the browser enforces the type and size the app's picker does not
          need to spell out, so say it before the file dialog rejects something. */}
      <p className="sb-caption">{t.imageField.hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError("");
          if (crop.enqueue([file]) === 0) clearPicker();
        }}
      />

      {error ? (
        <p className="sb-error" role="alert">
          {error}
        </p>
      ) : null}

      {preview && value ? (
        <ImagePreviewModal images={[value]} index={0} onIndexChange={() => {}} onClose={() => setPreview(false)} />
      ) : null}

      {crop.request ? (
        <ImageCropModal
          request={crop.request}
          busy={crop.busy || busy}
          onApply={crop.apply}
          onCancel={() => {
            crop.cancelCurrent();
            clearPicker();
          }}
        />
      ) : null}
    </div>
  );
}
