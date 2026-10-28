"use client";

import { useId, useState } from "react";
import { format, t } from "@/i18n";

import { BottomSheet } from "@/components/BottomSheet";
import "@/styles/series.css";

/**
 * "Later" on a "Due to come back" row (docs/customer-due-list.md): the call went unanswered — try
 * tomorrow — or the customer asked to be called back on a day. The day's range comes from the API
 * (`callBackRange`, tomorrow … today+60 on the store's clock), never this device's.
 * Portalled through BottomSheet → OverlayPortal like every overlay here.
 */
export function LaterSheet({
  name,
  range,
  busy,
  onNoAnswer,
  onCallBackOn,
  onClose,
}: {
  name: string;
  range: { min: string; max: string };
  busy: boolean;
  onNoAnswer: () => void;
  onCallBackOn: (day: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dayId = useId();
  const [day, setDay] = useState(range.min);

  return (
    <BottomSheet onClose={onClose} closeLabel={t.customers.due.cancel} labelledBy={titleId} className="srs-sheet">
      <header className="srs-head">
        <div className="srs-head-text">
          <h2 id={titleId} className="srs-title">
            {format(t.customers.due.laterTitle, { name })}
          </h2>
        </div>
      </header>
      <div className="srs-scroll rs due-later">
        <button type="button" className="ss-btn outline block" disabled={busy} onClick={onNoAnswer}>
          {t.customers.due.noAnswer}
        </button>
        <p className="wk-label rs-label">{t.customers.due.callBackOn}</p>
        <label className="sr-only" htmlFor={dayId}>
          {t.customers.due.callBackDay}
        </label>
        <input
          id={dayId}
          type="date"
          className="rs-date"
          value={day}
          min={range.min}
          max={range.max}
          onChange={(e) => {
            if (e.target.value) setDay(e.target.value);
          }}
        />
      </div>
      <div className="srs-footer">
        <button
          type="button"
          className="ss-btn primary block"
          disabled={busy || day < range.min || day > range.max}
          onClick={() => onCallBackOn(day)}
        >
          {t.customers.due.save}
        </button>
        <button type="button" className="ss-btn ghost block" disabled={busy} onClick={onClose}>
          {t.customers.due.cancel}
        </button>
      </div>
    </BottomSheet>
  );
}
