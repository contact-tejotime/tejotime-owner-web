"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";

/**
 * The app's `EditSheet` (settings add/edit forms): a bottom sheet with a grabber and a title over
 * a capped, scrollable body. A phone and a tablet get the sheet (centred in a 560px column on a
 * tablet, as the app does); beside the desktop sidebar it becomes a centred dialog with a close ×,
 * which is how the walk-in sheet already behaves there. Styles: `.sb-sheet-*` in settings-b.css.
 *
 * Deliberately NOT portalled. The store theme's tokens are scoped to `.app[data-tt-theme]`, so a
 * sheet moved to <body> would lose them and paint light-mode colours on a dark-mode store.
 *
 * `locked` keeps it open while a save or an upload is in flight — closing mid-request would
 * leave the owner not knowing whether it happened.
 */
export function EditSheet({
  open,
  title,
  locked = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  locked?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Held in refs so the effect below runs once per opening, not on every parent render.
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    closeRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open) return;
    // Read BEFORE anything inside takes focus. That is why the forms mark their first field with
    // `data-autofocus` instead of React's `autoFocus`: autoFocus fires during the commit, before
    // this effect, so the "opener" captured here was the new form's own input — and focus was
    // returned to an unmounted node on close instead of the Add button.
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Into the dialog, so a keyboard user is not left tabbing through the page behind the scrim:
    // the marked field for a new item (the keyboard comes up on a phone, as in the app), else the
    // panel itself, which does not pop a keyboard just for opening an existing row.
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || lockedRef.current) return;
      // The crop and photo-preview dialogs open INSIDE this panel and handle Escape themselves;
      // one key press must close the innermost dialog only, not the form behind it too.
      if (panelRef.current?.querySelector('[aria-modal="true"]')) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      // Back to whatever opened the sheet — the list row or the Add button — so a keyboard user
      // is not dropped at the top of the page.
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="sb-sheet-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        className="sb-sheet-backdrop"
        tabIndex={-1}
        aria-label={t.confirm.close}
        onClick={() => {
          if (!locked) onClose();
        }}
      />
      <div className="sb-sheet" ref={panelRef} tabIndex={-1}>
        <span className="sb-sheet-handle" aria-hidden />
        <div className="sb-sheet-head">
          <h2 className="sb-sheet-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="sb-sheet-close"
            onClick={onClose}
            disabled={locked}
            aria-label={t.confirm.close}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="sb-sheet-body">{children}</div>
      </div>
    </div>
  );
}
