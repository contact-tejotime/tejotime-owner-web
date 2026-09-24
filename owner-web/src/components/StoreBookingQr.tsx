"use client";

import { useId, useState } from "react";
import { t, format } from "@/i18n";

import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import "@/styles/shell-sheets.css";

/** A public QR endpoint — no qrcode.react dependency, so owner-web stays dependency-light. */
function qrImageUrl(data: string, px: number): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&data=${encodeURIComponent(data)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Print ONLY the QR and the store's name, centred on one page — the app's QRSheet does the same.
 *
 * Printed from a hidden iframe holding just that document: `window.print()` on the page itself
 * would print the whole dashboard around the dialog. `@page { margin: 0 }` leaves the browser no
 * room for its date/URL header and footer. The QR is an <img> from the QR endpoint, so printing
 * waits for it to load — printing on `doc.close()` produced a blank square.
 */
function printQr(name: string, qrUrl: string) {
  const safe = escapeHtml(name);
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(format(t.qr.printTitle, { name }))}</title>` +
    `<style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}` +
    `.wrap{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;` +
    `padding:40px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;color:#111}` +
    `h1{font-size:28px;font-weight:700;margin:0 0 8px}p{font-size:15px;color:#555;margin:0 0 36px}` +
    `img{width:420px;height:420px;max-width:80vw}</style></head>` +
    `<body><div class="wrap"><h1>${safe}</h1><p>${escapeHtml(t.qr.subtitle)}</p>` +
    `<img src="${escapeHtml(qrUrl)}" alt=""></div></body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    return;
  }
  const cleanup = () => iframe.remove();
  doc.open();
  doc.write(html);
  doc.close();
  win.onafterprint = cleanup;
  // Some browsers never fire afterprint for an iframe; do not leave it in the page forever.
  setTimeout(cleanup, 60000);
  const go = () => {
    win.focus();
    win.print();
  };
  const img = doc.querySelector("img");
  if (!img || img.complete) go();
  else {
    img.addEventListener("load", go, { once: true });
    img.addEventListener("error", cleanup, { once: true });
  }
}

/**
 * Booking QR for the owner's store profile header / Home's live card.
 *
 * Encodes the customer chooser at `/{phone}/card` (same target as the admin hub and the app).
 *
 * The dialog is the web twin of the app's QRSheet: a bottom sheet on a phone and tablet (a centred
 * dialog on desktop — see BottomSheet), with the title, the "scan to book" line, the QR on a
 * white square, and Print. "Open link" and "Close" are web-only and kept.
 *
 * Portalled (BottomSheet → OverlayPortal), and it has to be: on Home the trigger sits in the
 * live-queue card, which is its own stacking context (`isolation: isolate`, for the decorative
 * discs), so an overlay rendered in place only ranked INSIDE the card and the seat boards painted
 * straight over the QR on a phone. It now goes to the themed shell root rather than <body>, which
 * is also what keeps it in the store's colours and dark mode.
 */
export function StoreBookingQr({
  cardUrl,
  storeName,
  variant = "icon",
  label = t.qr.label,
  buttonClassName = "qr-icon-btn",
}: {
  cardUrl: string;
  storeName: string;
  /** `icon` = compact header control; `button` = dashboard quick-action style. */
  variant?: "icon" | "button";
  label?: string;
  /** The `icon` variant's class — the Home live card draws it on the brand fill. */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  if (!cardUrl) return null;

  const name = storeName || t.qr.storeFallback;
  // Twice the drawn size, so the code stays crisp on a high-density screen.
  const qrSrc = qrImageUrl(cardUrl, 352);

  return (
    <>
      {variant === "button" ? (
        <button
          type="button"
          className="btn secondary home-action-secondary"
          onClick={() => setOpen(true)}
          aria-label={label}
        >
          <Icon name="qrCode" size={18} />
          {label}
        </button>
      ) : (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => setOpen(true)}
          title={t.qr.buttonTitle}
          aria-label={t.qr.buttonAria}
        >
          <Icon name="qrCode" size={18} />
        </button>
      )}

      {open ? (
        <BottomSheet
          onClose={() => setOpen(false)}
          closeLabel={t.qr.close}
          labelledBy={titleId}
          className="qr-sheet"
        >
          {/* Scrolls only when the sheet's height cap actually bites (a short landscape phone). */}
          <div className="qr-sheet-body">
            <h3 id={titleId} className="qr-sheet-title">
              {format(t.qr.heading, { name })}
            </h3>
            <p className="qr-sheet-sub">{t.qr.subtitle}</p>
            {/* White in dark mode too: a QR needs its light quiet zone to scan. */}
            <div className="qr-sheet-box">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote QR PNG, not a page asset */}
              <img src={qrSrc} alt="" width={176} height={176} />
            </div>
            <div className="qr-sheet-actions">
              <button
                type="button"
                className="ss-btn primary block"
                onClick={() => printQr(name, qrImageUrl(cardUrl, 840))}
              >
                {t.qr.print}
              </button>
              <a href={cardUrl} target="_blank" rel="noreferrer" className="ss-btn outline block">
                <Icon name="externalLink" size={16} />
                {t.qr.openLink}
              </a>
              <button type="button" className="ss-btn ghost block" onClick={() => setOpen(false)}>
                {t.qr.close}
              </button>
            </div>
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}
