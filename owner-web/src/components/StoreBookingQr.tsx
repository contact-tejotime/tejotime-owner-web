"use client";

import { useEffect, useId, useState } from "react";
import { t, format } from "@/i18n";

import { Icon } from "@/components/Icon";

/**
 * Booking QR for the owner's store profile header / home Contact QR action.
 *
 * Encodes the customer chooser at `/{phone}/card` (same target as the admin hub). No
 * qrcode.react dependency — the PNG comes from a public QR endpoint so the dialog stays
 * dependency-light on owner-web.
 */
export function StoreBookingQr({
  cardUrl,
  storeName,
  variant = "icon",
  label = t.qr.label,
}: {
  cardUrl: string;
  storeName: string;
  /** `icon` = compact header control; `button` = dashboard quick-action style. */
  variant?: "icon" | "button";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!cardUrl) return null;

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(cardUrl)}`;

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
          className="qr-icon-btn"
          onClick={() => setOpen(true)}
          title={t.qr.buttonTitle}
          aria-label={t.qr.buttonAria}
        >
          <Icon name="qrCode" size={18} />
        </button>
      )}

      {open ? (
        <div className="store-qr-overlay" onClick={() => setOpen(false)} role="presentation">
          <div
            className="store-qr-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={titleId}>{format(t.qr.heading, { name: storeName || t.qr.storeFallback })}</h3>
            <p className="field-hint" style={{ marginTop: 4, textAlign: "center" }}>
              {t.qr.subtitle}
            </p>
            <div className="store-qr-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc} alt="" width={220} height={220} />
            </div>
            <a href={cardUrl} target="_blank" rel="noreferrer" className="btn secondary btn-sm" style={{ width: "100%" }}>
              {t.qr.openLink}
            </a>
            <button type="button" className="btn secondary btn-sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setOpen(false)}>
              {t.qr.close}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
