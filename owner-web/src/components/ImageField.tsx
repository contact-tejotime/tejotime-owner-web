"use client";

import { useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";

/**
 * One picture: preview, upload, remove.
 *
 * Uploads go through owner-web's existing `/api/upload` proxy, which signs with the owner's
 * token server-side and PUTs the bytes to storage — the browser never sees a storage
 * credential. Only the returned public URL is handed back to the form, so the field's value is
 * always something the microsite can actually render.
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

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("assetType", assetType);
      const res = await fetch("/api/upload", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.publicUrl) {
        setError(json?.error?.message ?? "That image could not be uploaded.");
        return;
      }
      onChange(json.publicUrl as string);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      // Clear the picker so choosing the SAME file again still fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="image-field">
      <div className="image-field-head">
        <span className="image-field-label">{label}</span>
        {value ? (
          <button type="button" className="btn secondary btn-sm" onClick={() => onChange("")}>
            Remove
          </button>
        ) : null}
      </div>

      <div className="image-field-body">
        <div className="image-field-preview">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" />
          ) : (
            <span className="image-field-empty">
              <Icon name="plus" size={18} />
            </span>
          )}
          {busy ? (
            <span className="image-field-busy">
              <Spinner size={18} />
            </span>
          ) : null}
        </div>

        <div className="image-field-actions">
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {value ? "Replace" : "Upload"}
          </button>
          <p className="field-hint">{hint ?? "JPEG, PNG or WebP, up to 5 MB."}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
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
