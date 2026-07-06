"use client";

import { useRef, useState, type ChangeEvent } from "react";
import type { GalleryRow } from "@/lib/types";

/** POST a file to the admin panel's server proxy, which pushes it to Supabase and returns the URL. */
async function uploadImage(file: File, assetType: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("assetType", assetType);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `Upload failed (${res.status})`);
  return json.publicUrl as string;
}

const ACCEPT = "image/jpeg,image/png,image/webp";
const errStyle = { color: "var(--red-600)" };

/** Single-image uploader (hero / about). Shows the current image with replace + remove. */
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
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      onChange(await uploadImage(file, assetType));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="field full" style={{ marginBottom: 14 }}>
      <label>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 160,
            height: 96,
            flexShrink: 0,
            borderRadius: 10,
            border: "1px solid var(--border-subtle)",
            background: "var(--gray-100)",
            backgroundImage: value ? `url(${value})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          {!value && "No image"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={pick} disabled={busy} style={{ maxWidth: 260 }} />
          {value && (
            <button type="button" className="btn-remove" style={{ height: "auto", padding: "6px 12px" }} onClick={() => onChange("")}>
              Remove
            </button>
          )}
        </div>
      </div>
      {busy && <p className="hint">Uploading…</p>}
      {err && <p className="hint" style={errStyle}>{err}</p>}
    </div>
  );
}

/** Multi-image uploader for the gallery — appends each uploaded photo as a { url, alt } row. */
export function GalleryUpload({
  value,
  onChange,
  assetType,
}: {
  value: GalleryRow[];
  onChange: (rows: GalleryRow[]) => void;
  assetType: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setErr("");
    setBusy(true);
    try {
      const added: GalleryRow[] = [];
      for (const f of files) added.push({ url: await uploadImage(f, assetType), alt: "" });
      onChange([...value, ...added]);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          {value.map((g, i) => (
            <div
              key={i}
              style={{
                position: "relative",
                width: 120,
                height: 84,
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
                backgroundImage: `url(${g.url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <button
                type="button"
                onClick={() => remove(i)}
                title="Remove"
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
                  fontSize: 15,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={inputRef} type="file" accept={ACCEPT} multiple onChange={pick} disabled={busy} />
      {busy && <p className="hint">Uploading…</p>}
      {err && <p className="hint" style={errStyle}>{err}</p>}
      {value.length === 0 && !busy && <p className="hint">Choose one or more photos from your device.</p>}
    </div>
  );
}
