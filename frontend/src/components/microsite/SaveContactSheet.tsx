"use client";

import { useEffect, useId, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/Icon";
import { t, format } from "@/i18n";

/**
 * "Save contact" sheet for the customer microsite, on every device.
 *
 * The QR encodes `/{phone}/card` (book-or-save chooser) — same landing as the owner/printed
 * booking QR — so a scan never drops straight into a .vcf download.
 *
 * It shows on handheld too, which is why `onSaveToPhone` exists. A QR is useless to the person
 * holding the screen; it is for showing the shop to someone ELSE. The button underneath is the
 * path for the visitor's own phone, and it goes exactly where handheld "Save contact" used to
 * go directly. Both jobs, one sheet.
 *
 * Absolute QR URL is built only while the sheet is open (client-only), so SSR never emits a
 * wrong origin and scanning always hits the current host.
 */
export default function SaveContactSheet({
  open,
  onClose,
  phoneFull,
  storeName,
  onSaveToPhone,
}: {
  open: boolean;
  onClose: () => void;
  /** Digits-only international number — microsite URL key. */
  phoneFull: string;
  storeName: string;
  /** Sends this device to the book-or-save chooser. Same target as the QR encodes. */
  onSaveToPhone: () => void;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  // Escape closes; move focus into the dialog on open, restore it on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Sheet is client-only once open — safe to read window for a scannable absolute URL.
  const cardUrl = phoneFull ? `${window.location.origin}/${phoneFull}/card` : "";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "ttFade .22s ease" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        style={{ width: 400, maxWidth: "100%", background: "var(--surface-card)", borderRadius: 20, boxShadow: "var(--shadow-xl)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column", animation: "ttModalIn .42s cubic-bezier(.34,1.4,.5,1) both" }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span id={titleId} style={{ font: "var(--fw-extrabold) 20px/1.15 var(--font-sans)", color: "var(--text-strong)" }}>
            {format(t.microsite.saveSheet.title, { name: storeName })}
          </span>
          <div onClick={onClose} aria-label={t.microsite.saveSheet.close} style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
            <Icon name="x" size={18} />
          </div>
        </div>

        <div style={{ padding: "24px 24px 28px", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          {cardUrl ? (
            <div style={{ padding: 16, background: "#fff", borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
              <QRCodeSVG value={cardUrl} size={188} level="M" marginSize={0} />
            </div>
          ) : null}
          <span style={{ font: "var(--fw-regular) 14px/1.5 var(--font-sans)", color: "var(--text-muted)", textAlign: "center", maxWidth: 280 }}>
            {format(t.microsite.saveSheet.body, { name: storeName })}
          </span>
          <button
            type="button"
            onClick={onSaveToPhone}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              height: "var(--control-h-md, 38px)",
              padding: "0 18px",
              background: "var(--primary)",
              color: "var(--on-brand, #fff)",
              border: "1px solid var(--brand-outline, transparent)",
              borderRadius: "calc(10px * var(--radius-scale, 1))",
              font: "var(--fw-semibold) 14px/1 var(--font-sans)",
              cursor: "pointer",
            }}
          >
            <Icon name="user" size={16} />
            {t.microsite.saveSheet.saveToPhone}
          </button>
        </div>
      </div>
    </div>
  );
}
