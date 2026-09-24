"use client";

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import { OverlayPortal } from "@/components/OverlayPortal";
import "@/styles/shell-sheets.css";

/**
 * Bottom sheet chrome — the web twin of the app's `TSheet` (dimmed scrim + slide-up panel with a
 * grab handle). Used by the walk-in sheet and the booking QR, which are TSheets on the app.
 *
 * By width, the same markup:
 *   - phone:   a full-width sheet from the bottom edge, as on the app
 *   - tablet:  the same sheet, capped and centred (the app caps these at 520–560 on a tablet)
 *   - desktop: a centred dialog — a sheet rising from the bottom of a monitor reads as a toast
 *
 * As on the app, the scrim FADES and the panel SLIDES; the two layers are animated separately so
 * the dark scrim never travels up the screen with the panel.
 *
 * Portalled (see OverlayPortal): these open from inside Home's seat boards and live card, and a
 * fixed overlay inside a stacking context gets painted under the boards on a phone.
 *
 * The caller mounts it only while open, so there is no exit animation — the app keeps its sheet
 * mounted through one, which needs state this web version does not otherwise carry.
 */
export function BottomSheet({
  onClose,
  closeLabel,
  label,
  labelledBy,
  className = "",
  children,
}: {
  onClose: () => void;
  /** Accessible name of the scrim, which closes the sheet like the app's scrim tap. */
  closeLabel: string;
  label?: string;
  labelledBy?: string;
  /** Per-sheet modifier on the panel (width cap, max height). */
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onEscape = useEffectEvent(() => onClose());

  /**
   * Escape closes, the page behind stops scrolling under the finger, and focus moves into the
   * dialog so a keyboard user is not left tabbing through the page underneath it.
   *
   * Runs ONCE per open. Callers pass an inline `onClose`, whose identity changes every time the
   * board re-renders — and the board re-renders on every live queue update. With `onClose` as a
   * dependency the focus call re-ran mid-typing and yanked the cursor out of the name field;
   * `useEffectEvent` reads the latest `onClose` without making it a reason to re-run.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <OverlayPortal>
      <div className="bs-root">
        <button type="button" className="bs-scrim" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
        <div
          ref={panelRef}
          className={`bs-panel ${className}`}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-labelledby={labelledBy}
          tabIndex={-1}
        >
          <div className="bs-handle" aria-hidden />
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}
