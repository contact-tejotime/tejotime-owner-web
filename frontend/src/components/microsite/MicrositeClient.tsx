"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import PhoneField from "@/components/ui/PhoneField";
import {
  ApiError,
  publicApi,
  type AppointmentLookup,
  type BookedSeries,
  type Microsite,
  type MicrositeStaff,
  type RepeatRule,
  type SeriesPreview,
  type Slot,
  type Ticket,
} from "@/lib/api";
import { REPEAT_LIMITS, addDaysYmd, formatYmd, rhythmLabel, ruleTotalVisits } from "@/lib/series";
import { localYmd, viewerBookDays } from "@/lib/booking-days";
import { t, format, plural } from "@/i18n";
import { currencySymbol } from "@/lib/currencies";
import { combineToE164, DEFAULT_DIAL_CODE, DEFAULT_ISO2, formatPhone, splitPhone } from "@/lib/phone";
import type { CustomerAuth } from "@/lib/socket";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { API_BASE_URL } from "@/lib/config";
import { micrositeThemeConfig } from "@/theme";
import { ThemePortalProvider } from "@/theme/ThemePortal";
import { useThemePreview } from "@/theme/usePreviewChannel";
import { domainFor } from "./domains";
import { GalleryMosaic, LiveBoard, ReviewsBlock, Section, ServiceList, StatCards, Ticker } from "./sections";
import { statusCopy } from "./status-copy";
import { readOpenIntent, stripOpenIntent, type OpenIntent } from "./open-intent";
import "./salon.css";
import { SocialLinks } from "./SocialLinks";
import ChatWidget, { storeChatTitle } from "@/components/chat/ChatWidget";
import { BlockedError, useChatFlow, type FlowAdapter } from "@/components/chat/flow/useChatFlow";
import type { Card, Draft, FlowCtx } from "@/components/chat/flow/engine";
import { maskPhone, parseTypedPhone } from "@/components/chat/flow/phone";
import {
  AppointmentCard,
  ConsentCard,
  ServicesCard,
  SlotsCard,
  StaffCard,
  SummaryCard,
  TicketCard,
} from "@/components/chat/flow/FlowCards";
import { CookieSettingsButton } from "@/components/consent/CookieSettingsButton";

/**
 * Interaction-only surfaces, kept out of the first-load chunk.
 *
 * SaveContactSheet drags in qrcode.react and Lightbox is a full-screen viewer — neither is on
 * the path to first paint, and both are opened by an explicit tap. `ssr: false` is honest here:
 * they render nothing until opened, so there is no server markup to miss.
 */
const SaveContactSheet = dynamic(() => import("./SaveContactSheet"), { ssr: false });
// My appointments brings the time picker and the repeating-booking manager with it — both only
// ever opened by a tap.
const MyAppointments = dynamic(() => import("./MyAppointments"), { ssr: false });
const Lightbox = dynamic(() => import("./sections").then((m) => ({ default: m.Lightbox })), {
  ssr: false,
});

const AVATAR_COLORS = ["var(--primary)", "var(--secondary)", "var(--amber-500)"];
const DAYS = t.microsite.days;

/**
 * How far ahead the booking calendar runs. Two weeks covers "next Saturday" — the thing
 * customers actually ask for — without turning the day strip into an endless scroll.
 */
const BOOKING_DAYS_AHEAD = 14;
/** Mirrors backend MAX_SERVICES_PER_VISIT (config/constants.ts) — the API rejects more. */
const MAX_SERVICES_PER_VISIT = 10;
/** Characters of the store name the header shows before cutting it with an ellipsis. */
const HEADER_NAME_MAX = 30;

// Client-side abuse simulation: after this many joins from one phone in a session we
// show the "too many attempts" view (the backend enforces only a generic per-IP 429).
const BLOCK_AT = 3;
// localStorage namespace for the held-ticket/abuse simulation. Keyed per business (by slug)
// so a held ticket or attempt counter from one salon never leaks onto another salon's page.
const STORE_PREFIX = "tt_microsite_";


const revealStyle: CSSProperties = { animation: "ttReveal .7s ease both" };
const eyebrow: CSSProperties = {
  font: "var(--fw-bold) 12px/1 var(--font-sans)",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 16,
};

// ---- Client-side "held ticket" simulation (localStorage) ----
// The backend allows duplicate joins and has no per-phone lookup, so the design's
// one-token-per-phone + resume behaviour is simulated here. Every held record is
// re-validated against the real getTicket so we never surface a stale/dead ticket.
interface HeldRecord {
  phone: string;
  name: string;
  ticketId: string;
  ticketKey: string;
  businessId: string;
  token: string;
}
/*
 * Bookings are NOT kept in this browser (since 2026-10-05, docs/customer-my-appointments.md).
 * My Appointments and the chat's "My appointments" both start from a phone number, like Check
 * Waitlist Status, and the phone lookup returns every key and series token the page needs. A list
 * saved here would show the next person on a shared phone everyone's bookings: four numbers booked
 * from one browser all appeared together. Old records still carrying `appointments` / `series` are
 * cleared when they load (readStore).
 */
interface Store {
  hold: HeldRecord | null;
  attempts: Record<string, number>;
  blocked: Record<string, boolean>;
  lastPhone: string;
  lastName: string;
}
const defaultStore = (): Store => ({ hold: null, attempts: {}, blocked: {}, lastPhone: "", lastName: "" });

/** "Repeat this booking?" choices; the numbers are days. "once" is the default — nobody signs up for a series by accident. */
type RepeatChoice = "once" | "7" | "14" | "21" | "28" | "custom";
const REPEAT_PRESETS: { value: RepeatChoice; label: string }[] = [
  { value: "once", label: t.microsite.repeat.once },
  { value: "7", label: t.microsite.repeat.everyWeek },
  { value: "14", label: t.microsite.repeat.every2Weeks },
  { value: "21", label: t.microsite.repeat.every3Weeks },
  { value: "28", label: t.microsite.repeat.every4Weeks },
];
type RepeatEndChoice = "count" | "until" | "never";
/** The plan's defaults (docs/recurring-appointments.md §1.1): custom shows 18 days, a series stops after 6 visits. */
const DEFAULT_CUSTOM_DAYS = "18";
const DEFAULT_END_COUNT = "6";
/** Wait this long after the last change to the rule before asking the API for the dates. */
const PREVIEW_DEBOUNCE_MS = 300;

// Styles shared by the repeat section. Native radios rather than the div-chips used elsewhere in
// the modal: these are true pick-one groups, and a real <input type="radio"> gives keyboard and
// screen-reader users the group semantics for free.
const fieldLabel: CSSProperties = {
  font: "var(--fw-bold) 12px/1 var(--font-sans)",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 9,
  padding: 0,
};
const fieldsetReset: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };
const repeatPill = (on: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  cursor: "pointer",
  font: "var(--fw-semibold) 13px/1.2 var(--font-sans)",
  padding: "7px 12px",
  borderRadius: "calc(10px * var(--radius-scale, 1))",
  transition: "border-color .15s ease, background .15s ease",
  color: "var(--text-strong)",
  background: on ? "color-mix(in srgb, var(--primary) 6%, var(--surface-card))" : "var(--surface-card)",
  border: `1.5px solid ${on ? "var(--primary)" : "var(--border-subtle)"}`,
});
const repeatRadio: CSSProperties = { margin: 0, width: 15, height: 15, flexShrink: 0, accentColor: "var(--primary)" };
const repeatInput: CSSProperties = {
  padding: "4px 6px",
  border: "1.5px solid var(--border-default)",
  borderRadius: "calc(8px * var(--radius-scale, 1))",
  font: "var(--fw-semibold) 13px/1.2 var(--font-sans)",
  color: "var(--text-strong)",
  background: "var(--surface-card)",
  outline: "none",
};
const repeatHint: CSSProperties = { font: "var(--fw-regular) 12.5px/1.45 var(--font-sans)", color: "var(--text-muted)", marginTop: 8 };
const repeatErrorText: CSSProperties = { font: "var(--fw-medium) 12.5px/1.4 var(--font-sans)", color: "var(--error)", marginTop: 8 };
function readStore(key: string): Store {
  if (typeof window === "undefined") return defaultStore();
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null") || {};
    // Until 2026-10-05 every booking made here was saved with its key (and a repeating booking with
    // its manage token). Nothing reads them any more; clear them once rather than leave working
    // keys on a shared phone.
    if ("appointments" in raw || "series" in raw) {
      delete raw.appointments;
      delete raw.series;
      localStorage.setItem(key, JSON.stringify(raw));
    }
    return { ...defaultStore(), ...raw };
  } catch {
    return defaultStore();
  }
}
function writeStore(key: string, s: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/**
 * A booked time in the STORE's clock — the zone its slot labels and hours are in — not the
 * viewer's. For a store in another zone (a Phoenix store viewed from India) the viewer's clock
 * shows a different time from the one the customer just picked. Falls back to the viewer's zone
 * when the payload has no timezone (older backend) or an invalid one.
 */
function formatInStoreZone(iso: string, tz: string | undefined, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(iso).toLocaleString(undefined, tz ? { ...opts, timeZone: tz } : opts);
  } catch {
    return new Date(iso).toLocaleString(undefined, opts);
  }
}

/** A ticket "exists / is live" only while in queue (waiting) or in process (in_service).
 *  Anything else — completed, cancelled, no_show — means there's no active entry. */
const isActive = (s?: string | null) => s === "waiting" || s === "in_service";

/** Leave is only allowed while waiting — not once service has started. */
const canLeaveQueue = (s?: string | null) => s === "waiting";

/**
 * Wall-clock-aware wait, so the pill counts down between server updates (Swiggy-style) instead of
 * sitting still until the next poll. Only the in-service head decays (`serviceRemainingMinutes`);
 * the queued-behind portion is held flat. `nowTs === null` (pre-mount) or a missing anchor falls
 * back to the raw server value, and the result is clamped to [0, waitMinutes] so interpolation can
 * never read higher than the server said (guards a walk-in bump or a skewed device clock).
 */
function displayWaitMinutes(ticket: Ticket | null, nowTs: number | null): number {
  const wait = ticket?.waitMinutes ?? 0;
  if (!ticket || wait <= 0 || nowTs == null || !ticket.asOf) return wait;
  const anchor = Date.parse(ticket.asOf);
  if (Number.isNaN(anchor)) return wait;
  const decayable = ticket.serviceRemainingMinutes ?? wait;
  const hold = Math.max(0, wait - decayable);
  const elapsed = Math.max(0, Math.floor((nowTs - anchor) / 60000));
  return Math.min(wait, hold + Math.max(0, decayable - elapsed));
}

/** Wall-clock decay for shop/staff wait snapshots between socket pushes. */
function displayStaffWaitMinutes(waitMinutes: number, asOf: string | null, nowTs: number | null): number {
  if (waitMinutes <= 0 || nowTs == null || !asOf) return waitMinutes;
  const anchor = Date.parse(asOf);
  if (Number.isNaN(anchor)) return waitMinutes;
  const elapsed = Math.max(0, Math.floor((nowTs - anchor) / 60000));
  return Math.max(0, waitMinutes - elapsed);
}

/** Emphasized count inside the live status line (free chairs / people ahead). */
function LiveStatusNum({ children, onDark }: { children: ReactNode; onDark?: boolean }) {
  return (
    <span
      style={{
        font: "var(--fw-extrabold) 1.15em/1 var(--font-sans)",
        color: onDark ? "#fff" : "var(--text-strong)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-.02em",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Structured live status — the free-count / ahead-count pulled forward so the numbers attract
 * the eye. Used by the mobile bottom bar and the LiveBoard dark tile (compact one-liners).
 *
 * This line used to say "All 4 free" and "Lisa free", in hardcoded English. "Free" reads as
 * *no charge* on a page that also prints prices, which is the single ambiguity the copy review
 * called out first — it now says "available", and every fragment comes from `t`.
 */
function LiveStatusLine({
  membersLength,
  liveCount,
  freeName,
  freeCount,
  onDark,
  closed = false,
  closedLabel,
}: {
  membersLength: number;
  liveCount: number;
  freeName: string | null;
  freeCount: number;
  onDark?: boolean;
  closed?: boolean;
  closedLabel?: string;
}) {
  const muted = onDark ? "rgba(255,255,255,.7)" : "var(--text-muted)";
  const body = onDark ? "rgba(255,255,255,.92)" : "var(--text-body)";
  const freePhrase = onDark ? "rgba(255,255,255,.95)" : "var(--success)";

  // Outside business hours an idle floor is not an invitation. Anyone already queued is still
  // reported, because their place is real; an empty closed floor just says so.
  if (closed && liveCount === 0) {
    return <span style={{ color: muted }}>{closedLabel ?? t.microsite.wait.liveClosed}</span>;
  }
  if (membersLength === 0 || closed) {
    return (
      <span style={{ color: body }}>
        <LiveStatusNum onDark={onDark}>{liveCount}</LiveStatusNum>
        <span style={{ color: muted }}>{t.microsite.wait.liveOnWaitlist}</span>
      </span>
    );
  }
  if (liveCount === 0 && freeCount > 0) {
    return (
      <span style={{ color: body }}>
        <span style={{ font: "var(--fw-bold) 1em/1.35 var(--font-sans)", color: freePhrase }}>
          {t.microsite.wait.liveAllPrefix}
          <LiveStatusNum onDark={onDark}>{membersLength}</LiveStatusNum>
          {t.microsite.wait.liveAllSuffix}
        </span>
        <span style={{ color: muted }}>{t.microsite.wait.liveNoWait}</span>
      </span>
    );
  }
  if (freeName) {
    return (
      <span style={{ color: body }}>
        <span style={{ font: "var(--fw-semibold) 1em/1.35 var(--font-sans)", color: body }}>
          {format(t.microsite.wait.liveNameAvailable, { name: freeName })}
        </span>
        <span style={{ color: muted }}>{t.microsite.wait.liveSeparator}</span>
        <LiveStatusNum onDark={onDark}>{liveCount}</LiveStatusNum>
        <span style={{ color: muted }}>{t.microsite.wait.liveWaiting}</span>
      </span>
    );
  }
  return (
    <span style={{ color: body }}>
      <LiveStatusNum onDark={onDark}>{liveCount}</LiveStatusNum>
      <span style={{ color: muted }}>{t.microsite.wait.aheadShortest}</span>
    </span>
  );
}

type QueueStaffMember = {
  id: string;
  name: string;
  busy: boolean;
  count: number;
  wait: string;
};

const QUEUE_STAFF_PREVIEW = 6;

/**
 * Hero-card wait summary: shop-wide total as the big headline (swapped above the old
 * "Walk in now" line), then wait subline + staff-wise breakdown.
 *
 * Tickets with no seat (`staff_id` null — e.g. deleted staff ON DELETE SET NULL) still count
 * in `liveCount` but not on any staff row; those are surfaced as an "Any" line so the
 * breakdown always adds up to the headline total.
 */
function QueueWaitSummary({
  liveCount,
  members,
  closedHeadline,
  detail,
  walkInsClosed = false,
}: {
  liveCount: number;
  members: QueueStaffMember[];
  /** Closed with nobody queued: "Closed", shown in place of the count (status-copy.ts `card`). */
  closedHeadline: string | null;
  /** The line under the headline (status-copy.ts `card.detail`). */
  detail: string;
  walkInsClosed?: boolean;
}) {
  const freeCount = members.filter((m) => !m.busy).length;
  const assignedWaiting = members.reduce((n, m) => n + m.count, 0);
  const unassignedWaiting = Math.max(0, liveCount - assignedWaiting);
  const shown = members.slice(0, QUEUE_STAFF_PREVIEW);
  const overflow = members.length - shown.length;
  // A closed shop is never "clear": the old green "0 min wait" read as an invitation to walk in
  // while the badge two lines above said CLOSED TODAY. Anyone still queued is shown as waiting.
  const isClear = !walkInsClosed && liveCount === 0 && (members.length === 0 || freeCount > 0);

  const headline =
    closedHeadline ? (
      <span className="ttWaitCountLabel" style={{ font: "var(--fw-bold) 0.62em/1.1 var(--font-sans)", color: "var(--text-muted)" }}>
        {closedHeadline}
      </span>
    ) : members.length === 0 ? (
      <>
        <span className="ttWaitCountNum" style={{ fontVariantNumeric: "tabular-nums" }}>{liveCount}</span>
        <span className="ttWaitCountLabel" style={{ font: "var(--fw-bold) 0.55em/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-muted)", marginLeft: "0.28em" }}>
          {t.microsite.sections.waitingLabel}
        </span>
      </>
    ) : isClear ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "var(--success)",
            flexShrink: 0,
          }}
        />
        <span>
          <span className="ttWaitCountNum" style={{ fontVariantNumeric: "tabular-nums" }}>0</span>
          <span className="ttWaitCountLabel" style={{ font: "var(--fw-bold) 0.55em/1.1 var(--font-sans)", letterSpacing: "-.02em", marginLeft: "0.28em" }}>
            {t.microsite.sections.minWaitLabel}
          </span>
        </span>
      </span>
    ) : (
      <>
        <span className="ttWaitCountNum" style={{ fontVariantNumeric: "tabular-nums" }}>{liveCount}</span>
        <span className="ttWaitCountLabel" style={{ font: "var(--fw-bold) 0.55em/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-muted)", marginLeft: "0.28em" }}>
          {t.microsite.sections.waitingLabel}
        </span>
      </>
    );

  const row = (key: string, name: string, status: string, free: boolean) => (
    <li
      key={key}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        font: "var(--fw-medium) 14px/1.35 var(--font-sans)",
      }}
    >
      <span style={{ color: "var(--text-body)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
      <span
        style={{
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
          color: free ? "var(--success)" : "var(--text-muted)",
          font: free
            ? "var(--fw-semibold) 13.5px/1.35 var(--font-sans)"
            : "var(--fw-medium) 13.5px/1.35 var(--font-sans)",
        }}
      >
        {status}
      </span>
    </li>
  );

  return (
    <div className={`ttWaitSummary${isClear ? " ttWaitClear" : ""}`}>
      <div
        className="ttWaitCount"
        style={{
          font: "var(--fw-extrabold) clamp(24px, 3.4vw, 38px)/1.02 var(--font-sans)",
          letterSpacing: "-.035em",
          color: isClear ? "var(--success)" : walkInsClosed ? "var(--text-muted)" : "var(--text-strong)",
          // Clear floor: one number says everything, so centre it. Staff rows below stay
          // left/right aligned — they are a list, not a headline.
          textAlign: isClear || closedHeadline ? "center" : undefined,
        }}
      >
        {headline}
      </div>
      {/* When the floor is clear the big "0 est wait" already says it — the old pink
          "No wait right now" pill was the same sentence twice. Keep the pill only when it
          adds an ETA the headline does not already show. */}
      {/* Closed with nobody queued: "Opens tomorrow at 9:00 AM" is a sentence, not an ETA, so it
          sits as plain centred text under "Closed". The bordered ttWaitEstimate pill made it look
          like an input field. */}
      {closedHeadline && detail ? (
        <div
          style={{
            marginTop: 6,
            textAlign: "center",
            font: "var(--fw-semibold) clamp(16px, 4vw, 18px)/1.35 var(--font-sans)",
            color: "var(--text-body)",
          }}
        >
          {detail}
        </div>
      ) : !isClear && detail ? (
        <div
          className="ttWaitEstimate"
          style={{
            marginTop: 10,
            font: "var(--fw-semibold) clamp(16px, 4vw, 18px)/1.35 var(--font-sans)",
            color: "var(--text-body)",
          }}
        >
          {detail}
        </div>
      ) : null}
      {/* The breakdown says "Available" against every idle seat — true of the floor, false as an
          invitation once the doors are shut. Hidden whenever closed: it used to stay while anyone
          was still queued, which put a green "Available" under "Closed · Opens …" (row 27). */}
      {members.length > 0 && !walkInsClosed && (
        <ul
          style={{
            listStyle: "none",
            margin: "14px 0 0",
            padding: "12px 0 0",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {shown.map((m) => {
            const isFree = !m.busy && m.count === 0;
            return row(m.id, m.name, isFree ? t.microsite.wait.free : m.count > 0 ? format(t.microsite.wait.waitingCount, { count: m.count }) : m.wait, isFree);
          })}
          {unassignedWaiting > 0 && row("__any__", t.microsite.wait.any, format(t.microsite.wait.waitingCount, { count: unassignedWaiting }), false)}
          {overflow > 0 && (
            <li style={{ font: "var(--fw-medium) 13px/1.35 var(--font-sans)", color: "var(--text-subtle)" }}>
              {format(t.microsite.wait.moreCount, { count: overflow })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function staffWaitLabel(waitMinutes: number): string {
  return waitMinutes > 0 ? format(t.microsite.wait.minShort, { min: waitMinutes }) : t.microsite.sections.noWaitCell;
}

type View = "flow" | "already" | "blocked" | "left" | "track";
/** Screens within the join/book modal's "flow" view, in a fixed order. Which ones actually
 *  appear for a given business is computed dynamically (see `flowScreens` below) — e.g. the
 *  "visitor" screen only exists for Hospital-category businesses, "service" only when the
 *  business has services configured. */
type FlowScreen = "visitor" | "service" | "details" | "success";

export default function MicrositeClient({ initialSite }: { initialSite: Microsite }) {
  const site = initialSite;
  // Per-business localStorage namespace (see STORE_PREFIX) and the shop's real contact
  // number for the rate-limited "call the shop" view (was a hardcoded demo number).
  const storeKey = `${STORE_PREFIX}${site.slug}`;
  const shopPhone = site.phoneNumber ? formatPhone(combineToE164(site.countryCode ?? "", site.phoneNumber)) : null;
  const [menuOpen, setMenuOpen] = useState(false); // mobile hamburger dropdown
  const [saveOpen, setSaveOpen] = useState(false); // "Save contact" (vCard) sheet
  const [apptsOpen, setApptsOpen] = useState(false); // My appointments pop-up
  // The number My appointments opens pre-filled with, captured as it opens (never read from the
  // store ref during render).
  const [apptsPhone, setApptsPhone] = useState("");
  // Pictures are optional, and a stored URL is not proof of a picture (a deleted or unreachable
  // object 404s). Record the URL that failed — not a boolean — so the page falls back to the
  // no-image layout instead of a blank frame, and a later re-upload (a new URL) is tried afresh
  // without any reset logic.
  const [failedHeroUrl, setFailedHeroUrl] = useState<string | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const heroUrl = site.heroImageUrl && site.heroImageUrl !== failedHeroUrl ? site.heroImageUrl : null;
  const logoUrl = site.logoUrl && site.logoUrl !== failedLogoUrl ? site.logoUrl : null;
  // The hero is a CSS background, which has no onError — so probe it. Only the failure is
  // acted on; while it loads (or if the probe never resolves) the normal hero renders.
  useEffect(() => {
    const url = site.heroImageUrl;
    if (!url) return;
    const probe = new window.Image();
    probe.onerror = () => setFailedHeroUrl(url);
    probe.src = url;
    return () => {
      probe.onerror = null;
    };
  }, [site.heroImageUrl]);
  // Live vCard endpoint for this store. The backend rebuilds the .vcf from the current
  // business row on every request, so a saved contact always reflects the latest details.
  // `?open=1` serves it inline so a phone (tap, or scanning the desktop QR) opens the
  // Add-Contact card directly instead of downloading a file to open manually.
  const vcardUrl = `${API_BASE_URL}/public/businesses/${initialSite.slug}/vcard?open=1`;
  // Digits-only international number — same key as /{phone} and /{phone}/card.
  const phoneFull = `${initialSite.countryCode ?? ""}${initialSite.phoneNumber ?? ""}`;
  // Single mobile breakpoint (JS + inline styles) driving both the nav collapse and the
  // hero stacking — reliably applies via React rendering on every load and hot-reload.
  const isMobile = useMediaQuery("(max-width: 860px)");
  // True touch/handheld (phone / most tablets) vs a computer — decides whether "Save contact"
  // opens the /card chooser in-place or shows a QR to scan (computer).
  const [liveWait, setLiveWait] = useState(initialSite.live.waitMinutes);
  const [liveCount, setLiveCount] = useState(initialSite.live.queueCount);
  const [liveStaff, setLiveStaff] = useState<MicrositeStaff[]>(initialSite.staff ?? []);
  // Anchors for client-side wait decay between server/socket snapshots.
  const [liveAsOf, setLiveAsOf] = useState<string | null>(null);
  const [staffAsOf, setStaffAsOf] = useState<string | null>(null);

  const [joinOpen, setJoinOpen] = useState(false);
  const [mode, setMode] = useState<"queue" | "book">("queue");
  const [view, setView] = useState<View>("flow");
  const [screen, setScreen] = useState<FlowScreen>("details");
  const [tstep, setTstep] = useState(1); // Track-my-turn sub-step: 1 phone → 3 not-found
  /**
   * The services chosen for this visit, in pick order. A visit is routinely more than one thing
   * ("haircut AND a hair spa"), and picking one used to silently drop the rest: the shop sized
   * the visit by the first service and rang up its price alone.
   *
   * Order is load-bearing — the first pick becomes the entry's primary service on the API side.
   */
  const [cart, setCart] = useState<string[]>([]);
  const toggleService = (id: string) =>
    setCart((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [visitorType, setVisitorType] = useState<"mr" | "patient" | null>(null);
  const [name, setName] = useState("");
  // Phone entry is split into a searchable country code + national number. `phone`
  // (E.164, e.g. +919824410712) is derived and remains the single value used for
  // storage, dedup and every API call, so the rest of the flow is unchanged.
  const [phoneCountry, setPhoneCountry] = useState<{ dialCode: string; iso2: string }>({
    dialCode: DEFAULT_DIAL_CODE,
    iso2: DEFAULT_ISO2,
  });
  const [national, setNational] = useState("");
  const phone = combineToE164(phoneCountry.dialCode, national);
  // Seed the picker from a stored full number (held / lastPhone restore).
  const seedPhone = (raw: string) => {
    const parts = splitPhone(raw);
    setPhoneCountry({ dialCode: parts.dialCode, iso2: parts.iso2 });
    setNational(parts.national);
  };
  const [member, setMember] = useState("any");
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // One unchecked box covers all three texts (confirmation, reminder, review request). The API
  // stores appointment and review consent as separate flags; this box sets both.
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  /**
   * The day being booked, YYYY-MM-DD. Booking used to be today-only, which bites hardest exactly
   * when someone is most likely to be looking: late in the day, when today has one slot left and
   * the customer's actual intent is "sometime this week".
   */
  const [bookDate, setBookDate] = useState<string>(() => localYmd(new Date()));
  /**
   * Guards against out-of-order slot responses. Tapping through days faster than the network
   * answers would otherwise let an earlier request land last and paint the wrong day's times.
   */
  const slotReq = useRef(0);
  /**
   * "Repeat this booking?" (docs/recurring-appointments.md). Only offered when the store allows it
   * and only once a time is picked; "Just this once" stays the default on every open.
   */
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>("once");
  const [customDays, setCustomDays] = useState(DEFAULT_CUSTOM_DAYS);
  const [endChoice, setEndChoice] = useState<RepeatEndChoice>("count");
  const [endCount, setEndCount] = useState(DEFAULT_END_COUNT);
  const [endDate, setEndDate] = useState("");
  /**
   * The last preview the API answered, tagged with the request it answers. Rendering compares the
   * tag with the current rule, so a stale answer (the customer changed the rule while it was in
   * flight) is simply never shown — no effect has to clear it.
   */
  const [preview, setPreview] = useState<{ key: string; data: SeriesPreview | null; error: string } | null>(null);
  const previewSeq = useRef(0);
  const resetRepeat = () => {
    setRepeatChoice("once");
    setCustomDays(DEFAULT_CUSTOM_DAYS);
    setEndChoice("count");
    setEndCount(DEFAULT_END_COUNT);
    setEndDate("");
  };
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [booking, setBooking] = useState<{
    serviceName: string | null;
    staffName: string | null;
    scheduledStartAt: string;
    series?: BookedSeries;
    /** The rule has dates beyond the ones booked now (the job books them ~3 weeks ahead). */
    moreToCome?: boolean;
  } | null>(null);
  const [justTurn, setJustTurn] = useState(false);
  const [initialAhead, setInitialAhead] = useState(0);
  // Wall-clock tick that drives the live countdown. null until mount (keeps SSR/first paint equal
  // to the server value — no hydration mismatch); then updated every 15s while a ticket is active.
  const [nowTs, setNowTs] = useState<number | null>(null);

  const [etaNotice, setEtaNotice] = useState<{ min: number; at: number } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leftMsg, setLeftMsg] = useState("");
  const [held, setHeld] = useState<HeldRecord | null>(null);
  // True once the restore below has settled `held` either way. `held` alone cannot say so: it is
  // null both before the restore's ticket fetch returns and after it finds nothing. A pop-up opened
  // from the link (?open=checkin) waits for this, or someone already in line would be handed a
  // fresh Check in instead of "you're already in line".
  const [restored, setRestored] = useState(false);
  // Name pulled from the track lookup (returning customer) to pre-fill Join.
  const [trackedName, setTrackedName] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const ticketPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const availabilityPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep latest slug for interval/socket callbacks without writing a ref during render
  // (react-hooks/refs). Polls started once still read the current value on each tick.
  const siteSlugRef = useRef(site.slug);
  useEffect(() => {
    siteSlugRef.current = site.slug;
  }, [site.slug]);
  const storeRef = useRef<Store>(defaultStore());


  // ---- realtime: availability (+ poll fallback when socket is down) ----
  const stopTicketPoll = () => {
    if (ticketPoll.current) clearInterval(ticketPoll.current);
    ticketPoll.current = null;
  };
  const clearHold = () => {
    const store = storeRef.current;
    store.hold = null;
    writeStore(storeKey, store);
    setHeld(null);
  };

  const stopAvailabilityPoll = () => {
    if (availabilityPoll.current) {
      clearInterval(availabilityPoll.current);
      availabilityPoll.current = null;
    }
  };

  const fetchLiveSnapshot = () => {
    const slug = siteSlugRef.current;
    publicApi
      .getAvailability(slug)
      .then((a) => {
        setLiveWait(a.waitMinutes);
        setLiveCount(a.queueCount);
        setLiveAsOf(new Date().toISOString());
      })
      .catch(() => {});
    publicApi
      .getStaffAvailability(slug)
      .then((r) => {
        setLiveStaff(r.staff);
        setStaffAsOf(new Date().toISOString());
      })
      .catch(() => {});
  };

  /** HTTP fallback while the customer socket is down. Idempotent — connect_error may fire often. */
  const startAvailabilityPoll = () => {
    if (availabilityPoll.current) return;
    fetchLiveSnapshot();
    availabilityPoll.current = setInterval(fetchLiveSnapshot, 15000);
  };

  const bindSocket = (s: Socket) => {
    s.on("connect", () => stopAvailabilityPoll());
    s.on("disconnect", () => startAvailabilityPoll());
    s.on("connect_error", () => startAvailabilityPoll());
    s.on("availability:updated", (d: { waitMinutes: number; queueCount: number }) => {
      setLiveWait(d.waitMinutes);
      setLiveCount(d.queueCount);
      setLiveAsOf(new Date().toISOString());
    });
    s.on("staff:availability", (d: { staff: MicrositeStaff[] }) => {
      if (d.staff) {
        setLiveStaff(d.staff);
        setStaffAsOf(new Date().toISOString());
      }
    });
    s.on("ticket:updated", (d: { ahead: number; waitMinutes: number; serviceRemainingMinutes?: number; status: string; isYourTurn?: boolean; at?: string }) => {
      setTicket((prev) =>
        prev
          ? {
              ...prev,
              ahead: d.ahead,
              waitMinutes: d.waitMinutes,
              serviceRemainingMinutes: d.serviceRemainingMinutes,
              status: d.status,
              // Re-anchor the countdown to this push (emitter stamps `at`); fall back to receipt time.
              asOf: d.at ?? new Date().toISOString(),
            }
          : prev,
      );
      setNowTs(Date.now());
      if (d.isYourTurn) setJustTurn(true);
      if (d.status === "in_service") setConfirmLeave(false);
      // Terminal states normally arrive via ticket:cancelled/ticket:completed, but if an
      // update ever carries a non-active status, treat the entry as gone.
      if (!isActive(d.status)) {
        setJustTurn(false);
        stopTicketPoll();
        clearHold();
      }
    });
    s.on("ticket:ready", () => {
      setJustTurn(true);
      setTicket((prev) => (prev ? { ...prev, ahead: 0, isYourTurn: true } : prev));
    });
    s.on("ticket:cancelled", () => {
      setTicket((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      setJustTurn(false);
      stopTicketPoll();
      clearHold();
    });
    s.on("ticket:completed", () => {
      setTicket((prev) => (prev ? { ...prev, status: "completed", ahead: 0 } : prev));
      setJustTurn(false);
      stopTicketPoll();
      clearHold();
    });
    // One-shot per ticket, server-side (notified_eta_15_at). The page had no listener; the chat
    // now turns it into "about 15 min until your turn".
    s.on("ticket:eta_15", (d: { waitMinutes?: number }) => {
      setEtaNotice({ min: typeof d.waitMinutes === "number" ? d.waitMinutes : 15, at: Date.now() });
    });
  };

  /**
   * Every openSocket call bumps this. The socket module is fetched lazily, so a second call can
   * land while the first is still importing — without the generation check the older connection
   * would win and the visitor would be subscribed to the wrong ticket.
   */
  const socketGen = useRef(0);

  const openSocket = (auth: CustomerAuth) => {
    const gen = ++socketGen.current;
    const prev = socketRef.current;
    if (prev) {
      // Drop listeners before close so intentional reconnects don't trip the poll fallback.
      prev.removeAllListeners();
      prev.close();
      socketRef.current = null;
    }
    // socket.io-client + engine.io is ~150KB and nothing on the first screen needs it: the live
    // numbers arrive from fetchLiveSnapshot() and the poll fallback already covers the gap. So
    // it is imported on demand, keeping it out of the chunk that blocks hydration.
    void import("@/lib/socket").then(({ connectCustomer }) => {
      if (gen !== socketGen.current) return; // superseded while loading
      const s = connectCustomer(auth);
      bindSocket(s);
      socketRef.current = s;
    });
  };

  // ---- ticket polling (fallback to socket) ----
  const startTicketPoll = (id: string) => {
    stopTicketPoll();
    ticketPoll.current = setInterval(() => {
      publicApi
        .getTicket(id)
        .then((t) => {
          setTicket((prev) => (prev ? { ...prev, ...t } : t));
          if (t.isYourTurn) setJustTurn(true);
          if (!isActive(t.status)) {
            stopTicketPoll();
            clearHold();
          }
        })
        .catch(() => {});
    }, 5000);
  };

  useEffect(() => {
    openSocket({ businessId: site.id });
    // One-shot so first paint is fresh before any socket push; ongoing polls only when socket is down.
    fetchLiveSnapshot();
    return () => {
      stopAvailabilityPoll();
      // Invalidate any import still resolving, so it cannot attach after unmount.
      socketGen.current += 1;
      const s = socketRef.current;
      if (s) {
        s.removeAllListeners();
        s.close();
      }
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  // ---- live countdown tick (ticket pill + staff/shop wait decay between server updates) ----
  const ticketActive = !!ticket && isActive(ticket.status);
  const needsClock = ticketActive || liveWait > 0 || liveStaff.some((s) => s.waitMinutes > 0);
  useEffect(() => {
    if (!needsClock) return;
    // Kick off the first tick asynchronously — sync setState in an effect trips
    // react-hooks/set-state-in-effect and forces an extra cascading render.
    const first = setTimeout(() => setNowTs(Date.now()), 0);
    const id = setInterval(() => setNowTs(Date.now()), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [needsClock]);

  // ---- restore a held ticket (resume pill / "already in line") ----
  useEffect(() => {
    const store = readStore(storeKey);
    storeRef.current = store;
    if (!store.hold) {
      // Asynchronously, like the clock tick above: a sync setState here trips
      // react-hooks/set-state-in-effect.
      const id = setTimeout(() => setRestored(true), 0);
      return () => clearTimeout(id);
    }
    const rec = store.hold;
    publicApi
      .getTicket(rec.ticketId)
      .then((t) => {
        // In the same callback as setHeld, so both land in one render — the link's pop-up then
        // sees the restored `held`.
        setRestored(true);
        if (!isActive(t.status)) {
          clearHold();
          return;
        }
        setHeld(rec);
        setTicket(t);
        setInitialAhead(t.ahead);
        setJustTurn(!!t.isYourTurn);
        openSocket({ businessId: rec.businessId || site.id, ticketId: rec.ticketId, ticketKey: rec.ticketKey });
        startTicketPoll(rec.ticketId);
      })
      .catch((e) => {
        setRestored(true);
        if (e instanceof ApiError && e.status === 404) clearHold();
        // other (network) errors: keep the record optimistically, don't restore live state
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  useEffect(
    () => () => {
      if (ticketPoll.current) clearInterval(ticketPoll.current);
    },
    [],
  );

  // ---- derived data ----
  const curSym = currencySymbol(site.currency);
  const rupeeLabel = (amountPaise: number) => `${curSym}${Math.round(amountPaise / 100)}`;
  /**
   * One label per service, built once here so no call site can reintroduce a bare
   * `${curSym}${number}`.
   *
   * The store now says which of three things a price is, instead of every surface guessing
   * from a zero. A **fixed** service shows its amount. A **range** shows the band the shop
   * committed to — the final figure is settled at the counter, not on this page. A service
   * nobody has priced renders NOTHING (an empty label): price is optional, so the page asks for
   * and shows as little as the store gave it. It used to render as "$0", which told every
   * customer it was free — the empty label is what keeps that from coming back. A response
   * cached from before pricing modes carries no `priceType`, and the old rule (a real amount is
   * a fixed price) still reads it correctly.
   */
  const priceLabelFor = (sv: { price: { amount: number }; priceType?: string; priceMax?: { amount: number } | null }) => {
    const type = sv.priceType ?? (sv.price.amount > 0 ? "fixed" : "unset");
    if (type === "range" && sv.priceMax) {
      return format(t.microsite.sections.priceRange, {
        min: rupeeLabel(sv.price.amount),
        max: rupeeLabel(sv.priceMax.amount),
      });
    }
    if (type === "unset" || sv.price.amount <= 0) return "";
    return rupeeLabel(sv.price.amount);
  };
  const services = (site.services ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    dur: `${s.durationMinutes} min`,
    priceLabel: priceLabelFor(s),
    // Raw values kept alongside the rendered label: a multi-service visit has to SUM durations
    // and prices, which a formatted string cannot do.
    durationMinutes: s.durationMinutes,
    price: s.price,
    priceType: s.priceType,
    priceMax: s.priceMax ?? null,
  }));

  // ---- open / closed ----
  // Business hours are the only open/closed signal the API has, so a store that never configured
  // them reports isOpen:false forever. Treat "no hours" as unknown and leave the walk-in flow
  // live — gating on the raw flag alone would silently switch check-in off for every such store.
  const hasHours = site.hours.length > 0;
  const walkInsClosed = hasHours && !site.openStatus.isOpen;
  // Greyed in My appointments' time picker, gated on hours the same way the booking strip is.
  // Memoised: the picker's day strip is built from it.
  const closedWeekdays = useMemo(
    () => (hasHours ? site.hours.filter((h) => h.isClosed).map((h) => h.dayOfWeek) : []),
    [site.hours, hasHours],
  );
  const nextOpenLabel = site.openStatus.nextOpenLabel ?? null;

  /**
   * The bookable days, starting today.
   *
   * Weekdays the store never opens are shown greyed rather than hidden, so the strip reads as a
   * calendar ("closed Sundays") instead of silently skipping a date the customer was looking for.
   * `hasHours` gates that the same way the walk-in controls are gated: a store that never
   * configured hours reports every day closed, and hiding every date would leave nothing to book.
   *
   * Rendered only inside the modal, which cannot be open during SSR — so `new Date()` here can
   * never produce a server/client hydration mismatch.
   */
  // Built from the viewer's clock (lib/booking-days.ts) — the repeating-booking picker uses the
  // store-day builder next to it instead.
  const bookDays = useMemo(() => viewerBookDays(BOOKING_DAYS_AHEAD, site.hours, hasHours), [site.hours, hasHours]);
  const selectedDay = bookDays.find((d) => d.ymd === bookDate) ?? bookDays[0];

  // ---- "Repeat this booking?" (docs/recurring-appointments.md §1.1) ----
  // Booking only (a walk-in cannot repeat), and only where the store allows it. The API refuses a
  // repeat from a store that switched it off anyway; hiding it here just avoids offering it.
  const repeatOffered = mode === "book" && !!site.recurringEnabled;
  const repeatEveryDays =
    repeatChoice === "once"
      ? null
      : repeatChoice === "custom"
        ? /^\d+$/.test(customDays.trim())
          ? Number(customDays.trim())
          : NaN
        : Number(repeatChoice);
  const everyDaysValid =
    repeatEveryDays !== null &&
    Number.isInteger(repeatEveryDays) &&
    repeatEveryDays >= REPEAT_LIMITS.minEveryDays &&
    repeatEveryDays <= REPEAT_LIMITS.maxEveryDays;
  // The first visit is on the picked day; "today" is the strip's first day. Both are local
  // YYYY-MM-DD, and every bound below is plain calendar arithmetic on them — the server re-checks
  // with the store's own clock and its message wins if the two ever disagree.
  const todayYmd = bookDays[0]?.ymd ?? bookDate;
  const endDateMax = addDaysYmd(todayYmd, REPEAT_LIMITS.maxEndDays);
  const endDateMin = addDaysYmd(bookDate, everyDaysValid ? repeatEveryDays! : REPEAT_LIMITS.minEveryDays);
  const repeatDaysError = repeatEveryDays !== null && !everyDaysValid ? t.microsite.repeat.errCustomDays : "";
  const endCountNum = /^\d+$/.test(endCount.trim()) ? Number(endCount.trim()) : NaN;
  const repeatEndError =
    !everyDaysValid
      ? ""
      : endChoice === "count"
        ? Number.isInteger(endCountNum) && endCountNum >= REPEAT_LIMITS.minCount && endCountNum <= REPEAT_LIMITS.maxCount
          ? ""
          : t.microsite.repeat.errCount
        : endChoice === "until"
          ? !endDate
            ? t.microsite.repeat.errEndDateMissing
            : endDate < endDateMin
              ? t.microsite.repeat.errEndDateTooSoon
              : endDate > endDateMax
                ? t.microsite.repeat.errEndDateTooFar
                : ""
          : "";
  /** What the booking will send as `repeat`, or null for a single visit (or a rule still being typed). */
  const repeatRule: RepeatRule | null =
    repeatOffered && everyDaysValid && !repeatEndError
      ? {
          everyDays: repeatEveryDays!,
          end:
            endChoice === "count"
              ? { type: "count", count: endCountNum }
              : endChoice === "until"
                ? { type: "until", date: endDate }
                : { type: "never" },
        }
      : null;
  /** A repeat was asked for but the rule is not complete — Confirm waits rather than booking a single visit. */
  const repeatIncomplete = repeatOffered && repeatChoice !== "once" && !repeatRule;
  // Only a multiple of 7 keeps landing on the same weekday; people otherwise expect "every 18 days"
  // to stay on a Saturday.
  const weekdayDrifts = repeatChoice === "custom" && everyDaysValid && repeatEveryDays! % 7 !== 0;
  /** Picking "On [date]" with no date yet pre-fills the date six visits out — the same reach as the "after 6" default. */
  const chooseUntil = () => {
    setEndChoice("until");
    if (endDate) return;
    const guess = addDaysYmd(bookDate, (everyDaysValid ? repeatEveryDays! : 14) * (Number(DEFAULT_END_COUNT) - 1));
    setEndDate(guess > endDateMax ? endDateMax : guess);
  };
  /** The preview request, serialised: the effect keys on it and the answer is tagged with it. */
  const previewKey =
    repeatRule && selectedSlot
      ? JSON.stringify({
          serviceIds: cart.length ? cart : undefined,
          preferredStaffId: member,
          slotStart: selectedSlot,
          repeat: repeatRule,
        })
      : null;
  useEffect(() => {
    if (!previewKey) return;
    const seq = ++previewSeq.current;
    // Debounced: typing "21" into the custom box is two rules, and only the last one matters.
    const timer = setTimeout(() => {
      publicApi
        .previewSeries(site.slug, JSON.parse(previewKey))
        .then((data) => {
          if (previewSeq.current === seq) setPreview({ key: previewKey, data, error: "" });
        })
        .catch((e) => {
          if (previewSeq.current !== seq) return;
          // A 400 here carries a customer-readable reason ("…room for at least two visits"); a
          // network failure does not, and must not stop them booking.
          setPreview({ key: previewKey, data: null, error: e instanceof ApiError ? e.message : t.microsite.repeat.previewError });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [previewKey, site.slug]);
  const currentPreview = previewKey && preview?.key === previewKey ? preview : null;
  const previewLoading = !!previewKey && !currentPreview;

  /** "Check in instead" only makes sense for today, and only while the doors are actually open. */
  const canOfferWalkIn = !walkInsClosed && bookDate === bookDays[0]?.ymd;
  // Which screens the join/book modal shows, in order — computed per-business so the
  // progress bar and navigation stay correct regardless of which optional screens apply.
  const isHospital = site.category === "Hospital";
  const flowScreens: FlowScreen[] = [
    ...(isHospital ? (["visitor"] as const) : []),
    ...(services.length > 0 ? (["service"] as const) : []),
    "details",
    "success",
  ];
  const goNext = async (from: FlowScreen) => {
    const i = flowScreens.indexOf(from);
    const next = flowScreens[i + 1];
    if (!next) return;
    setScreen(next);
    setFormError("");
    if (next === "details" && mode === "book") await fetchSlots(cart, bookDate, member);
  };
  const goBack = (from: FlowScreen) => {
    const i = flowScreens.indexOf(from);
    const prev = flowScreens[i - 1];
    if (prev) setScreen(prev);
  };
  const members = liveStaff.map((s, i) => {
    const waitMin = displayStaffWaitMinutes(s.waitMinutes, staffAsOf, nowTs);
    return {
      id: s.id,
      name: s.name,
      role: s.roleLabel ?? "",
      photo: s.avatarUrl,
      busy: s.busy,
      count: s.queueCount,
      wait: staffWaitLabel(waitMin),
      waitMin,
      avBg: AVATAR_COLORS[i % AVATAR_COLORS.length],
    };
  });
  const amenities = site.amenities ?? [];
  const gallery = site.gallery ?? [];
  const faqs = Array.isArray(site.faqs) ? site.faqs : [];
  const reviews = Array.isArray(site.reviews) ? site.reviews : [];

  // The example store (/demo-store) showcases every photo slot as a blank placeholder frame,
  // even when no image is set — so operators see where photos go. Scoped to that one slug only.
  const isDemo = site.slug === "demo-store";
  // Where the store is, as the page says it: the neighborhood, or the city when the owner left the
  // neighborhood blank (optional since the client review of 2026-10-05).
  const place = site.area?.trim() || site.city?.trim() || null;

  // Render each About piece only when it has real content; collapse the section otherwise.
  const hasHeading = !!site.aboutHeading?.trim();
  const hasDescription = !!site.description?.trim();
  const hasAmenities = amenities.length > 0;
  const hasAboutText = hasHeading || hasDescription || hasAmenities;
  const hasAboutImage = !!site.aboutImageUrl;
  const showAbout = hasAboutText || hasAboutImage || isDemo;
  const rating = site.rating ?? 0;
  const reviewCount = site.reviewCount ?? 0;

  // ---- modal control ----
  const openJoin = (m: "queue" | "book", preselectMember = "any") => {
    setMode(m);
    setConfirmLeave(false);
    setFormError("");
    const store = storeRef.current;
    const lp = store.lastPhone;
    // The walk-in block (join → leave, repeatedly) guards the LINE only — booking stays open.
    if (m === "queue" && lp && store.blocked[lp]) {
      seedPhone(lp);
      setView("blocked");
      setJoinOpen(true);
      return;
    }
    // One live place per number applies to the WALK-IN line only. A ticket for today used to block
    // Book as well, which left someone already waiting unable to book next week's visit — the two
    // are unrelated, and the chat's Book allows it too (docs/customer-chatbot-booking.md).
    if (held && m === "queue") {
      seedPhone(held.phone);
      setName(held.name);
      setView("already");
      setJoinOpen(true);
      return;
    }
    setView("flow");
    // Jump straight to the first screen this business actually needs — visitor-type and/or
    // service picking are skipped entirely when they don't apply (see flowScreens above).
    const firstScreen = flowScreens[0];
    setScreen(firstScreen);
    setCart([]);
    setVisitorType(null);
    setName(store.lastName || "");
    seedPhone(lp || "");
    setMember(preselectMember);
    // Booking while holding a walk-in ticket must not wipe that ticket's live state — the resume
    // pill and the chat's ticket card both read it.
    if (!held) {
      setTicket(null);
      setJustTurn(false);
    }
    setBooking(null);
    setSlots([]);
    setSelectedSlot(null);
    setSmsOptIn(false);
    // Back to "Just this once" on every open: a rhythm left over from the last booking must never
    // turn the next one into a series the customer did not choose.
    resetRepeat();
    // Every open starts on today; a date left over from a previous booking would silently send
    // the next customer to last week.
    const openingDate = localYmd(new Date());
    setBookDate(openingDate);
    setJoinOpen(true);
    if (firstScreen === "details" && m === "book") fetchSlots([], openingDate, preselectMember);
  };
  // Every walk-in control is disabled or re-pointed while the shop is closed; these two are the
  // backstop for a page left open past closing time, so a stale render cannot mint a token that
  // nobody is there to serve.
  const openQueue = () => openJoin(walkInsClosed ? "book" : "queue");
  const openBook = () => openJoin("book");
  // The provider survives the switch: openJoin seeds `member`, so "Book with Sneha" on a closed
  // store opens the appointment flow with Sneha already selected rather than dropping the choice.
  const openWith = (memberId: string) => openJoin(walkInsClosed ? "book" : "queue", memberId);

  // ---- Save contact ----
  // The sheet now opens on every device rather than handheld jumping straight to the chooser.
  // A phone visitor asked for the QR: it is how you hand the shop to the person next to you.
  // Saving to your OWN phone is the button inside the sheet, which runs openCardChooser — the
  // exact navigation handheld used to do immediately, so that path is unchanged.
  const openCardChooser = () => {
    if (!phoneFull) {
      window.location.href = vcardUrl;
      return;
    }
    window.location.href = `/${phoneFull}/card`;
  };
  const onSaveContact = () => setSaveOpen(true);

  // ---- Track my turn (look up an existing ticket by phone, e.g. from another browser) ----
  const openTrack = () => {
    setMode("queue");
    setConfirmLeave(false);
    setFormError("");
    // Same browser: if we already hold a live ticket locally, jump straight to it.
    if (held) {
      seedPhone(held.phone);
      setName(held.name);
      setView("already");
      setJoinOpen(true);
      return;
    }
    seedPhone(storeRef.current.lastPhone || "");
    setTstep(1);
    setView("track");
    setJoinOpen(true);
  };
  /**
   * Adopt a live ticket as this browser's hold: page state, the localStorage record (so a reload
   * restores it), the ticket socket room and the poll. The one place a ticket becomes "held" —
   * after a join, and after a phone lookup finds one — shared by the pop-up and the chat.
   */
  const holdTicket = (tk: Ticket, p: string, holderName: string) => {
    setTicket(tk);
    setInitialAhead(tk.ahead);
    setJustTurn(!!tk.isYourTurn);
    const store = storeRef.current;
    store.hold = {
      phone: p,
      name: holderName,
      ticketId: tk.ticketId,
      ticketKey: tk.socket?.ticketKey ?? "",
      businessId: tk.socket?.businessId ?? site.id,
      token: tk.token,
    };
    writeStore(storeKey, store);
    setHeld(store.hold);
    if (tk.socket) openSocket({ businessId: tk.socket.businessId, ticketId: tk.ticketId, ticketKey: tk.socket.ticketKey });
    startTicketPoll(tk.ticketId);
  };
  /** Waitlist status by phone (pop-up Track + chat "My waitlist status"). Throws ApiError. */
  const trackPhone = async (p: string, fallbackName: string) => {
    const r = await publicApi.trackByPhone(site.slug, { phone: p });
    const store = storeRef.current;
    store.lastPhone = p;
    const knownName = r.customerName ?? "";
    setTrackedName(knownName);
    if (knownName) store.lastName = knownName;
    // Persist the hold so THIS browser now also restores on reload.
    if (r.found) holdTicket(r, p, store.lastName || fallbackName);
    else writeStore(storeKey, store);
    return r;
  };
  // Track lookup: enter phone → show the live slot, or the "not found" screen (tstep 3).
  const runTrack = async () => {
    if (phone.replace(/\D/g, "").length < 4) {
      setFormError(t.microsite.join.errNoPhone);
      return;
    }
    const p = phone.trim();
    setSubmitting(true);
    setFormError("");
    try {
      const r = await trackPhone(p, name.trim());
      if (r.found) setView("already");
      else setTstep(3);
    } catch (e) {
      setFormError((e as Error)?.message ?? t.microsite.join.errGeneric);
    } finally {
      setSubmitting(false);
    }
  };
  // From the Track "no active booking" screen: carry the phone + known name into a
  // fresh Join; only service selection is left.
  const joinAfterTrack = () => {
    // Same gate as every other walk-in entry point: a closed store gets the booking flow.
    setMode(walkInsClosed ? "book" : "queue");
    setView("flow");
    setScreen(flowScreens[0]);
    setCart([]);
    setVisitorType(null);
    setMember("any");
    setName(trackedName || storeRef.current.lastName || "");
    seedPhone(storeRef.current.lastPhone || "");
    setFormError("");
    setBooking(null);
    setJustTurn(false);
    setConfirmLeave(false);
    setSlots([]);
    setSelectedSlot(null);
    setBookDate(localYmd(new Date()));
    setCart([]);
    resetRepeat();
  };

  // ---- My appointments (docs/customer-my-appointments.md) ----
  /**
   * Phone lookups, for the life of this page. CLIENT DECISION 2026-10-05: the phone number alone is
   * enough to see, move and cancel appointments, so a lookup hands back every booking's key and the
   * series manage token.
   *
   * SECURITY: they stay HERE, in memory — never in localStorage. Written there, they would hand the
   * next person on a shared browser the previous person's bookings without typing anything. Held
   * per number so reopening the pop-up (or asking the chat) does not spend another lookup — it is
   * publicWrite, 20/hour per network. Both start from a number, like Check Waitlist Status, and
   * show only that number's bookings. The waitlist lookup (Track) is untouched: it still never
   * returns a ticket key.
   */
  const lookupMem = useRef(new Map<string, AppointmentLookup>());
  /**
   * Keys of bookings made on this page, so the chat's "Cancel" on the booking it just made works.
   * Memory only, for the same reason as lookupMem.
   */
  const bookedKeys = useRef(new Map<string, string>());
  const lookupApptsByPhone = async (p: string): Promise<AppointmentLookup> => {
    const remember = () => {
      // The number is remembered, like Track does — never anything the lookup returned. Also on a
      // memory hit: switching back to a number already looked up makes it the one the next open
      // (and the chat's "Use +91…?") offers.
      const store = storeRef.current;
      if (store.lastPhone === p) return;
      store.lastPhone = p;
      writeStore(storeKey, store);
    };
    const hit = lookupMem.current.get(p);
    if (hit) {
      remember();
      return hit;
    }
    const r = await publicApi.lookupAppointments(site.slug, { phone: p });
    // Normalised once (an older backend sends no `series`) so every reader can rely on both lists.
    const res: AppointmentLookup = { appointments: r.appointments ?? [], series: r.series ?? [] };
    lookupMem.current.set(p, res);
    remember();
    return res;
  };
  /** Drop a booking from every held lookup — it was cancelled, so no list may offer it again. */
  const dropFromLookups = (id: string) => {
    for (const [p, r] of lookupMem.current) {
      lookupMem.current.set(p, { ...r, appointments: r.appointments.filter((a) => a.appointmentId !== id) });
    }
  };
  /** The key that opens a booking: one made on this page, else a held lookup. Never from storage. */
  const apptKeyFor = (id: string): string | undefined =>
    bookedKeys.current.get(id) ??
    [...lookupMem.current.values()].flatMap((r) => r.appointments).find((a) => a.appointmentId === id)?.appointmentKey;
  const openMyAppts = () => {
    setMenuOpen(false);
    setApptsPhone(storeRef.current.lastPhone || "");
    setApptsOpen(true);
  };

  // Booking → waitlist without losing the form. Only offered when the store is open AND the
  // selected day is today — "join the queue now" is meaningless while browsing next Tuesday.
  // `mode` drives validation and submission, so nothing else has to move.
  const switchToWaitlist = () => {
    setMode("queue");
    setSelectedSlot(null);
    setFormError("");
  };

  const closeJoin = () => {
    setJoinOpen(false);
    setConfirmLeave(false);
    // Keep the live ticket socket + poll alive when we still hold a ticket, so the
    // resume pill stays current; otherwise fall back to the availability-only socket.
    if (!held) {
      stopTicketPoll();
      openSocket({ businessId: site.id });
    }
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const toggleFaq = (i: number) => setFaqOpen((cur) => (cur === i ? null : i));
  // The help chat's suggested buttons land on the page's own flows — the widget itself never
  // calls a mutating endpoint. "faq" simply scrolls to the Q&A the answer pointed at.
  // "appts" (a cancel / reschedule question) opens My appointments, which can move as well as cancel.
  const onChatAction = (type: string) => {
    if (type === "join") openQueue();
    else if (type === "book") openBook();
    else if (type === "track") openTrack();
    else if (type === "appts") openMyAppts();
    else document.getElementById("faq")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /**
   * Load the bookable times for one day.
   *
   * Takes its date, service and provider as ARGUMENTS rather than reading state: every caller
   * fires from the same event that changes one of them, and React state is not updated yet at
   * that point — reading `bookDate` here would fetch the previous day.
   *
   * `staffId` narrows availability to a named provider's chair; "no preference" leaves it off so
   * the customer sees every time the shop could take them.
   */
  const fetchSlots = async (serviceIds: string[], date: string, staffId: string) => {
    const req = ++slotReq.current;
    setSlotsLoading(true);
    setSelectedSlot(null);
    try {
      const r = await publicApi.getSlots(site.slug, {
        date,
        // The whole selection: a haircut + spa needs a 90-minute hole, not a 30-minute one.
        serviceIds: serviceIds.length ? serviceIds : undefined,
        staffId: staffId && staffId !== "any" ? staffId : undefined,
      });
      // A newer day/provider was picked while this was in flight — its response is the truth.
      if (slotReq.current !== req) return;
      setSlots(r.slots);
    } catch {
      if (slotReq.current === req) setSlots([]);
    } finally {
      if (slotReq.current === req) setSlotsLoading(false);
    }
  };

  // ---- open a pop-up from the link (an Instagram ad's ?instagram, or ?open=checkin|book) ----
  // Through openQueue/openBook, so the link gets exactly what the buttons give: a closed store's
  // Check in becomes Book, someone already in line sees that, a blocked number sees the block.
  // The intent lives in a ref, read once, and the keys leave the address bar as it is read: React's
  // development double-run would otherwise read an already-cleaned URL the second time and open
  // nothing (the homepage's ?join=1 effect has that flaw). Waiting on `restored` is what makes
  // `held` current in the openQueue this render hands the timer.
  // Declared below fetchSlots on purpose: openJoin calls it, and an effect reaching a function
  // declared after it fails react-hooks/immutability.
  const linkIntent = useRef<OpenIntent | null | undefined>(undefined);
  useEffect(() => {
    if (!restored) return;
    if (linkIntent.current === undefined) {
      const { pathname, search, hash } = window.location;
      linkIntent.current = readOpenIntent(search);
      // history.state, not {}: it carries the Next.js router's own entry.
      if (linkIntent.current) window.history.replaceState(window.history.state, "", pathname + stripOpenIntent(search) + hash);
    }
    const intent = linkIntent.current;
    if (!intent) return;
    const id = setTimeout(() => {
      linkIntent.current = null;
      if (intent === "book") openBook();
      else openQueue();
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // Returns true (and shows the blocked view) if this phone is locally rate-limited.
  const blockGuard = (p: string) => {
    const store = storeRef.current;
    if (store.blocked[p] || (store.attempts[p] || 0) >= BLOCK_AT) {
      store.blocked[p] = true;
      store.lastPhone = p;
      writeStore(storeKey, store);
      setView("blocked");
      return true;
    }
    return false;
  };
  // Shared Step 2 validation (name + phone, plus a slot when booking).
  const detailsInvalid = () => {
    if (!name.trim() || phone.replace(/\D/g, "").length < 4) {
      setFormError(t.microsite.join.errNoNamePhone);
      return true;
    }
    if (mode === "book" && !selectedSlot) {
      setFormError(t.microsite.join.errNoSlot);
      return true;
    }
    return false;
  };
  // Step 2 -> perform the join/book directly (no verification gate).
  const confirmJoin = () => {
    if (detailsInvalid()) return;
    if (mode === "queue" && blockGuard(phone.trim())) return;
    performJoinOrBook();
  };

  /** Record a number as locally blocked (the "too many attempts" view / chat message). */
  const markBlocked = (p: string) => {
    const store = storeRef.current;
    store.blocked[p] = true;
    store.lastPhone = p;
    writeStore(storeKey, store);
  };
  /** Same rule blockGuard applies, without touching the pop-up's view — the chat asks this too. */
  const isPhoneBlocked = (p: string) => {
    const store = storeRef.current;
    return !!store.blocked[p] || (store.attempts[p] || 0) >= BLOCK_AT;
  };

  interface VisitInput {
    serviceIds: string[];
    name: string;
    phone: string;
    member: string;
    visitorType: "mr" | "patient" | null | undefined;
    smsOptIn: boolean;
  }
  /**
   * The single place that joins the walk-in queue — the pop-up and the chat both call it, so the
   * hold, the abuse counter and the ticket socket cannot differ between them. Throws ApiError.
   */
  const submitJoin = async (v: VisitInput): Promise<Ticket> => {
    const tk = await publicApi.joinQueue(site.slug, {
      serviceIds: v.serviceIds.length ? v.serviceIds : undefined,
      name: v.name,
      phone: v.phone,
      preferredStaffId: v.member,
      visitorType: v.visitorType ?? undefined,
      // A walk-in only ever gets the review text, but both flags record what was agreed to.
      smsOptIn: v.smsOptIn,
      reviewSmsOptIn: v.smsOptIn,
    });
    const store = storeRef.current;
    store.lastPhone = v.phone;
    store.lastName = v.name;
    // Only count a genuinely new join toward the abuse counter — a day-scoped dedup hit
    // (the phone was already in today's queue) is a no-op, not a fresh join.
    if (!tk.alreadyInQueue) store.attempts[v.phone] = (store.attempts[v.phone] || 0) + 1;
    holdTicket(tk, v.phone, v.name);
    return tk;
  };
  /**
   * The single place that books a slot (pop-up + chat). Keeps the key that allows self-cancel.
   * `repeat` is sent only by the pop-up — the chat books single visits in v1.
   */
  const submitBook = async (v: VisitInput & { slotStart: string; repeat?: RepeatRule }) => {
    const b = await publicApi.bookSlot(site.slug, {
      serviceIds: v.serviceIds.length ? v.serviceIds : undefined,
      name: v.name,
      phone: v.phone,
      preferredStaffId: v.member,
      slotStart: v.slotStart,
      visitorType: v.visitorType ?? undefined,
      smsOptIn: v.smsOptIn,
      reviewSmsOptIn: v.smsOptIn,
      ...(v.repeat ? { repeat: v.repeat } : {}),
    });
    const store = storeRef.current;
    store.lastPhone = v.phone;
    store.lastName = v.name;
    // A lookup held for this number no longer lists everything it has — the next one asks afresh.
    lookupMem.current.delete(v.phone);
    // Keys stay in page memory (bookedKeys), never in storage: see the Store comment.
    if (b.series) for (const visit of b.series.visits) bookedKeys.current.set(visit.appointmentId, visit.appointmentKey);
    else if (b.appointmentKey) bookedKeys.current.set(b.appointmentId, b.appointmentKey);
    writeStore(storeKey, store);
    return b;
  };

  // Perform the REAL join/book from the pop-up.
  const performJoinOrBook = async () => {
    if (services.length > 0 && cart.length === 0) return;
    const p = phone.trim();
    const visit: VisitInput = { serviceIds: cart, name: name.trim(), phone: p, member, visitorType, smsOptIn };
    setSubmitting(true);
    setFormError("");
    try {
      if (mode === "queue") {
        const tk = await submitJoin(visit);
        // Backend found this phone already holds a live ticket today → show it, don't dupe.
        if (tk.alreadyInQueue) setView("already");
        else setScreen("success");
      } else {
        const b = await submitBook({ ...visit, slotStart: selectedSlot!, repeat: repeatRule ?? undefined });
        // Rule dates are handled in order from the first, booked or skipped; anything past that
        // count is still to come. Unknown (null) means a series that never ends.
        const total = repeatRule ? ruleTotalVisits(repeatRule, bookDate) : null;
        const handled = b.series ? b.series.visits.length + b.series.skipped.length : 0;
        setBooking({
          serviceName: b.serviceName,
          staffName: b.staffName,
          scheduledStartAt: b.scheduledStartAt,
          series: b.series,
          moreToCome: total === null || handled < total,
        });
        setScreen("success");
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "RATE_LIMITED" && mode === "queue") {
        markBlocked(p);
        setView("blocked");
      } else if (e instanceof ApiError && e.code === "SLOT_UNAVAILABLE") {
        // Someone else took the time (the server re-checks it under a lock) — say so and show
        // the day's fresh times instead of leaving a stale grid on screen.
        setFormError(e.message);
        fetchSlots(cart, bookDate, member);
      } else if (e instanceof ApiError && e.code === "RECURRING_DISABLED") {
        // The store switched repeating bookings off after this page loaded. Drop back to a single
        // visit, so a second Confirm books exactly what the API's message offers.
        resetRepeat();
        setFormError(e.message);
      } else {
        // SERIES_EXISTS (409) and a refused rule (400) land here too: both messages are written
        // for the customer, so they are shown as the API words them.
        // A booking 429 is a busy network, not the walk-in abuse block — never block the number.
        const msg = (e as Error)?.message ?? t.microsite.join.errGeneric;
        setFormError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };
  // ---- leave / rejoin ----
  const askLeave = () => setConfirmLeave(true);
  const cancelLeave = () => setConfirmLeave(false);
  /** Drop the hold after leaving: record, live state, the ticket socket room and its poll. */
  const releaseHold = () => {
    const store = storeRef.current;
    store.hold = null;
    writeStore(storeKey, store);
    setHeld(null);
    stopTicketPoll();
    openSocket({ businessId: site.id });
    setTicket(null);
  };
  /**
   * Leave from the chat. Unlike the pop-up (which releases the hold whatever the API says), a
   * refusal is surfaced and the hold KEPT: a 409 means the owner has just started the service,
   * and the customer is still very much in the chair.
   */
  const leaveHeld = async () => {
    const tid = held?.ticketId ?? ticket?.ticketId;
    if (!tid) return;
    // Only the browser that joined holds the key; a place found by phone lookup can't be left.
    if (!held?.ticketKey) throw new ApiError(404, "NO_TICKET_KEY", t.chat.flow.leaveOtherDevice);
    await publicApi.leaveTicket(tid, held.ticketKey);
    releaseHold();
  };
  const confirmLeaveQueue = async () => {
    const store = storeRef.current;
    const p = (phone || store.lastPhone).trim();
    const tid = held?.ticketId ?? ticket?.ticketId;
    if (tid) {
      try {
        await publicApi.leaveTicket(tid, held?.ticketKey ?? "");
      } catch {
        /* ignore */
      }
    }
    releaseHold();
    const many = (store.attempts[p] || 0) >= BLOCK_AT;
    setLeftMsg(
      many
        ? t.microsite.left.bodyMany
        : t.microsite.left.body,
    );
    setTicket(null);
    setConfirmLeave(false);
    setView("left");
  };
  const joinDifferent = () => {
    setView("flow");
    setScreen(flowScreens[0]);
    setCart([]);
    setVisitorType(null);
    setName("");
    seedPhone("");
    setMember("any");
    setBooking(null);
    setJustTurn(false);
    setConfirmLeave(false);
    setSlots([]);
    setSelectedSlot(null);
    setFormError("");
    resetRepeat();
  };

  // ---- derived render values ----
  /** The chosen services in pick order; `sel` stays the primary one for the single-service copy. */
  const selected = cart.map((id) => services.find((x) => x.id === id)).filter((x): x is (typeof services)[number] => !!x);
  const sel = selected[0];
  const totalMinutes = selected.reduce((n, sv) => n + sv.durationMinutes, 0);
  /**
   * The visit's total. A range-priced service makes the whole total a range, so the two ends are
   * summed separately — "from ₹2,350" is honest where a single figure would not be.
   *
   * Empty when ANY chosen service has no price: a total that silently leaves one out would quote
   * less than the visit costs, and "nothing" is the honest reading of a partly unpriced cart.
   */
  const cartTotalLabel = (() => {
    if (selected.length === 0) return "";
    const anyUnpriced = selected.some((sv) => (sv.priceType ?? (sv.price.amount > 0 ? "fixed" : "unset")) === "unset");
    if (anyUnpriced) return "";
    const min = selected.reduce((n, sv) => n + sv.price.amount, 0);
    const max = selected.reduce((n, sv) => n + (sv.priceMax?.amount ?? sv.price.amount), 0);
    return max > min ? `${curSym}${Math.round(min / 100)}–${curSym}${Math.round(max / 100)}` : `${curSym}${Math.round(min / 100)}`;
  })();
  // Shop-wide "soonest free chair" wait. A 0 means a chair is open right now, so read
  // it as an invitation ("Walk in now") rather than the nonsensical "~0 min wait".
  const displayLiveWait = displayStaffWaitMinutes(liveWait, liveAsOf, nowTs);
  // Join-form summary wait, member-aware: a specific member shows their own chair's
  // clear time; "Any" falls back to the shop-wide soonest value.
  const selMember = members.find((b) => b.id === member);
  const joinWaitMin = member === "any" ? displayLiveWait : selMember?.waitMin ?? displayLiveWait;
  const joinWaitText = joinWaitMin > 0 ? format(t.microsite.wait.minWait, { min: joinWaitMin }) : t.microsite.wait.noWait;
  const modeTitle =
    view === "track"
      ? tstep === 3
        ? t.microsite.nav.noActiveBooking
        : t.microsite.nav.checkYourPlace
      : view === "already"
        ? t.microsite.already.title
        : view === "blocked"
          ? t.microsite.nav.holdOn
          : mode === "book"
            ? t.microsite.nav.bookATime
            : t.microsite.nav.checkIn;
  const showResume = !!held && !joinOpen && !!ticket && isActive(ticket.status);
  const resumeToken = ticket?.token ?? held?.token ?? "";
  const resumeAhead = justTurn ? 0 : ticket?.ahead ?? 0;
  // Live, wall-clock-aware wait for the pill — ticks down between server updates.
  const displayWait = displayWaitMinutes(ticket, nowTs);
  // No configured services → no real per-visit duration to base a minute estimate on;
  // show only the ahead-count, which is a real number regardless of service data.
  const resumeLabel =
    services.length === 0
      ? resumeAhead <= 0
        ? t.microsite.wait.almostYourTurn
        : format(t.microsite.wait.aheadCount, { count: resumeAhead })
      : displayWait <= 1
        ? t.microsite.wait.almostYourTurn
        : format(t.microsite.wait.aheadWithWait, { count: resumeAhead, min: displayWait });
  // Owner has started this customer's service (waiting → in_service) — surface it live.
  const inService = ticket?.status === "in_service" || justTurn;

  // ---- store chat: guided check-in / booking / status (docs/customer-chatbot-booking.md) ----
  // The chat ACTS only through the functions above (submitJoin, submitBook, trackPhone,
  // leaveHeld) — the same code the pop-up runs — so a chat check-in is indistinguishable from a
  // pop-up one: same hold, same abuse counter, same socket, same resume pill.
  const storeDial = site.countryCode || DEFAULT_DIAL_CODE;
  const chatFormatWhen = (iso: string) =>
    formatInStoreZone(iso, site.timezone, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const chatDays = bookDays.map((d, i) => ({ ymd: d.ymd, label: i < 2 ? d.weekday : d.full, closed: d.closed }));
  const liveTicketHeld = !!held && !!ticket && isActive(ticket.status);
  // Called at every chat step (never during render), so the flow always sees the page as it is
  // at that moment: live staff, the held ticket, open/closed, the remembered name and number.
  const getChatCtx = (): Omit<FlowCtx, "now"> => ({
    storeName: site.name,
    isHospital,
    services: services.map((s) => ({ id: s.id, name: s.name })),
    staff: liveStaff.map((s) => ({ id: s.id, name: s.name })),
    walkInsClosed,
    nextOpenLabel,
    waitMinutes: displayLiveWait,
    days: chatDays,
    held: liveTicketHeld && ticket ? { token: ticket.token, status: ticket.status, inService, canLeave: !!held?.ticketKey } : null,
    lastName: storeRef.current.lastName,
    lastPhone: storeRef.current.lastPhone,
    hasPhone: !!phoneFull,
    maxServices: MAX_SERVICES_PER_VISIT,
    isBlocked: isPhoneBlocked,
    normalizePhone: (raw) => parseTypedPhone(raw, storeDial),
    maskPhone,
    formatWhen: chatFormatWhen,
  });
  const toVisit = (d: Draft): VisitInput => ({
    serviceIds: d.serviceIds,
    name: d.name ?? "",
    phone: d.phone ?? "",
    member: d.staffId ?? "any",
    visitorType: d.visitorType ?? null,
    smsOptIn: d.sms === true,
  });
  /** The pop-up's blockGuard, for the chat: a locally blocked number never reaches the API. */
  const guardChat = (p: string) => {
    if (isPhoneBlocked(p)) {
      markBlocked(p);
      throw new BlockedError();
    }
  };
  const chatAdapter: FlowAdapter = {
    fetchSlots: async (date, serviceIds, staffId) =>
      (
        await publicApi.getSlots(site.slug, {
          date,
          serviceIds: serviceIds.length ? serviceIds : undefined,
          staffId: staffId && staffId !== "any" ? staffId : undefined,
        })
      ).slots,
    refreshStaffIds: async () => {
      // Staff changes (a chair deactivated) emit no socket event, so re-read before confirming.
      const r = await publicApi.getStaffAvailability(site.slug);
      setLiveStaff(r.staff);
      setStaffAsOf(new Date().toISOString());
      return r.staff.map((s) => s.id);
    },
    join: async (d) => {
      const v = toVisit(d);
      guardChat(v.phone);
      try {
        const tk = await submitJoin(v);
        return { alreadyInQueue: !!tk.alreadyInQueue };
      } catch (e) {
        if (e instanceof ApiError && e.code === "RATE_LIMITED") markBlocked(v.phone);
        throw e;
      }
    },
    // No walk-in block here, and a 429 never marks the number blocked: the block guards the
    // walk-in line only (a blocked number used to be refused booking — QA / user report).
    book: async (d) => {
      const b = await submitBook({ ...toVisit(d), slotStart: d.slot?.startAt ?? "" });
      return {
        appointmentId: b.appointmentId,
        serviceName: b.serviceName,
        staffName: b.staffName,
        scheduledStartAt: b.scheduledStartAt,
        status: b.status,
        canCancel: !!b.appointmentKey,
      };
    },
    track: async (p) => {
      const r = await trackPhone(p, "");
      // The WAITLIST phone lookup never returns the ticket key, so a place found this way can be
      // seen but not left. (The 2026-10-05 "phone alone is enough" decision covers appointments
      // only — the waitlist stays view-only by phone.)
      return r.found ? { found: true, status: r.status, token: r.token, isYourTurn: r.isYourTurn, canLeave: !!r.socket?.ticketKey } : { found: false };
    },
    leave: leaveHeld,
    // The same lookup — and the same page-memory hold — as My appointments. It carries each
    // changeable booking's key (client decision 2026-10-05), so a booking made on another device is
    // as cancellable here as one made on this one. The key stays in lookupMem; the chat state only
    // learns that there is one.
    lookupAppts: async (p) => {
      const r = await lookupApptsByPhone(p);
      return r.appointments.map((a) => ({
        appointmentId: a.appointmentId,
        serviceName: a.serviceName,
        staffName: a.staffName,
        scheduledStartAt: a.scheduledStartAt,
        status: a.status,
        repeats: a.repeats === true,
        canCancel: !!a.appointmentKey,
      }));
    },
    cancelAppt: async (id) => {
      const key = apptKeyFor(id);
      // Unreachable from the engine (it only offers Cancel where canCancel), kept as a guard.
      if (!key) throw new ApiError(404, "NOT_FOUND", t.chat.flow.apptNotFound);
      await publicApi.cancelAppointment(id, key);
      dropFromLookups(id);
    },
  };
  const ticketStatus = ticket?.status ?? null;
  const chatSignals = useMemo(() => ({ status: ticketStatus, justTurn, eta: etaNotice }), [ticketStatus, justTurn, etaNotice]);
  const chatFlow = useChatFlow({ getCtx: getChatCtx, adapter: chatAdapter, signals: chatSignals });

  /** Price total for a set of service ids — the pop-up's cartTotalLabel rule, for the chat summary. */
  const totalFor = (ids: string[]) => {
    const picked = ids.map((id) => services.find((x) => x.id === id)).filter((x): x is (typeof services)[number] => !!x);
    if (picked.length === 0) return "";
    if (picked.some((sv) => (sv.priceType ?? (sv.price.amount > 0 ? "fixed" : "unset")) === "unset")) return "";
    const min = picked.reduce((n, sv) => n + sv.price.amount, 0);
    const max = picked.reduce((n, sv) => n + (sv.priceMax?.amount ?? sv.price.amount), 0);
    return max > min ? `${curSym}${Math.round(min / 100)}–${curSym}${Math.round(max / 100)}` : `${curSym}${Math.round(min / 100)}`;
  };
  const renderChatCard = (card: Card, choose: (id: string, value: unknown, label: string) => void, active: boolean): ReactNode => {
    switch (card.type) {
      case "services":
        return <ServicesCard services={services} initial={card.selected} max={MAX_SERVICES_PER_VISIT} active={active} choose={choose} />;
      case "staff":
        return (
          <StaffCard
            staff={members.map((m) => ({ id: m.id, name: m.name, busy: m.busy, count: m.count, waitMin: m.waitMin }))}
            kind={card.kind}
            anyWaitMin={displayLiveWait}
            active={active}
            choose={choose}
          />
        );
      case "slots":
        return (
          <SlotsCard
            slots={chatFlow.state.step === "time" ? chatFlow.state.slots : []}
            error={chatFlow.state.slotsError}
            active={active}
            choose={choose}
          />
        );
      case "summary": {
        const d = card.draft;
        const staffName = d.staffId === undefined ? "" : d.staffId === "any" ? t.chat.flow.staffAny : members.find((m) => m.id === d.staffId)?.name ?? "";
        const day = chatDays.find((x) => x.ymd === d.date)?.label ?? "";
        return (
          <SummaryCard
            kind={card.kind}
            draft={d}
            serviceNames={d.serviceIds.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(" + ")}
            staffName={staffName}
            when={d.slot ? `${day} · ${d.slot.label}` : ""}
            phone={d.phone ? maskPhone(d.phone) : ""}
            total={totalFor(d.serviceIds)}
            visitorLabel={d.visitorType === "mr" ? t.chat.flow.visitorMr : d.visitorType === "patient" ? t.chat.flow.visitorPatient : ""}
          />
        );
      }
      case "ticket":
        return (
          <TicketCard
            token={ticket?.token ?? held?.token ?? null}
            status={ticket?.status ?? null}
            inService={inService}
            ahead={resumeAhead}
            waitLabel={
              services.length === 0
                ? ""
                : displayWait <= 1
                  ? t.microsite.wait.almostYourTurn
                  : format(t.chat.flow.card.waitMin, { min: displayWait })
            }
            staffName={ticket?.staffName ?? null}
            serviceName={ticket?.serviceName ?? null}
          />
        );
      case "appointment":
        return <AppointmentCard appt={card.appt} when={chatFormatWhen(card.appt.scheduledStartAt)} />;
      case "consent":
        return <ConsentCard storeName={site.name} />;
    }
  };

  // In-page jump links, shared by the desktop bar and the mobile dropdown so the
  // two never drift. Each is shown only when its section actually renders.
  const navLinks = (
    [
      [services.length > 0, t.microsite.nav.services, "#services"],
      [members.length > 0, t.microsite.nav.team, "#team"],
      // Only when the section renders (it needs photos) — the demo store has none, and its link
      // used to scroll nowhere.
      [gallery.length > 0, t.microsite.nav.gallery, "#gallery"],
      [reviews.length > 0, t.microsite.nav.reviews, "#reviews"],
      [showAbout, t.microsite.nav.about, "#about"],
      [Boolean(site.address || place || site.hours.length > 0), t.microsite.nav.visitUs, "#visit"],
    ] as [boolean, string, string][]
  ).filter(([show]) => show);

  // The header shows the store's name in full up to 30 characters; past that it is cut with an
  // ellipsis (the full name is in the tooltip). An exact character cap rather than a pixel width,
  // so the same name reads the same at every screen size.
  const headerName = site.name.length > HEADER_NAME_MAX ? `${site.name.slice(0, HEADER_NAME_MAX).trimEnd()}…` : site.name;

  const scrollToTop = (e: ReactMouseEvent) => {
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  // The progress bar always matches this business's actual screen count (1-4, depending on
  // whether "visitor" and/or "service" apply) — see flowScreens above.
  const totalSteps = flowScreens.length;
  const visualStep = flowScreens.indexOf(screen) + 1;
  const accent = (n: number) => (visualStep >= n ? "var(--primary)" : "var(--surface-sunken)");

  const progressPct =
    justTurn || ticket?.status === "completed"
      ? "100%"
      : ticket && initialAhead > 0
        ? `${Math.max(0, Math.round((1 - ticket.ahead / initialAhead) * 100))}%`
        : "0%";

  const cantConfirm =
    !name.trim() || phone.replace(/\D/g, "").length < 4 || (mode === "book" && (!selectedSlot || repeatIncomplete));
  /** Shown in the summary so the rhythm is restated right above Confirm, not only in the radios. */
  const summaryRepeat = repeatRule ? format(t.microsite.repeat.summaryRepeats, { rhythm: rhythmLabel(repeatRule.everyDays) }) : null;

  // Pre-confirmation summary parts. Booking shows the chosen slot's own label rather than a bare
  // "time selected", so the customer can check the time without scrolling back up to the chips.
  const summaryWhen =
    mode === "book"
      ? (() => {
          const label = slots.find((x) => x.startAt === selectedSlot)?.label;
          // Day AND time now that more than today is bookable — "10:00 AM" alone no longer says
          // which of fourteen days the customer just picked.
          if (label) return [selectedDay?.full, label].filter(Boolean).join(" · ");
          return selectedSlot ? t.microsite.join.timeSelected : t.microsite.join.chooseTimeAbove;
        })()
      : joinWaitText;
  // No stylists means no provider to name — "Any" would read as a choice the customer never had.
  const summaryProvider = members.length === 0 ? null : member === "any" ? t.microsite.join.memberAny : selMember?.name ?? null;

  // Theming root. The colour tokens themselves are server-rendered by <ThemeStyle/> into a
  // <style> block keyed on [data-tt-theme]; this element only carries the two attributes that
  // select which of its light/dark blocks applies. useThemePreview is a no-op unless the URL
  // carries ?preview=1 (admin live preview), in which case it overwrites the tokens in place.
  // Wording and section order for this store's vertical. A clinic should not be told it has
  // "stylists", and a restaurant's photos matter more than its staff roster. Unknown
  // categories fall through to the current salon copy, so nothing regresses.
  const domain = domainFor(site.category);
  const queueWord = domain.id === "clinic" ? t.microsite.queueWord.waitingList : domain.id === "food" ? t.microsite.queueWord.waitlist : t.microsite.queueWord.queue;
  // Every open / closed / wait string on the page, from one place (status-copy.ts), so that a
  // closed store says "Closed" once — in the hero card — and the check can prove it
  // (npm run test:status-copy). `waitHeadline` is the compact wait value for the stat tile, the
  // team board's tile and the open banner.
  const status = statusCopy({
    closed: walkInsClosed,
    nextOpenLabel,
    liveCount,
    waitMinutes: displayLiveWait,
    ctaHeading: domain.ctaHeading,
    queueWord,
  });
  const waitHeadline = status.waitHeadline;
  const svcEyebrow = domain.id === "clinic" ? t.microsite.sections.svcEyebrowTreatments : t.microsite.sections.svcEyebrowMenu;
  // v3's live sub-line: an empty queue is an invitation, never a "0".
  const freeMembers = members.filter((m) => !m.busy);
  const liveStatus = (
    <LiveStatusLine
      membersLength={members.length}
      liveCount={liveCount}
      freeCount={freeMembers.length}
      freeName={freeMembers[0]?.name ?? null}
      closed={walkInsClosed}
      closedLabel={nextOpenLabel ? format(t.microsite.wait.opensAt, { when: nextOpenLabel }) : undefined}
    />
  );
  const liveStatusDark = (
    <LiveStatusLine
      membersLength={members.length}
      liveCount={liveCount}
      freeCount={freeMembers.length}
      freeName={freeMembers[0]?.name ?? null}
      closed={walkInsClosed}
      closedLabel={nextOpenLabel ? format(t.microsite.wait.opensAt, { when: nextOpenLabel }) : undefined}
      onDark
    />
  );
  // A closed store's provider cards offer the one action that still works, with that provider
  // carried into the booking flow — rather than a disabled button that reads as a broken page.
  const liveCtaLabel = walkInsClosed
    ? (name: string) => format(t.microsite.sections.bookWith, { name })
    : domain.liveCta;
  // v3's four icon cards. Built from the same guarded data as the old trust row, so a store
  // without an established year or reviews simply shows fewer cards rather than zeroes.
  // v3's accent marquee: what the store offers, then where and how well rated.
  // Service names only — prices belong on the Services cards, not this marquee strip.
  const tickerItems = [
    ...services.map((sv) => sv.name),
    place,
    site.establishedYear != null ? format(t.microsite.hero.since, { year: site.establishedYear }) : null,
    reviewCount > 0 ? format(t.microsite.ticker.ratingReviews, { rating, reviewCount }) : null,
  ].filter(Boolean) as string[];
  const statCards = [
    site.establishedYear != null && place
      ? { icon: "calendar" as const, value: format(t.microsite.ticker.sinceYear, { year: site.establishedYear }), label: format(t.microsite.ticker.servingArea, { area: place }) }
      : null,
    reviewCount > 0
      ? { icon: "star" as const, value: rating.toFixed(1), label: format(t.microsite.ticker.reviewsLabel, { count: reviewCount }) }
      : null,
    // Closed, the wait tile is left out rather than reading "Closed" a fourth time.
    walkInsClosed ? null : {
      icon: "hourglass" as const,
      value: waitHeadline,
      label: liveCount === 0 ? t.microsite.ticker.walkInRightNow : t.microsite.ticker.shortestWaitNow,
    },
    members.length > 0
      ? {
          icon: "users" as const,
          value: String(members.length),
          label: walkInsClosed
            ? plural(members.length, t.microsite.ticker.teamOne, t.microsite.ticker.teamMany)
            : plural(members.length, t.microsite.ticker.teamAvailableOne, t.microsite.ticker.teamAvailableMany),
        }
      : null,
  ].filter(Boolean) as { icon: "calendar" | "star" | "hourglass" | "users"; value: string; label: string }[];
  const galleryPhotos = gallery.length > 0 ? gallery : [];
  const [lightbox, setLightbox] = useState<number | null>(null);
  const stepLightbox = (d: number) =>
    setLightbox((i) => (i == null ? i : (i + d + galleryPhotos.length) % galleryPhotos.length));

  // Escape closes the viewer; the arrow keys page through it.
  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, galleryPhotos.length]);

  // Tapping a service card opens the booking flow with that service already chosen. openJoin
  // clears the cart, so the selection is applied after it — both run in one batched handler.
  //
  // This is the appointment entry point, not the walk-in one: the card says "Book Appointment",
  // and it used to open the live-queue flow instead. Walk-ins have their own four entry points
  // (header, hero, the per-provider cards, the sticky bar), all of which say "waitlist".
  const openServiceBooking = (serviceId: string) => {
    openJoin("book");
    setCart([serviceId]);
  };

  /* Sections whose position varies by domain are built here and placed by the order map in
     the return. Their internals are unchanged apart from the trust row, which is now a
     the live floor as v3 stat cards. */
  const aboutSection = showAbout ? (
      
        <div id="about" style={{ maxWidth: 1180, margin: "0 auto", padding: "clamp(28px, 7vw, 72px) clamp(16px, 4vw, 32px) 40px" }}>
          <div style={{ ...revealStyle, display: "flex", gap: "clamp(20px, 4vw, 48px)", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
            {hasAboutText && (
              // Pictures are optional. Beside a photo the text is a left-aligned column; with no
              // photo it would stretch the full width and hug the left edge of an otherwise empty
              // row, so it is capped to a readable measure and centred instead. (The wrapper
              // already centres its children, so the cap is what makes it land in the middle.)
              <div style={{ flex: 1, minWidth: 300, ...(hasAboutImage || isDemo ? {} : { maxWidth: 720, textAlign: "center" as const }) }}>
                <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>{site.name ? format(t.microsite.about.eyebrowNamed, { name: site.name }) : t.microsite.about.eyebrow}</div>
                {hasHeading && (
                  <h2 style={{ font: "var(--fw-extrabold) clamp(24px, 4vw, 34px)/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 14px" }}>{site.aboutHeading}</h2>
                )}
                {hasDescription && (
                  <p style={{ font: "var(--fw-regular) 16px/1.6 var(--font-sans)", color: "var(--text-body)", margin: "0 0 24px" }}>
                    {site.description}
                  </p>
                )}
                {hasAmenities && (
                  <>
                    <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 11 }}>{t.microsite.about.amenities}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 9, ...(hasAboutImage || isDemo ? {} : { justifyContent: "center" }) }}>
                      {amenities.map((a) => (
                        <span key={a} className="salonAmenity" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)", borderRadius: 999, padding: "7px 14px", font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-body)", background: "var(--surface-card)" }}>
                          <span style={{ color: "var(--success)", display: "flex" }}>
                            <Icon name="check" size={14} />
                          </span>
                          {a}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {(hasAboutImage || isDemo) && (
              <div style={{ flex: hasAboutText ? "1 1 0" : "0 1 560px", minWidth: 280, height: 260, borderRadius: "calc(18px * var(--radius-scale, 1))", background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, var(--surface-card)), color-mix(in srgb, var(--secondary) 12%, var(--surface-card)))", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", ...(hasAboutImage ? { backgroundImage: `url(${site.aboutImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}>
                {!hasAboutImage && (
                  <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-subtle)", display: "flex", alignItems: "center", gap: 7 }}>
                    <Icon name="building" size={15} />
                    {t.microsite.about.aboutPhoto}
                  </span>
                )}
              </div>
            )}
          </div>

        </div>
  ) : null;

  const reviewsSection = reviews.length > 0 ? (
    <Section id="reviews">
      {/* The demo store's reviews are made up — say so (client review, row 28/29). */}
      <ReviewsBlock reviews={reviews} rating={rating} reviewCount={reviewCount} avatarColors={AVATAR_COLORS} sample={isDemo} />
    </Section>
  ) : null;

  const themeConfig = micrositeThemeConfig(site);
  const themeRootRef = useRef<HTMLDivElement | null>(null);
  // Also kept in state: ThemePortalProvider needs the ELEMENT during render (createPortal's
  // target cannot come from a ref read in render), while useThemePreview needs the ref object.
  // The callback ref is stable, so this costs exactly one extra render at mount.
  const [themeRootEl, setThemeRootEl] = useState<HTMLElement | null>(null);
  const attachThemeRoot = useCallback((node: HTMLDivElement | null) => {
    themeRootRef.current = node;
    setThemeRootEl(node);
  }, []);
  useThemePreview(themeRootRef);

  // The "Right now" card — v3's centrepiece and the page's primary action. Built once because it
  // lives in one of two places depending on whether the store has a hero photo (see the hero
  // body). It carries no outer margin; the slot it is dropped into decides that.
  const rightNowCard = (
    <div className="ttWaitCard" style={{ width: "100%", maxWidth: 430, borderRadius: "calc(26px * var(--radius-scale, 1))", padding: "clamp(18px, 2.4vw, 26px)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "0 26px 60px rgba(15,23,42,.16)" }}>
      <div style={{ font: "var(--fw-bold) 10.5px/1 var(--font-sans)", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--primary)" }}>{t.microsite.hero.rightNow}</div>
      <div style={{ marginTop: 14 }}>
        <QueueWaitSummary
          liveCount={liveCount}
          members={members}
          closedHeadline={status.card.closedHeadline}
          detail={status.card.detail}
          walkInsClosed={walkInsClosed}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
        {/* Closed: booking is promoted to the primary action and the walk-in button is
            dropped rather than shown disabled — an inert button reads as a broken page. */}
        {walkInsClosed ? (
          <>
            <Button size="lg" fullWidth onClick={openBook}>{t.microsite.hero.bookSlot}</Button>
          </>
        ) : (
          <>
            <Button size="lg" fullWidth onClick={openQueue}>{domain.id === "clinic" ? t.microsite.hero.takeAToken : t.microsite.hero.checkIn}</Button>
            <Button size="lg" variant="outline" fullWidth onClick={openBook}>{t.microsite.hero.bookSlot}</Button>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, font: "var(--fw-medium) 12.5px/1.4 var(--font-sans)", color: "var(--text-subtle)" }}>
        <Icon name="check" size={14} />
        <span>{t.microsite.hero.noAppNote}</span>
      </div>
    </div>
  );

  return (
    <ThemePortalProvider container={themeRootEl}>
    <div
      ref={attachThemeRoot}
      data-tt-theme={themeConfig.preset}
      data-tt-mode={themeConfig.mode}
      style={{
        position: "relative",
        overflowX: "hidden",
        // The page background has to live HERE, not on <body>: body sits outside
        // [data-tt-theme], so it resolves --surface-page from the :root fallbacks and would
        // stay light for a store on mode dark/auto. --surface-page and --text-body are the
        // same tokens body already uses and resolve to the same values in light mode, so this
        // is a no-op for every existing microsite.
        minHeight: "100vh",
        background: "var(--surface-page)",
        color: "var(--text-body)",
      }}
    >
      {/* ===== NAV + HERO (TejoTime Microsite v3) =====
           v3 puts the header inside the hero's gradient rather than on its own white bar, and
           replaces the full-bleed background photo with a right-hand image column plus a white
           "Right now" card carrying the live wait and both CTAs. Behaviour is unchanged: the
           same openQueue / openBook / openTrack / onSaveContact handlers, the same nav links,
           the same mobile menu. */}
      <div style={{ position: "relative", overflow: "hidden", background: "radial-gradient(72% 62% at 4% 6%, color-mix(in srgb, var(--primary) 30%, transparent) 0%, transparent 62%), linear-gradient(150deg, color-mix(in srgb, var(--primary) 10%, var(--surface-card)) 0%, var(--surface-page) 54%, var(--surface-card) 100%)" }}>

        {/* --- header --- */}
        <div className="ttHeader" style={{ maxWidth: 1320, margin: "0 auto", padding: "clamp(16px, 2.4vw, 26px) clamp(18px, 4vw, 30px)", display: "flex", alignItems: "center", gap: 18 }}>
          {/* An uploaded logo sits on nothing — most are transparent PNGs. Only the fallback
              mark gets the brand tile. */}
          {/* Logo and name both take the visitor back to the top, like a site's home link. The
              name link is hidden from the tab order so a keyboard user meets one link, not two. */}
          <a href="#top" onClick={scrollToTop} aria-label={format(t.microsite.header.backToTop, { name: site.name })} className="ttLogo" style={{ width: 40, height: 40, borderRadius: "calc(12px * var(--radius-scale, 1))", overflow: "hidden", flexShrink: 0, background: logoUrl ? "transparent" : "var(--primary)", color: "var(--text-on-brand)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={site.name} onError={() => setFailedLogoUrl(logoUrl)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <Icon name="sparkle" size={20} />
            )}
          </a>
          <a href="#top" onClick={scrollToTop} tabIndex={-1} aria-hidden="true" title={site.name} className="ttName" style={{ font: "var(--fw-extrabold) 18px/1.1 var(--font-sans)", letterSpacing: "-.025em", color: "var(--text-strong)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{headerName}</a>

          <span className="ttHeaderSpacer" style={{ flex: 1 }} />

          <div data-shed="1" data-desk="1" style={{ display: "flex", alignItems: "center", gap: 26 }}>
            {navLinks.map(([, label, href]) => (
              <a key={href} href={href} className="salonNavLink" style={{ font: "var(--fw-medium) 13.5px/1 var(--font-sans)", letterSpacing: ".01em", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</a>
            ))}
          </div>

          <span data-desk="1" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="sm" variant="outline" onClick={onSaveContact} leadingIcon={<Icon name="user" size={14} />}>{t.microsite.header.saveContact}</Button>
            <Button size="sm" variant="outline" onClick={openTrack}>{t.microsite.header.trackMyTurn}</Button>
            <Button size="sm" variant="outline" onClick={openMyAppts}>{t.microsite.header.myAppointments}</Button>
          </span>
          <span data-desk="1">
            {/* Closed shops get the booking action here rather than a disabled control: the one
                thing a visitor can still do outside business hours is reserve a time. */}
            <Button size="sm" variant="primary" onClick={walkInsClosed ? openBook : openQueue}>
              {walkInsClosed
                ? t.microsite.hero.bookSlot
                : domain.id === "clinic"
                  ? t.microsite.header.takeToken
                  : t.microsite.header.checkIn}
            </Button>
          </span>

          <button
            type="button"
            className="ttMobileBar ttMenuBtn"
            aria-label={menuOpen ? t.microsite.header.closeMenu : t.microsite.header.openMenu}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            style={{ position: "static", display: "none", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 6, borderRadius: "calc(8px * var(--radius-scale, 1))", cursor: "pointer", color: "var(--text-strong)", boxShadow: "none", flexShrink: 0 }}
          >
            <Icon name={menuOpen ? "x" : "menu"} size={24} />
          </button>
        </div>

        {menuOpen && (
          <div style={{ display: "flex", flexDirection: "column", padding: "8px clamp(18px, 4vw, 30px) 18px", background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-md)", animation: "ttFade .18s ease both" }}>
            {navLinks.map(([, label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-body)", textDecoration: "none", padding: "14px 6px", borderBottom: "1px solid var(--border-subtle)" }}>{label}</a>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              <Button fullWidth variant="outline" onClick={() => { setMenuOpen(false); openTrack(); }}>{t.microsite.header.trackMyTurn}</Button>
              <Button fullWidth variant="outline" onClick={openMyAppts}>{t.microsite.header.myAppointments}</Button>
              <Button fullWidth variant="outline" onClick={() => { setMenuOpen(false); onSaveContact(); }} leadingIcon={<Icon name="user" size={16} />}>{t.microsite.header.saveContact}</Button>
            </div>
          </div>
        )}

        {/* --- hero body --- */}
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "12px clamp(18px, 4vw, 30px) clamp(28px, 6vw, 72px)", display: "flex", flexWrap: "wrap", gap: "clamp(22px, 4vw, 44px)", alignItems: "center" }}>
          <div style={{ flex: "1.05 1 300px", minWidth: 300 }}>
            {/* Closed, the pill is dropped: the "Right now" card directly below already says Closed
                and when the store reopens, and the page used to repeat that five times over. */}
            {!walkInsClosed && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 11, borderRadius: 999, padding: "9px 18px 9px 14px", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)" }}>
              <span style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: site.openStatus.isOpen ? "var(--success)" : "var(--text-subtle)" }} />
                <span className="ttPing" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: site.openStatus.isOpen ? "var(--success)" : "var(--text-subtle)" }} />
              </span>
              <span style={{ font: "var(--fw-bold) 12.5px/1 var(--font-sans)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-strong)" }}>{site.openStatus.label}</span>
            </div>
            )}

            <h1 style={{ font: "var(--fw-extrabold) clamp(32px, 5.9vw, 100px)/0.96 var(--font-display, var(--font-sans))", letterSpacing: "-.045em", color: "var(--text-strong)", margin: walkInsClosed ? 0 : "22px 0 0", overflowWrap: "break-word", textWrap: "balance" }}>
              {/* `||`, not `??`: a store saved with an empty headline would otherwise show an empty h1. */}
              {site.tagline?.trim() || site.name}
            </h1>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 26 }}>
              {reviewCount > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--fw-bold) 15px/1 var(--font-sans)", color: "var(--text-strong)" }}>
                  <span style={{ color: "var(--warning)", display: "flex" }}><Icon name="star" size={17} fill="currentColor" /></span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{rating.toFixed(1)}</span>
                  <span style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-subtle)" }}>
                    {format(t.microsite.sections.reviewsCount, { count: reviewCount })}
                  </span>
                </span>
              )}
              {place && <span style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-muted)" }}>{place}</span>}
              {site.establishedYear != null && <span style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-muted)" }}>{format(t.microsite.hero.since, { year: site.establishedYear })}</span>}
            </div>

            {/* With a photo the card sits under the headline, as ever. Without one it moves to the
                right-hand column the photo would have filled (below) — see `rightNowCard`. */}
            {heroUrl && <div style={{ marginTop: "clamp(20px, 3vw, 32px)" }}>{rightNowCard}</div>}
          </div>

          {heroUrl ? (
            <div style={{ flex: "1 1 300px", minWidth: 300, alignSelf: "stretch", minHeight: "clamp(280px, 46vw, 460px)", position: "relative", borderRadius: "calc(26px * var(--radius-scale, 1))", overflow: "hidden", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", boxShadow: "0 26px 60px rgba(15,23,42,.13)" }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${heroUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
            </div>
          ) : (
            // No hero photo: an empty frame (or a "Hero photo" placeholder) read as a broken page
            // to real customers. The live card takes the photo's column instead, so the hero is
            // two balanced halves on a computer and simply stacks on a phone — nothing is faked.
            <div style={{ flex: "1 1 300px", minWidth: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {rightNowCard}
            </div>
          )}
        </div>
      </div>

      {/* ===== TICKER ===== */}
      <Ticker items={tickerItems} />

      {/* ===== SECTIONS — order comes from the store's domain profile ===== */}
      {domain.order.map((key) => {
        if (key === "live" && members.length > 0) {
          return (
            <Section key={key} id="team" tone="tint">
              <LiveBoard
                members={members}
                heading={domain.liveHeading}
                note={status.teamNote}
                liveHeadline={waitHeadline}
                liveSub={liveStatusDark}
                ctaLabel={liveCtaLabel}
                onJoin={openWith}
                walkInsClosed={walkInsClosed}
              />
              <StatCards cards={statCards} />
            </Section>
          );
        }
        // Stylists are optional. Without any there is no team board to show, but the stat cards
        // (year, rating, the live wait) do not depend on a roster — dropping them along with the
        // board is what left a stylist-less page with nothing between the hero and the services.
        // The wait card is always present and already sits in the hero, so it only earns a section
        // when there is something alongside it.
        if (key === "live" && statCards.length > 1) {
          return (
            <Section key={key} tone="tint">
              <StatCards cards={statCards} />
            </Section>
          );
        }
        if (key === "services" && services.length > 0) {
          return (
            <Section key={key} id="services">
              <ServiceList
                services={services}
                eyebrow={svcEyebrow}
                heading={domain.servicesHeading}
                note={domain.servicesNote}
                onPick={openServiceBooking}
              />
            </Section>
          );
        }
        if (key === "gallery" && galleryPhotos.length > 0) {
          return (
            <Section key={key} id="gallery" tone="tint">
              <GalleryMosaic photos={galleryPhotos} heading={site.galleryHeading?.trim() || domain.galleryHeading} onOpen={setLightbox} />
            </Section>
          );
        }
        if (key === "about") return <div key={key}>{aboutSection}</div>;
        if (key === "reviews") return <div key={key}>{reviewsSection}</div>;
        return null;
      })}

      {/* ===== FAQ (only when the store has Q&A) ===== */}
      {faqs.length > 0 && (
        <div id="faq" style={{ maxWidth: 1180, margin: "0 auto", padding: "24px clamp(16px, 4vw, 32px) 56px" }}>
          <div style={revealStyle}>
            <div style={eyebrow}>{t.microsite.faq.eyebrow}</div>
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "calc(16px * var(--radius-scale, 1))", overflow: "hidden", background: "var(--surface-card)" }}>
              {faqs.map((f, i) => {
                const open = faqOpen === i;
                return (
                  <div key={f.q} style={{ borderBottom: i < faqs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    <div onClick={() => toggleFaq(i)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", cursor: "pointer" }}>
                      <span style={{ font: "var(--fw-semibold) 16px/1.3 var(--font-sans)", color: "var(--text-strong)" }}>{f.q}</span>
                      <span style={{ display: "flex", color: "var(--text-muted)", transition: "transform .25s ease", transform: open ? "rotate(45deg)" : "rotate(0deg)" }}>
                        <Icon name="plus" size={18} />
                      </span>
                    </div>
                    <div style={{ overflow: "hidden", transition: "max-height .3s ease, opacity .3s ease", maxHeight: open ? 180 : 0, opacity: open ? 1 : 0 }}>
                      <div style={{ padding: "0 20px 18px", font: "var(--fw-regular) 15px/1.6 var(--font-sans)", color: "var(--text-muted)" }}>{f.a}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mobile only: a "Save contact" action just above the Visit us section, so a phone
          visitor scrolling toward the bottom can save the shop without reaching back up to the
          hamburger. Reuses onSaveContact (handheld → live .vcf, computer → QR sheet). */}
      {isMobile && (
        <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)", padding: "24px clamp(16px, 4vw, 32px)" }}>
          <Button fullWidth variant="outline" onClick={onSaveContact} leadingIcon={<Icon name="user" size={16} />}>{t.microsite.header.saveContact}</Button>
        </div>
      )}

      {/* ===== VISIT ===== */}
      {(site.address || place || site.hours.length > 0) && (
      <div id="visit" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: 0, display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, padding: "calc(clamp(28px, 7vw, 56px) * var(--density-scale, 1)) clamp(16px, 4vw, 32px)" }}>
            <div style={eyebrow}>{t.microsite.visit.eyebrow}</div>
            {site.address && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9, font: "var(--fw-medium) 15px/1.4 var(--font-sans)", color: "var(--text-body)", marginBottom: 22 }}>
                <span style={{ color: "var(--primary)", display: "flex", flexShrink: 0, marginTop: 1 }}>
                  <Icon name="building" size={18} />
                </span>
                <span>
                  {site.address}
                  {/* The map iframe beside this only *shows* the place; a customer on a phone
                      wants the address handed to their own maps app. */}
                  {" · "}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--primary)", font: "var(--fw-semibold) 15px/1.4 var(--font-sans)", textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    {t.microsite.visit.getDirections}
                  </a>
                </span>
              </div>
            )}
            {/* Save contact lives here. The v3 design has no slot for it, and Visit is where it
                belongs: it sits with the address and phone it actually saves. The nav keeps its
                own copy for anyone who never scrolls this far. */}
            <div style={{ marginBottom: 26 }}>
              <Button variant="outline" onClick={onSaveContact} leadingIcon={<Icon name="user" size={16} />}>
                {t.microsite.visit.saveContact}
              </Button>
            </div>
            {site.hours.length > 0 && (
              <>
                <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>{t.microsite.visit.openingHours}</div>
                <div style={{ maxWidth: 320 }}>
                  {[...site.hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek).map((h, i, arr) => (
                    <div key={h.dayOfWeek} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none", font: "var(--fw-medium) 14px/1 var(--font-sans)", color: "var(--text-body)" }}>
                      <span>{DAYS[h.dayOfWeek]}</span>
                      <span style={{ color: h.isClosed ? "var(--error)" : "var(--text-strong)" }}>{h.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {(site.address || place) && (
            <iframe
              title={format(t.microsite.visit.mapTitle, { name: site.name })}
              src={`https://www.google.com/maps?q=${encodeURIComponent(site.address || place || site.name)}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ flex: 1, minWidth: 300, minHeight: 280, border: 0, borderLeft: "1px solid var(--border-subtle)" }}
            />
          )}
        </div>
      </div>
      )}

      {/* ===== FINAL CTA ===== */}
      <div style={{ background: "linear-gradient(135deg, var(--brand-ink), var(--primary))", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -60, right: -30, width: 240, height: 240, borderRadius: "50%", background: "rgba(255,255,255,.08)", animation: "ttFloat 8s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -70, left: "6%", width: 170, height: 170, borderRadius: "50%", background: "rgba(255,255,255,.06)", animation: "ttFloat 10s ease-in-out infinite" }} />
        <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto", padding: "calc(var(--section-y, clamp(24px, 4.4vw, 52px)) * var(--density-scale, 1)) clamp(16px, 4vw, 32px)", textAlign: "center" }}>
          <h2 style={{ font: "var(--fw-extrabold) clamp(24px, 5.2vw, 42px)/1.08 var(--font-display, var(--font-sans))", letterSpacing: "-.025em", color: "var(--on-hero)", margin: "0 0 10px" }}>
            {status.cta.heading}
          </h2>
          <p style={{ font: "var(--fw-medium) 16px/1.5 var(--font-sans)", color: "rgba(255,255,255,.85)", margin: "0 0 26px" }}>
            {status.cta.sub}
          </p>
          {domain.urgentLabel && (
            <p style={{ font: "var(--fw-semibold) 13px/1.4 var(--font-sans)", color: "rgba(255,255,255,.72)", margin: "-14px 0 22px" }}>{domain.urgentLabel}</p>
          )}
          <div onClick={walkInsClosed ? openBook : openQueue} className="salonCtaBtn" style={{ display: "inline-block", cursor: "pointer", background: "#fff", color: "var(--primary)", font: "var(--fw-bold) 17px/1 var(--font-sans)", padding: "16px 32px", borderRadius: "calc(12px * var(--radius-scale, 1))", boxShadow: "var(--shadow-lg)" }}>
            {walkInsClosed ? t.microsite.cta.buttonClosed : t.microsite.cta.button}
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px clamp(16px, 4vw, 32px)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>
            {t.brand.poweredBy}{" "}
            <span style={{ font: "var(--fw-extrabold) 14px/1 var(--font-sans)" }}>
              <span style={{ color: "var(--brand-ink)" }}>{t.brand.nameFirst}</span>
              <span style={{ color: "var(--brand-accent)" }}>{t.brand.nameSecond}</span>
            </span>
          </span>
          {/* The store's own profiles sit between the TejoTime credit and the legal links —
              the footer is where people look for "where else can I find this shop". */}
          <SocialLinks socials={site.socials} />
          <span style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-subtle)" }}>
            <Link href="/terms" style={{ color: "inherit" }}>
              {t.brand.terms}
            </Link>
            {" · "}
            <Link href="/privacy" style={{ color: "inherit" }}>
              {t.brand.privacy}
            </Link>
            {" · "}
            {/* A customer who accepted on the booking page can change their mind here without
                having to find the marketing site. */}
            <CookieSettingsButton style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }} />
          </span>
        </div>
        {/* This page is the SMS opt-in URL Twilio reviewers open, so it names the legal entity
            registered as the A2P brand (docs/sms-opt-in-a2p.md). */}
        <p style={{ maxWidth: 1180, margin: "0 auto", padding: "0 clamp(16px, 4vw, 32px) 20px", font: "var(--fw-regular) 12px/1.5 var(--font-sans)", color: "var(--text-subtle)" }}>
          {format(t.brand.operatedBy, { entity: t.legal.entity })}
        </p>
      </div>

      {/* ===== RESUME PILL (restored session) ===== */}
      {showResume && (
        <div onClick={openQueue} className="salonResumePill" style={{ position: "fixed", bottom: 22, right: 22, zIndex: 150, cursor: "pointer", display: "flex", alignItems: "center", gap: 11, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: 999, padding: "10px 18px 10px 13px", boxShadow: "var(--shadow-xl)", animation: "ttModalIn .45s cubic-bezier(.34,1.4,.5,1) both" }}>
          <span style={{ position: "relative", display: "flex", width: 10, height: 10 }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--success)", animation: "ttRing 1.6s ease-out infinite" }} />
            <span style={{ position: "relative", width: 10, height: 10, borderRadius: "50%", background: "var(--success)" }} />
          </span>
          <span style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--text-strong)" }}>
            {inService ? t.microsite.resume.yourTurn : t.microsite.resume.inLine} · {resumeToken}
          </span>
          <span style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: inService ? "var(--success)" : "var(--text-muted)" }}>
            {inService ? t.microsite.resume.headToChair : resumeLabel}
          </span>
          <span style={{ font: "var(--fw-bold) 13px/1 var(--font-sans)", color: "var(--primary)" }}>{t.microsite.resume.track}</span>
        </div>
      )}

      {/* ===== STICKY MOBILE ACTION BAR =====
           Phones only (CSS-gated, not JS) and hidden while the resume pill is showing, so a
           customer already in the queue is not offered a second "Join". On desktop the hero
           CTAs stay in reach; on a phone they scroll away within one swipe. */}
      {!showResume && !joinOpen && !apptsOpen && (
        <div
          className="ttMobileBar"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 80,
            alignItems: "center",
            gap: 12,
            padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "var(--surface-glass, rgba(255,255,255,.96))",
            backdropFilter: "blur(14px)",
            borderTop: "1px solid var(--border-subtle)",
            boxShadow: "0 -6px 24px rgba(15,23,42,.08)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ttMobileBarWait" style={{ font: "var(--fw-extrabold) 16px/1.2 var(--font-sans)", color: walkInsClosed ? "var(--text-muted)" : "var(--text-strong)" }}>
              {status.bar.headline}
            </div>
            {status.bar.sub && (
              <div className="ttMobileBarCount" style={{ font: "var(--fw-semibold) 15px/1.35 var(--font-sans)", color: "var(--text-body)", marginTop: 4 }}>
                {status.bar.sub === "live" ? liveStatus : status.bar.sub}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            <Button size="lg" onClick={walkInsClosed ? openBook : openQueue}>
              {walkInsClosed ? t.microsite.mobileBar.book : t.microsite.mobileBar.checkIn}
            </Button>
          </div>
        </div>
      )}

      {/* ===== HELP CHAT (platform flag) =====
           Rendered only when the payload says CHATBOT_ENABLED is on, so a backend with the
           feature off never shows a launcher that leads to a 404. Read-only by design: it answers
           from the FAQs and the facts on this page and hands every action back to the handlers
           above, so a chat can never join, book or leave for the customer. */}
      {site.chatbotEnabled && (
        <ChatWidget
          send={(body) => publicApi.chat(site.slug, body)}
          title={storeChatTitle(site.name)}
          subtitle={t.chat.subtitle}
          welcome={format(t.chat.flow.welcome, { name: site.name })}
          chips={[t.chat.chips.hours, t.chat.chips.walkIns, t.chat.chips.waitlist]}
          disclaimer={t.chat.flow.disclaimer}
          lifted={showResume}
          phoneHref={phoneFull ? `tel:+${phoneFull}` : null}
          onAction={onChatAction}
          flow={{ ...chatFlow.binding, renderCard: renderChatCard }}
        />
      )}

      {/* ===== GALLERY LIGHTBOX ===== */}
      {lightbox != null && (
        <Lightbox
          photos={galleryPhotos}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onStep={stepLightbox}
        />
      )}

      {/* ===== SAVE CONTACT (vCard) SHEET ===== */}
      {saveOpen && (
        <SaveContactSheet
          open
          onClose={() => setSaveOpen(false)}
          phoneFull={phoneFull}
          storeName={site.name}
          onSaveToPhone={openCardChooser}
        />
      )}

      {/* ===== MY APPOINTMENTS ===== */}
      {apptsOpen && (
        <MyAppointments
          storeName={site.name}
          timezone={site.timezone}
          staff={liveStaff.map((s) => ({ id: s.id, name: s.name }))}
          closedWeekdays={closedWeekdays}
          initialPhone={apptsPhone}
          lookup={lookupApptsByPhone}
          peekLookup={(p) => lookupMem.current.get(p)}
          saveLookup={(p, r) => lookupMem.current.set(p, r)}
          onBook={() => {
            setApptsOpen(false);
            openJoin("book");
          }}
          onClose={() => setApptsOpen(false)}
        />
      )}

      {/* ===== JOIN / BOOK MODAL ===== */}
      {joinOpen && (
        <div onClick={closeJoin} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 24px)", animation: "ttFade .22s ease" }}>
          <div onClick={stop} style={{ width: 460, maxWidth: "100%", background: "var(--surface-card)", borderRadius: "calc(20px * var(--radius-scale, 1))", boxShadow: "var(--shadow-xl)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column", animation: "ttModalIn .42s cubic-bezier(.34,1.4,.5,1) both" }}>
            {/* header w/ steps */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ font: "var(--fw-extrabold) 20px/1 var(--font-sans)", color: "var(--text-strong)" }}>{modeTitle}</span>
                <div onClick={closeJoin} style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                  <Icon name="x" size={18} />
                </div>
              </div>
              {view === "flow" && (
                <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
                  {Array.from({ length: totalSteps }).map((_, i) => (
                    <span key={i} style={{ height: 4, flex: 1, borderRadius: 999, background: accent(i + 1) }} />
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: "22px 24px 26px", overflow: "auto" }}>
              {/* ---------- VIEW: FLOW ---------- */}
              {view === "flow" && (
                <>
                  {/* SCREEN: visitor type (Hospital only) */}
                  {screen === "visitor" && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <p style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 16px" }}>{t.microsite.join.visitorQuestion}</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                        {([
                          ["mr", t.microsite.join.visitorMr, t.microsite.join.visitorMrSub],
                          ["patient", t.microsite.join.visitorPatient, t.microsite.join.visitorPatientSub],
                        ] as const).map(([value, label, sub]) => {
                          const on = visitorType === value;
                          return (
                            <div key={value} onClick={() => setVisitorType(value)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 13, borderRadius: "calc(12px * var(--radius-scale, 1))", padding: "13px 15px", transition: "border-color .15s ease, background .15s ease", background: on ? "color-mix(in srgb, var(--primary) 6%, var(--surface-card))" : "var(--surface-card)", border: `1.5px solid ${on ? "var(--primary)" : "var(--border-subtle)"}` }}>
                              {/* Square, not a circle: a radio says "pick one of these", a checkbox
                                  says "pick any of these". The shape is the affordance — it is
                                  what tells someone they may add the spa as well as the haircut. */}
                              <div role="checkbox" aria-checked={on} style={{ width: 22, height: 22, borderRadius: "calc(6px * var(--radius-scale, 1))", border: `2px solid ${on ? "var(--primary)" : "var(--border-default)"}`, background: on ? "var(--primary)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <span style={{ display: "flex", color: "#fff", transition: "opacity .15s ease", opacity: on ? 1 : 0 }}>
                                  <Icon name="check" size={13} />
                                </span>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ font: "var(--fw-semibold) 15px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{label}</div>
                                <div style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{sub}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 20 }}>
                        <Button variant="primary" size="lg" fullWidth disabled={!visitorType} onClick={() => goNext("visitor")}>
                          {visitorType ? t.common.continue : t.microsite.join.visitorPickOne}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* SCREEN: pick service */}
                  {screen === "service" && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <p style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 16px" }}>
                        {mode === "book" ? t.microsite.join.serviceQuestionBook : t.microsite.join.serviceQuestionQueue}
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                        {services.map((sv) => {
                          const on = cart.includes(sv.id);
                          return (
                            <div key={sv.id} onClick={() => toggleService(sv.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 13, borderRadius: "calc(12px * var(--radius-scale, 1))", padding: "13px 15px", transition: "border-color .15s ease, background .15s ease", background: on ? "color-mix(in srgb, var(--primary) 6%, var(--surface-card))" : "var(--surface-card)", border: `1.5px solid ${on ? "var(--primary)" : "var(--border-subtle)"}` }}>
                              <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--primary)" : "var(--border-default)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <span style={{ display: "flex", color: "var(--primary)", transition: "opacity .15s ease", opacity: on ? 1 : 0 }}>
                                  <Icon name="check" size={13} />
                                </span>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ font: "var(--fw-semibold) 15px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{sv.name}</div>
                                <div style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{sv.dur}</div>
                              </div>
                              {sv.priceLabel ? (
                                <span style={{ font: "var(--fw-bold) 16px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{sv.priceLabel}</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {/* A running total, because more than one service is now normal: the customer
                          needs to see what the visit costs and how long it takes without adding it
                          up themselves. Hidden at zero — an empty row would just be noise. */}
                      {selected.length > 0 && (
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 14, padding: "11px 15px", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: "calc(12px * var(--radius-scale, 1))" }}>
                          <span style={{ font: "var(--fw-medium) 13px/1.35 var(--font-sans)", color: "var(--text-body)" }}>
                            {format(t.microsite.join.serviceTotal, { count: selected.length, minutes: totalMinutes })}
                          </span>
                          {cartTotalLabel ? (
                            <span style={{ flexShrink: 0, font: "var(--fw-bold) 15px/1.35 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
                              {cartTotalLabel}
                            </span>
                          ) : null}
                        </div>
                      )}

                      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                        {flowScreens.indexOf("service") > 0 && (
                          <Button variant="outline" size="lg" onClick={() => goBack("service")}>{t.common.back}</Button>
                        )}
                        <div style={{ flex: 1 }}>
                          <Button variant="primary" size="lg" fullWidth disabled={cart.length === 0} onClick={() => goNext("service")}>
                            {cart.length === 0
                              ? t.microsite.join.servicePickOne
                              : cart.length === 1
                                ? format(t.microsite.join.serviceContinue, { name: sel!.name })
                                : format(t.microsite.join.serviceContinueMany, { count: cart.length })}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SCREEN: details */}
                  {screen === "details" && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{t.microsite.join.nameLabel}</div>
                      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.microsite.join.namePlaceholder} className="salonInput" style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--border-default)", borderRadius: "calc(10px * var(--radius-scale, 1))", fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--text-strong)", outline: "none", marginBottom: 16, background: "var(--surface-card)" }} />
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{t.microsite.join.phoneLabel}</div>
                      <PhoneField country={phoneCountry} national={national} onCountryChange={setPhoneCountry} onNationalChange={setNational} marginBottom={6} />
                      {/* The form asks for a mobile number. Texts only go out if they check
                          the box — Twilio A2P 30925: unchecked by default, not bundled with Confirm. */}
                      <div style={{ font: "var(--fw-regular) 12.5px/1.45 var(--font-sans)", color: "var(--text-muted)", marginBottom: 12 }}>
                        {mode === "book" ? t.microsite.join.phoneHelperBook : t.microsite.join.phoneHelperQueue}
                      </div>
                      {/* One unticked box, on both Book and Check in, that names all three texts —
                          confirmation, reminder and the post-visit review request — so it matches the
                          three registered A2P samples and "Up to 3 messages per visit". Unchecked by
                          default and not tied to Confirm (Twilio 30923 / 30925). Body-size,
                          full-contrast text: A2P reviewers reject disclosures that are not "clearly and
                          conspicuously" visible — small grey type reads as fine print. */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
                        <input
                          id="tt-sms-opt-in"
                          type="checkbox"
                          checked={smsOptIn}
                          onChange={(e) => setSmsOptIn(e.target.checked)}
                          style={{ marginTop: 3, flexShrink: 0, width: 16, height: 16, accentColor: "var(--primary)" }}
                        />
                        <div style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-strong)" }}>
                          <label htmlFor="tt-sms-opt-in" style={{ cursor: "pointer" }}>
                            {format(t.microsite.join.consentOptIn, { name: site.name })}
                          </label>
                          {" "}
                          <Link href="/privacy" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>{t.microsite.join.consentPrivacy}</Link>
                          {" · "}
                          <Link href="/terms" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>{t.microsite.join.consentSmsTerms}</Link>
                        </div>
                      </div>
                      {/* Stylists are optional: a store with none has no one to choose between, so
                          the whole row goes rather than offering a lone "Any" chip. `member` stays
                          "any", which the join/book API already resolves to no preference. */}
                      {members.length > 0 && (
                        <>
                          <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>{t.microsite.join.memberLabel}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                            {[{ id: "any", name: t.microsite.join.memberAny }, ...members.map((b) => ({ id: b.id, name: b.name }))].map((c) => {
                              const on = member === c.id;
                              return (
                                <span key={c.id} onClick={() => { setMember(c.id); if (mode === "book") fetchSlots(cart, bookDate, c.id); }} style={{ cursor: "pointer", font: "var(--fw-semibold) 13px/1 var(--font-sans)", padding: "8px 15px", borderRadius: 999, transition: "all .15s ease", ...(on ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" } : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }) }}>
                                  {c.name}
                                </span>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {mode === "book" && (
                        <>
                          <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>{t.microsite.join.timeLabel}</div>

                          {/* The day strip. Horizontally scrollable rather than wrapped: two weeks
                              of dates wrapped into rows dominates the sheet and buries the times,
                              which are what the customer is actually here to pick. */}
                          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 14, scrollbarWidth: "thin", WebkitOverflowScrolling: "touch" }}>
                            {bookDays.map((d) => {
                              const on = bookDate === d.ymd;
                              return (
                                <button
                                  key={d.ymd}
                                  type="button"
                                  disabled={d.closed}
                                  aria-pressed={on}
                                  aria-label={d.closed ? `${d.full} — ${t.microsite.join.dayClosed}` : d.full}
                                  onClick={() => { setBookDate(d.ymd); fetchSlots(cart, d.ymd, member); }}
                                  style={{
                                    flex: "0 0 auto", minWidth: 62, padding: "8px 10px", textAlign: "center",
                                    borderRadius: "calc(10px * var(--radius-scale, 1))", fontFamily: "var(--font-sans)",
                                    cursor: d.closed ? "not-allowed" : "pointer", opacity: d.closed ? 0.4 : 1,
                                    transition: "all .15s ease",
                                    ...(on
                                      ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" }
                                      : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }),
                                  }}
                                >
                                  <span style={{ display: "block", font: "var(--fw-semibold) 11px/1.3 var(--font-sans)", opacity: 0.85 }}>{d.weekday}</span>
                                  <span style={{ display: "block", font: "var(--fw-bold) 15px/1.25 var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>{d.dayNum}</span>
                                  <span style={{ display: "block", font: "var(--fw-medium) 10.5px/1.3 var(--font-sans)", opacity: 0.75 }}>{d.closed ? t.microsite.join.dayClosed : d.month}</span>
                                </button>
                              );
                            })}
                          </div>

                          {slotsLoading ? (
                            <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", marginBottom: 18 }}>{t.microsite.join.slotsLoading}</div>
                          ) : slots.length === 0 ? (
                            <div style={{ marginBottom: 18 }}>
                              <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>
                                {format(selectedDay?.closed ? t.microsite.join.slotsClosedDay : t.microsite.join.slotsEmptyDay, { date: selectedDay?.full ?? "" })}
                              </div>
                              {/* Fallback only — Check in stays its own entry point. Offered when the
                                  selected day is TODAY and the doors are open, because that is the
                                  only situation where joining the live queue is a real alternative
                                  to the appointment the customer came here for. Keeps the name,
                                  phone, service and provider already entered. */}
                              {canOfferWalkIn && (
                                <div style={{ marginTop: 10 }}>
                                  <Button variant="outline" fullWidth onClick={switchToWaitlist}>
                                    {t.microsite.join.switchToWaitlist}
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                              {slots.map((s) => {
                                const on = selectedSlot === s.startAt;
                                return (
                                  <span key={s.startAt} onClick={() => setSelectedSlot(s.startAt)} style={{ cursor: "pointer", font: "var(--fw-semibold) 13px/1 var(--font-sans)", padding: "8px 13px", borderRadius: "calc(10px * var(--radius-scale, 1))", transition: "all .15s ease", ...(on ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" } : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }) }}>
                                    {s.label}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* REPEAT THIS BOOKING? — after a time is picked, before Confirm, so the
                              preview can judge real dates at that time. "Just this once" is the
                              default; the SMS box above is untouched (its wording is the A2P one). */}
                          {repeatOffered && selectedSlot && (
                            <div style={{ marginBottom: 18 }}>
                              <fieldset style={fieldsetReset}>
                                <legend style={fieldLabel}>{t.microsite.repeat.title}</legend>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  {REPEAT_PRESETS.map((o) => {
                                    const on = repeatChoice === o.value;
                                    return (
                                      <label key={o.value} style={repeatPill(on)}>
                                        <input type="radio" name="tt-repeat" value={o.value} checked={on} onChange={() => setRepeatChoice(o.value)} style={repeatRadio} />
                                        {o.label}
                                      </label>
                                    );
                                  })}
                                  {/* The day count sits inside its own option: typing in it (or
                                      focusing it) selects Custom, so the number can't be filled in
                                      while some other rhythm silently stays chosen. */}
                                  <label style={repeatPill(repeatChoice === "custom")}>
                                    <input type="radio" name="tt-repeat" value="custom" checked={repeatChoice === "custom"} onChange={() => setRepeatChoice("custom")} style={repeatRadio} />
                                    {t.microsite.repeat.custom}
                                    <span style={{ font: "var(--fw-regular) 13px/1.2 var(--font-sans)", color: "var(--text-muted)" }}>{t.microsite.repeat.customEvery}</span>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={REPEAT_LIMITS.minEveryDays}
                                      max={REPEAT_LIMITS.maxEveryDays}
                                      value={customDays}
                                      aria-label={t.microsite.repeat.customDaysAria}
                                      onFocus={() => setRepeatChoice("custom")}
                                      onChange={(e) => {
                                        setCustomDays(e.target.value);
                                        setRepeatChoice("custom");
                                      }}
                                      style={{ ...repeatInput, width: 54, textAlign: "center" }}
                                    />
                                    <span style={{ font: "var(--fw-regular) 13px/1.2 var(--font-sans)", color: "var(--text-muted)" }}>{t.microsite.repeat.customDays}</span>
                                  </label>
                                </div>
                                {repeatDaysError && <div role="alert" style={repeatErrorText}>{repeatDaysError}</div>}
                                {weekdayDrifts && <div style={repeatHint}>{format(t.microsite.repeat.weekdayDrift, { n: repeatEveryDays! })}</div>}
                              </fieldset>

                              {repeatChoice !== "once" && (
                                <>
                                  <fieldset style={{ ...fieldsetReset, marginTop: 16 }}>
                                    <legend style={fieldLabel}>{t.microsite.repeat.stopTitle}</legend>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                      <label style={repeatPill(endChoice === "count")}>
                                        <input type="radio" name="tt-repeat-end" value="count" checked={endChoice === "count"} onChange={() => setEndChoice("count")} style={repeatRadio} />
                                        {t.microsite.repeat.endAfter}
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min={REPEAT_LIMITS.minCount}
                                          max={REPEAT_LIMITS.maxCount}
                                          value={endCount}
                                          aria-label={t.microsite.repeat.endCountAria}
                                          onFocus={() => setEndChoice("count")}
                                          onChange={(e) => {
                                            setEndCount(e.target.value);
                                            setEndChoice("count");
                                          }}
                                          style={{ ...repeatInput, width: 50, textAlign: "center" }}
                                        />
                                        {t.microsite.repeat.endAfterVisits}
                                      </label>
                                      <label style={repeatPill(endChoice === "until")}>
                                        <input type="radio" name="tt-repeat-end" value="until" checked={endChoice === "until"} onChange={chooseUntil} style={repeatRadio} />
                                        {t.microsite.repeat.endOn}
                                        <input
                                          type="date"
                                          min={endDateMin}
                                          max={endDateMax}
                                          value={endDate}
                                          aria-label={t.microsite.repeat.endDateAria}
                                          onFocus={chooseUntil}
                                          onChange={(e) => {
                                            setEndDate(e.target.value);
                                            setEndChoice("until");
                                          }}
                                          style={{ ...repeatInput, width: 142 }}
                                        />
                                      </label>
                                      <label style={repeatPill(endChoice === "never")}>
                                        <input type="radio" name="tt-repeat-end" value="never" checked={endChoice === "never"} onChange={() => setEndChoice("never")} style={repeatRadio} />
                                        {t.microsite.repeat.endNever}
                                      </label>
                                    </div>
                                    {repeatEndError && <div role="alert" style={repeatErrorText}>{repeatEndError}</div>}
                                  </fieldset>

                                  {/* What they are agreeing to, date by date, before they confirm. */}
                                  {repeatRule && (
                                    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: "calc(12px * var(--radius-scale, 1))" }}>
                                      <div style={fieldLabel}>{t.microsite.repeat.previewTitle}</div>
                                      {previewLoading ? (
                                        <div aria-live="polite" style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{t.microsite.repeat.previewLoading}</div>
                                      ) : currentPreview?.data ? (
                                        <>
                                          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                                            {currentPreview.data.dates.map((d) => {
                                              const skipped = d.status === "closed" || d.status === "taken" || d.status === "outside_hours";
                                              return (
                                                <li key={d.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, font: "var(--fw-medium) 13.5px/1.35 var(--font-sans)" }}>
                                                  {/* `date` is already the store's calendar date, so it is printed as-is
                                                      rather than converted through the viewer's zone. */}
                                                  <span style={{ color: d.status === "ok" ? "var(--text-strong)" : "var(--text-muted)", textDecoration: skipped ? "line-through" : undefined }}>
                                                    {formatYmd(d.date)}
                                                  </span>
                                                  {skipped && (
                                                    <span style={{ flexShrink: 0, font: "var(--fw-medium) 12.5px/1.35 var(--font-sans)", color: d.status === "closed" ? "var(--text-muted)" : "var(--warning-soft-fg)" }}>
                                                      {d.status === "closed" ? t.microsite.repeat.statusClosed : t.microsite.repeat.statusTaken}
                                                    </span>
                                                  )}
                                                </li>
                                              );
                                            })}
                                          </ul>
                                          <div style={{ marginTop: 8, font: "var(--fw-semibold) 13px/1.4 var(--font-sans)", color: "var(--text-body)" }}>
                                            {currentPreview.data.totalVisits == null || !currentPreview.data.lastDate
                                              ? t.microsite.repeat.andMore
                                              : format(t.microsite.repeat.totalLine, { count: currentPreview.data.totalVisits, date: formatYmd(currentPreview.data.lastDate) })}
                                          </div>
                                          {currentPreview.data.dates.some((d) => d.status === "later") && (
                                            <div style={repeatHint}>{t.microsite.repeat.laterNote}</div>
                                          )}
                                        </>
                                      ) : currentPreview?.error ? (
                                        <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{currentPreview.error}</div>
                                      ) : null}
                                      <div style={{ ...repeatHint, marginTop: 10 }}>{t.microsite.repeat.finePrint}</div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* What the customer is about to agree to, spelled out before the button
                          rather than after it: service, how long it takes, when, with whom, and
                          what it costs. This used to read "THREADING · choose a time above · $0". */}
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: "calc(12px * var(--radius-scale, 1))", padding: "13px 15px", marginBottom: 14 }}>
                        <span style={{ minWidth: 0, font: "var(--fw-medium) 13px/1.45 var(--font-sans)", color: "var(--text-body)" }}>
                          <span style={{ display: "block", font: "var(--fw-semibold) 13.5px/1.35 var(--font-sans)", color: "var(--text-strong)" }}>
                            {selected.length
                              ? [selected.map((sv) => sv.name).join(" + "), `${totalMinutes} min`].join(" · ")
                              : site.name}
                          </span>
                          <span style={{ display: "block", marginTop: 3 }}>
                            {[summaryWhen, summaryProvider].filter(Boolean).join(" · ")}
                          </span>
                          {mode === "book" && summaryRepeat && (
                            <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, color: "var(--text-strong)" }}>
                              <Icon name="repeat" size={13} />
                              {summaryRepeat}
                            </span>
                          )}
                        </span>
                        {cartTotalLabel ? (
                          <span style={{ flexShrink: 0, font: "var(--fw-bold) 16px/1.35 var(--font-sans)", color: "var(--text-strong)" }}>{cartTotalLabel}</span>
                        ) : null}
                      </div>
                      {/* Nothing is charged here — payments are not wired — so the page has to say
                          where the money is actually taken, before the customer commits. */}
                      <div style={{ font: "var(--fw-regular) 12.5px/1.45 var(--font-sans)", color: "var(--text-muted)", marginBottom: 14 }}>
                        {t.microsite.join.paymentNote}
                      </div>
                      {formError && <div style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--error)", marginBottom: 12 }}>{formError}</div>}
                      <div style={{ display: "flex", gap: 10 }}>
                        {flowScreens.indexOf("details") > 0 && (
                          <Button variant="outline" size="lg" onClick={() => goBack("details")}>{t.common.back}</Button>
                        )}
                        <div style={{ flex: 1 }}>
                          <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={cantConfirm || submitting} onClick={confirmJoin}>
                            {mode === "book" ? t.microsite.join.confirmBooking : t.microsite.join.confirmCheckIn}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SCREEN: ticket / booked */}
                  {screen === "success" && (
                    <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                      <div style={{ position: "relative", width: 68, height: 68, margin: "6px auto 16px" }}>
                        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--success)", animation: "ttRing 1.2s ease-out infinite" }} />
                        <div style={{ position: "relative", width: 68, height: 68, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", animation: "ttPop .5s cubic-bezier(.34,1.5,.5,1) both" }}>
                          <Icon name="check" size={34} />
                        </div>
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 22px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>
                        {mode === "book"
                          ? booking?.series
                            ? format(t.microsite.repeat.successTitle, { rhythm: rhythmLabel(booking.series.everyDays) })
                            : t.microsite.success.booked
                          : ticket?.status === "completed"
                            ? t.microsite.success.allDone
                            : ticket && !isActive(ticket.status)
                              ? t.microsite.success.noLongerInQueue
                              : justTurn
                                ? t.microsite.success.yourTurn
                                : t.microsite.success.inQueue}
                      </h3>
                      <p style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>
                        {mode === "book"
                          ? booking?.series
                            ? // Every date is listed below, so this line names what repeats, not when.
                              [booking.serviceName || t.microsite.success.yourVisit, booking.staffName].filter(Boolean).join(" · ")
                            : booking
                            ? format(t.microsite.success.bookingLine, { service: booking.serviceName || t.microsite.success.yourVisit, when: formatInStoreZone(booking.scheduledStartAt, site.timezone, { weekday: "short", hour: "numeric", minute: "2-digit" }) })
                            : t.microsite.success.bookedSub
                          : ticket?.status === "completed"
                            ? t.microsite.success.completedSub
                            : ticket && !isActive(ticket.status)
                              ? t.microsite.success.noLongerSub
                              : justTurn
                                ? t.microsite.success.yourTurnSub
                                : (ticket?.ahead ?? 0) <= 1
                                  ? t.microsite.success.nextSub
                                  : t.microsite.success.waitSub}
                      </p>
                      {/* How to get back to it. A one-off booking has no link to keep, and people
                          don't keep links anyway — My Appointments finds it by phone number on any
                          device (client decision 2026-10-05). A series says so beside its link. */}
                      {mode === "book" && booking && !booking.series && (
                        <p style={{ font: "var(--fw-regular) 12.5px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "-10px 0 18px" }}>
                          {t.microsite.success.manageHint}
                        </p>
                      )}

                      {mode === "queue" && ticket && (
                        <div style={{ border: "2px solid var(--text-strong)", borderRadius: "calc(16px * var(--radius-scale, 1))", padding: 20, marginBottom: 16 }}>
                          <div style={{ font: "var(--fw-bold) 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{t.microsite.success.yourToken}</div>
                          <div style={{ font: "var(--fw-extrabold) 46px/1 var(--font-sans)", color: "var(--text-strong)", margin: "8px 0", letterSpacing: "-.01em" }}>{ticket.token}</div>
                          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 10 }}>
                            <div>
                              <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{justTurn ? 0 : ticket.ahead}</div>
                              <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{t.microsite.wait.aheadOfYou}</div>
                            </div>
                            {services.length > 0 && (
                              <div>
                                <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--secondary)", fontVariantNumeric: "tabular-nums" }}>{justTurn ? t.microsite.wait.now : `~${displayWait}m`}</div>
                                <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{t.microsite.wait.estWait}</div>
                              </div>
                            )}
                          </div>
                          <div style={{ height: 6, background: "var(--surface-sunken)", borderRadius: 999, marginTop: 16, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: progressPct, background: "var(--success)", borderRadius: 999, transition: "width .6s ease" }} />
                          </div>
                        </div>
                      )}

                      {mode === "book" && booking?.series && (
                        <div style={{ textAlign: "left", marginBottom: 16 }}>
                          <div style={fieldLabel}>{t.microsite.repeat.bookedVisits}</div>
                          <ul style={{ listStyle: "none", margin: "0 0 4px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                            {booking.series.visits.map((v) => (
                              <li key={v.appointmentId} style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-semibold) 14px/1.35 var(--font-sans)", color: "var(--text-strong)" }}>
                                <span style={{ color: "var(--success)", display: "flex" }}>
                                  <Icon name="check" size={15} />
                                </span>
                                {formatInStoreZone(v.scheduledStartAt, site.timezone, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                              </li>
                            ))}
                          </ul>
                          {/* Dates inside the first three weeks that could NOT be booked — said
                              here so nobody turns up for a visit that does not exist. */}
                          {booking.series.skipped.length > 0 && (
                            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                              {booking.series.skipped.map((s) => (
                                <li key={s.date} style={{ font: "var(--fw-medium) 13px/1.4 var(--font-sans)", color: s.reason === "closed" ? "var(--text-muted)" : "var(--warning-soft-fg)" }}>
                                  {format(t.microsite.repeat.notBooked, {
                                    date: formatYmd(s.date),
                                    reason: s.reason === "closed" ? t.microsite.repeat.reasonClosed : t.microsite.repeat.reasonNotFree,
                                  })}
                                </li>
                              ))}
                            </ul>
                          )}
                          {booking.moreToCome && <div style={repeatHint}>{t.microsite.repeat.laterNote}</div>}

                          {/* No link to save here (client, 2026-10-05): customers didn't keep it. They come
                              back to this page and use My Appointments, which finds the booking by phone
                              number (docs/customer-my-appointments.md). The confirmation SMS still links
                              to the manage page. */}
                          <div style={{ ...repeatHint, marginTop: 12 }}>{t.microsite.repeat.manageHint}</div>
                        </div>
                      )}

                      {mode === "queue" && ticket && isActive(ticket.status) && !confirmLeave && (
                        <>
                          <Button variant="primary" fullWidth onClick={closeJoin}>{t.common.done}</Button>
                          {canLeaveQueue(ticket.status) && !!held?.ticketKey && (
                            <div onClick={askLeave} style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--error)", marginTop: 14, cursor: "pointer" }}>{t.microsite.success.leaveQueue}</div>
                          )}
                        </>
                      )}
                      {(mode === "book" || !ticket || !isActive(ticket.status)) && !confirmLeave && (
                        <Button variant="primary" fullWidth onClick={closeJoin}>{t.common.done}</Button>
                      )}
                      {confirmLeave && (
                        <LeaveConfirm token={ticket?.token ?? held?.token ?? ""} onStay={cancelLeave} onLeave={confirmLeaveQueue} />
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ---------- VIEW: TRACK MY TURN ---------- */}
              {view === "track" && (
                <>
                  {/* TRACK STEP 1: phone */}
                  {tstep === 1 && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <div style={{ width: 52, height: 52, borderRadius: "calc(14px * var(--radius-scale, 1))", background: "color-mix(in srgb, var(--secondary) 12%, var(--surface-card))", color: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <Icon name="ticket" size={24} />
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>{t.microsite.track.title}</h3>
                      <p style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>
                        {t.microsite.track.body}
                      </p>
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{t.microsite.track.phoneLabel}</div>
                      <PhoneField country={phoneCountry} national={national} onCountryChange={setPhoneCountry} onNationalChange={setNational} marginBottom={18} />
                      {formError && <div style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--error)", marginBottom: 12 }}>{formError}</div>}
                      <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={phone.replace(/\D/g, "").length < 4 || submitting} onClick={runTrack}>
                        {t.microsite.track.submit}
                      </Button>
                    </div>
                  )}

                  {/* TRACK STEP 3: no active booking */}
                  {tstep === 3 && (
                    <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                      <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface-sunken)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
                        <Icon name="search" size={26} />
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>{t.microsite.track.noneTitle}</h3>
                      <p style={{ font: "var(--fw-regular) 14px/1.55 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 20px" }}>
                        {t.microsite.track.noneBody}
                      </p>
                      <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <Button variant="outline" fullWidth onClick={closeJoin}>{t.common.close}</Button>
                        </div>
                        <div style={{ flex: 1 }}>
                          <Button variant="primary" fullWidth onClick={joinAfterTrack}>
                            {walkInsClosed ? t.microsite.track.book : t.microsite.track.checkIn}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ---------- VIEW: ALREADY IN LINE ---------- */}
              {view === "already" && (
                <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "50%", background: inService ? "var(--success-soft)" : "color-mix(in srgb, var(--secondary) 12%, var(--surface-card))", color: inService ? "var(--success)" : "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
                    <Icon name={inService ? "check" : "ticket"} size={30} />
                  </div>
                  <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>{inService ? t.microsite.already.yourTurn : t.microsite.already.title}</h3>
                  <p style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>{inService ? t.microsite.already.yourTurnBody : t.microsite.already.body}</p>
                  <div style={{ border: "2px solid var(--text-strong)", borderRadius: "calc(16px * var(--radius-scale, 1))", padding: 18, marginBottom: 16 }}>
                    <div style={{ font: "var(--fw-bold) 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{t.microsite.success.yourToken}</div>
                    <div style={{ font: "var(--fw-extrabold) 40px/1 var(--font-sans)", color: "var(--text-strong)", margin: "8px 0" }}>{ticket?.token ?? held?.token ?? ""}</div>
                    <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6 }}>
                      <div>
                        <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "var(--primary)" }}>{justTurn ? 0 : ticket?.ahead ?? 0}</div>
                        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{t.microsite.wait.aheadOfYou}</div>
                      </div>
                      {services.length > 0 && (
                        <div>
                          <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "var(--secondary)" }}>{justTurn ? t.microsite.wait.now : `~${displayWait}m`}</div>
                          <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{t.microsite.wait.estWait}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {!confirmLeave ? (
                    <>
                      <Button variant="primary" fullWidth onClick={closeJoin}>{t.microsite.already.trackMyTurn}</Button>
                      {canLeaveQueue(ticket?.status) && !!held?.ticketKey ? (
                        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                          <div style={{ flex: 1 }}>
                            <Button variant="outline" fullWidth onClick={joinDifferent}>{t.microsite.already.differentNumber}</Button>
                          </div>
                          <div style={{ flex: 1 }}>
                            <Button variant="ghost" fullWidth onClick={askLeave}>{t.microsite.already.leaveQueue}</Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 10 }}>
                          {/* Found by phone lookup on this device: no ticket key, so no Leave here. */}
                          {canLeaveQueue(ticket?.status) && !held?.ticketKey && (
                            <p style={{ font: "var(--fw-regular) 12.5px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 10px" }}>{t.chat.flow.leaveOtherDevice}</p>
                          )}
                          <Button variant="outline" fullWidth onClick={joinDifferent}>{t.microsite.already.differentNumber}</Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <LeaveConfirm token={ticket?.token ?? held?.token ?? ""} onStay={cancelLeave} onLeave={confirmLeaveQueue} />
                  )}
                </div>
              )}

              {/* ---------- VIEW: BLOCKED / RATE-LIMITED ---------- */}
              {view === "blocked" && (
                <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--warning-soft)", color: "var(--warning-soft-fg)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
                    <Icon name="hourglass" size={28} />
                  </div>
                  <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>{t.microsite.blocked.title}</h3>
                  <p style={{ font: "var(--fw-regular) 14px/1.55 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 8px" }}>
                    {t.microsite.blocked.bodyLead} <span style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--text-strong)" }}>{t.microsite.blocked.bodyCall}</span> {t.microsite.blocked.bodyTail}
                  </p>
                  {shopPhone && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: "calc(12px * var(--radius-scale, 1))", padding: 12, margin: "16px 0" }}>
                      <span style={{ color: "var(--primary)", display: "flex" }}>
                        <Icon name="phone" size={16} />
                      </span>
                      <span style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--text-strong)" }}>{shopPhone}</span>
                    </div>
                  )}
                  <Button variant="primary" fullWidth onClick={closeJoin}>{t.common.gotIt}</Button>
                  {/* The block covers the walk-in line only; appointments stay open to this number. */}
                  <div style={{ marginTop: 10 }}>
                    <Button variant="outline" fullWidth onClick={() => openJoin("book")}>{t.microsite.track.book}</Button>
                  </div>
                </div>
              )}

              {/* ---------- VIEW: LEFT QUEUE ---------- */}
              {view === "left" && (
                <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface-sunken)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
                    <Icon name="check" size={28} />
                  </div>
                  <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>{t.microsite.left.title}</h3>
                  <p style={{ font: "var(--fw-regular) 14px/1.55 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 20px" }}>{leftMsg}</p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <Button variant="outline" fullWidth onClick={closeJoin}>{t.common.close}</Button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Button variant="primary" fullWidth onClick={joinDifferent}>{t.microsite.left.rejoin}</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </ThemePortalProvider>
  );
}

// Inline "leave the queue?" confirmation used by the ticket and already-in-line views.
function LeaveConfirm({ token, onStay, onLeave }: { token: string; onStay: () => void; onLeave: () => void }) {
  return (
    <div style={{ border: "1.5px solid var(--error)", borderRadius: "calc(14px * var(--radius-scale, 1))", padding: 16, background: "color-mix(in srgb, var(--error) 5%, var(--surface-card))", textAlign: "left", animation: "ttStep .25s ease both" }}>
      <div style={{ font: "var(--fw-bold) 15px/1.3 var(--font-sans)", color: "var(--text-strong)", marginBottom: 6 }}>{t.microsite.leaveConfirm.title}</div>
      <div style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", marginBottom: 14 }}>
        {format(t.microsite.leaveConfirm.body, { token })}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Button variant="outline" fullWidth onClick={onStay}>{t.microsite.leaveConfirm.stay}</Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button variant="danger" fullWidth onClick={onLeave}>{t.microsite.leaveConfirm.leave}</Button>
        </div>
      </div>
    </div>
  );
}
