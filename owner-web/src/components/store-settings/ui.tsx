import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/Icon";

/*
 * The small building blocks the app's settings forms are made of, drawn for the web. No hooks and
 * no "use client", so the same pieces render from a Server Component page and inside the client
 * editors alike. Styles: src/styles/settings-b.css (imported by each page).
 */

/**
 * The app's settings `Section`: a bold title, an optional hint, then ONE card holding the fields.
 * Title and hint sit outside the card on purpose — that is what makes a long form scan as named
 * blocks on the phone, and it is how every settings form in the app is built.
 */
export function SbSection({
  title,
  hint,
  titleId,
  className,
  children,
}: {
  title: string;
  hint?: string;
  /** For a radiogroup/list inside that wants the title as its accessible name. */
  titleId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`sb-section${className ? ` ${className}` : ""}`}>
      <h2 className="sb-section-title" id={titleId}>
        {title}
      </h2>
      {hint ? <p className="sb-section-hint">{hint}</p> : null}
      <div className="sb-card">
        <div className="sb-card-body">{children}</div>
      </div>
    </section>
  );
}

/**
 * The app's `TInput`: label above, the control inside a bordered box (with an optional prefix
 * like ₹ or +91, and a lock when read-only), then a hint — or the error, which replaces it.
 * The caller passes the actual <input>/<textarea>/<select> as `children`, with the `id`.
 */
export function SbField({
  id,
  label,
  hint,
  error,
  prefix,
  disabled = false,
  multiline = false,
  children,
}: {
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  prefix?: string;
  disabled?: boolean;
  multiline?: boolean;
  children: ReactNode;
}) {
  const box = [
    "sb-input",
    disabled ? "is-disabled" : "",
    error ? "is-invalid" : "",
    multiline ? "is-multiline" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="sb-field">
      {label ? (
        <label className="sb-field-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className={box}>
        {prefix ? (
          <span className="sb-input-prefix" aria-hidden>
            {prefix}
          </span>
        ) : null}
        {children}
        {disabled ? <Icon name="lock" size={16} className="sb-input-lock" /> : null}
      </div>
      {error || hint ? (
        <p className={`sb-field-hint${error ? " is-error" : ""}`} role={error ? "alert" : undefined}>
          {error || hint}
        </p>
      ) : null}
    </div>
  );
}

/** The app's `TEmptyState`: an icon in a soft brand disc over a centred message. */
export function SbEmpty({ icon, title, compact = false }: { icon: IconName; title: string; compact?: boolean }) {
  return (
    <div className={`sb-empty${compact ? " sb-empty--compact" : ""}`}>
      <span className="sb-empty-disc" aria-hidden>
        <Icon name={icon} size={compact ? 20 : 24} />
      </span>
      <p className="sb-empty-title">{title}</p>
    </div>
  );
}
