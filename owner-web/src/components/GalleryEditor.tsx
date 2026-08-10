"use client";

import { useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";

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
 */
export function GalleryEditor({
  images,
  onChange,
  max = 24,
}: {
  images: GalleryImage[];
  onChange: (next: GalleryImage[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addFiles(files: FileList) {
    setBusy(true);
    setError("");
    const room = max - images.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (chosen.length < files.length) {
      setError(`Only ${max} photos can be shown, so the extras were skipped.`);
    }
    const added: GalleryImage[] = [];
    try {
      for (const file of chosen) {
        const body = new FormData();
        body.append("file", file);
        body.append("assetType", "gallery");
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.publicUrl) {
          setError(json?.error?.message ?? `${file.name} could not be uploaded.`);
          break;
        }
        added.push({ url: json.publicUrl as string, alt: null });
      }
      // Applied once at the end rather than per file, so a part-failed batch still keeps
      // whatever did upload instead of discarding the lot.
      if (added.length) onChange([...images, ...added]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
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
        <p className="field-hint">No photos yet. These appear in the gallery on your page.</p>
      ) : (
        <ul className="gallery-grid">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="gallery-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt ?? ""} />
              <div className="gallery-item-bar">
                <button
                  type="button"
                  className="gallery-btn"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label="Move earlier"
                  title="Move earlier"
                >
                  <Icon name="chevronLeft" size={14} />
                </button>
                <button
                  type="button"
                  className="gallery-btn"
                  onClick={() => move(i, i + 1)}
                  disabled={i === images.length - 1}
                  aria-label="Move later"
                  title="Move later"
                >
                  <Icon name="chevronRight" size={14} />
                </button>
                <button
                  type="button"
                  className="gallery-btn danger"
                  onClick={() => onChange(images.filter((_, idx) => idx !== i))}
                  aria-label="Remove photo"
                  title="Remove"
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
          {busy ? "Uploading…" : "Add photos"}
        </button>
        <span className="field-hint">
          {images.length} of {max} · JPEG, PNG or WebP, up to 5 MB each
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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
    </div>
  );
}
