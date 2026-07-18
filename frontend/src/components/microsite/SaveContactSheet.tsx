"use client";

import { useEffect, useId, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/Icon";

/**
 * "Save contact" sheet for the customer microsite. Two ways to save the store as a
 * phone contact, both pointing at the live `.vcf` endpoint (rebuilt from the current
 * business row on every request, so it never goes stale):
 *
 *  1. Direct tap — the primary flow. The visitor is already on their phone with the
 *     site open, so tapping "Add to my contacts" hands the browser the .vcf. iOS opens
 *     the native "Add Contact" preview; Android downloads it and the Contacts app imports
 *     it. No scanning, no second device. The backend's `Content-Disposition: attachment`
 *     header drives the save even though the URL is cross-origin (the `download` filename
 *     hint is only honoured same-origin, which is fine — the header already names the file).
 *
 *  2. QR fallback — for someone viewing on a desktop/laptop. They can't tap-to-save on the
 *     machine they're on, so they scan the QR with their phone's camera to open the same
 *     .vcf on the device where the contact should land.
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
            Save {storeName} to your contacts
          </span>
          <div onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
            <Icon name="x" size={18} />
          </div>
        </div>

        <div style={{ padding: "22px 24px 26px", overflow: "auto" }}>
          <p style={{ font: "var(--fw-regular) 14px/1.5 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>
            Saves our number, address &amp; website straight to your phone — so you can call or find us again in one tap.
          </p>

          {/* Primary flow: tap to save on the phone you're already holding. */}
          <a
            href={vcardUrl}
            download={`${storeName || "contact"}.vcf`}
            onClick={onClose}
            style={{ display: "inline-flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 9, height: "var(--control-h-lg)", padding: "0 22px", font: "var(--fw-semibold) var(--fs-body-lg)/1 var(--font-sans)", letterSpacing: "var(--ls-snug)", borderRadius: "var(--radius-md)", background: "var(--primary)", color: "var(--text-on-brand)", border: "1px solid transparent", boxShadow: "var(--shadow-xs)", textDecoration: "none", cursor: "pointer" }}
          >
            <Icon name="user" size={18} />
            Add to my contacts
          </a>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0 18px" }}>
            <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
            <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-subtle)" }}>on a computer?</span>
            <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
          </div>

          {/* QR fallback: scan with a phone to open the same .vcf on the device you want it on. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ padding: 14, background: "#fff", borderRadius: 14, border: "1px solid var(--border-subtle)" }}>
              <QRCodeSVG value={vcardUrl} size={148} level="M" marginSize={0} />
            </div>
            <span style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", textAlign: "center", maxWidth: 260 }}>
              Scan with your phone&apos;s camera to save {storeName} on your phone.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
