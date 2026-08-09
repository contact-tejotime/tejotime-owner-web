"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { MOCK_SEATS, MOCK_SERVICES } from "@/lib/mock-data";

type WalkInSheetProps = {
  open: boolean;
  onClose: () => void;
};

export function WalkInSheet({ open, onClose }: WalkInSheetProps) {
  const [serviceId, setServiceId] = useState(MOCK_SERVICES[0]?.id ?? "");
  const [seatId, setSeatId] = useState("any");

  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label="Add walk-in">
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-grabber" aria-hidden />
        <h2 className="sheet-title">Add walk-in</h2>

        <div className="field">
          <label htmlFor="walkin-name">Customer name</label>
          <input id="walkin-name" placeholder="Full name" />
        </div>

        <div className="field">
          <label htmlFor="walkin-phone">Phone</label>
          <div className="phone-split">
            <button type="button" className="phone-cc-btn" tabIndex={-1}>
              +91
            </button>
            <input id="walkin-phone" placeholder="98xxx xxxxx" />
          </div>
        </div>

        <p className="field-label">Service</p>
        <div className="service-pick-list">
          {MOCK_SERVICES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`service-pick ${serviceId === s.id ? "selected" : ""}`}
              style={{ ["--accent" as string]: s.accent }}
              onClick={() => setServiceId(s.id)}
            >
              <span className="service-pick-accent" />
              <span className="service-pick-body">
                <span className="nm">{s.name}</span>
                <span className="meta">
                  <Icon name="clock" size={12} /> {s.mins} min
                </span>
              </span>
              <span className="service-pick-price">{s.price}</span>
            </button>
          ))}
        </div>

        <p className="field-label">Assign to seat</p>
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
              <span className="nm">Any seat</span>
              <span className="meta">Soonest free · {MOCK_SEATS[0]?.name}</span>
            </span>
            {seatId === "any" ? <Icon name="check" size={18} className="seat-pick-check" /> : null}
          </button>
          {MOCK_SEATS.map((seat) => (
            <button
              key={seat.id}
              type="button"
              className={`seat-pick ${seatId === seat.id ? "selected" : ""}`}
              onClick={() => setSeatId(seat.id)}
            >
              <span className="seat-pick-avatar" style={{ background: seat.color }}>
                {seat.name[0]}
              </span>
              <span className="seat-pick-body">
                <span className="nm">{seat.name}</span>
                <span className="meta">{seat.status === "free" ? "Free now" : "Busy"}</span>
              </span>
              {seatId === seat.id ? <Icon name="check" size={18} className="seat-pick-check" /> : null}
            </button>
          ))}
        </div>

        <button type="button" className="btn sheet-submit" onClick={onClose}>
          Add to queue
        </button>
      </div>
    </div>
  );
}
