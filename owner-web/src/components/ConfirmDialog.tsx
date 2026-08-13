"use client";

import { useEffect, useState } from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";

/**
 * Our own confirm / prompt, replacing `window.confirm` and `window.prompt`.
 *
 * Those were never acceptable here. They are unstyled OS chrome that reads as a browser
 * security warning rather than part of the product, they block the whole tab, some browsers let
 * the user suppress them entirely for the rest of the session — which would silently turn
 * "confirm before disabling a login" into "disable it" — and `window.prompt` cannot validate
 * or mask what is typed, which matters when the thing being typed is a password.
 *
 * The mobile twin has the same problem in a worse form: `Alert.prompt` is iOS-only, so the
 * Android build's "reset password" did nothing at all.
 *
 * The caller gives this a `key` that changes per opening, so each one mounts fresh — that is
 * what stops the next confirm inheriting the last dialog's typed password, and it is cheaper
 * and harder to get wrong than resetting state in an effect.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = t.confirm.confirm,
  cancelLabel = t.confirm.cancel,
  destructive = false,
  /** Present a text field and hand its value to onConfirm. Used for setting a password. */
  input,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  input?: { label: string; hint?: string; type?: "text" | "password"; minLength?: number };
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  function confirm() {
    if (input?.minLength && value.length < input.minLength) {
      setError(format(t.confirm.minLength, { count: input.minLength }));
      return;
    }
    onConfirm(value);
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="sheet confirm-sheet">
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label={t.confirm.close}>
            <Icon name="x" size={18} />
          </button>
        </header>

        {body ? <p className="confirm-body">{body}</p> : null}

        {input ? (
          <div className="field">
            <label htmlFor="confirm-input">{input.label}</label>
            <input
              id="confirm-input"
              type={input.type ?? "text"}
              value={value}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
            />
            {input.hint ? <p className="field-hint">{input.hint}</p> : null}
          </div>
        ) : null}

        {error ? (
          <div className="alert err" role="alert">
            {error}
          </div>
        ) : null}

        <div className="sheet-actions">
          <button
            type="button"
            className={`btn ${destructive ? "danger" : ""}`}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? <Spinner size={14} /> : null}
            {confirmLabel}
          </button>
          <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
