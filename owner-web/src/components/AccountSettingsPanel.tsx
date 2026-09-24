"use client";

import "@/styles/settings-hub.css";

import { useId, useState, type ReactNode } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";

/**
 * Collapsible shell for the secondary account + password block on Profile.
 * Default closed so the long store / Appearance editor stays the focus.
 *
 * The toggle is drawn as a Settings row (icon tile, label, subtitle — the app's `TSettingsRow`),
 * with a chevron that turns as it opens, so the block reads as the same "Your account" entry the
 * Settings hub shows rather than a one-off heading.
 */
export function AccountSettingsPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className={`st-fold${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="st-row st-row-link st-fold-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="st-row-icon" aria-hidden>
          <Icon name="user" size={18} />
        </span>
        <span className="st-row-body">
          <span className="st-row-text">
            <span className="st-row-label">{t.account.panelTitle}</span>
            <span className="st-row-sub">{t.account.panelSub}</span>
          </span>
          <Icon name="chevronDown" size={18} className="st-fold-chevron" />
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="st-fold-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
