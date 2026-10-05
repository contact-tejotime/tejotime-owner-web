"use client";

import { useEffect, useId, useState } from "react";
import { format, t } from "@/i18n";

import { AppointmentStatusBadge } from "@/components/AppointmentListItem";
import { BottomSheet } from "@/components/BottomSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { Skeleton, Spinner } from "@/components/Skeleton";
import { formatPhone } from "@/lib/format";
import {
  dateLabel,
  endLabel,
  issueReasonLabel,
  pauseLabel,
  rhythmLabel,
  seriesStatusLabel,
  stylistLabel,
  telHref,
  visitStatusKey,
  whenLabel,
  type PickerContext,
} from "@/lib/series";
import type { AppointmentRow, SeriesDetail, SeriesIssue } from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import "@/styles/series.css";

import { ChangeFuturePanel } from "./ChangeFuturePanel";
import { ReschedulePanel, pickTitle, type PickTarget } from "./RescheduleSheet";
import { ResolveIssueButton } from "./ResolveIssueButton";

type SeriesAction = "pause" | "resume" | "cancel";

const DONE: Record<SeriesAction, string> = {
  pause: t.series.seriesPaused,
  resume: t.series.seriesResumed,
  cancel: t.series.seriesCancelled,
};

type Pending = { kind: "skip"; visit: AppointmentRow } | { kind: "cancel" };

/**
 * What the sheet is showing. Moving a visit, booking a flagged date and changing future visits
 * replace the sheet's body in place rather than stacking a second sheet on top of it: one sheet,
 * one Escape, one scroll lock.
 */
type Mode = { kind: "view" } | { kind: "pick"; target: PickTarget } | { kind: "change" };

interface ApiError {
  error?: { code?: string; message?: string; details?: { field?: string }[] };
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; json: unknown }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

/**
 * One repeating booking (docs/recurring-appointments.md §2): who and how often, why it is paused,
 * what the job could not book, the visits coming up, and the owner's controls — Pause / Resume,
 * Skip one visit, Cancel series.
 *
 * NOTHING here texts the customer (decided with the client: only the three registered SMS ever go
 * out), so the header leads with Call and the cancel confirm says "let them know".
 *
 * Loaded through the BFF (`GET /api/appointments/series/:id`) when it opens; it renders the name the
 * row already had straight away so the sheet is never an empty box. `version` comes from the list
 * row: when a live update changes the series, the page refreshes, `version` moves, and the sheet
 * re-reads instead of showing what it loaded a minute ago.
 *
 * Pause / resume / cancel answer with the whole detail, so the sheet takes the reply as its new
 * state; skip answers with the one visit, which is patched in. Each also refreshes the page, whose
 * list shows the same series.
 *
 * Phase 2 adds Reschedule on each upcoming visit, "Book another time" on each Needs attention item
 * (both the shared ReschedulePanel) and "Change future visits" (ChangeFuturePanel). A move or a
 * booking answers with one visit, so the sheet re-reads its detail; a change answers with the
 * whole detail.
 *
 * Portalled through BottomSheet → OverlayPortal (docs/owner-web-app-parity.md: overlays must not be
 * trapped in a trigger's stacking context, nor fall outside the themed shell).
 */
export function SeriesSheet({
  seriesId,
  name,
  version,
  picker,
  canManage,
  onClose,
  onChanged,
}: {
  seriesId: string;
  /** The customer's name from the row, shown while the detail loads. */
  name: string;
  /** Changes when the series changes; the sheet re-reads on a change. */
  version: string;
  /** The store's zone, its stylists (also "Choose who takes this series" when resuming), closed days. */
  picker: PickerContext;
  /** `appointments: manage`. Without it the sheet is read-only — Call still works. */
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const titleId = useId();
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [running, setRunning] = useState<SeriesAction | "skip" | null>(null);
  /** Which stylist button of the resume picker was pressed, so only that one spins. */
  const [choice, setChoice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  /** A confirm opened by a panel (Move this visit to …?) is on top. */
  const [childModal, setChildModal] = useState(false);
  /** Bumped after a move or a booking, which answer with one visit: re-read the whole detail. */
  const [reloadKey, setReloadKey] = useState(0);
  const busy = running !== null;
  const zone = picker.zone;
  const staff = picker.staff;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/appointments/series/${encodeURIComponent(seriesId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as SeriesDetail & ApiError;
        if (!alive) return;
        if (!res.ok) {
          setLoadError(json?.error?.message ?? t.series.couldNotLoad);
          return;
        }
        setLoadError("");
        setDetail(json);
      } catch {
        if (alive) setLoadError(t.appointments.networkError);
      }
    })();
    return () => {
      alive = false;
    };
  }, [seriesId, version, reloadKey]);

  /**
   * A confirm is open on top of the sheet: Escape (heard by both) and the confirm's own buttons
   * belong to it, so the sheet must not close underneath it. BottomSheet reads the latest
   * `onClose` per key press, so this sees the current state.
   */
  const close = () => {
    if (pending || childModal) return;
    onClose();
  };

  /** After a move or "Book another time" inside the sheet: back to the series, freshly read. */
  function afterPick() {
    setMode({ kind: "view" });
    setChildModal(false);
    setReloadKey((k) => k + 1);
    onChanged();
  }

  function moveVisit(v: AppointmentRow) {
    setMode({ kind: "pick", target: { kind: "move", appointmentId: v.id, startAt: v.scheduledStartAt, staffId: v.staffId } });
  }

  function bookIssue(issue: SeriesIssue) {
    setMode({
      kind: "pick",
      target: {
        kind: "book",
        issueId: issue.id,
        seriesId: issue.seriesId,
        occurrenceDate: issue.occurrenceDate,
        staffId: issue.staffId,
      },
    });
  }

  async function runSeries(action: SeriesAction, body?: unknown): Promise<boolean> {
    setRunning(action);
    try {
      const { ok, json } = await post(`/api/appointments/series/${encodeURIComponent(seriesId)}/${action}`, body);
      if (!ok) {
        const err = (json as ApiError).error;
        showToast(err?.message ?? t.common.thatDidntWork, "error");
        // Paused for another reason, but its stylist has left since: the API refuses to resume onto
        // them (400, field staffId) — offer the picker instead of a dead end.
        if (action === "resume" && err?.code === "VALIDATION_ERROR" && err.details?.some((d) => d.field === "staffId")) {
          setPicking(true);
        }
        return false;
      }
      setDetail(json as SeriesDetail);
      setPicking(false);
      showToast(DONE[action], "success");
      onChanged();
      return true;
    } catch {
      showToast(t.appointments.networkError, "error");
      return false;
    } finally {
      setRunning(null);
      setChoice(null);
    }
  }

  async function skip(visit: AppointmentRow) {
    setRunning("skip");
    try {
      const { ok, json } = await post(`/api/appointments/${encodeURIComponent(visit.id)}/skip`);
      if (!ok) {
        showToast((json as ApiError).error?.message ?? t.common.thatDidntWork, "error");
        return;
      }
      const row = json as AppointmentRow;
      setDetail((d) => (d ? { ...d, visits: d.visits.map((v) => (v.id === row.id ? { ...v, ...row } : v)) } : d));
      showToast(t.series.visitSkipped, "success");
      onChanged();
    } catch {
      showToast(t.appointments.networkError, "error");
    } finally {
      setRunning(null);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    if (pending.kind === "skip") await skip(pending.visit);
    else await runSeries("cancel");
    setPending(null);
  }

  function resume() {
    // Its stylist left: resuming onto them would only flag and pause again on the next date.
    if (detail?.series.pauseReason === "stylist_unavailable") setPicking(true);
    else void runSeries("resume");
  }

  function resumeWith(staffId: string) {
    setChoice(staffId);
    void runSeries("resume", { staffId });
  }

  const s = detail?.series;
  const tel = telHref(s?.customerPhone);
  const nowMs = detail ? Date.parse(detail.now) : 0;
  const upcoming = detail ? detail.visits.filter((v) => Date.parse(v.scheduledStartAt) > nowMs) : [];
  const showFooter = canManage && !!s && s.status !== "cancelled";
  const canChange = canManage && s?.status === "active" && (detail?.changeFromDates?.length ?? 0) > 0;

  /** Name + phone + Call, kept on top in every mode — the owner may need to phone mid-change. */
  const header = (
    <header className="srs-head">
      <div className="srs-head-text">
        <h2 id={titleId} className="srs-title">
          {mode.kind === "pick"
            ? pickTitle(mode.target, zone)
            : mode.kind === "change"
              ? t.reschedule.change
              : (s?.customerName ?? name)}
        </h2>
        {mode.kind !== "view" ? (
          <p className="srs-phone">{s?.customerName ?? name}</p>
        ) : s?.customerPhone ? (
          <p className="srs-phone">{formatPhone(s.customerPhone)}</p>
        ) : null}
      </div>
      {tel ? (
        <a className="srs-call" href={tel} aria-label={format(t.series.callAria, { name: s?.customerName ?? name })}>
          <Icon name="phone" size={14} />
          {t.series.call}
        </a>
      ) : null}
    </header>
  );

  if (mode.kind === "pick" && detail) {
    return (
      <BottomSheet onClose={close} closeLabel={t.series.close} labelledBy={titleId} className="srs-sheet">
        {header}
        <ReschedulePanel
          target={mode.target}
          picker={picker}
          onDone={afterPick}
          onBack={() => {
            setChildModal(false);
            setMode({ kind: "view" });
          }}
          onModalChange={setChildModal}
        />
      </BottomSheet>
    );
  }

  if (mode.kind === "change" && detail) {
    return (
      <BottomSheet onClose={close} closeLabel={t.series.close} labelledBy={titleId} className="srs-sheet">
        {header}
        <ChangeFuturePanel
          detail={detail}
          picker={picker}
          onDone={(next) => {
            setDetail(next);
            setMode({ kind: "view" });
            onChanged();
          }}
          onBack={() => setMode({ kind: "view" })}
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet onClose={close} closeLabel={t.series.close} labelledBy={titleId} className="srs-sheet">
      {header}

      <div className="srs-scroll">
        {!s || !detail ? (
          loadError ? (
            <p className="ss-error" role="alert">
              {loadError}
            </p>
          ) : (
            <div className="srs-loading" aria-busy="true" aria-label={t.series.loading}>
              <Skeleton width="70%" height={14} />
              <Skeleton width="55%" height={14} />
              <Skeleton width="40%" height={14} />
              <Skeleton width="100%" height={44} radius={10} />
            </div>
          )
        ) : (
          <>
            {s.status !== "active" ? (
              <p className={`srs-state tone-${s.status}`}>
                <span className="srs-state-dot" aria-hidden />
                {s.status === "paused" ? pauseLabel(s.pauseReason) : seriesStatusLabel(s.status)}
              </p>
            ) : null}

            <dl className="srs-facts">
              <div className="srs-fact">
                <dt>{t.series.repeats}</dt>
                <dd>{rhythmLabel(s)}</dd>
              </div>
              <div className="srs-fact">
                <dt>{t.series.ends}</dt>
                <dd>{endLabel(s, zone)}</dd>
              </div>
              <div className="srs-fact">
                <dt>{t.series.stylist}</dt>
                <dd>{stylistLabel(s)}</dd>
              </div>
              {s.serviceName ? (
                <div className="srs-fact">
                  <dt>{t.series.service}</dt>
                  <dd>{s.serviceName}</dd>
                </div>
              ) : null}
            </dl>

            {detail.issues.length > 0 ? (
              <section className="srs-section">
                <h3 className="srs-section-title srs-section-title-warn">
                  <Icon name="alertTriangle" size={15} />
                  {t.series.needsAttention}
                </h3>
                <ul className="srs-rows">
                  {detail.issues.map((issue) => (
                    <li key={issue.id} className="srs-row srs-row-wrap">
                      <div className="srs-row-body">
                        <p className="srs-row-when">{whenLabel(issue.scheduledStartAt, zone)}</p>
                        <p className="srs-row-note">{issueReasonLabel(issue.reason)}</p>
                      </div>
                      {canManage ? (
                        <div className="rs-row-actions">
                          {/* A cancelled series has nothing left to book into. */}
                          {s.status !== "cancelled" ? (
                            <button type="button" className="srs-ghost-btn" disabled={busy} onClick={() => bookIssue(issue)}>
                              {t.reschedule.bookAnother}
                            </button>
                          ) : null}
                          <ResolveIssueButton
                            issueId={issue.id}
                            onResolved={() =>
                              setDetail((d) => (d ? { ...d, issues: d.issues.filter((i) => i.id !== issue.id) } : d))
                            }
                          />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="srs-section">
              <h3 className="srs-section-title">{t.series.upcomingVisits}</h3>
              {upcoming.length === 0 ? (
                <p className="srs-muted">{t.series.noVisitBooked}</p>
              ) : (
                <ul className="srs-rows">
                  {upcoming.map((v) => {
                    // The API's rule: only a visit still booked can be skipped or moved.
                    const open = canManage && (v.status === "pending" || v.status === "confirmed");
                    return (
                      <li key={v.id} className="srs-row srs-row-wrap">
                        <div className="srs-row-body">
                          <p className="srs-row-when">{whenLabel(v.scheduledStartAt, zone)}</p>
                          {v.rescheduledAt && v.status !== "cancelled" ? (
                            <p className="srs-row-note">{t.reschedule.moved}</p>
                          ) : null}
                        </div>
                        {open ? (
                          <div className="rs-row-actions">
                            <button type="button" className="srs-ghost-btn" disabled={busy} onClick={() => moveVisit(v)}>
                              <Icon name="calendarClock" size={14} />
                              {t.reschedule.action}
                            </button>
                            <button
                              type="button"
                              className="srs-ghost-btn"
                              disabled={busy}
                              title={t.appointments.skipVisit}
                              onClick={() => setPending({ kind: "skip", visit: v })}
                            >
                              {running === "skip" && pending?.kind === "skip" && pending.visit.id === v.id ? (
                                <Spinner size={13} />
                              ) : (
                                <Icon name="skipForward" size={14} />
                              )}
                              {t.series.skip}
                            </button>
                          </div>
                        ) : (
                          <AppointmentStatusBadge status={visitStatusKey(v)} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {detail.laterDates.length > 0 ? (
                <p className="srs-later">
                  {format(t.series.laterDates, {
                    dates: detail.laterDates.map((d) => dateLabel(d, zone)).join(", "),
                  })}
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>

      {showFooter && s ? (
        picking ? (
          <div className="srs-footer">
            <p className="srs-pick-title">{t.series.chooseStylist}</p>
            <div className="srs-pick" role="group" aria-label={t.series.chooseStylist}>
              {staff.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="srs-pick-btn"
                  disabled={busy}
                  onClick={() => resumeWith(m.id)}
                >
                  {choice === m.id ? <Spinner size={13} /> : null}
                  {m.name}
                </button>
              ))}
              {/* A staff login may only keep the series on its own chair. */}
              {picker.allowAny ? (
                <button type="button" className="srs-pick-btn" disabled={busy} onClick={() => resumeWith("any")}>
                  {choice === "any" ? <Spinner size={13} /> : null}
                  {t.series.anyStylist}
                </button>
              ) : null}
            </div>
            <button type="button" className="ss-btn ghost block" disabled={busy} onClick={() => setPicking(false)}>
              {t.common.back}
            </button>
          </div>
        ) : (
          <div className="srs-footer">
            {canChange ? (
              <button type="button" className="ss-btn outline block" disabled={busy} onClick={() => setMode({ kind: "change" })}>
                <Icon name="calendarClock" size={16} />
                {t.reschedule.change}
              </button>
            ) : null}
            {s.status === "active" ? (
              <button type="button" className="ss-btn outline block" disabled={busy} onClick={() => runSeries("pause")}>
                {running === "pause" ? <Spinner size={16} /> : null}
                {t.series.pause}
              </button>
            ) : null}
            {s.status === "paused" ? (
              <button type="button" className="ss-btn primary block" disabled={busy} onClick={resume}>
                {running === "resume" ? <Spinner size={16} /> : null}
                {t.series.resume}
              </button>
            ) : null}
            <button
              type="button"
              className="ss-btn outline block srs-btn-danger"
              disabled={busy}
              onClick={() => setPending({ kind: "cancel" })}
            >
              {t.series.cancel}
            </button>
          </div>
        )
      ) : null}

      {/* Mounted per opening (ConfirmDialog's contract), after the sheet, so it paints above it. */}
      {pending ? (
        <ConfirmDialog
          key={pending.kind === "skip" ? `skip-${pending.visit.id}` : "cancel"}
          open
          title={pending.kind === "skip" ? t.series.skipConfirmTitle : t.series.cancelConfirmTitle}
          body={pending.kind === "skip" ? t.series.skipConfirmBody : t.series.cancelConfirmBody}
          confirmLabel={pending.kind === "skip" ? t.series.skip : t.series.cancel}
          cancelLabel={pending.kind === "skip" ? t.confirm.cancel : t.series.keepSeries}
          destructive={pending.kind === "cancel"}
          busy={busy}
          onConfirm={() => void confirmPending()}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
        />
      ) : null}
    </BottomSheet>
  );
}
