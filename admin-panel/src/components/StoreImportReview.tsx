"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, format } from "@/i18n";
import {
  IMPORT_GROUP_LABEL,
  IMPORT_GROUP_ORDER,
  defaultSelection,
  type ImportItem,
  type ImportKey,
} from "@/lib/store-import";

/**
 * The review step of "autofill from a link". Nothing the page (or the model) said touches the form
 * until the admin ticks it here and presses Apply — that is what makes it safe to read arbitrary
 * pages, since the page text is untrusted and the model can be talked into saying odd things.
 *
 * Portalled to <body> like ConfirmDialog so a transformed/overflow-hidden ancestor cannot clip it.
 */
export default function StoreImportReview({
  source,
  items,
  changesOnly = false,
  warnings,
  onApply,
  onCancel,
}: {
  source: string;
  items: ImportItem[];
  /** A re-fetch: only what the page changed since the last fetch is listed. */
  changesOnly?: boolean;
  warnings: string[];
  onApply: (selected: Set<ImportKey>) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<ImportKey>>(() => defaultSelection(items));

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const grouped = useMemo(
    () =>
      IMPORT_GROUP_ORDER.map((g) => ({ group: g, rows: items.filter((i) => i.group === g) })).filter((g) => g.rows.length > 0),
    [items],
  );

  const toggle = (key: ImportKey) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
        <h3 id={titleId}>{t.storeImport.reviewTitle}</h3>
        <p className="import-intro">
          {format(changesOnly ? t.storeImport.reviewIntroChanged : t.storeImport.reviewIntro, { source })}
        </p>

        {warnings.length > 0 && (
          <div className="alert warn import-warn" role="status">
            <strong>{t.storeImport.warningsTitle}</strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {items.length === 0 ? (
          <p className="import-empty">{t.storeImport.nothingNew}</p>
        ) : (
          <>
            <div className="import-bulk">
              <button type="button" className="import-link" onClick={() => setSelected(new Set(items.map((i) => i.key)))}>
                {t.storeImport.selectAll}
              </button>
              <button type="button" className="import-link" onClick={() => setSelected(new Set())}>
                {t.storeImport.selectNone}
              </button>
            </div>
            <div className="import-list">
              {grouped.map(({ group, rows }) => (
                <section key={group} className="import-group">
                  <h4>{IMPORT_GROUP_LABEL[group]}</h4>
                  {rows.map((item) => (
                    <label key={item.key} className={`import-row${selected.has(item.key) ? " on" : ""}`}>
                      <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                      <span className="import-body">
                        <span className="import-label">
                          {item.label}
                          {item.replaces ? (
                            <span className="import-tag replace">{t.storeImport.replaces}</span>
                          ) : item.existingCount ? (
                            <span className="import-tag">{format(t.storeImport.existingCount, { n: item.existingCount })}</span>
                          ) : null}
                        </span>
                        <span className="import-found">{item.found}</span>
                        {item.replaces && item.current && (
                          <span className="import-current">{format(t.storeImport.current, { value: item.current })}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}

        <div className="confirm-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t.storeImport.cancel}
          </button>
          <button type="button" className="btn-primary" disabled={selected.size === 0} onClick={() => onApply(selected)}>
            {format(t.storeImport.apply, { n: selected.size })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
