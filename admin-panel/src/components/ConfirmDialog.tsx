"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import Spinner from "./ui/Spinner";

/**
 * Modal confirmation. Portalled to <body> (so it can't be clipped by a
 * transformed/overflow-hidden ancestor), with focus moved into the dialog on
 * open, a Tab focus-trap, and focus restored to the trigger on close. Overlay
 * click or Escape cancels — but not while a request is in flight.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  // Capture what had focus, move focus into the dialog, restore it on close.
  // (The dialog only ever mounts client-side, so `document` is always available.)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => prev?.focus?.();
  }, []);

  // Escape to cancel + a simple Tab focus-trap over the dialog's buttons.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!busy) onCancel();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="confirm-overlay" onClick={() => !busy && onCancel()}>
      <div
        className="confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={bodyId}>{body}</p>
        <div className="confirm-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            {t.confirm.cancel}
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy && <Spinner className="btn-spinner" />}
            {busy ? t.confirm.working : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
