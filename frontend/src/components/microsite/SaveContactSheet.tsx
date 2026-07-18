"use client";

import { useEffect, useId, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/Icon";

/**
 * Desktop-only "Save contact" sheet for the customer microsite. Shown when the visitor is on a
 * computer (the phone path in MicrositeClient navigates straight to the .vcf instead). They can't
 * tap-to-save on the machine they're on, so they scan this QR with their phone's camera.
 *
 * The QR encodes the live `.vcf` URL with `?open=1`, which the backend serves `inline` — so the
 * scanning phone opens the OS Add-Contact card directly rather than downloading a file. The .vcf is
 * rebuilt from the current business row on every request, so a saved contact never goes stale.
 */
export default function SaveContactSheet({
  open,
  onClose,
  vcardUrl,
  storeName,
}: {
  open: boolean;
  onClose: () => void;
  vcardUrl: string;
  storeName: string;
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
        {/* header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span id={titleId} style={{ font: "var(--fw-extrabold) 20px/1.15 var(--font-sans)", color: "var(--text-strong)" }}>
            Scan to save {storeName}
          </span>
          <div onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
            <Icon name="x" size={18} />
          </div>
        </div>

        {/* Computer flow: the visitor is on a desktop, so they scan this QR with their phone's
            camera to open the same live .vcf on the device the contact should land on. */}
        <div style={{ padding: "24px 24px 28px", overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ padding: 16, background: "#fff", borderRadius: 16, border: "1px solid var(--border-subtle)" }}>
            <QRCodeSVG value={vcardUrl} size={188} level="M" marginSize={0} />
          </div>
          <span style={{ font: "var(--fw-regular) 14px/1.5 var(--font-sans)", color: "var(--text-muted)", textAlign: "center", maxWidth: 280 }}>
            Point your phone&apos;s camera at this code to save {storeName}&apos;s number, address &amp; website to your contacts.
          </span>
        </div>
      </div>
    </div>
  );
}
