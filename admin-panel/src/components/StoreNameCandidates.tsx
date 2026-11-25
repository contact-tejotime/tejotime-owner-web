"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "@/i18n";
import type { PlaceCandidate } from "@/lib/store-import";

/**
 * The disambiguation step of "autofill from a business name": when a search returns more than one
 * match, the admin picks the right business before we spend a (billed) details+photos fill on it.
 * Portalled to <body> like StoreImportReview so an overflow-hidden ancestor cannot clip it.
 */
export default function StoreNameCandidates({
  candidates,
  onPick,
  onCancel,
}: {
  candidates: PlaceCandidate[];
  onPick: (placeId: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-card import-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{t.storeNameImport.pickTitle}</h3>
        <p className="import-intro">{t.storeNameImport.pickIntro}</p>

        <div className="import-list">
          {candidates.map((c) => {
            const badge =
              c.businessStatus === "CLOSED_PERMANENTLY"
                ? t.storeNameImport.closedPermanently
                : c.businessStatus === "CLOSED_TEMPORARILY"
                  ? t.storeNameImport.closedTemporarily
                  : null;
            return (
              <button key={c.placeId} type="button" className="candidate-row" onClick={() => onPick(c.placeId)}>
                <span className="candidate-name">
                  {c.name}
                  {badge && <span className="import-tag replace">{badge}</span>}
                </span>
                {c.formattedAddress && <span className="candidate-addr">{c.formattedAddress}</span>}
                {c.primaryTypeDisplayName && <span className="candidate-type">{c.primaryTypeDisplayName}</span>}
              </button>
            );
          })}
        </div>

        <div className="confirm-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t.storeNameImport.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
