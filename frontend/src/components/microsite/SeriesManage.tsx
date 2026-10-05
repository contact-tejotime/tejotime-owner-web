"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import {
  ApiError,
  publicApi,
  type PublicSeries,
  type SeriesChangeBody,
  type SeriesChangePreview,
  type SeriesChangeResolution,
} from "@/lib/api";
import { SERIES_TOKEN_RE, formatInZone, formatTimeOfDay, formatYmd, rhythmLabel } from "@/lib/series";
import { ymdInZone } from "@/lib/booking-days";
import SlotPicker, { type PickedSlot } from "./SlotPicker";
import { t, format } from "@/i18n";

/**
 * The customer's manage page for a repeating booking — `/<store phone>/v#<token>`
 * (docs/recurring-appointments.md §1.3, §5). See the series, skip one visit, move one visit,
 * change all future visits (new time and/or stylist), cancel it all.
 *
 * There is no login. The manage token is the only key, and it arrives in the URL FRAGMENT, which a
 * browser never sends to a server — so it is read here, on the client, and sent to the API as the
 * `X-Series-Token` header. A missing, malformed or wrong token all end on the same "this link
 * doesn't open a booking" screen (the API answers 404 for both, so a guess learns nothing).
 *
 * Every time shown or picked comes from the API on the store's clock (`today` / `lastDay`, slot
 * labels and instants). No SMS goes out for a move or a change (client rule) — the page itself is
 * the confirmation.
 */

const S = t.microsite.series;

// The fragment, read through useSyncExternalStore rather than an effect: it is a browser-only
// value, the server snapshot (null) keeps the first paint identical on both sides, and a
// `hashchange` (someone pasting the rest of a cut-off link) is picked up without a reload.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;
const serverHash = () => null;

/**
 * The token from "#AbC…". Tolerates "#k=AbC…" (the plan's first shape) and trailing punctuation a
 * messaging app may glue onto a link, since a link that fails over a stray "." is a support call.
 */
function tokenFrom(hash: string): string {
  let raw = hash.replace(/^#/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep the raw value */
  }
  raw = raw.trim().replace(/^k=/, "").replace(/[^A-Za-z0-9_-]+$/, "");
  return SERIES_TOKEN_RE.test(raw) ? raw : "";
}

type Loaded = { token: string; attempt: number; series: PublicSeries | null; failure: "" | "invalid" | "network" };
type Confirming = { kind: "skip"; appointmentId: string } | { kind: "cancel" } | null;
/** Where an error message belongs on the page: a visit's row, the change panel, or the page. */
type ErrorAt = { where: string; message: string } | null;
type WriteResult = { ok: true } | { ok: false; error: unknown };

// `flex: 1 1 auto` with no `minWidth: 0`: each button keeps at least its label's width, so on a
// phone the pair wraps onto two full-width rows instead of "Go to the booking page" spilling out of
// its border (seen at 390px wide).
const linkButton = (primary: boolean): CSSProperties => ({
  flex: "1 1 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: "var(--control-h-md, 44px)",
  padding: "0 16px",
  borderRadius: "var(--radius-md, 10px)",
  font: "var(--fw-semibold) 15px/1 var(--font-sans)",
  textDecoration: "none",
  whiteSpace: "nowrap",
  ...(primary
    ? { background: "var(--primary)", color: "var(--text-on-brand)", border: "1px solid var(--brand-outline, transparent)" }
    : { background: "var(--surface-card)", color: "var(--text-strong)", border: "1px solid var(--border-default)" }),
});
const sectionLabel: CSSProperties = {
  font: "var(--fw-bold) 12px/1 var(--font-sans)",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: "0 0 10px",
};
const muted: CSSProperties = { font: "var(--fw-regular) 14px/1.5 var(--font-sans)", color: "var(--text-muted)", margin: 0 };
const errorText: CSSProperties = { font: "var(--fw-medium) 13.5px/1.4 var(--font-sans)", color: "var(--error)", margin: "10px 0 0" };
const pill = (on: boolean): CSSProperties => ({
  cursor: "pointer",
  font: "var(--fw-semibold) 13px/1 var(--font-sans)",
  padding: "8px 13px",
  borderRadius: 999,
  transition: "all .15s ease",
  ...(on
    ? { background: "var(--primary)", color: "var(--text-on-brand, #fff)", border: "1.5px solid var(--primary)" }
    : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }),
});
const visitWhenOpts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };

/**
 * Load a series by its manage token — shared by the standalone page (token from the link) and the
 * inline manager in My appointments (token from the phone lookup or this device's saved booking).
 * `onSeries` hears every load and every write's answer (null = the token opens nothing); it is
 * kept in a ref so a parent passing a fresh closure each render does not refetch.
 */
function useSeriesByToken(token: string | null, onSeries?: (s: PublicSeries | null) => void) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const report = useRef(onSeries);
  useEffect(() => {
    report.current = onSeries;
  }, [onSeries]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    publicApi
      .getSeries(token)
      .then((series) => {
        if (!live) return;
        setLoaded({ token, attempt, series, failure: "" });
        report.current?.(series);
      })
      .catch((e) => {
        if (!live) return;
        // 404 is the API's single answer for "no such token" — never retryable. Anything else
        // (offline, a 5xx, a 429) is worth a "Try again".
        const invalid = e instanceof ApiError && e.status === 404;
        setLoaded({ token, attempt, series: null, failure: invalid ? "invalid" : "network" });
        if (invalid) report.current?.(null);
      });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  // Only an answer for THIS token and THIS attempt counts; anything older reads as loading.
  const current = token && loaded && loaded.token === token && loaded.attempt === attempt ? loaded : null;
  return {
    current,
    retry: () => setAttempt((n) => n + 1),
    setSeries: (next: PublicSeries) => {
      if (!current) return;
      setLoaded({ token: current.token, attempt, series: next, failure: "" });
      report.current?.(next);
    },
    setGone: () => {
      if (!current) return;
      setLoaded({ token: current.token, attempt, series: null, failure: "invalid" });
      report.current?.(null);
    },
  };
}

function RetryLoad({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "12px 0" }}>
      <p style={{ ...muted, marginBottom: 16 }}>{S.loadError}</p>
      <Button variant="primary" onClick={onRetry}>
        {S.retry}
      </Button>
    </div>
  );
}

export default function SeriesManage({
  phone,
  storeHours,
}: {
  phone: string;
  /**
   * Weekdays the store this URL belongs to never opens, for greying the picker's day strip. Only
   * used when it is the series' own store (the token, not the URL, decides which store that is).
   */
  storeHours?: { slug: string; closedWeekdays: number[] } | null;
}) {
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  /** null = not hydrated yet (server render); "" = no usable token in the link. */
  const token = hash === null ? null : tokenFrom(hash);
  const { current, retry, setSeries, setGone } = useSeriesByToken(token);
  const storePhone = current?.series?.store.phoneFull || phone;

  let body: ReactNode;
  if (token === null || (token && !current)) {
    body = (
      <p aria-live="polite" style={{ ...muted, textAlign: "center", padding: "24px 0" }}>
        {S.loading}
      </p>
    );
  } else if (token === "" || current?.failure === "invalid" || !current) {
    body = <InvalidLink phone={phone} />;
  } else if (current.failure === "network" || !current.series) {
    body = <RetryLoad onRetry={retry} />;
  } else {
    const series = current.series;
    body = (
      <SeriesView
        token={current.token}
        series={series}
        closedWeekdays={storeHours && storeHours.slug === series.store.slug ? storeHours.closedWeekdays : undefined}
        onSeries={setSeries}
        onGone={setGone}
        storePhone={storePhone}
      />
    );
  }

  return (
    <main style={{ width: 520, maxWidth: "100%", margin: "0 auto" }}>
      <div
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "calc(22px * var(--radius-scale, 1))",
          boxShadow: "var(--shadow-lg)",
          padding: "clamp(20px, 5vw, 32px)",
        }}
      >
        {body}
      </div>
    </main>
  );
}

/**
 * The same manage view, embedded in the microsite's My appointments pop-up for a token the page
 * already holds (from the phone lookup, or a repeating booking made on this device). Everything a
 * customer can do on the link page works here — skip, move, change all future visits, cancel.
 *
 * `embedded` drops what only makes sense on a page of its own: the card wrapper, the store name and
 * the h1 (the pop-up has its own title), and the "Call the salon / Go to the booking page" links
 * (the customer is on the booking page). The token stays in memory: it is never put in the URL.
 */
export function SeriesPanel({
  token,
  closedWeekdays,
  onSeries,
}: {
  token: string;
  closedWeekdays?: number[];
  /** Every load and every write's answer; null = this token no longer opens a booking. */
  onSeries?: (s: PublicSeries | null) => void;
}) {
  const { current, retry, setSeries, setGone } = useSeriesByToken(token, onSeries);
  if (!current) {
    return (
      <p aria-live="polite" style={{ ...muted, padding: "12px 0" }}>
        {S.loading}
      </p>
    );
  }
  if (current.failure === "invalid") return <p style={{ ...muted, padding: "12px 0" }}>{S.embeddedGone}</p>;
  if (current.failure === "network" || !current.series) return <RetryLoad onRetry={retry} />;
  return (
    <SeriesView
      token={current.token}
      series={current.series}
      closedWeekdays={closedWeekdays}
      onSeries={setSeries}
      onGone={setGone}
      storePhone={current.series.store.phoneFull ?? ""}
      embedded
    />
  );
}

function InvalidLink({ phone }: { phone: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "var(--surface-sunken)",
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "2px auto 16px",
        }}
      >
        <Icon name="search" size={26} />
      </div>
      <h1 style={{ font: "var(--fw-extrabold) 21px/1.25 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>{S.invalidTitle}</h1>
      <p style={{ ...muted, marginBottom: 20 }}>{S.invalidLink}</p>
      {/* The URL's own number is the store's — the one useful thing a broken link still carries.
          The booking page comes first now: its My Appointments finds the booking by phone number
          (client decision 2026-10-05), so a lost or cut-off link no longer means a phone call. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a href={`/${phone}`} style={linkButton(true)}>
          {S.openStore}
        </a>
        <a href={`tel:+${phone}`} style={linkButton(false)}>
          <Icon name="phone" size={16} />
          {S.callSalon}
        </a>
      </div>
    </div>
  );
}

function SeriesView({
  token,
  series: s,
  closedWeekdays,
  onSeries,
  onGone,
  storePhone,
  embedded = false,
}: {
  token: string;
  series: PublicSeries;
  closedWeekdays?: number[];
  onSeries: (s: PublicSeries) => void;
  onGone: () => void;
  storePhone: string;
  /** Inside My appointments: no store name / h1 and no page links (see SeriesPanel). */
  embedded?: boolean;
}) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorAt>(null);
  const [notice, setNotice] = useState("");
  /** The visit whose time picker is open. */
  const [moving, setMoving] = useState<string | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  /** Bumped on every successful write: the change panel's preview depends on the series as it is now. */
  const [rev, setRev] = useState(0);

  const tz = s.store.timezone;
  const canEdit = !!s.today && !!s.lastDay;
  const visitWhen = (iso: string) => formatInZone(iso, tz, visitWhenOpts);

  /**
   * Every write goes through here: the response IS the new state. A 404 means the link no longer
   * opens anything; a 422 means the series moved under us (skipped or cancelled elsewhere), so the
   * page re-reads it rather than leave a button that will only fail again.
   */
  const write = async (
    where: string,
    action: () => Promise<PublicSeries>,
    messageFor?: (e: ApiError) => string | null,
  ): Promise<WriteResult> => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      onSeries(await action());
      setRev((n) => n + 1);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        onGone();
        return { ok: false, error: e };
      }
      setError({ where, message: e instanceof ApiError ? messageFor?.(e) ?? e.message : S.actionError });
      if (e instanceof ApiError && e.status === 422) {
        publicApi
          .getSeries(token)
          .then(onSeries)
          .catch(() => undefined);
      }
      return { ok: false, error: e };
    } finally {
      setBusy(false);
    }
  };

  // "Every 2 weeks · Sat 10:00 AM". The weekday only means something when the rhythm is whole
  // weeks — every 18 days lands on a different day each time, so it gets the time alone.
  // Taken from the RULE's dates first: a visit can be moved to another day (Phase 2), and the first
  // visit moved Monday → Tuesday made this read "Every week · Tue" for a Monday regular.
  const ruleDate = s.laterDates[0] ?? s.changeFromDates?.[0] ?? s.lastDate ?? null;
  const unmovedVisit = s.visits.find((v) => !v.moved);
  const weekday =
    s.everyDays % 7 === 0
      ? ruleDate
        ? formatYmd(ruleDate, { weekday: "short" })
        : unmovedVisit
          ? formatInZone(unmovedVisit.scheduledStartAt, tz, { weekday: "short" })
          : ""
      : "";
  const rhythmLine = format(S.rhythmLine, {
    rhythm: rhythmLabel(s.everyDays, true),
    when: [weekday, formatTimeOfDay(s.startTime)].filter(Boolean).join(" "),
  });
  const endLine =
    s.end.type === "never"
      ? S.endNever
      : s.end.type === "count"
        ? format(S.endCount, { count: s.totalVisits ?? s.end.count, date: s.lastDate ? formatYmd(s.lastDate) : "" })
        : format(S.endUntil, { date: formatYmd(s.end.date) });

  const banner =
    s.status === "paused" ? S.paused : s.status === "ended" ? S.ended : s.status === "cancelled" ? S.cancelled : null;
  const open = s.status === "active" || s.status === "paused";
  const canChange = canEdit && s.status === "active" && (s.changeFromDates?.length ?? 0) > 0;

  return (
    <div>
      {embedded ? (
        <h3 style={{ font: "var(--fw-extrabold) 18px/1.25 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 10px" }}>{S.heading}</h3>
      ) : (
        <>
          <div
            style={{
              font: "var(--fw-bold) 12px/1.3 var(--font-sans)",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--primary)",
              marginBottom: 8,
            }}
          >
            {s.store.name}
          </div>
          <h1 style={{ font: "var(--fw-extrabold) clamp(22px, 5vw, 26px)/1.2 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 14px" }}>
            {S.heading}
          </h1>
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
        <div style={{ font: "var(--fw-semibold) 16px/1.4 var(--font-sans)", color: "var(--text-strong)" }}>
          {[s.serviceName, s.staffName ? format(S.staffLine, { name: s.staffName }) : null].filter(Boolean).join(" · ")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, font: "var(--fw-medium) 14.5px/1.4 var(--font-sans)", color: "var(--text-body)" }}>
          <span role="img" aria-label={t.microsite.repeat.marker} style={{ display: "flex", color: "var(--primary)" }}>
            <Icon name="repeat" size={16} />
          </span>
          {rhythmLine}
        </div>
        <div style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{endLine}</div>
      </div>

      {banner && (
        <div
          role="status"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "12px 14px",
            marginBottom: 18,
            borderRadius: "calc(12px * var(--radius-scale, 1))",
            font: "var(--fw-medium) 14px/1.45 var(--font-sans)",
            ...(s.status === "paused"
              ? { background: "var(--warning-soft)", color: "var(--warning-soft-fg)" }
              : { background: "var(--surface-sunken)", color: "var(--text-body)" }),
          }}
        >
          <span style={{ display: "flex", marginTop: 1 }}>
            <Icon name={s.status === "paused" ? "alertTriangle" : "info"} size={17} />
          </span>
          {banner}
        </div>
      )}

      {notice && (
        <div
          role="status"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "10px 14px",
            marginBottom: 14,
            borderRadius: "calc(12px * var(--radius-scale, 1))",
            background: "var(--success-soft)",
            color: "var(--success-soft-fg, var(--success))",
            font: "var(--fw-semibold) 14px/1.4 var(--font-sans)",
          }}
        >
          <Icon name="checkCircle" size={17} />
          {notice}
        </div>
      )}

      <h2 style={sectionLabel}>{S.upcoming}</h2>
      {s.visits.length === 0 ? (
        <p style={{ ...muted, marginBottom: 14 }}>{S.noUpcoming}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {s.visits.map((v) => (
            <VisitRow
              key={v.appointmentId}
              token={token}
              series={s}
              visit={v}
              when={visitWhen(v.scheduledStartAt)}
              closedWeekdays={closedWeekdays}
              canEdit={canEdit}
              busy={busy}
              moving={moving === v.appointmentId}
              askingSkip={confirming?.kind === "skip" && confirming.appointmentId === v.appointmentId}
              error={error?.where === v.appointmentId ? error.message : ""}
              onAskSkip={() => {
                setError(null);
                setMoving(null);
                setConfirming({ kind: "skip", appointmentId: v.appointmentId });
              }}
              onSkip={async () => {
                await write(v.appointmentId, () => publicApi.skipSeriesVisit(token, v.appointmentId));
                setConfirming(null);
              }}
              onOpenMove={() => {
                setError(null);
                setConfirming(null);
                setMoving(v.appointmentId);
              }}
              onCloseMove={() => setMoving(null)}
              onNevermind={() => setConfirming(null)}
              onMove={async (pick, staffChanged) => {
                const r = await write(v.appointmentId, () =>
                  publicApi.rescheduleSeriesVisit(token, v.appointmentId, {
                    slotStart: pick.startAt,
                    ...(staffChanged && pick.staffId ? { staffId: pick.staffId } : {}),
                  }),
                );
                if (r.ok) {
                  setMoving(null);
                  setNotice(S.movedDone);
                }
                return r;
              }}
            />
          ))}
        </ul>
      )}

      {s.laterDates.length > 0 && (
        <p style={{ ...muted, fontSize: 13.5, marginBottom: 18 }}>
          {format(S.laterDates, { dates: s.laterDates.map((d) => formatYmd(d)).join(" · ") })}
        </p>
      )}

      {error?.where === "page" && (
        <p role="alert" style={{ ...errorText, margin: "0 0 14px" }}>
          {error.message}
        </p>
      )}

      {canChange &&
        (changeOpen ? (
          <ChangePanel
            key={`change-${s.seriesId}`}
            token={token}
            series={s}
            closedWeekdays={closedWeekdays}
            rev={rev}
            busy={busy}
            error={error?.where === "change" ? error.message : ""}
            onClose={() => {
              setChangeOpen(false);
              if (error?.where === "change") setError(null);
            }}
            onApply={async (body) => {
              const r = await write(
                "change",
                () => publicApi.changeSeries(token, body),
                (e) => (e.code === "CHANGE_CONFLICTS" ? S.changeConflictsAgain : null),
              );
              if (r.ok) {
                setChangeOpen(false);
                setNotice(S.changeDone);
              }
              return r;
            }}
          />
        ) : (
          <div style={{ marginBottom: 10 }}>
            <Button
              variant="outline"
              fullWidth
              disabled={busy}
              leadingIcon={<Icon name="calendar" size={16} />}
              onClick={() => {
                setError(null);
                setNotice("");
                setMoving(null);
                setConfirming(null);
                setChangeOpen(true);
              }}
            >
              {S.changeOpen}
            </Button>
          </div>
        ))}

      {open &&
        (confirming?.kind === "cancel" ? (
          <ConfirmBox
            text={S.cancelConfirm}
            yes={S.cancelYes}
            no={S.cancelKeep}
            busy={busy}
            onYes={async () => {
              await write("page", () => publicApi.cancelSeries(token));
              setConfirming(null);
              setChangeOpen(false);
            }}
            onNo={() => setConfirming(null)}
          />
        ) : (
          <Button
            variant="outline"
            fullWidth
            disabled={busy}
            onClick={() => {
              setError(null);
              setMoving(null);
              setConfirming({ kind: "cancel" });
            }}
            style={{ color: "var(--error)" }}
          >
            {S.cancelSeries}
          </Button>
        ))}

      {!embedded && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <a href={`tel:+${storePhone}`} style={linkButton(false)}>
            <Icon name="phone" size={16} />
            {S.callSalon}
          </a>
          <a href={`/${storePhone}`} style={linkButton(false)}>
            {S.openStore}
          </a>
        </div>
      )}
    </div>
  );
}

/** One upcoming visit: its time, Skip, and Reschedule with an inline picker + confirm. */
function VisitRow({
  token,
  series: s,
  visit: v,
  when,
  closedWeekdays,
  canEdit,
  busy,
  moving,
  askingSkip,
  error,
  onAskSkip,
  onSkip,
  onOpenMove,
  onCloseMove,
  onNevermind,
  onMove,
}: {
  token: string;
  series: PublicSeries;
  visit: PublicSeries["visits"][number];
  when: string;
  closedWeekdays?: number[];
  canEdit: boolean;
  busy: boolean;
  moving: boolean;
  askingSkip: boolean;
  error: string;
  onAskSkip: () => void;
  onSkip: () => void;
  onOpenMove: () => void;
  onCloseMove: () => void;
  onNevermind: () => void;
  onMove: (pick: PickedSlot, staffChanged: boolean) => Promise<WriteResult>;
}) {
  const cancelled = v.status === "cancelled";
  const staff = s.staff ?? [];
  // The chip a move starts on: the visit's own stylist while they still work here, else "any".
  const currentChoice = v.staffId && staff.some((x) => x.id === v.staffId) ? v.staffId : "any";
  const [pick, setPick] = useState<PickedSlot | null>(null);
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(
    (date: string, staffId: string | undefined) =>
      publicApi.getSeriesSlots(token, { date, staffId, appointmentId: v.appointmentId }).then((r) => r.slots),
    [token, v.appointmentId],
  );
  const staffChanged = !!pick && pick.staffId !== (v.staffId ?? "any");
  const pickedName = staffChanged && pick?.staffId && pick.staffId !== "any" ? staff.find((x) => x.id === pick.staffId)?.name : null;
  const pickWhen = pick ? formatInZone(pick.startAt, s.store.timezone, visitWhenOpts) : "";

  return (
    <li
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "calc(12px * var(--radius-scale, 1))",
        padding: "10px 12px",
        background: cancelled ? "var(--surface-page)" : "var(--surface-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 36, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            style={{
              font: "var(--fw-semibold) 14.5px/1.35 var(--font-sans)",
              color: cancelled ? "var(--text-muted)" : "var(--text-strong)",
              textDecoration: cancelled ? "line-through" : undefined,
            }}
          >
            {when}
          </span>
          {v.moved && !cancelled && (
            <span style={{ font: "var(--fw-semibold) 12px/1 var(--font-sans)", color: "var(--primary)" }}>{S.moved}</span>
          )}
        </span>
        {cancelled ? (
          <span style={{ flexShrink: 0, font: "var(--fw-semibold) 12.5px/1 var(--font-sans)", color: "var(--text-muted)" }}>
            {v.cancelReason === "skipped" ? S.skipped : S.visitCancelled}
          </span>
        ) : !askingSkip && !moving ? (
          <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {canEdit && v.canReschedule && (
              <Button variant="outline" size="sm" disabled={busy} onClick={onOpenMove}>
                {S.reschedule}
              </Button>
            )}
            {v.canSkip && (
              <Button variant="outline" size="sm" disabled={busy} onClick={onAskSkip}>
                {S.skip}
              </Button>
            )}
          </span>
        ) : null}
      </div>

      {askingSkip && <ConfirmBox text={S.skipConfirm} yes={S.skipYes} no={S.keepVisit} busy={busy} onYes={onSkip} onNo={onNevermind} />}

      {moving && canEdit && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ ...sectionLabel, margin: "0 0 12px" }}>{S.pickNewTime}</div>
          <SlotPicker
            today={s.today!}
            lastDay={s.lastDay!}
            initialDate={ymdInZone(v.scheduledStartAt, s.store.timezone)}
            closedWeekdays={closedWeekdays}
            staffOptions={staff}
            staffId={currentChoice}
            currentStaffId={currentChoice}
            load={load}
            value={pick?.startAt ?? null}
            onChange={setPick}
            refreshKey={refresh}
          />
          {pick ? (
            <ConfirmBox
              tone="neutral"
              text={format(S.moveConfirm, { when: pickedName ? format(S.whenWith, { when: pickWhen, name: pickedName }) : pickWhen })}
              yes={S.moveYes}
              no={t.common.back}
              busy={busy}
              onYes={async () => {
                const r = await onMove(pick, staffChanged);
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPick(null);
                  onCloseMove();
                }}
              >
                {S.keepThisTime}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </li>
  );
}

type Resolution = { slotStart: string; when: string } | { skip: true };

/**
 * "Change all future visits": from one of the series' dates on, a new time and/or stylist. The
 * preview shows every date's fate before anything is written; a date the new time doesn't fit
 * needs the customer's choice (another time, or skip) — nothing is moved or dropped silently.
 */
function ChangePanel({
  token,
  series: s,
  closedWeekdays,
  rev,
  busy,
  error,
  onClose,
  onApply,
}: {
  token: string;
  series: PublicSeries;
  closedWeekdays?: number[];
  rev: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onApply: (body: SeriesChangeBody & { resolutions?: SeriesChangeResolution[] }) => Promise<WriteResult>;
}) {
  const tz = s.store.timezone;
  const fromDates = s.changeFromDates ?? [];
  const staff = s.staff ?? [];
  // The stylist chip that means "no change": the series' stylist, "any", or none at all when the
  // chosen stylist has left (then the customer must pick someone).
  const currentChoice: string | null = s.staffLocked ? (s.staffId && staff.some((x) => x.id === s.staffId) ? s.staffId : null) : "any";

  const [fromDate, setFromDate] = useState(fromDates[0] ?? "");
  /** undefined = keep the current stylist. */
  const [staffChoice, setStaffChoice] = useState<string | undefined>(undefined);
  /** null = keep the current time. */
  const [newSlot, setNewSlot] = useState<PickedSlot | null>(null);
  const [nonce, setNonce] = useState(0);
  const [againNote, setAgainNote] = useState(false);
  /** The conflict date whose picker is open. */
  const [picking, setPicking] = useState<string | null>(null);

  const load = useCallback(
    (date: string, staffId: string | undefined) => publicApi.getSeriesSlots(token, { date, staffId, fromDate }).then((r) => r.slots),
    [token, fromDate],
  );

  const body: SeriesChangeBody | null =
    fromDate && (newSlot || staffChoice !== undefined)
      ? {
          fromDate,
          ...(newSlot ? { slotStart: newSlot.startAt } : {}),
          ...(staffChoice !== undefined ? { staffId: staffChoice } : {}),
        }
      : null;
  // The choices behind a preview; `rev` so a visit moved meanwhile re-runs it. Resolutions belong
  // to these choices — new choices mean new conflicts, so old answers are dropped with them.
  const choiceKey = body ? JSON.stringify({ ...body, rev }) : null;
  const fetchKey = choiceKey ? `${choiceKey}#${nonce}` : null;

  const [preview, setPreview] = useState<{ key: string; data: SeriesChangePreview | null; error: string } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!fetchKey || !choiceKey) return;
    const mine = ++seq.current;
    const wire = JSON.parse(choiceKey) as SeriesChangeBody & { rev?: number };
    delete wire.rev; // a client-side cache key only — the API's schema is strict
    publicApi
      .previewSeriesChange(token, wire)
      .then((data) => {
        if (seq.current === mine) setPreview({ key: fetchKey, data, error: "" });
      })
      .catch((e) => {
        if (seq.current === mine) setPreview({ key: fetchKey, data: null, error: e instanceof ApiError ? e.message : S.actionError });
      });
  }, [fetchKey, choiceKey, token]);
  const currentPreview = fetchKey && preview?.key === fetchKey ? preview : null;

  const [res, setRes] = useState<{ key: string | null; map: Record<string, Resolution> }>({ key: null, map: {} });
  const resolved = res.key === choiceKey ? res.map : {};
  const resolve = (date: string, r: Resolution | null) =>
    setRes((prev) => {
      const map = { ...(prev.key === choiceKey ? prev.map : {}) };
      if (r) map[date] = r;
      else delete map[date];
      return { key: choiceKey, map };
    });

  const conflicts = currentPreview?.data?.conflicts ?? [];
  const allResolved = conflicts.every((d) => !!resolved[d]);
  const canConfirm = !!body && !!currentPreview?.data && allResolved && !busy;

  const chooseFrom = (d: string) => {
    if (d === fromDate) return;
    setFromDate(d);
    setNewSlot(null); // times are per date
    setPicking(null);
    setAgainNote(false);
  };
  const chooseStaff = (id: string) => {
    const next = id === currentChoice ? undefined : id;
    if (next === staffChoice) return;
    setStaffChoice(next);
    setNewSlot(null); // a time free for one stylist may not be for another
    setPicking(null);
    setAgainNote(false);
  };

  const confirm = async () => {
    if (!body) return;
    setAgainNote(false);
    const resolutions: SeriesChangeResolution[] = conflicts.map((date) => {
      const r = resolved[date];
      return "skip" in r ? { date, skip: true } : { date, slotStart: r.slotStart };
    });
    const out = await onApply({ ...body, ...(resolutions.length ? { resolutions } : {}) });
    if (!out.ok && out.error instanceof ApiError && out.error.code === "CHANGE_CONFLICTS") {
      // Someone took a time meanwhile: forget the answers for the dates it names, re-run the
      // preview, and let the customer pick again — never apply half a change.
      for (const d of out.error.details) if (d.rule) resolve(d.rule, null);
      setNonce((n) => n + 1);
      setAgainNote(true);
    }
  };

  return (
    <section
      aria-label={S.changeTitle}
      style={{
        border: "1.5px solid var(--border-default)",
        borderRadius: "calc(14px * var(--radius-scale, 1))",
        padding: 16,
        marginBottom: 12,
      }}
    >
      <h2 style={{ font: "var(--fw-bold) 16px/1.3 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>{S.changeTitle}</h2>
      <p style={{ ...muted, fontSize: 13.5, marginBottom: 14 }}>{S.changeIntro}</p>

      <div style={sectionLabel}>{S.changeFrom}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {fromDates.map((d) => (
          <button key={d} type="button" aria-pressed={d === fromDate} onClick={() => chooseFrom(d)} style={pill(d === fromDate)}>
            {formatYmd(d)}
          </button>
        ))}
      </div>

      {/* Stylist before time: the times on offer depend on who is doing the visit. */}
      {staff.length > 0 && (
        <>
          <div style={sectionLabel}>{S.changeStylist}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: currentChoice === null ? 8 : 16 }}>
            {[{ id: "any", name: t.microsite.slotPicker.anyStylist }, ...staff].map((c) => {
              const on = (staffChoice ?? currentChoice) === c.id;
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => chooseStaff(c.id)} style={pill(on)}>
                  {c.id === currentChoice ? format(S.currentStylist, { name: c.name }) : c.name}
                </button>
              );
            })}
          </div>
          {currentChoice === null && <p style={{ ...muted, fontSize: 13, marginBottom: 16 }}>{S.stylistGone}</p>}
        </>
      )}

      <div style={sectionLabel}>{S.changeNewTime}</div>
      <div style={{ marginBottom: 10 }}>
        <button type="button" aria-pressed={!newSlot} onClick={() => setNewSlot(null)} style={pill(!newSlot)}>
          {format(S.keepCurrentTime, { time: formatTimeOfDay(s.startTime) })}
        </button>
      </div>
      {fromDate && s.today && s.lastDay && (
        <SlotPicker
          key={`${fromDate}|${staffChoice ?? ""}`}
          today={s.today}
          lastDay={s.lastDay}
          initialDate={fromDate}
          showDays={false}
          staffId={staffChoice}
          load={load}
          value={newSlot?.startAt ?? null}
          onChange={(p) => {
            setNewSlot(p);
            setPicking(null);
            setAgainNote(false);
          }}
        />
      )}

      <div style={{ ...sectionLabel, marginTop: 18 }}>{S.changePreview}</div>
      {!body ? (
        <p style={{ ...muted, fontSize: 13.5 }}>{S.changePickSomething}</p>
      ) : !currentPreview ? (
        <p aria-live="polite" style={{ ...muted, fontSize: 13.5 }}>
          {S.changePreviewLoading}
        </p>
      ) : !currentPreview.data ? (
        <p role="alert" style={{ ...errorText, marginTop: 0 }}>
          {currentPreview.error}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {currentPreview.data.dates.map((d) => (
            <PreviewRow
              key={d.date}
              date={d}
              tz={tz}
              resolution={resolved[d.date] ?? null}
              picking={picking === d.date}
              busy={busy}
              onPick={() => setPicking(d.date)}
              onSkip={() => {
                resolve(d.date, { skip: true });
                setPicking(null);
              }}
              onUndo={() => resolve(d.date, null)}
              picker={
                picking === d.date && s.today && s.lastDay ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ ...muted, fontSize: 13, color: "var(--text-body)", marginBottom: 8 }}>
                      {format(S.pickForDate, { date: formatYmd(d.date) })}
                    </div>
                    {/* Any free time in the customer's range — on this date, or another if they
                        prefer — for the stylist the change is moving to. */}
                    <SlotPicker
                      today={s.today}
                      lastDay={s.lastDay}
                      initialDate={d.date}
                      closedWeekdays={closedWeekdays}
                      staffId={staffChoice}
                      load={load}
                      value={null}
                      onChange={(p) => {
                        if (!p) return;
                        resolve(d.date, { slotStart: p.startAt, when: formatInZone(p.startAt, tz, visitWhenOpts) });
                        setPicking(null);
                      }}
                    />
                    <div style={{ marginTop: 10 }}>
                      <Button variant="ghost" size="sm" onClick={() => setPicking(null)}>
                        {t.common.back}
                      </Button>
                    </div>
                  </div>
                ) : null
              }
            />
          ))}
        </ul>
      )}

      {againNote && (
        <p role="alert" style={errorText}>
          {S.changeConflictsAgain}
        </p>
      )}
      {error && !againNote && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      {!!currentPreview?.data && !allResolved && <p style={{ ...muted, fontSize: 13, marginTop: 12 }}>{S.changeNeedsChoices}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <Button variant="outline" fullWidth disabled={busy} onClick={onClose}>
            {t.common.close}
          </Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button variant="primary" fullWidth loading={busy} disabled={!canConfirm} onClick={confirm}>
            {S.changeConfirm}
          </Button>
        </div>
      </div>
    </section>
  );
}

function PreviewRow({
  date: d,
  tz,
  resolution,
  picking,
  busy,
  onPick,
  onSkip,
  onUndo,
  picker,
}: {
  date: SeriesChangePreview["dates"][number];
  tz: string;
  resolution: Resolution | null;
  picking: boolean;
  busy: boolean;
  onPick: () => void;
  onSkip: () => void;
  onUndo: () => void;
  picker: ReactNode;
}) {
  // A date whose time is not being set by this change shows only the date: "kept" keeps its own
  // moved time and the others are not booked at all.
  const showTime = d.status === "ok" || d.status === "taken" || d.status === "later";
  const label = showTime ? formatInZone(d.startAt, tz, visitWhenOpts) : formatYmd(d.date);
  const dim = d.status === "skipped" || d.status === "closed" || d.status === "later";
  const statusText =
    d.status === "taken"
      ? S.changeStatusTaken
      : d.status === "kept"
        ? S.changeStatusKept
        : d.status === "skipped"
          ? S.changeStatusSkipped
          : d.status === "closed"
            ? S.changeStatusClosed
            : d.status === "later"
              ? S.changeStatusLater
              : "";
  return (
    <li
      style={{
        padding: d.status === "taken" ? "10px 12px" : "2px 0",
        ...(d.status === "taken"
          ? {
              border: `1.5px solid ${resolution ? "var(--border-subtle)" : "var(--warning-soft-fg, var(--error))"}`,
              borderRadius: "calc(12px * var(--radius-scale, 1))",
              background: resolution ? "var(--surface-card)" : "color-mix(in srgb, var(--warning-soft) 60%, var(--surface-card))",
            }
          : {}),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            font: "var(--fw-semibold) 14px/1.35 var(--font-sans)",
            color: dim ? "var(--text-muted)" : "var(--text-strong)",
            textDecoration: d.status === "taken" && resolution ? "line-through" : undefined,
          }}
        >
          {label}
        </span>
        {statusText && (
          <span
            style={{
              font: "var(--fw-medium) 12.5px/1.4 var(--font-sans)",
              color: d.status === "taken" ? "var(--warning-soft-fg, var(--text-body))" : "var(--text-muted)",
            }}
          >
            {statusText}
          </span>
        )}
      </div>
      {d.status === "taken" &&
        (resolution ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
            <span style={{ font: "var(--fw-semibold) 13.5px/1.35 var(--font-sans)", color: "var(--text-strong)" }}>
              {"skip" in resolution ? S.resolvedSkip : format(S.resolvedTime, { when: resolution.when })}
            </span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onUndo}>
              {S.changeChoice}
            </Button>
          </div>
        ) : picking ? (
          picker
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Button variant="outline" size="sm" disabled={busy} onClick={onPick}>
              {S.pickAnotherTime}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={onSkip}>
              {S.skipThisDate}
            </Button>
          </div>
        ))}
    </li>
  );
}

/**
 * Inline "are you sure?" — the microsite's LeaveConfirm pattern, not a browser dialog. `danger` for
 * the irreversible ones (skip, cancel); `neutral` for a move, which can be moved again. Exported for
 * My appointments, so a one-off booking's confirms look exactly like a series visit's.
 */
export function ConfirmBox({
  text,
  yes,
  no,
  busy,
  onYes,
  onNo,
  tone = "danger",
}: {
  text: string;
  yes: string;
  no: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
  tone?: "danger" | "neutral";
}) {
  const danger = tone === "danger";
  return (
    <div
      role="alertdialog"
      aria-label={text}
      style={{
        marginTop: 10,
        border: `1.5px solid ${danger ? "var(--error)" : "var(--primary)"}`,
        borderRadius: "calc(12px * var(--radius-scale, 1))",
        padding: 14,
        background: danger
          ? "color-mix(in srgb, var(--error) 5%, var(--surface-card))"
          : "color-mix(in srgb, var(--primary) 5%, var(--surface-card))",
      }}
    >
      <div style={{ font: "var(--fw-semibold) 14px/1.45 var(--font-sans)", color: "var(--text-strong)", marginBottom: 12 }}>{text}</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Button variant="outline" fullWidth disabled={busy} onClick={onNo}>
            {no}
          </Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button variant={danger ? "danger" : "primary"} fullWidth loading={busy} onClick={onYes}>
            {yes}
          </Button>
        </div>
      </div>
    </div>
  );
}
