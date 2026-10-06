"use client";

import { useEffect, useId, useState } from "react";
import { t, format } from "@/i18n";

import { OverlayPortal } from "@/components/OverlayPortal";
import { Spinner } from "@/components/Skeleton";
import "@/styles/shell-sheets.css";

/**
 * Our own confirm / prompt, replacing `window.confirm` and `window.prompt` — the web twin of the
 * app's `ConfirmSheet`: a centred card with the title, the body, an optional field, then the
 * confirm button over Cancel, both full width.
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
 * The header × this used to carry is gone, as on the app: Cancel, Escape and a click on the
 * backdrop all dismiss it, and a fourth way only competed with the two buttons.
 *
 * Portalled (see OverlayPortal) so no ancestor's stacking context can paint over it.
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
  /**
   * Present a text field and hand its value to onConfirm. Used for setting a password, and for
   * the price of a checkout add-on (`prefix` = the store's currency symbol, `inputMode` brings up
   * a phone's number pad, `validate` returns the message to show instead of confirming).
   */
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
  input?: {
    label: string;
    hint?: string;
    type?: "text" | "password";
    minLength?: number;
    prefix?: string;
    inputMode?: "decimal";
    validate?: (value: string) => string | null;
  };
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const titleId = useId();
  const inputId = useId();

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
    const invalid = input?.validate?.(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    onConfirm(value);
  }

  return (
    <OverlayPortal>
      <div
        className="cfm-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onCancel();
        }}
      >
        <div className="cfm-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <h2 id={titleId} className="cfm-title">
            {title}
          </h2>

          {body ? <p className="cfm-body">{body}</p> : null}

          {input ? (
            <div className="cfm-field">
              <label htmlFor={inputId}>{input.label}</label>
              <div className={input.prefix ? "cfm-input-wrap" : undefined}>
                {input.prefix ? (
                  <span className="cfm-prefix" aria-hidden>
                    {input.prefix}
                  </span>
                ) : null}
                <input
                  id={inputId}
                  className="cfm-input"
                  type={input.type ?? "text"}
                  inputMode={input.inputMode}
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
              </div>
              {input.hint ? <p className="cfm-hint">{input.hint}</p> : null}
            </div>
          ) : null}

          {error ? (
            <p className="ss-error cfm-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="cfm-actions">
            <button
              type="button"
              className={`ss-btn block ${destructive ? "danger" : "primary"}`}
              onClick={confirm}
              disabled={busy}
            >
              {busy ? <Spinner size={14} /> : null}
              {confirmLabel}
            </button>
            <button type="button" className="ss-btn outline block" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
