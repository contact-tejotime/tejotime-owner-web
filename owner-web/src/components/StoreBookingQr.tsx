"use client";

import { useEffect, useId, useState } from "react";

import { Icon } from "@/components/Icon";

/**
 * Booking QR for the owner's store profile header.
 *
 * Encodes the customer chooser at `/{phone}/card` (same target as the admin hub). No
 * qrcode.react dependency — the PNG comes from a public QR endpoint so the dialog stays
 * dependency-light on owner-web.
 */
export function StoreBookingQr({
  cardUrl,
  storeName,
}: {
  cardUrl: string;
  storeName: string;
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
      <button
        type="button"
        className="qr-icon-btn"
        onClick={() => setOpen(true)}
        title="Booking QR — scan to book or save contact"
        aria-label="Booking QR"
      >
        <Icon name="qrCode" size={18} />
      </button>

      {open ? (
        <div className="store-qr-overlay" onClick={() => setOpen(false)} role="presentation">
          <div
            className="store-qr-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={titleId}>{storeName || "Store"} — booking QR</h3>
            <p className="field-hint" style={{ marginTop: 4, textAlign: "center" }}>
              Scan to book an appointment, or save this store as a contact.
            </p>
            <div className="store-qr-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc} alt="" width={220} height={220} />
            </div>
            <a href={cardUrl} target="_blank" rel="noreferrer" className="btn secondary btn-sm" style={{ width: "100%" }}>
              Open link
            </a>
            <button type="button" className="btn secondary btn-sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
