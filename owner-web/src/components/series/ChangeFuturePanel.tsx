"use client";

import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { dateLabel, weekdayOf, whenLabel, type PickerContext } from "@/lib/series";
import type {
  ChangeDateStatus,
  ChangePreview,
  ChangeResolution,
  SeriesDetail,
  SlotOption,
  SlotsResponse,
} from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import "@/styles/series.css";

import { StylistOption } from "./RescheduleSheet";

interface ApiError {
  error?: { code?: string; message?: string; details?: { rule?: string }[] };
}

/** "keep" leaves the series' stylist as it is; otherwise a stylist id or "any". */
type StaffChoice = "keep" | string;

/** The words under each previewed date. `ok` has none: the row's own date and new time say it. */
const STATUS_NOTE: Record<Exclude<ChangeDateStatus, "ok">, string> = {
  taken: t.reschedule.taken,
  kept: t.reschedule.kept,
  skipped: t.reschedule.skipped,
  closed: t.reschedule.closed,
  later: t.reschedule.later,
};

/**
 * One request's free times, keyed so a late reply for an older choice (another From date, another
 * stylist) is never shown as the current one's.
 *
 * `fresh` is part of the key too: the same URL must be asked again when the answer may have
 * changed — after a 409 the conflict picker for a date offered the very time that had just been
 * taken, because its URL had not changed and the old list was still in state (seen in headless
 * Chrome, 2026-10-03).
 */
function useSlots(url: string | null, fresh: number): { loading: boolean; slots: SlotOption[]; error: string } {
  const [result, setResult] = useState<{ key: string; slots: SlotOption[]; error: string } | null>(null);
  const key = url ? `${url}#${fresh}` : null;
  useEffect(() => {
    if (!url || !key) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as SlotsResponse & ApiError;
        if (!alive) return;
        setResult(
          res.ok
            ? { key, slots: json.slots ?? [], error: "" }
            : { key, slots: [], error: json?.error?.message ?? t.common.thatDidntWork },
        );
      } catch {
        if (alive) setResult({ key, slots: [], error: t.appointments.networkError });
      }
    })();
    return () => {
      alive = false;
    };
  }, [url, key]);
  const loading = !!key && (!result || result.key !== key);
  return { loading, slots: loading || !result ? [] : result.slots, error: loading || !result ? "" : result.error };
}

/** Loading / closed / none / the time chips — the same states as the Reschedule picker. */
function SlotChips({
  state,
  date,
  closedDays,
  labelledBy,
  lead,
  selected,
  onPick,
  disabled,
}: {
  state: { loading: boolean; slots: SlotOption[]; error: string };
  date: string;
  closedDays: number[];
  labelledBy: string;
  /** A first chip that is not a time ("Keep current time"). */
  lead?: { label: string; selected: boolean; onPick: () => void };
  selected: string | null;
  onPick: (slot: SlotOption) => void;
  disabled?: boolean;
}) {
  const leadChip = lead ? (
    <button
      type="button"
      className="rs-slot rs-slot-wide"
      aria-pressed={lead.selected}
      disabled={disabled}
      onClick={lead.onPick}
    >
      {lead.label}
    </button>
  ) : null;
  let body;
  if (state.loading) {
    body = (
      <p className="rs-state" role="status">
        <Spinner size={14} />
        {t.reschedule.loadingTimes}
      </p>
    );
  } else if (state.error) {
    body = (
      <p className="ss-error" role="alert">
        {state.error}
      </p>
    );
  } else if (state.slots.length === 0) {
    body = <p className="rs-state">{closedDays.includes(weekdayOf(date)) ? t.reschedule.closedDay : t.reschedule.noTimes}</p>;
  } else {
    body = null;
  }
  return (
    <div className="rs-slots" role="group" aria-labelledby={labelledBy}>
      {leadChip}
      {body ??
        state.slots.map((slot) => (
          <button
            key={slot.startAt}
            type="button"
            className="rs-slot"
            aria-pressed={selected === slot.startAt}
            disabled={disabled}
            onClick={() => onPick(slot)}
          >
            {slot.label}
          </button>
        ))}
    </div>
  );
}

/**
 * "Change future visits" (Phase 2): a new time and/or stylist for every visit from a chosen date
 * on. Never the interval (client spec).
 *
 *  1. From — one of the API's `changeFromDates` (today up to the first date not booked yet).
 *  2. Stylist — another stylist, "Any stylist", or "Keep current stylist"; then New time — a free
 *     slot ON the From date (or "Keep current time"). Stylist first, as on the app and the
 *     customer site: the free times depend on it, and picking a stylist clears the time.
 *  3. Preview — the API works out each date's fate. A date where the new time is taken CANNOT use
 *     it: the owner picks another free time for that date or skips it. A visit already moved by
 *     hand keeps its time.
 *  4. Change visits — enabled only once every taken date has a choice. If a date was taken in the
 *     meantime the API answers 409 CHANGE_CONFLICTS, nothing is written, and the preview is run
 *     again with those dates' choices cleared.
 *
 * Nobody is texted (client rule), and the footer says so. Renders a scroll area and a footer, in
 * place of the series sheet's own.
 */
export function ChangeFuturePanel({
  detail,
  picker,
  onDone,
  onBack,
}: {
  detail: SeriesDetail;
  picker: PickerContext;
  onDone: (next: SeriesDetail) => void;
  onBack: () => void;
}) {
  const s = detail.series;
  const fromDates = detail.changeFromDates ?? [];
  const fromId = useId();
  const timeId = useId();
  const staffLabelId = useId();
  const [fromDate, setFromDate] = useState(fromDates[0] ?? "");
  const [time, setTime] = useState<SlotOption | null>(null);
  const [staff, setStaff] = useState<StaffChoice>("keep");
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, SlotOption | "skip">>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * Bumped each time a date's "Pick another time" opens, so it always asks again (a 409 means a
   * time was just taken). Not bumped for the New time chips: re-asking those while the preview
   * scrolled into view collapsed them to "Loading times…" mid-scroll and stopped it short.
   */
  const [fresh, setFresh] = useState(0);
  const previewRef = useRef<HTMLElement>(null);
  const busy = previewing || saving;

  // On a phone the preview lands under the From, New time and Stylist lists — out of sight, so
  // pressing Preview looked like nothing happened. Bring it into view when it arrives. Instant,
  // not smooth: a smooth scroll stopped short whenever anything re-laid the panel out mid-way.
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: "start" });
  }, [preview]);

  const base = `/api/appointments/series/${encodeURIComponent(s.id)}/slots`;
  const slotsUrl = (date: string) => {
    const p = new URLSearchParams({ date, fromDate });
    if (staff !== "keep") p.set("staffId", staff);
    return `${base}?${p}`;
  };
  const newTimes = useSlots(fromDate ? slotsUrl(fromDate) : null, 0);
  const otherTimes = useSlots(picking ? slotsUrl(picking) : null, fresh);

  // A date's times open under its row, often below the fold on a phone: once they have loaded
  // (their final height), bring them into view.
  const pickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picking && !otherTimes.loading) pickRef.current?.scrollIntoView({ block: "nearest" });
  }, [picking, otherTimes.loading]);

  /** Any change to the request makes the preview (and the choices made on it) stale. */
  function reset() {
    setPreview(null);
    setResolutions({});
    setPicking(null);
  }

  function body() {
    return {
      fromDate,
      ...(time ? { slotStart: time.startAt } : {}),
      ...(staff !== "keep" ? { staffId: staff } : {}),
    };
  }

  async function runPreview() {
    setPreviewing(true);
    try {
      const res = await fetch(`/api/appointments/series/${encodeURIComponent(s.id)}/preview-change`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      const json = (await res.json().catch(() => ({}))) as ChangePreview & ApiError;
      if (!res.ok) {
        showToast(json?.error?.message ?? t.common.thatDidntWork, "error");
        return;
      }
      setPreview(json);
      // Keep only the choices for dates that still need one.
      setResolutions((prev) => Object.fromEntries(Object.entries(prev).filter(([d]) => json.conflicts.includes(d))));
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setSaving(true);
    try {
      const list: ChangeResolution[] = preview.conflicts.map((date) => {
        const r = resolutions[date];
        return r === "skip" ? { date, skip: true } : { date, slotStart: (r as SlotOption).startAt };
      });
      const res = await fetch(`/api/appointments/series/${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body(), ...(list.length ? { resolutions: list } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as SeriesDetail & ApiError;
      if (!res.ok) {
        if (res.status === 409 && json?.error?.code === "CHANGE_CONFLICTS") {
          // A date was taken (or a picked time went) since the preview: nothing was written.
          showToast(t.reschedule.conflictsAgain, "error");
          const stale = new Set((json.error.details ?? []).map((d) => d.rule).filter(Boolean) as string[]);
          setResolutions((prev) => Object.fromEntries(Object.entries(prev).filter(([d]) => !stale.has(d))));
          setPicking(null);
          await runPreview();
          return;
        }
        showToast(json?.error?.message ?? t.common.thatDidntWork, "error");
        return;
      }
      showToast(t.reschedule.changed, "success");
      onDone(json);
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setSaving(false);
    }
  }

  const nothingChosen = time === null && staff === "keep";
  const allResolved = !!preview && preview.conflicts.every((d) => resolutions[d] !== undefined);

  return (
    <>
      <div className="srs-scroll rs">
        <p className="wk-label rs-label" id={fromId}>
          {t.reschedule.from}
        </p>
        <div className="rs-slots" role="radiogroup" aria-labelledby={fromId}>
          {fromDates.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={fromDate === d}
              className="rs-slot rs-slot-wide"
              disabled={busy}
              onClick={() => {
                setFromDate(d);
                // The new time must be a slot ON the From date.
                setTime(null);
                reset();
              }}
            >
              {dateLabel(d, picker.zone)}
            </button>
          ))}
        </div>

        {picker.staff.length > 0 ? (
          <>
            <p className="wk-label rs-label" id={staffLabelId}>
              {t.reschedule.stylist}
            </p>
            <div className="wk-list" role="radiogroup" aria-labelledby={staffLabelId}>
              <StylistOption
                checked={staff === "keep"}
                onSelect={() => {
                  setStaff("keep");
                  setTime(null);
                  reset();
                }}
                avatar={<Icon name="repeat" size={15} />}
                avatarClass="auto"
                label={t.reschedule.keepStylist}
              />
              {picker.allowAny ? (
                <StylistOption
                  checked={staff === "any"}
                  onSelect={() => {
                    setStaff("any");
                    setTime(null);
                    reset();
                  }}
                  avatar={<Icon name="sparkles" size={15} />}
                  avatarClass="auto"
                  label={t.reschedule.anyStylist}
                />
              ) : null}
              {picker.staff.map((st) => (
                <StylistOption
                  key={st.id}
                  checked={staff === st.id}
                  onSelect={() => {
                    setStaff(st.id);
                    // Times differ per stylist: a time picked for the old choice may not be free.
                    setTime(null);
                    reset();
                  }}
                  avatar={st.name[0]}
                  avatarClass={`seat-avatar-${st.colorToken || "secondary"}`}
                  label={st.name}
                />
              ))}
            </div>
          </>
        ) : null}

        <p className="wk-label rs-label" id={timeId}>
          {t.reschedule.newTime}
        </p>
        <SlotChips
          state={newTimes}
          date={fromDate}
          closedDays={picker.closedDays}
          labelledBy={timeId}
          lead={{
            label: t.reschedule.keepTime,
            selected: time === null,
            onPick: () => {
              setTime(null);
              reset();
            },
          }}
          selected={time?.startAt ?? null}
          onPick={(slot) => {
            setTime(slot);
            reset();
          }}
          disabled={busy}
        />

        {preview ? (
          <section className="srs-section rs-preview" aria-live="polite" ref={previewRef}>
            <ul className="srs-rows">
              {preview.dates.map((d) => {
                const r = resolutions[d.date];
                return (
                  <li key={d.date} className={`srs-row srs-row-wrap rs-preview-row${d.status === "taken" ? " is-taken" : ""}`}>
                    <div className="srs-row-body">
                      <p className="srs-row-when">
                        {d.status === "ok" ? whenLabel(d.startAt, picker.zone) : dateLabel(d.date, picker.zone)}
                      </p>
                      {d.status !== "ok" ? (
                        <p className={`srs-row-note${d.status === "taken" ? " rs-note-warn" : ""}`}>{STATUS_NOTE[d.status]}</p>
                      ) : null}
                      {d.status === "taken" && r ? (
                        <p className="srs-row-note rs-note-chosen">
                          <Icon name="check" size={13} />
                          {r === "skip" ? t.reschedule.skipped : whenLabel(r.startAt, picker.zone)}
                        </p>
                      ) : null}
                    </div>
                    {d.status === "taken" ? (
                      <div className="rs-row-actions">
                        <button
                          type="button"
                          className="srs-ghost-btn"
                          aria-expanded={picking === d.date}
                          disabled={busy}
                          onClick={() => {
                            setFresh((n) => n + 1);
                            setPicking(picking === d.date ? null : d.date);
                          }}
                        >
                          {t.reschedule.pickAnother}
                        </button>
                        <button
                          type="button"
                          className="srs-ghost-btn"
                          aria-pressed={r === "skip"}
                          disabled={busy}
                          onClick={() => {
                            setResolutions((prev) => ({ ...prev, [d.date]: "skip" }));
                            setPicking(null);
                          }}
                        >
                          {t.reschedule.skipDate}
                        </button>
                      </div>
                    ) : null}
                    {picking === d.date ? (
                      <div className="rs-inline-pick" ref={pickRef}>
                        <SlotChips
                          state={otherTimes}
                          date={d.date}
                          closedDays={picker.closedDays}
                          labelledBy={timeId}
                          selected={r && r !== "skip" ? r.startAt : null}
                          onPick={(slot) => {
                            setResolutions((prev) => ({ ...prev, [d.date]: slot }));
                            setPicking(null);
                          }}
                          disabled={busy}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="srs-footer">
        {preview ? (
          <>
            <p className="rs-hint">{t.reschedule.noText}</p>
            <button
              type="button"
              className="ss-btn primary block"
              disabled={busy || !allResolved}
              onClick={() => void apply()}
            >
              {saving ? <Spinner size={16} /> : null}
              {t.reschedule.changeVisits}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ss-btn primary block"
            disabled={busy || nothingChosen || !fromDate}
            onClick={() => void runPreview()}
          >
            {previewing ? <Spinner size={16} /> : null}
            {t.reschedule.preview}
          </button>
        )}
        <button type="button" className="ss-btn ghost block" disabled={saving} onClick={onBack}>
          {t.reschedule.back}
        </button>
      </div>
    </>
  );
}
