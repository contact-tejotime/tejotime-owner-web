"use client";

/**
 * Full-size viewer for an already-uploaded image.
 *
 * The thumbnails in these fields are small and cropped to fit their box, so there was no way to
 * check what actually got saved without opening the live site. Clicking one now opens it here.
 *
 * Takes a list plus an index rather than a single URL, so the gallery can page through its photos
 * without closing and reopening; a single-image field just passes an array of one and the
 * navigation hides itself.
 *
 * Styling is inline for the same reason as the crop modal: this file is mirrored verbatim into
 * owner-web, and the two apps share design tokens but not class names. The glyphs are inline SVG
 * rather than each app's Icon component, which lives at a different path in each.
 */
import { useCallback, useEffect } from "react";

import { t, format } from "@/i18n";

import { CHECKERBOARD } from "./assets";

/** Dialog padding, shared with the image's height budget so the picture never overflows. */
const PAD = "clamp(16px, 5vw, 56px)";

export function ImagePreviewModal({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: string[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const total = images.length;
  const src = images[index];

  const step = useCallback(
    (delta: number) => {
      if (total < 2) return;
      onIndexChange((index + delta + total) % total);
    },
    [index, total, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, step]);

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.imagePreview.title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 420,
        background: "rgba(15,23,42,.78)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: PAD,
      }}
    >
      <button
        type="button"
        aria-label={t.imagePreview.close}
        onClick={onClose}
        style={{ ...roundBtn, position: "absolute", top: 16, right: 16 }}
      >
        <CloseGlyph />
      </button>

      {total > 1 ? (
        <>
          <button
            type="button"
            aria-label={t.imagePreview.previous}
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            style={{ ...roundBtn, position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }}
          >
            <ChevronGlyph dir="left" />
          </button>
          <button
            type="button"
            aria-label={t.imagePreview.next}
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            style={{ ...roundBtn, position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)" }}
          >
            <ChevronGlyph dir="right" />
          </button>
        </>
      ) : null}

      {/* The panel is what makes a transparent logo readable — and visibly transparent. */}
      <div
        // Clicking the picture itself must not dismiss — only the surrounding backdrop does.
        onClick={(e) => e.stopPropagation()}
        style={{
          ...CHECKERBOARD,
          display: "inline-block",
          lineHeight: 0,
          maxWidth: "100%",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,.45)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          style={{
            display: "block",
            maxWidth: "100%",
            // Against the viewport, not the parent: a percentage height inside a shrink-wrapped
            // box resolves against `auto` and gets dropped. PAD matches the dialog's own padding.
            maxHeight: `calc(100vh - 2 * ${PAD})`,
            objectFit: "contain",
          }}
        />
      </div>

      {total > 1 ? (
        <span
          style={{
            position: "absolute",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 12px",
            borderRadius: 999,
            background: "rgba(15,23,42,.7)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {format(t.imagePreview.counter, { index: index + 1, total })}
        </span>
      ) : null}
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ChevronGlyph({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M15 18 9 12l6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

const roundBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "none",
  background: "rgba(255,255,255,.92)",
  color: "var(--text-strong, #0f172a)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(0,0,0,.25)",
  zIndex: 1,
};
