"use client";

/**
 * Crop-before-upload modal, shared by every image field in the panel.
 *
 * Hand-rolled rather than pulled from a crop library: both apps ship their own controls
 * (PhoneField, ConfirmDialog, Icon) and neither has a UI kit to hang a third-party cropper off.
 * The whole interaction is a CSS transform on an <img> plus the matching canvas draw in
 * cropImage.ts, which is far less code than reconciling a library with two design systems.
 *
 * Styling is inline on purpose. This file is mirrored verbatim into owner-web (see
 * scripts/sync-image-crop.mjs), and the two apps share design tokens but not class names, so
 * tokens + clamp() are the portable subset. No media queries needed: every size below is
 * viewport-relative.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t, format } from "@/i18n";

import { CHECKERBOARD, cropConfigFor } from "./assets";
import {
  clampOffset,
  cropToFile,
  panBounds,
  type CropTransform,
} from "./cropImage";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const IDENTITY: CropTransform = { offset: { x: 0, y: 0 }, zoom: 1, rotation: 0 };

export type CropRequest = {
  file: File;
  assetType: string;
  /** 1-based position when a batch is being cropped; omitted for single fields. */
  index?: number;
  total?: number;
};

/**
 * A gallery batch reuses one modal instance across several files. Keying by file gives each one
 * a fresh mount, so zoom, rotation, pan and the decoded source can never leak from the previous
 * image into the next — and no call site has to remember to pass a key.
 */
export function ImageCropModal(props: CropModalProps) {
  const f = props.request.file;
  return <CropModal key={`${f.name}:${f.size}:${f.lastModified}`} {...props} />;
}

type CropModalProps = {
  request: CropRequest;
  /** Set while the parent is uploading, so the modal can lock instead of closing early. */
  busy?: boolean;
  onApply: (cropped: File) => void;
  onCancel: () => void;
};

function CropModal({ request, busy = false, onApply, onCancel }: CropModalProps) {
  const config = useMemo(() => cropConfigFor(request.assetType), [request.assetType]);

  // Read to a data URL rather than URL.createObjectURL. An object URL has to be revoked, and
  // React's dev StrictMode mounts -> cleans up -> mounts again: the cleanup revokes the URL,
  // the second mount reuses the same memoised (now dead) one, and the frame renders empty.
  // A data URL has no revoke step, so there is nothing to get out of sync.
  const [src, setSrc] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<CropTransform>(IDENTITY);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const locked = busy || working;

  useEffect(() => {
    let alive = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (alive) setSrc(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => {
      if (alive) setError(t.imageCrop.failed);
    };
    reader.readAsDataURL(request.file);
    return () => {
      alive = false;
      reader.abort();
    };
  }, [request.file]);


  // Frame size drives every calculation, so it is measured rather than assumed.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The offset is clamped on read rather than synced back into state: a resize or rotate must
  // never leave a gap, and deriving it keeps the frame covered without an effect that would
  // re-render on every ResizeObserver tick.
  const view: CropTransform = useMemo(
    () =>
      natural && frame.width
        ? { ...transform, offset: clampOffset(natural, frame, transform) }
        : transform,
    [natural, frame, transform],
  );

  const setTransformClamped = useCallback(
    (next: CropTransform) => {
      if (!natural || !frame.width) return setTransform(next);
      setTransform({ ...next, offset: clampOffset(natural, frame, next) });
    },
    [natural, frame],
  );

  // ---- pointer drag ----
  const drag = useRef<{ id: number; x: number; y: number; from: { x: number; y: number } } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (locked || !natural) return;
    const b = panBounds(natural, frame, view);
    if (b.x === 0 && b.y === 0) return; // nothing to pan
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view.offset };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setTransformClamped({
      ...view,
      offset: { x: d.from.x + (e.clientX - d.x), y: d.from.y + (e.clientY - d.y) },
    });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  // ---- controls ----
  const setZoom = (zoom: number) =>
    setTransformClamped({ ...view, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) });

  const rotate = () =>
    setTransformClamped({ ...view, rotation: (view.rotation + 90) % 360, offset: { x: 0, y: 0 } });

  const reset = () => setTransform(IDENTITY);

  const onWheel = (e: React.WheelEvent) => {
    if (locked) return;
    setZoom(view.zoom - e.deltaY * 0.002);
  };

  // Escape cancels, but only when nothing is in flight — losing an upload to a stray key is worse
  // than making the user aim for the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onCancel();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [locked, onCancel]);

  async function apply() {
    const image = imgRef.current;
    if (!image || !natural || !frame.width || locked) return;
    setWorking(true);
    setError("");
    try {
      onApply(await cropToFile(image, frame, view, config, request.file));
    } catch {
      setError(t.imageCrop.failed);
      setWorking(false);
    }
  }

  const { index: stepIndex, total: stepTotal } = request;
  const showStep = typeof stepIndex === "number" && typeof stepTotal === "number" && stepTotal > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.imageCrop.title}
      onMouseDown={(e) => {
        // Backdrop click closes only when idle, and only when the press started on the backdrop —
        // releasing a drag outside the frame must not throw the crop away.
        if (e.target === e.currentTarget && !locked) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(15,23,42,.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(12px, 4vw, 32px)",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-card)",
          borderRadius: 16,
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 24px 60px rgba(15,23,42,.28)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-strong)" }}>
            {t.imageCrop.title}
          </h3>
          {showStep ? (
            <span style={{ fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {format(t.imageCrop.step, { index: stepIndex as number, total: stepTotal as number })}
            </span>
          ) : null}
        </div>

        <div style={{ padding: "16px 20px", overflow: "auto" }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
            {t.imageCrop.hint}
          </p>

          <div
            ref={frameRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: String(config.aspect),
              maxHeight: "46vh",
              margin: "0 auto",
              overflow: "hidden",
              borderRadius: 12,
              // Checkerboard, not a flat fill: a logo being cropped is usually a transparent PNG,
              // and the owner needs to see which parts are transparent while framing it.
              ...CHECKERBOARD,
              border: "1px solid var(--border-subtle)",
              cursor: locked ? "default" : "move",
              touchAction: "none",
            }}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNatural({ width: el.naturalWidth, height: el.naturalHeight });
                }}
                onError={() => setError(t.imageCrop.failed)}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: natural && frame.width ? scaledWidth(natural, frame, view) : 0,
                  transform: `translate(-50%, -50%) translate(${view.offset.x}px, ${view.offset.y}px) rotate(${view.rotation}deg)`,
                  transformOrigin: "center",
                  userSelect: "none",
                  maxWidth: "none",
                  // Hidden until measured, so a half-laid-out frame never flashes.
                  visibility: natural ? "visible" : "hidden",
                }}
              />
            ) : null}
            {/* Rule-of-thirds guides, non-interactive. */}
            <span aria-hidden style={gridStyle} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px", margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
              {t.imageCrop.zoom}
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={view.zoom}
                disabled={locked || !natural}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label={t.imageCrop.zoom}
                style={{ flex: 1, width: "auto", minWidth: 0 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={rotate} disabled={locked || !natural} style={ghostBtn}>
                {t.imageCrop.rotate}
              </button>
              <button type="button" onClick={reset} disabled={locked || !natural} style={ghostBtn}>
                {t.imageCrop.reset}
              </button>
            </div>
          </div>

          {error ? (
            <p role="alert" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--red-600, #dc2626)" }}>
              {error}
            </p>
          ) : null}
        </div>

        <div
          style={{
            padding: "12px 20px 16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button type="button" onClick={onCancel} disabled={locked} style={ghostBtn}>
            {t.imageCrop.cancel}
          </button>
          <button type="button" onClick={apply} disabled={locked || !natural} style={primaryBtn}>
            {locked ? t.imageCrop.applying : t.imageCrop.apply}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Width the <img> needs so that zoom 1 exactly covers the frame at the current rotation. */
function scaledWidth(
  natural: { width: number; height: number },
  frame: { width: number; height: number },
  transform: CropTransform,
): number {
  const quarter = Math.abs(transform.rotation % 180) === 90;
  const effW = quarter ? natural.height : natural.width;
  const effH = quarter ? natural.width : natural.height;
  const cover = Math.max(frame.width / effW, frame.height / effH) * transform.zoom;
  // The element is rotated by CSS, so its own width is always the natural width.
  return natural.width * cover;
}

/**
 * Rule-of-thirds guides.
 *
 * Paired light and dark rules offset by a pixel rather than `mix-blend-mode: difference`. The
 * blend read well on photos but inverts against the transparency checker underneath, which turned
 * the guides into noise on exactly the images (logos) that need careful framing. A light line with
 * a dark one behind it stays legible over anything without touching the pixels below.
 */
const gridStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage:
    "linear-gradient(to right, rgba(0,0,0,.28) 1px, transparent 1px)," +
    "linear-gradient(to bottom, rgba(0,0,0,.28) 1px, transparent 1px)," +
    "linear-gradient(to right, rgba(255,255,255,.7) 1px, transparent 1px)," +
    "linear-gradient(to bottom, rgba(255,255,255,.7) 1px, transparent 1px)",
  backgroundSize: "33.333% 33.333%",
  backgroundPosition: "0 0, 0 0, 1px 1px, 1px 1px",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-card)",
  color: "var(--text-strong)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 18px",
  borderRadius: 8,
  border: "1px solid var(--primary)",
  background: "var(--primary)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
