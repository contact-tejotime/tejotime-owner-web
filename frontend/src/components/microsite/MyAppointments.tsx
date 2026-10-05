"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import PhoneField from "@/components/ui/PhoneField";
import { ApiError, publicApi, type AppointmentLookup, type PublicAppointment, type PublicSeries } from "@/lib/api";
import { formatInZone, rhythmLabel } from "@/lib/series";
import { ymdInZone } from "@/lib/booking-days";
import { combineToE164, formatPhone, splitPhone } from "@/lib/phone";
import { t, format } from "@/i18n";
import SlotPicker, { type PickedSlot } from "./SlotPicker";
import { ConfirmBox, SeriesPanel } from "./SeriesManage";

/**
 * "My Appointments" — see, move and cancel this store's upcoming bookings, from any device
 * (docs/customer-my-appointments.md).
 *
 * Number first, like Check Waitlist Status: it opens on the phone step (pre-filled with the last
 * number used here) and lists ONLY that number's bookings. CLIENT DECISION 2026-10-05: the number
 * alone is enough, so the lookup hands back each booking's key and the repeating booking's manage
 * token, the same power as the link. Customers lost the link and had no way back from another phone.
 *
 * There is no "booked on this device" list any more. It listed every booking this browser had saved
 * whatever the number, so four numbers booked from one browser all showed together, and anyone
 * picking up a shared phone saw them without typing anything.
 *
 * SECURITY: whatever a lookup hands back stays in page memory and is NEVER written to
 * localStorage, for the same shared-phone reason. The parent keeps each lookup in a ref for the life
 * of the page, so reopening this pop-up for the same number does not spend a second lookup
 * (publicWrite, 20/hour).
 *
 * Every time shown is on the STORE's clock; every time picked comes from the API's slots.
 */

const M = t.microsite.myAppts;
const S = t.microsite.series;
const P = t.microsite.slotPicker;
const STATUS = t.chat.flow.card.status as Record<string, string>;

/** One booking on screen, with the key that changes it (null = there is nothing left to do). */
interface Held {
  appt: PublicAppointment;
  key: string | null;
  /** Cancelled or skipped here, this session — kept on screen struck through rather than vanishing. */
  done?: "cancelled" | "skipped";
}
interface SeriesRef {
  seriesId: string;
  token: string;
}
/** A series' latest read: the payload, "gone" (the token opens nothing), or null (couldn't load). */
type SeriesInfo = PublicSeries | "gone" | null;
interface Model {
  appts: Held[];
  series: SeriesRef[];
  infos: Record<string, SeriesInfo>;
}
type Row =
  | { kind: "appt"; at: number; held: Held }
  | { kind: "series"; at: number; ref: SeriesRef; info: PublicSeries | null; nextAt: string | null; fallback: PublicAppointment | null };
type WriteResult = { ok: true } | { ok: false; error: unknown };

/** What a list shows on load. Checked in stays (it is today's visit); the rest is history. */
const SHOWN = new Set(["pending", "confirmed", "checked_in"]);
const CHANGEABLE = new Set(["pending", "confirmed"]);
const whenOpts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };

const isSeriesVisit = (a: PublicAppointment) => !!a.seriesId || a.repeats === true;
const seriesOpen = (info: SeriesInfo | undefined) => info !== "gone" && !(info && (info.status === "cancelled" || info.status === "ended"));

/** The API's own message where it has one (they are written for customers); a friendly 429. */
function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.status === 429 ? M.tooMany : e.message;
  return M.networkError;
}

async function readSeries(refs: SeriesRef[]): Promise<Record<string, SeriesInfo>> {
  // publicRead, one per series — a phone has at most one open series per store.
  const pairs = await Promise.all(
    refs.map(async (r): Promise<[string, SeriesInfo]> => {
      try {
        return [r.seriesId, await publicApi.getSeries(r.token)];
      } catch (e) {
        return [r.seriesId, e instanceof ApiError && e.status === 404 ? "gone" : null];
      }
    }),
  );
  return Object.fromEntries(pairs);
}

async function modelFromLookup(r: AppointmentLookup): Promise<Model> {
  const series = (r.series ?? []).map((s) => ({ seriesId: s.seriesId, token: s.manageToken }));
  return {
    appts: (r.appointments ?? []).filter((a) => SHOWN.has(a.status)).map((a) => ({ appt: a, key: a.appointmentKey ?? null })),
    series,
    infos: await readSeries(series),
  };
}

/** What goes back into the page's in-memory lookup after a change, so a reopen shows the truth. */
function toLookup(m: Model, prev: AppointmentLookup): AppointmentLookup {
  return {
    appointments: m.appts
      .filter((h) => !h.done && h.appt.status !== "cancelled")
      .map((h) => (h.key ? { ...h.appt, appointmentKey: h.key } : h.appt)),
    series: (prev.series ?? []).filter((s) => seriesOpen(m.infos[s.seriesId])),
  };
}

/**
 * One entry per repeating booking (its visits are managed inside it), then the one-off bookings —
 * plus any series visit whose series this page has no token for, which stays a row of its own.
 * Soonest first; a series with no visit booked right now sorts last.
 */
function rowsOf(m: Model): Row[] {
  // Visits of a series this page holds the token for are never rows of their own — not even once
  // the series is cancelled or ended (they went with it; the stale copies must not resurface).
  const known = new Set(m.series.map((r) => r.seriesId));
  const rows: Row[] = [];
  for (const ref of m.series) {
    const info = m.infos[ref.seriesId];
    if (info === "gone" || !seriesOpen(info)) continue;
    const fallback = m.appts.find((h) => h.appt.seriesId === ref.seriesId && h.appt.status !== "cancelled")?.appt ?? null;
    // The series' own read is the truth (a visit moved or skipped inside the manager changes it);
    // the list's row is the stand-in when the read failed.
    const nextAt = info ? info.visits.find((v) => v.status !== "cancelled")?.scheduledStartAt ?? null : fallback?.scheduledStartAt ?? null;
    rows.push({ kind: "series", at: nextAt ? Date.parse(nextAt) : Infinity, ref, info: info ?? null, nextAt, fallback });
  }
  for (const held of m.appts) {
    if (held.appt.seriesId && known.has(held.appt.seriesId)) continue;
    rows.push({ kind: "appt", at: Date.parse(held.appt.scheduledStartAt), held });
  }
  return rows.sort((a, b) => a.at - b.at);
}

// ---- styles (the join pop-up's, so the two read as one family) ----
const fieldLabel: CSSProperties = {
  font: "var(--fw-bold) 12px/1 var(--font-sans)",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 8,
};
const muted: CSSProperties = { font: "var(--fw-regular) 13.5px/1.5 var(--font-sans)", color: "var(--text-muted)", margin: 0 };
const errorText: CSSProperties = { font: "var(--fw-medium) 13px/1.4 var(--font-sans)", color: "var(--error)", margin: "10px 0 0" };
const card = (dim: boolean): CSSProperties => ({
  border: "1px solid var(--border-subtle)",
  borderRadius: "calc(12px * var(--radius-scale, 1))",
  padding: "12px 14px",
  background: dim ? "var(--surface-page)" : "var(--surface-card)",
});
const chip = (tone: "muted" | "brand" | "warn"): CSSProperties => ({
  flexShrink: 0,
  font: "var(--fw-semibold) 12px/1.2 var(--font-sans)",
  padding: "4px 9px",
  borderRadius: 999,
  ...(tone === "brand"
    ? { color: "var(--primary)", background: "color-mix(in srgb, var(--primary) 9%, var(--surface-card))" }
    : tone === "warn"
      ? { color: "var(--warning-soft-fg)", background: "var(--warning-soft)" }
      : { color: "var(--text-muted)", background: "var(--surface-sunken)" }),
});

export default function MyAppointments({
  storeName,
  timezone,
  staff,
  closedWeekdays,
  initialPhone,
  lookup,
  peekLookup,
  saveLookup,
  onBook,
  onClose,
}: {
  storeName: string;
  /** The store's IANA zone — every time is shown on its clock. */
  timezone?: string;
  /** The store's active stylists — who a booking can move to. Empty for a store without any. */
  staff: { id: string; name: string }[];
  /** Weekdays the store never opens, greyed in the time picker. Must be a stable array. */
  closedWeekdays: number[];
  /** The number the page last used, pre-filled ("+<cc><national>", or empty). */
  initialPhone: string;
  /** The phone lookup — answered from page memory when this number was already looked up. */
  lookup: (phone: string) => Promise<AppointmentLookup>;
  /** The page-memory answer for a number, without a request (undefined if never looked up). */
  peekLookup: (phone: string) => AppointmentLookup | undefined;
  /** Write a changed answer back to page memory (never to storage). */
  saveLookup: (phone: string, r: AppointmentLookup) => void;
  /** Close this and open the booking flow. */
  onBook: () => void;
  onClose: () => void;
}) {
  // A number already looked up on this page goes straight to its list (from memory, no request);
  // otherwise the phone step, pre-filled with the last number used here.
  const [cached] = useState(() => (initialPhone ? peekLookup(initialPhone) : undefined));
  const [view, setView] = useState<"loading" | "phone" | "list">(cached ? "loading" : "phone");
  const [found, setFound] = useState<{ phone: string; lookup: AppointmentLookup; model: Model } | null>(null);

  const [country, setCountry] = useState(() => {
    const p = splitPhone(initialPhone);
    return { dialCode: p.dialCode, iso2: p.iso2 };
  });
  const [national, setNational] = useState(() => splitPhone(initialPhone).national);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ id: string; mode: "move" | "cancel" } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [openSeries, setOpenSeries] = useState<SeriesRef | null>(null);

  useEffect(() => {
    let live = true;
    if (cached) {
      void modelFromLookup(cached).then((model) => {
        if (!live) return;
        setFound({ phone: initialPhone, lookup: cached, model });
        setView("list");
      });
    }
    return () => {
      live = false;
    };
    // Once per open, on the snapshot taken as it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetUi = () => {
    setActive(null);
    setRowError(null);
    setNotice("");
    setOpenSeries(null);
  };
  const show = (v: "phone" | "list") => {
    resetUi();
    setFormError("");
    setView(v);
  };

  const phone = combineToE164(country.dialCode, national);
  const phoneShort = national.replace(/\D/g, "").length < 4;
  const runLookup = async (e?: FormEvent) => {
    e?.preventDefault();
    if (phoneShort) {
      setFormError(M.errPhone);
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const r = await lookup(phone);
      const model = await modelFromLookup(r);
      setFound({ phone, lookup: r, model });
      show("list");
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- writes. Each handler runs from a tap, with `busy` stopping a second one meanwhile, so the
  // model it read when it started is still the one on screen when it commits. ----
  /** Every change goes back into the page-memory lookup too, so a reopen (or the chat) shows the truth. */
  const commit = (model: Model) => {
    if (!found) return;
    const next = toLookup(model, found.lookup);
    saveLookup(found.phone, next);
    setFound({ ...found, model, lookup: next });
  };
  const patchAppt = (id: string, fn: (h: Held) => Held) => {
    const m = found?.model;
    if (m) commit({ ...m, appts: m.appts.map((h) => (h.appt.appointmentId === id ? fn(h) : h)) });
  };
  /** After a 422 the booking changed under us (checked in, cancelled by the store): show it as it is. */
  const reread = (held: Held) => {
    if (!held.key) return;
    publicApi
      .getAppointment(held.appt.appointmentId, held.key)
      .then((appt) => patchAppt(appt.appointmentId, (h) => ({ ...h, appt })))
      .catch(() => undefined);
  };

  const cancel = async (held: Held) => {
    if (!held.key) return;
    const id = held.appt.appointmentId;
    const skip = isSeriesVisit(held.appt);
    setBusy(true);
    setRowError(null);
    setNotice("");
    try {
      // A series visit cancelled this way is recorded as skipped; the rest of the series carries on.
      const next = await publicApi.cancelAppointment(id, held.key);
      patchAppt(id, () => ({ appt: next, key: null, done: skip ? "skipped" : "cancelled" }));
      setActive(null);
      setNotice(skip ? M.skippedDone : M.cancelledDone);
    } catch (e) {
      setRowError({ id, message: messageOf(e) });
      if (e instanceof ApiError && e.status === 422) reread(held);
    } finally {
      setBusy(false);
    }
  };

  const move = async (held: Held, pick: PickedSlot, staffId: string | undefined): Promise<WriteResult> => {
    if (!held.key) return { ok: false, error: null };
    const id = held.appt.appointmentId;
    setBusy(true);
    setRowError(null);
    setNotice("");
    try {
      const next = await publicApi.rescheduleAppointment(id, held.key, pick.startAt, staffId);
      patchAppt(id, (h) => ({ ...h, appt: next }));
      setActive(null);
      setNotice(M.movedDone);
      return { ok: true };
    } catch (e) {
      setRowError({ id, message: messageOf(e) });
      if (e instanceof ApiError && e.status === 422) reread(held);
      return { ok: false, error: e };
    } finally {
      setBusy(false);
    }
  };

  /** Every read and write inside the series manager: keep the list and page memory honest. */
  const onSeriesRead = (seriesId: string, s: PublicSeries | null) => {
    const m = found?.model;
    if (m) {
      // The series read is the truth for its visits: update the ones the list holds (time,
      // status) and drop any it no longer lists (superseded by a change, or the series is gone),
      // so the page-memory lookup the chat also reads never offers a visit that is not there.
      const visits = new Map((s?.visits ?? []).map((v) => [v.appointmentId, v]));
      const appts = m.appts.flatMap((h) => {
        if (h.appt.seriesId !== seriesId) return [h];
        const v = visits.get(h.appt.appointmentId);
        return v ? [{ ...h, appt: { ...h.appt, scheduledStartAt: v.scheduledStartAt, status: v.status } }] : [];
      });
      commit({ ...m, appts, infos: { ...m.infos, [seriesId]: s ?? "gone" } });
    }
  };

  const fmt = (iso: string) => formatInZone(iso, timezone, whenOpts);
  const current = view === "list" ? found?.model ?? null : null;
  const rows = current ? rowsOf(current) : [];

  let body: ReactNode;
  if (view === "loading") {
    body = (
      <p aria-live="polite" style={{ ...muted, padding: "8px 0" }}>
        {M.loading}
      </p>
    );
  } else if (view === "phone") {
    body = (
      <form onSubmit={runLookup} style={{ animation: "ttStep .32s ease both" }}>
        <div style={{ width: 52, height: 52, borderRadius: "calc(14px * var(--radius-scale, 1))", background: "color-mix(in srgb, var(--primary) 12%, var(--surface-card))", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <Icon name="calendar" size={24} />
        </div>
        <h3 style={{ font: "var(--fw-extrabold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>{M.phoneTitle}</h3>
        <p style={{ ...muted, margin: "0 0 18px" }}>{M.phoneBody}</p>
        <div style={fieldLabel}>{M.phoneLabel}</div>
        <PhoneField country={country} national={national} onCountryChange={setCountry} onNationalChange={setNational} marginBottom={18} />
        {formError && (
          <div role="alert" style={{ ...errorText, margin: "0 0 12px" }}>
            {formError}
          </div>
        )}
        <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={phoneShort || submitting} onClick={() => void runLookup()}>
          {M.submit}
        </Button>
      </form>
    );
  } else if (openSeries && current) {
    const seriesId = openSeries.seriesId;
    body = (
      <div style={{ animation: "ttStep .32s ease both" }}>
        <div style={{ marginBottom: 12, marginLeft: -8 }}>
          <Button variant="ghost" size="sm" leadingIcon={<Icon name="chevronLeft" size={16} />} onClick={() => setOpenSeries(null)}>
            {M.back}
          </Button>
        </div>
        <SeriesPanel key={seriesId} token={openSeries.token} closedWeekdays={closedWeekdays} onSeries={(s) => onSeriesRead(seriesId, s)} />
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface-sunken)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
          <Icon name="search" size={26} />
        </div>
        <h3 style={{ font: "var(--fw-extrabold) 20px/1.25 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>{M.emptyTitle}</h3>
        {found && <p style={{ ...muted, fontSize: 14, margin: "0 0 20px" }}>{format(M.emptyBody, { phone: formatPhone(found.phone), name: storeName })}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Button variant="primary" fullWidth onClick={onBook}>
            {M.book}
          </Button>
          <Button variant="outline" fullWidth onClick={() => show("phone")}>
            {M.lookUpAnother}
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ animation: "ttStep .32s ease both" }}>
        <div style={{ ...fieldLabel, marginBottom: 12, lineHeight: 1.4 }}>
          {format(M.foundFor, { phone: formatPhone(found?.phone ?? "") })}
        </div>
        {notice && (
          <div role="status" style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", marginBottom: 12, borderRadius: "calc(12px * var(--radius-scale, 1))", background: "var(--success-soft)", color: "var(--success-soft-fg, var(--success))", font: "var(--fw-semibold) 14px/1.4 var(--font-sans)" }}>
            <Icon name="checkCircle" size={17} />
            {notice}
          </div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) =>
            row.kind === "series" ? (
              <SeriesRow
                key={`s-${row.ref.seriesId}`}
                row={row}
                fmt={fmt}
                busy={busy}
                onOpen={() => {
                  resetUi();
                  setOpenSeries(row.ref);
                }}
              />
            ) : (
              <ApptRow
                key={`a-${row.held.appt.appointmentId}`}
                held={row.held}
                when={fmt(row.held.appt.scheduledStartAt)}
                timezone={timezone}
                staff={staff}
                closedWeekdays={closedWeekdays}
                busy={busy}
                mode={active?.id === row.held.appt.appointmentId ? active.mode : null}
                error={rowError?.id === row.held.appt.appointmentId ? rowError.message : ""}
                onMode={(mode) => {
                  setRowError(null);
                  setNotice("");
                  setActive(mode ? { id: row.held.appt.appointmentId, mode } : null);
                }}
                onCancel={() => cancel(row.held)}
                onMove={(pick, staffId) => move(row.held, pick, staffId)}
              />
            ),
          )}
        </ul>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
          <Button variant="outline" fullWidth onClick={onBook}>
            {M.bookAnother}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => show("phone")}>
            {M.lookUpAnother}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 24px)", animation: "ttFade .22s ease" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tt-my-appts-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: "100%", background: "var(--surface-card)", borderRadius: "calc(20px * var(--radius-scale, 1))", boxShadow: "var(--shadow-xl)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column", animation: "ttModalIn .42s cubic-bezier(.34,1.4,.5,1) both" }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span id="tt-my-appts-title" style={{ font: "var(--fw-extrabold) 20px/1 var(--font-sans)", color: "var(--text-strong)" }}>
            {M.title}
          </span>
          <button type="button" aria-label={t.common.close} onClick={onClose} style={{ width: 34, height: 34, borderRadius: "50%", border: "none", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div style={{ padding: "22px 24px 26px", overflow: "auto" }}>{body}</div>
      </div>
    </div>
  );
}

/** A repeating booking: one entry, however many visits it has — they are managed inside it. */
function SeriesRow({
  row,
  fmt,
  busy,
  onOpen,
}: {
  row: Extract<Row, { kind: "series" }>;
  fmt: (iso: string) => string;
  busy: boolean;
  onOpen: () => void;
}) {
  const { info, nextAt, fallback } = row;
  const service = info ? info.serviceName : fallback?.serviceName ?? null;
  const staffName = info ? info.staffName : fallback?.staffName ?? null;
  return (
    <li style={card(false)}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-bold) 15px/1.35 var(--font-sans)", color: "var(--text-strong)" }}>
            <span role="img" aria-label={t.microsite.repeat.marker} style={{ display: "flex", color: "var(--primary)", flexShrink: 0 }}>
              <Icon name="repeat" size={16} />
            </span>
            {info ? format(M.repeatsTitle, { rhythm: rhythmLabel(info.everyDays) }) : M.repeating}
          </span>
          <span style={{ font: "var(--fw-semibold) 14px/1.4 var(--font-sans)", color: "var(--text-body)" }}>
            {nextAt ? format(M.nextVisit, { when: fmt(nextAt) }) : M.noNextVisit}
          </span>
          {(service || staffName) && (
            <span style={{ font: "var(--fw-regular) 13.5px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>
              {[service, staffName ? format(M.withStaff, { name: staffName }) : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        {info?.status === "paused" && <span style={chip("warn")}>{M.paused}</span>}
      </div>
      <div style={{ marginTop: 10 }}>
        <Button variant="outline" size="sm" disabled={busy} onClick={onOpen} trailingIcon={<Icon name="chevronRight" size={15} />}>
          {M.manage}
        </Button>
      </div>
    </li>
  );
}

/** A one-off booking (or a series visit this page has no series token for): Reschedule and Cancel. */
function ApptRow({
  held,
  when,
  timezone,
  staff,
  closedWeekdays,
  busy,
  mode,
  error,
  onMode,
  onCancel,
  onMove,
}: {
  held: Held;
  when: string;
  timezone?: string;
  staff: { id: string; name: string }[];
  closedWeekdays: number[];
  busy: boolean;
  mode: "move" | "cancel" | null;
  error: string;
  onMode: (mode: "move" | "cancel" | null) => void;
  onCancel: () => void;
  onMove: (pick: PickedSlot, staffId: string | undefined) => Promise<WriteResult>;
}) {
  const a = held.appt;
  const inSeries = isSeriesVisit(a);
  const over = !!held.done || a.status === "cancelled";
  // `canChange` is the API's own answer; a backend from before it falls back to the status alone
  // (the server refuses a booking that has started, and says so).
  const changeable = !over && !!held.key && (a.canChange ?? CHANGEABLE.has(a.status));
  const badge: { text: string; tone: "muted" | "brand" } | null =
    held.done === "skipped"
      ? { text: S.skipped, tone: "muted" }
      : over
        ? { text: STATUS.cancelled, tone: "muted" }
        : !CHANGEABLE.has(a.status)
          ? { text: STATUS[a.status] ?? a.status, tone: "muted" }
          : a.canChange === false
            ? { text: M.tooLate, tone: "muted" }
            : a.rescheduledAt
              ? { text: M.moved, tone: "brand" }
              : null;
  const what = [a.serviceName, when].filter(Boolean).join(" · ");

  return (
    <li style={card(over)}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ font: "var(--fw-bold) 15px/1.35 var(--font-sans)", color: over ? "var(--text-muted)" : "var(--text-strong)", textDecoration: over ? "line-through" : undefined }}>
            {when}
          </span>
          {(a.serviceName || a.staffName || inSeries) && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--fw-regular) 13.5px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>
              {inSeries && (
                <span role="img" aria-label={t.microsite.repeat.marker} style={{ display: "flex", flexShrink: 0 }}>
                  <Icon name="repeat" size={14} />
                </span>
              )}
              {[a.serviceName, a.staffName ? format(M.withStaff, { name: a.staffName }) : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        {badge && <span style={chip(badge.tone)}>{badge.text}</span>}
      </div>

      {changeable && mode === null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onMode("move")}>
            {M.reschedule}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onMode("cancel")} style={{ color: "var(--error)" }}>
            {inSeries ? M.skipVisit : M.cancel}
          </Button>
        </div>
      )}

      {changeable && mode === "cancel" && (
        <ConfirmBox
          text={format(inSeries ? M.skipConfirm : M.cancelConfirm, { what })}
          yes={inSeries ? M.skipYes : M.cancelYes}
          no={M.keep}
          busy={busy}
          onYes={onCancel}
          onNo={() => onMode(null)}
        />
      )}

      {changeable && mode === "move" && held.key && (
        <MovePanel appt={a} apptKey={held.key} timezone={timezone} staff={staff} closedWeekdays={closedWeekdays} busy={busy} onMove={onMove} onClose={() => onMode(null)} />
      )}

      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Pick a new time: the store's days today … today+20 (from the API, never the device clock), the
 * stylist chips, the day's free times — then "Move this visit to …?". The first request is only
 * to learn that range; SlotPicker then loads each day itself.
 */
function MovePanel({
  appt,
  apptKey,
  timezone,
  staff,
  closedWeekdays,
  busy,
  onMove,
  onClose,
}: {
  appt: PublicAppointment;
  apptKey: string;
  timezone?: string;
  staff: { id: string; name: string }[];
  closedWeekdays: number[];
  busy: boolean;
  onMove: (pick: PickedSlot, staffId: string | undefined) => Promise<WriteResult>;
  onClose: () => void;
}) {
  const id = appt.appointmentId;
  const initialDate = ymdInZone(appt.scheduledStartAt, timezone);
  const [range, setRange] = useState<{ today: string; lastDay: string } | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    publicApi
      .appointmentSlots(id, apptKey, initialDate)
      .then((r) => {
        if (live) setRange({ today: r.today, lastDay: r.lastDay });
      })
      .catch(() => {
        if (live) setRange("error");
      });
    return () => {
      live = false;
    };
  }, [id, apptKey, initialDate, attempt]);
  const load = useCallback(
    (date: string, staffId: string | undefined) => publicApi.appointmentSlots(id, apptKey, date, staffId).then((r) => r.slots),
    [id, apptKey],
  );

  // The chip a move starts on: the booking's own stylist while they still work here, else "any".
  // A store with no stylists shows no chips and loads for the booking as it is.
  const currentChoice = staff.length > 0 ? (appt.staffId && staff.some((x) => x.id === appt.staffId) ? appt.staffId : "any") : undefined;
  const [pick, setPick] = useState<PickedSlot | null>(null);
  const [refresh, setRefresh] = useState(0);
  // Only send a stylist when the customer changed it; omitted, the API keeps the booking's own.
  const staffChanged = !!pick && staff.length > 0 && pick.staffId !== (appt.staffId ?? "any");
  const pickedName = staffChanged && pick?.staffId && pick.staffId !== "any" ? staff.find((x) => x.id === pick.staffId)?.name : null;
  const pickWhen = pick ? formatInZone(pick.startAt, timezone, whenOpts) : "";

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ ...fieldLabel, marginBottom: 12 }}>{S.pickNewTime}</div>
      {range === null ? (
        <p aria-live="polite" style={muted}>
          {P.loading}
        </p>
      ) : range === "error" ? (
        <div>
          <p style={{ ...muted, marginBottom: 8 }}>{P.error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRange(null);
              setAttempt((n) => n + 1);
            }}
          >
            {P.retry}
          </Button>
        </div>
      ) : (
        <SlotPicker
          today={range.today}
          lastDay={range.lastDay}
          initialDate={initialDate}
          closedWeekdays={closedWeekdays}
          staffOptions={staff.length > 0 ? staff : undefined}
          staffId={currentChoice}
          currentStaffId={currentChoice}
          load={load}
          value={pick?.startAt ?? null}
          onChange={setPick}
          refreshKey={refresh}
        />
      )}
      {pick ? (
        <ConfirmBox
          tone="neutral"
          text={format(S.moveConfirm, { when: pickedName ? format(S.whenWith, { when: pickWhen, name: pickedName }) : pickWhen })}
          yes={S.moveYes}
          no={t.common.back}
          busy={busy}
          onYes={async () => {
            const r = await onMove(pick, staffChanged ? pick.staffId : undefined);
            if (r.ok) setPick(null);
            // Taken while they were deciding: drop the choice and show the day's real times.
            else if (r.error instanceof ApiError && r.error.code === "SLOT_UNAVAILABLE") {
              setPick(null);
              setRefresh((n) => n + 1);
            }
          }}
          onNo={() => setPick(null)}
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {S.keepThisTime}
          </Button>
        </div>
      )}
    </div>
  );
}
