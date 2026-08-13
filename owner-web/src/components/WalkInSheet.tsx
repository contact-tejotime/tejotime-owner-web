"use client";

import { useEffect, useState } from "react";
import { t, format } from "@/i18n";
import { Icon } from "@/components/Icon";
import PhoneField from "@/components/PhoneField";
import { formatMoney } from "@/lib/format";
import {
  combineToE164,
  DEFAULT_DIAL_CODE,
  DEFAULT_ISO2,
} from "@/lib/phone";
import type { ServiceRow, StaffRow } from "@/lib/server-api";

type WalkInSheetProps = {
  onClose: () => void;
  staff: StaffRow[];
  services: ServiceRow[];
  onAdded: () => void;
};

/**
 * Add a walk-in. Posts to `/api/queue`, which forwards to the backend's `queue_add` RPC —
 * the same call the Expo app makes, so token allocation and seat assignment stay identical.
 *
 * Mounted only while open (the parent renders it conditionally), so every field starts fresh
 * on each open without a reset effect — clearing state inside an effect paints the previous
 * customer's details for one frame before wiping them, which is what
 * react-hooks/set-state-in-effect is warning about.
 */
export function WalkInSheet({ onClose, staff, services, onAdded }: WalkInSheetProps) {
  // Pre-selects the first service, matching the app's walk-in sheet.
  const [serviceId, setServiceId] = useState(() => services[0]?.id ?? "");
  const [seatId, setSeatId] = useState("any");
  const [name, setName] = useState("");
  const [phoneCountry, setPhoneCountry] = useState({
    dialCode: DEFAULT_DIAL_CODE,
    iso2: DEFAULT_ISO2,
  });
  const [national, setNational] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    if (!name.trim()) return setError("Enter the customer's name.");
    if (services.length > 0 && !serviceId) return setError("Pick a service.");
    setBusy(true);
    try {
      const phone = combineToE164(phoneCountry.dialCode, national) || undefined;
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Field names come from the backend's addWalkInSchema, which is .strict() — anything
        // else is rejected outright. `staffId: "auto"` is the sentinel for "soonest free seat",
        // matching what the mobile app sends.
        body: JSON.stringify({
          name: name.trim(),
          phone,
          serviceId: serviceId || undefined,
          staffId: seatId === "any" ? "auto" : seatId,
          position: "end",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? t.walkin.errAdd);
        return;
      }
      onAdded();
    } catch {
      setError(t.walkin.networkError);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label={t.walkin.title}>
      <button type="button" className="sheet-root-backdrop" aria-label={t.walkin.close} onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-grabber" aria-hidden />
        <h2 className="sheet-title">{t.walkin.title}</h2>

        <div className="field">
          <label htmlFor="walkin-name">{t.walkin.nameLabel}</label>
          <input
            id="walkin-name"
            placeholder={t.walkin.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <PhoneField
          id="walkin-phone"
          label={t.walkin.phoneLabel}
          placeholder={t.walkin.phonePlaceholder}
          value={{ dialCode: phoneCountry.dialCode, national, iso2: phoneCountry.iso2 }}
          onChange={(v) => {
            setPhoneCountry({ dialCode: v.dialCode, iso2: v.iso2 });
            setNational(v.national);
          }}
        />

        <p className="field-label">{t.walkin.service}</p>
        <div className="service-pick-list">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`service-pick ${serviceId === s.id ? "selected" : ""}`}
              onClick={() => setServiceId(s.id)}
            >
              <span className="service-pick-accent" />
              <span className="service-pick-body">
                <span className="nm">{s.name}</span>
                <span className="meta">
                  <Icon name="clock" size={12} /> {format(t.walkin.minShort, { mins: s.durationMinutes })}
                </span>
              </span>
              <span className="service-pick-price">{formatMoney(s.price)}</span>
            </button>
          ))}
        </div>

        <p className="field-label">{t.walkin.assignSeat}</p>
        <div className="seat-pick-list">
          <button
            type="button"
            className={`seat-pick ${seatId === "any" ? "selected" : ""}`}
            onClick={() => setSeatId("any")}
          >
            <span className="seat-pick-avatar muted">
              <Icon name="sparkles" size={16} />
            </span>
            <span className="seat-pick-body">
              <span className="nm">{t.walkin.anySeat}</span>
              <span className="meta">{t.walkin.soonestFree}</span>
            </span>
            {seatId === "any" ? <Icon name="check" size={18} className="seat-pick-check" /> : null}
          </button>
          {staff.map((seat) => (
            <button
              key={seat.id}
              type="button"
              className={`seat-pick ${seatId === seat.id ? "selected" : ""}`}
              onClick={() => setSeatId(seat.id)}
            >
              <span className="seat-pick-avatar">{seat.name[0]}</span>
              <span className="seat-pick-body">
                <span className="nm">{seat.name}</span>
                <span className="meta">{seat.roleLabel ?? t.walkin.teamMember}</span>
              </span>
              {seatId === seat.id ? <Icon name="check" size={18} className="seat-pick-check" /> : null}
            </button>
          ))}
        </div>

        {error ? (
          <div className="alert err" role="alert">
            {error}
          </div>
        ) : null}

        <button type="button" className="btn sheet-submit" onClick={submit} disabled={busy}>
          {busy ? t.walkin.adding : t.walkin.addToQueue}
        </button>
      </div>
    </div>
  );
}
