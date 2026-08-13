"use client";

import { useId, useState, type ReactNode } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";

/**
 * Collapsible shell for the secondary account + password block on Profile.
 * Default closed so the long store / Appearance editor stays the focus.
 */
export function AccountSettingsPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className={`account-fold${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="account-fold-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-fold-title">{t.account.panelTitle}</span>
        <Icon name="chevronDown" size={18} className="account-fold-chevron" />
      </button>
      {open ? (
        <div id={bodyId} className="account-fold-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
