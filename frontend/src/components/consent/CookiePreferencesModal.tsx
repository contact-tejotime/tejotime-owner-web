"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/Icon";
import { t } from "@/i18n";
import { Z_INDEX, type ConsentCategories } from "@/lib/consent";
import { ConsentToggle } from "./ConsentToggle";
import "./consent.css";

type Optional = "analytics" | "marketing" | "preferences";

const OPTIONAL: Optional[] = ["analytics", "marketing", "preferences"];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The preferences dialog.
 *
 * `initial` carries whatever the visitor last chose — including on a version re-prompt, where
 * showing them their previous answers is the honest thing to do rather than silently resetting
 * everything to off. Optional categories are never pre-checked for a first-time visitor, which
 * is what `DEFAULT_CATEGORIES` guarantees upstream.
 *
 * LAYOUT. Sticky header, scrolling category list, sticky footer, with the sheet capped at 78vh
 * (85vh on a phone). The earlier version let the whole sheet grow, so on a short laptop it ran
 * past the viewport and took the Save button with it.
 *
 * Accessibility is the substance of this component, not decoration: a consent dialog that a
 * keyboard or screen-reader user cannot operate is not consent. It implements the full dialog
 * contract — labelled, described, focus-trapped, Escape-closable, scroll-locked, and it returns
 * focus to whatever opened it (that last part lives in ConsentProvider.closePreferences).
 */
export function CookiePreferencesModal({
  initial,
  onSave,
  onRejectAll,
  onCancel,
}: {
  initial: ConsentCategories;
  onSave: (categories: Omit<ConsentCategories, "necessary">) => void;
  onRejectAll: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<Optional, boolean>>({
    analytics: initial.analytics,
    marketing: initial.marketing,
    preferences: initial.preferences,
  });
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Escape closes; Tab cycles within the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // Move focus into the dialog, and lock the page behind it.
  useEffect(() => {
    // Focus the DIALOG ITSELF, not its first control.
    //
    // The first focusable is the close button, and focusing it meant the Enter keystroke that
    // opened the dialog finished landing on it: keydown activated Customize, the dialog mounted
    // and took focus, then the trailing char/keyup of that same press activated Close — so the
    // dialog opened and vanished in one keystroke. Focusing the container is the WAI-ARIA
    // Authoring Practices alternative and has no such adjacency.
    sheetRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="ttConsentScrim"
      style={{ zIndex: Z_INDEX.modal }}
      // Clicking the scrim cancels and saves nothing — a dismissal is not a choice.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={sheetRef}
        className="ttConsentSheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        // Programmatically focusable so focus can land on the dialog rather than on a control;
        // -1 keeps it out of the tab sequence. The outline is suppressed because the container
        // is not an interactive target — every control inside keeps its own focus ring.
        tabIndex={-1}
        style={{ outline: "none" }}
      >
        {/* Sheet affordance on phones; hidden on desktop where the card is centred. */}
        <div className="ttConsentGrab" aria-hidden="true" />

        <div className="ttConsentHeader">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ttConsentIcon" aria-hidden="true" style={{ width: 32, height: 32 }}>
              <Icon name="cookie" size={16} />
            </span>
            <h2
              id={titleId}
              style={{
                flex: 1,
                minWidth: 0,
                font: "var(--fw-semibold) 18px/1.25 var(--font-sans)",
                letterSpacing: "var(--ls-snug)",
                color: "var(--brand-ink)",
                margin: 0,
              }}
            >
              {t.consent.modal.title}
            </h2>
            {/* Escape and the scrim already cancel; this is the visible affordance for the
                majority who look for one rather than guessing. */}
            <button
              type="button"
              className="ttConsentClose"
              aria-label={t.consent.modal.close}
              onClick={onCancel}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          <p
            id={descId}
            style={{
              font: "var(--fw-regular) 13px/1.5 var(--font-sans)",
              color: "var(--text-body)",
              margin: "10px 0 0",
              textWrap: "pretty",
            }}
          >
            {t.consent.modal.description}
          </p>
        </div>

        {/* Only this list scrolls, so the title and the actions stay on screen at any height. */}
        <div className="ttConsentBody">
          {/* Necessary shares the same card surface as every other row. It is marked as locked by
              the pill and a dimmed control area only — a different background read as "selected"
              rather than "always on". */}
          <Row
            locked
            name={t.consent.categories.necessary.name}
            description={t.consent.categories.necessary.description}
            control={<span className="ttConsentPill">{t.consent.modal.alwaysActive}</span>}
          />

          {OPTIONAL.map((key) => (
            <OptionalRow
              key={key}
              name={t.consent.categories[key].name}
              description={t.consent.categories[key].description}
              checked={draft[key]}
              onChange={(next) => setDraft((d) => ({ ...d, [key]: next }))}
            />
          ))}

          <p style={{ margin: "12px 0 0", font: "var(--fw-regular) 12.5px/1.5 var(--font-sans)" }}>
            <Link href="/cookies" className="ttConsentLink">
              {t.consent.modal.policyLink}
            </Link>
          </p>
        </div>

        <div className="ttConsentFooter">
          <div className="ttConsentFooterRow">
            <button
              type="button"
              className="ttConsentBtn ttConsentBtnPrimary"
              onClick={() =>
                onSave({
                  analytics: draft.analytics,
                  marketing: draft.marketing,
                  preferences: draft.preferences,
                })
              }
            >
              {t.consent.modal.save}
            </button>
            <button type="button" className="ttConsentBtn ttConsentBtnOutline" onClick={onRejectAll}>
              {t.consent.modal.rejectAll}
            </button>
          </div>
          <p
            style={{
              font: "var(--fw-regular) 12px/1.45 var(--font-sans)",
              color: "var(--text-muted)",
              margin: 0,
              textWrap: "pretty",
            }}
          >
            {t.consent.modal.footerNote}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({
  name,
  description,
  control,
  describedById,
  locked = false,
}: {
  name: string;
  description: string;
  control: ReactNode;
  describedById?: string;
  locked?: boolean;
}) {
  return (
    <div className={`ttConsentRow${locked ? " isLocked" : ""}`}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            font: "var(--fw-semibold) 14px/1.3 var(--font-sans)",
            color: "var(--text-strong)",
            margin: "0 0 2px",
          }}
        >
          {name}
        </p>
        <p
          id={describedById}
          style={{
            font: "var(--fw-regular) 12.5px/1.45 var(--font-sans)",
            color: "var(--text-body)",
            margin: 0,
            textWrap: "pretty",
          }}
        >
          {description}
        </p>
      </div>
      <div className="ttConsentRowControl">{control}</div>
    </div>
  );
}

function OptionalRow({
  name,
  description,
  checked,
  onChange,
}: {
  name: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const descId = useId();
  return (
    <Row
      name={name}
      description={description}
      describedById={descId}
      control={<ConsentToggle checked={checked} onChange={onChange} label={name} describedBy={descId} />}
    />
  );
}
