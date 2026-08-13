"use client";

import { useRef, useState, type ChangeEvent } from "react";
import type { GalleryRow } from "@/lib/types";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import Spinner from "@/components/ui/Spinner";
import { ACCEPT_ATTR, ImageCropModal, ImagePreviewModal, checkerBehind, useImageCropQueue } from "@/components/image-crop";

/** POST a file to the admin panel's server proxy, which pushes it to object storage and returns the URL. */
async function uploadImage(file: File, assetType: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("assetType", assetType);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? format(t.imageUpload.uploadFailedStatus, { status: res.status }));
  return json.publicUrl as string;
}

const errStyle = { color: "var(--red-600)" };

/**
 * Single-image uploader (hero / about / logo / staff avatar).
 *
 * Picking a file no longer uploads it. The file is validated, then handed to the crop modal;
 * only the cropped result is sent. The existing value is left alone until that upload succeeds,
 * so a cancelled or failed crop never clears a picture the store already had.
 */
export function ImageUpload({
  value,
  onChange,
  assetType,
  label,
}: {
  value: string;
  onChange: (url: string) => void;
  assetType: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearPicker = () => {
    // Reset so choosing the SAME file again still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  };

  const crop = useImageCropQueue({
    assetType,
    onError: setErr,
    onDone: clearPicker,
    onCropped: async (file) => {
      setBusy(true);
      try {
        onChange(await uploadImage(file, assetType));
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : t.imageUpload.uploadFailed);
      } finally {
        setBusy(false);
      }
    },
  });

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    if (crop.enqueue([file]) === 0) clearPicker();
  }

  return (
    <div className="field full" style={{ marginBottom: 14 }}>
      <label>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* A button only once there is something to open, so an empty slot stays inert. */}
        <div
          role={value ? "button" : undefined}
          tabIndex={value ? 0 : undefined}
          aria-label={value ? t.imagePreview.open : undefined}
          title={value ? t.imagePreview.open : undefined}
          onClick={value ? () => setPreview(true) : undefined}
          onKeyDown={
            value
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreview(true);
                  }
                }
              : undefined
          }
          style={{
            position: "relative",
            width: 160,
            height: 96,
            flexShrink: 0,
            borderRadius: 10,
            border: "1px solid var(--border-subtle)",
            // Checker only once there is an image; an empty slot keeps the plain placeholder fill.
            ...(value ? checkerBehind(value) : { background: "var(--gray-100)" }),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 12,
            overflow: "hidden",
            cursor: value ? "zoom-in" : "default",
          }}
        >
          {busy ? (
            <span className="skeleton" aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 10 }} />
          ) : (
            !value && t.imageUpload.noImage
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR} onChange={pick} disabled={busy} style={{ maxWidth: 260 }} />
          {value && (
            <button type="button" className="btn-remove" style={{ height: "auto", padding: "6px 12px" }} onClick={() => onChange("")}>
              {t.common.remove}
            </button>
          )}
        </div>
      </div>
      {busy && (
        <p className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Spinner /> {t.imageUpload.uploading}
        </p>
      )}
      {err && <p className="hint" style={errStyle} role="alert">{err}</p>}

      {crop.request && (
        <ImageCropModal
          request={crop.request}
          busy={crop.busy || busy}
          onApply={crop.apply}
          onCancel={() => {
            crop.cancelCurrent();
            clearPicker();
          }}
        />
      )}

      {preview && value && (
        <ImagePreviewModal images={[value]} index={0} onIndexChange={() => {}} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}

/** Multi-image uploader for the gallery — appends each uploaded photo as a { url, alt } row. */
const GALLERY_MAX = 7;

/**
 * Gallery uploader.
 *
 * Each selected photo is cropped and uploaded one at a time, in order, so the batch is never
 * uploaded wholesale behind the user's back. Applying a crop appends that photo immediately;
 * skipping one leaves the rest of the batch running.
 */
export function GalleryUpload({
  value,
  onChange,
  assetType,
  max = GALLERY_MAX,
}: {
  value: GalleryRow[];
  onChange: (rows: GalleryRow[]) => void;
  assetType: string;
  max?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Index of the photo open in the viewer; null when closed.
  const [preview, setPreview] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= max;

  const clearPicker = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const crop = useImageCropQueue({
    assetType,
    onError: setErr,
    onDone: clearPicker,
    onCropped: async (file) => {
      setBusy(true);
      try {
        const url = await uploadImage(file, assetType);
        // `value` is current: each crop is applied by a separate click, so the parent has
        // re-rendered with the previous photo appended before this callback is rebuilt.
        onChange([...value, { url, alt: "" }]);
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : t.imageUpload.uploadFailed);
      } finally {
        setBusy(false);
      }
    },
  });

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setErr("");
    const room = max - value.length;
    const chosen = files.slice(0, Math.max(0, room));
    if (chosen.length < files.length) {
      setErr(format(t.imageUpload.galleryMaxSkipped, { max }));
    }
    if (!chosen.length || crop.enqueue(chosen) === 0) clearPicker();
  }

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          {value.map((g, i) => (
            <div
              key={i}
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
              style={{
                position: "relative",
                width: 120,
                height: 84,
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
                ...checkerBehind(g.url),
                cursor: "zoom-in",
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  // The tile behind this is the "open preview" target.
                  e.stopPropagation();
                  remove(i);
                }}
                title={t.imageUpload.removeTitle}
                style={{
                  position: "absolute",
                  top: -8,
                  right: -8,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#fff",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--red-600)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "var(--shadow-xs)",
                  cursor: "pointer",
                }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        onChange={pick}
        disabled={busy || full}
      />
      <p className="hint" style={{ marginTop: 6 }}>
        {format(t.imageUpload.galleryCount, { count: value.length, max })}
      </p>
      {busy && (
        <p className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Spinner /> {t.imageUpload.uploading}
        </p>
      )}
      {err && <p className="hint" style={errStyle} role="alert">{err}</p>}
      {value.length === 0 && !busy && <p className="hint">{t.imageUpload.chooseGallery}</p>}

      {crop.request && (
        <ImageCropModal
          request={crop.request}
          busy={crop.busy || busy}
          onApply={crop.apply}
          onCancel={crop.cancelCurrent}
        />
      )}

      {preview !== null && value[preview] && (
        <ImagePreviewModal
          images={value.map((g) => g.url)}
          index={preview}
          onIndexChange={setPreview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
