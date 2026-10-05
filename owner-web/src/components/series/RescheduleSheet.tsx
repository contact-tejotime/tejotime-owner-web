"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { format, t } from "@/i18n";

import { BottomSheet } from "@/components/BottomSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { dateLabel, weekdayOf, whenLabel, zonedYmd, type PickerContext } from "@/lib/series";
import type { AppointmentRow, SlotOption, SlotsResponse } from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import "@/styles/series.css";

/**
 * What the picker is for:
 *  - `move`: Reschedule one booking — one-off or a series visit — to another day, time or stylist
 *    (`POST /appointments/:id/reschedule`; the owner may go up to today+60).
 *  - `book`: "Book another time" for a Needs attention date — books that one flagged date at a
 *    time the owner picks (`POST /appointments/series/issues/:id/book`).
 */
export type PickTarget =
  | { kind: "move"; appointmentId: string; startAt: string; staffId: string | null }
  | { kind: "book"; issueId: string; seriesId: string; occurrenceDate: string; staffId: string | null };

interface ApiError {
  error?: { code?: string; message?: string };
}

/** "Move visit", or "Book Mon 26 Oct at another time". */
export function pickTitle(target: PickTarget, zone: string): string {
  return target.kind === "move"
    ? t.reschedule.title
    : format(t.reschedule.bookTitle, { date: dateLabel(target.occurrenceDate, zone) });
}

/** The stylist to start on: the booking's own when it can be offered, else "Any", else the first. */
function initialStaff(current: string | null, picker: PickerContext): string | null {
  if (picker.staff.length === 0) return null; // a store with no stylists: keep whatever it has
  if (current && picker.staff.some((s) => s.id === current)) return current;
  return picker.allowAny ? "any" : picker.staff[0].id;
}

/**
 * The picker itself: Day (a native date input bounded by the API's own today … lastDay), Stylist
 * (the walk-in sheet's radio list) and Time (the free times the API offers for that day and
 * stylist). In that order, as on the app and the customer site: tapping a time asks to confirm
 * straight away, so a stylist below the times could never be chosen first — and the times depend
 * on the stylist, so changing it re-reads them. The confirm says no text goes to the customer,
 * because none does (client rule: only the three registered SMS).
 *
 * Shared by the standalone sheet below (row Reschedule, Needs attention → Book another time) and
 * the series sheet, which shows it in place of its own body. It renders a scroll area and a footer,
 * so either host can drop it straight into a BottomSheet panel.
 *
 * Never works out a store-local day or instant itself: the date input starts on the booking's own
 * store day, its range comes from the API, and every time is a slot's `startAt`.
 */
export function ReschedulePanel({
  target,
  picker,
  onDone,
  onBack,
  onModalChange,
}: {
  target: PickTarget;
  picker: PickerContext;
  /** After the API accepted the move / booking (the toast has been shown). */
  onDone: (row: AppointmentRow) => void;
  /** Back out without changing anything. */
  onBack: () => void;
  /**
   * The confirm is open on top. Its host must not close the sheet on that Escape — both hear it,
   * and the sheet's listener runs first.
   */
  onModalChange?: (open: boolean) => void;
}) {
  const dayId = useId();
  const timeId = useId();
  const staffLabelId = useId();
  const [date, setDate] = useState(() =>
    target.kind === "move" ? zonedYmd(target.startAt, picker.zone) : target.occurrenceDate,
  );
  const [range, setRange] = useState<{ min: string; max: string } | null>(null);
  const [staffId, setStaffId] = useState<string | null>(() => initialStaff(target.staffId, picker));
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; slots: SlotOption[]; error: string } | null>(null);
  const [chosen, setChosen] = useState<SlotOption | null>(null);
  const [saving, setSaving] = useState(false);

  // One key per request; a reply for an older key (the owner kept clicking days) is shown as still
  // loading rather than as the new day's times.
  const key = `${date}|${staffId ?? ""}|${reload}`;
  const loading = !result || result.key !== key;

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ date });
    if (staffId) params.set("staffId", staffId);
    const base =
      target.kind === "move"
        ? `/api/appointments/${encodeURIComponent(target.appointmentId)}/slots`
        : `/api/appointments/series/${encodeURIComponent(target.seriesId)}/slots`;
    (async () => {
      try {
        const res = await fetch(`${base}?${params}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as SlotsResponse & ApiError;
        if (!alive) return;
        if (!res.ok) {
          setResult({ key, slots: [], error: json?.error?.message ?? t.common.thatDidntWork });
          return;
        }
        setRange({ min: json.today, max: json.lastDay });
        // A flagged date can already be behind us: start on the store's today instead.
        if (date < json.today) {
          setDate(json.today);
          return;
        }
        setResult({ key, slots: json.slots ?? [], error: "" });
      } catch {
        if (alive) setResult({ key, slots: [], error: t.appointments.networkError });
      }
    })();
    return () => {
      alive = false;
    };
    // `key` also carries `reload`; `target` is fixed for the life of the panel (hosts keep it in state).
  }, [key, date, staffId, target]);

  function choose(slot: SlotOption | null) {
    setChosen(slot);
    onModalChange?.(slot !== null);
  }

  async function submit() {
    if (!chosen) return;
    setSaving(true);
    try {
      const url =
        target.kind === "move"
          ? `/api/appointments/${encodeURIComponent(target.appointmentId)}/reschedule`
          : `/api/appointments/series/issues/${encodeURIComponent(target.issueId)}/book`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slotStart: chosen.startAt, ...(staffId ? { staffId } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as AppointmentRow & ApiError;
      if (!res.ok) {
        showToast(json?.error?.message ?? t.common.thatDidntWork, "error");
        choose(null);
        // Someone took that time while the sheet was open: show what is free now.
        if (res.status === 409) setReload((r) => r + 1);
        return;
      }
      showToast(target.kind === "move" ? t.reschedule.visitMoved : t.reschedule.visitBooked, "success");
      choose(null);
      onDone(json);
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setSaving(false);
    }
  }

  const closedDay = picker.closedDays.includes(weekdayOf(date));
  const slots = loading ? [] : result!.slots;

  return (
    <>
      <div className="srs-scroll rs">
        <label className="wk-label rs-label" htmlFor={dayId}>
          {t.reschedule.day}
        </label>
        <input
          id={dayId}
          type="date"
          className="rs-date"
          value={date}
          min={range?.min}
          max={range?.max}
          onChange={(e) => {
            // The native control can be cleared; an empty day has no times to ask for.
            if (e.target.value) setDate(e.target.value);
          }}
        />

        {picker.staff.length > 0 ? (
          <>
            <p className="wk-label rs-label" id={staffLabelId}>
              {t.reschedule.stylist}
            </p>
            {/* The walk-in sheet's seat list (WalkInSheet.tsx), minus its load line. */}
            <div className="wk-list" role="radiogroup" aria-labelledby={staffLabelId}>
              {picker.allowAny ? (
                <StylistOption
                  checked={staffId === "any"}
                  onSelect={() => setStaffId("any")}
                  avatar={<Icon name="sparkles" size={15} />}
                  avatarClass="auto"
                  label={t.reschedule.anyStylist}
                />
              ) : null}
              {picker.staff.map((st) => (
                <StylistOption
                  key={st.id}
                  checked={staffId === st.id}
                  onSelect={() => setStaffId(st.id)}
                  avatar={st.name[0]}
                  avatarClass={`seat-avatar-${st.colorToken || "secondary"}`}
                  label={st.name}
                />
              ))}
            </div>
          </>
        ) : null}

        <p className="wk-label rs-label" id={timeId}>
          {t.reschedule.time}
        </p>
        {loading ? (
          <p className="rs-state" role="status">
            <Spinner size={14} />
            {t.reschedule.loadingTimes}
          </p>
        ) : result!.error ? (
          <p className="ss-error" role="alert">
            {result!.error}
          </p>
        ) : slots.length === 0 ? (
          <p className="rs-state">{closedDay ? t.reschedule.closedDay : t.reschedule.noTimes}</p>
        ) : (
          <div className="rs-slots" role="group" aria-labelledby={timeId}>
            {slots.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                className="rs-slot"
                disabled={saving}
                onClick={() => choose(slot)}
              >
                {slot.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="srs-footer">
        <button type="button" className="ss-btn ghost block" disabled={saving} onClick={onBack}>
          {t.reschedule.back}
        </button>
      </div>

      {chosen ? (
        <ConfirmDialog
          key={chosen.startAt}
          open
          title={format(target.kind === "move" ? t.reschedule.confirmMove : t.reschedule.confirmBook, {
            when: whenLabel(chosen.startAt, picker.zone),
          })}
          body={t.reschedule.noText}
          confirmLabel={target.kind === "move" ? t.reschedule.moveVisit : t.reschedule.bookVisit}
          cancelLabel={t.reschedule.back}
          busy={saving}
          onConfirm={() => void submit()}
          onCancel={() => {
            if (!saving) choose(null);
          }}
        />
      ) : null}
    </>
  );
}

/** One row of the stylist radio list — the walk-in sheet's `.wk-seat`. */
export function StylistOption({
  checked,
  onSelect,
  avatar,
  avatarClass,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  avatar: ReactNode;
  avatarClass: string;
  label: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="wk-seat" onClick={onSelect}>
      <span className={`wk-seat-avatar ${avatarClass}`} aria-hidden>
        {avatar}
      </span>
      <span className="wk-seat-body">
        <span className="wk-seat-name">{label}</span>
      </span>
      {checked ? <Icon name="check" size={18} className="wk-seat-check" /> : null}
    </button>
  );
}

/**
 * The picker as a sheet of its own — row Reschedule on Appointments, and "Book another time" on a
 * Needs attention item. Portalled through BottomSheet → OverlayPortal like every overlay here.
 */
export function RescheduleSheet({
  target,
  name,
  picker,
  onClose,
  onDone,
}: {
  target: PickTarget;
  /** The customer, under the title. */
  name: string;
  picker: PickerContext;
  onClose: () => void;
  onDone: (row: AppointmentRow) => void;
}) {
  const titleId = useId();
  const [modal, setModal] = useState(false);

  return (
    <BottomSheet
      onClose={() => {
        if (!modal) onClose();
      }}
      closeLabel={t.series.close}
      labelledBy={titleId}
      className="srs-sheet"
    >
      <header className="srs-head">
        <div className="srs-head-text">
          <h2 id={titleId} className="srs-title">
            {pickTitle(target, picker.zone)}
          </h2>
          <p className="srs-phone">{name}</p>
        </div>
      </header>
      <ReschedulePanel target={target} picker={picker} onDone={onDone} onBack={onClose} onModalChange={setModal} />
    </BottomSheet>
  );
}
