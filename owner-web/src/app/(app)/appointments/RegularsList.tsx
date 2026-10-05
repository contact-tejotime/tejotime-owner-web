"use client";

import "@/styles/appointments.css";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { SeriesSheet } from "@/components/series/SeriesSheet";
import type { PickerContext } from "@/lib/series";
import type { SeriesStatus } from "@/lib/server-api";

/** One regular, already worded on the server in the store's zone (see page.tsx). */
export interface RegularRowView {
  id: string;
  name: string;
  /** "Every 2 weeks · Sat 10:00 AM" */
  rhythm: string;
  /** The stylist, or "Any stylist". */
  stylist: string;
  /** "Next: Sat 24 Oct, 10:00 AM", or "No visit booked yet". */
  next: string;
  status: SeriesStatus;
  /** The badge — only for a series that is not active. */
  statusLabel: string | null;
  needsAttention: boolean;
  /** Changes whenever the series does, so an open sheet re-reads after a live update. */
  version: string;
}

/** The app's StatusBadge tones: paused is a warning (it has stopped booking), the rest are done. */
const STATUS_TONE: Record<SeriesStatus, string> = {
  active: "success",
  paused: "warning",
  ended: "neutral",
  cancelled: "neutral",
};

/**
 * Regulars — every customer with an active or paused repeating booking (`GET /appointments/series`,
 * already narrowed to a staff login's own chair by the API). It lives under Appointments, not
 * Customers, on purpose: the free plan cuts the Customers list to two, and that cut must never
 * hide a regular (docs/recurring-appointments.md §0).
 *
 * Tapping a row opens the series sheet. The sheet stays open across the page refresh its own
 * actions trigger — even when cancelling drops the row from this list — because the open series is
 * held here, not looked up in `rows`.
 */
export function RegularsList({
  rows,
  picker,
  canManage,
}: {
  rows: RegularRowView[];
  picker: PickerContext;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const openRow = open ? rows.find((r) => r.id === open.id) : undefined;

  return (
    <>
      {rows.length === 0 ? (
        <div className="appts-empty appts-empty-fill">
          <span className="appts-empty-disc" aria-hidden>
            <Icon name="repeat" size={24} />
          </span>
          <p className="appts-empty-title">{t.series.regularsEmpty}</p>
          <p className="appts-empty-hint">{t.series.regularsEmptyHint}</p>
        </div>
      ) : (
        <ul className="appts-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`appts-reg${r.status === "active" ? "" : " is-muted"}`}
                aria-haspopup="dialog"
                onClick={() => setOpen({ id: r.id, name: r.name })}
              >
                <span className="appts-reg-body">
                  <span className="appts-reg-name-row">
                    <span className="appts-reg-name">{r.name}</span>
                    {r.statusLabel ? (
                      <span className={`appt-status tone-${STATUS_TONE[r.status]}`}>
                        <span className="appt-status-dot" aria-hidden />
                        {r.statusLabel}
                      </span>
                    ) : null}
                    {r.needsAttention ? (
                      <span className="appt-status tone-error">
                        <span className="appt-status-dot" aria-hidden />
                        {t.series.needsAttention}
                      </span>
                    ) : null}
                  </span>
                  <span className="appts-reg-line">{r.rhythm}</span>
                  <span className="appts-reg-line">
                    {r.stylist} · {r.next}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} className="appts-reg-chev" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Keyed by series so each opening starts from its own fresh state. */}
      {open ? (
        <SeriesSheet
          key={open.id}
          seriesId={open.id}
          name={open.name}
          version={openRow?.version ?? "gone"}
          picker={picker}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onChanged={() => startTransition(() => router.refresh())}
        />
      ) : null}
    </>
  );
}
