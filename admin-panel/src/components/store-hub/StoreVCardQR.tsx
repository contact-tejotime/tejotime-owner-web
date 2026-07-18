"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/icons";

/**
 * "Contact QR" for a store. Renders a small trigger link that opens a modal with
 * a QR code encoding the store's live vCard URL (`vcardUrl`). Scanning it saves
 * the store as a phone contact; because the backend rebuilds the .vcf from the
 * current business row on every request, the QR never needs regenerating when the
 * owner edits store details. Also offers a direct "Download vCard" and "Print".
 */
export default function StoreVCardQR({ vcardUrl, storeName }: { vcardUrl: string; storeName: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  // Print ONLY the QR + name via an isolated hidden iframe, never the whole admin page.
  // `@page { margin: 0 }` leaves no room for Chrome's auto date/title/URL/page-number header
  // & footer, so they don't render; the doc holds only the QR, so it's a single page.
  const handlePrint = () => {
    const svg = qrRef.current?.querySelector("svg")?.outerHTML;
    if (!svg) return;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return;
    }
    const cleanup = () => iframe.remove();
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(storeName || "Store")} contact QR</title>` +
        `<style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}` +
        // height:100vh + justify-content:center centers the card; box-sizing keeps padding
        // inside that height so it stays a single page (no blank overflow page).
        `.wrap{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;` +
        `padding:40px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;color:#111}` +
        `h1{font-size:28px;font-weight:700;margin:0 0 8px}p{font-size:15px;color:#555;margin:0 0 36px}` +
        `svg{width:420px;height:420px;max-width:80vw}</style>` +
        `</head><body><div class="wrap"><h1>${escapeHtml(storeName || "Store")}</h1>` +
        `<p>Scan to save this store as a contact.</p>${svg}</div></body></html>`,
    );
    doc.close();
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.onafterprint = cleanup;
    // Fallback in case onafterprint never fires (some browsers).
    setTimeout(cleanup, 60000);
    win.focus();
    win.print();
  };

  // Escape closes; move focus into the dialog on open, restore it on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLButtonElement>("button, a")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="qr-icon-btn"
        onClick={() => setOpen(true)}
        title="Contact QR — scan to save this store as a contact"
        aria-label="Contact QR"
      >
        <Icon name="qrCode" size={18} strokeWidth={2} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="confirm-overlay" onClick={() => setOpen(false)}>
            <div
              className="confirm-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              ref={cardRef}
              onClick={(e) => e.stopPropagation()}
              style={{ textAlign: "center", maxWidth: 340 }}
            >
              <h3 id={titleId}>{storeName || "Store"} — contact QR</h3>
              <p style={{ marginTop: 4 }}>Scan to save this store as a contact.</p>
              <div
                ref={qrRef}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: 16,
                  margin: "8px 0 16px",
                  background: "#fff",
                  borderRadius: 12,
                }}
              >
                <QRCodeSVG value={vcardUrl} size={220} level="M" marginSize={2} />
              </div>
              <div className="confirm-actions" style={{ justifyContent: "center" }}>
                <a className="btn-primary" href={vcardUrl} download={`${storeName || "store"}.vcf`}>
                  Download vCard
                </a>
                <button type="button" className="btn-ghost" onClick={handlePrint}>
                  Print
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// Escape store name before injecting it as HTML text into the print iframe.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
