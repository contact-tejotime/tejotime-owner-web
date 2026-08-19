"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import PhoneField from "@/components/ui/PhoneField";
import { ApiError, publicApi, type Microsite, type MicrositeStaff, type Slot, type Ticket } from "@/lib/api";
import { t, format } from "@/i18n";
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
import "./salon.css";
import { SocialLinks } from "./SocialLinks";

/**
 * Interaction-only surfaces, kept out of the first-load chunk.
 *
 * SaveContactSheet drags in qrcode.react and Lightbox is a full-screen viewer — neither is on
 * the path to first paint, and both are opened by an explicit tap. `ssr: false` is honest here:
 * they render nothing until opened, so there is no server markup to miss.
 */
const SaveContactSheet = dynamic(() => import("./SaveContactSheet"), { ssr: false });
const Lightbox = dynamic(() => import("./sections").then((m) => ({ default: m.Lightbox })), {
  ssr: false,
});

const AVATAR_COLORS = ["var(--primary)", "var(--secondary)", "var(--amber-500)"];
const DAYS = t.microsite.days;

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
interface Store {
  hold: HeldRecord | null;
  attempts: Record<string, number>;
  blocked: Record<string, boolean>;
  lastPhone: string;
  lastName: string;
}
const defaultStore = (): Store => ({ hold: null, attempts: {}, blocked: {}, lastPhone: "", lastName: "" });
function readStore(key: string): Store {
  if (typeof window === "undefined") return defaultStore();
  try {
    return { ...defaultStore(), ...(JSON.parse(localStorage.getItem(key) || "null") || {}) };
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
 * Structured live status — same four cases as the old plain `liveSub` string, with the
 * free-count / ahead-count pulled forward so "All 4 free" and waiting numbers attract the eye.
 * Used by the mobile bottom bar and LiveBoard dark tile (compact one-liners).
 */
function LiveStatusLine({
  membersLength,
  liveCount,
  freeName,
  freeCount,
  onDark,
}: {
  membersLength: number;
  liveCount: number;
  freeName: string | null;
  freeCount: number;
  onDark?: boolean;
}) {
  const muted = onDark ? "rgba(255,255,255,.7)" : "var(--text-muted)";
  const body = onDark ? "rgba(255,255,255,.92)" : "var(--text-body)";
  const freePhrase = onDark ? "rgba(255,255,255,.95)" : "var(--success)";

  if (membersLength === 0) {
    return (
      <span style={{ color: body }}>
        <LiveStatusNum onDark={onDark}>{liveCount}</LiveStatusNum>
        <span style={{ color: muted }}> in the queue right now</span>
      </span>
    );
  }
  if (liveCount === 0 && freeCount > 0) {
    return (
      <span style={{ color: body }}>
        <span style={{ font: "var(--fw-bold) 1em/1.35 var(--font-sans)", color: freePhrase }}>
          All <LiveStatusNum onDark={onDark}>{membersLength}</LiveStatusNum> free
        </span>
        <span style={{ color: muted }}> · no wait</span>
      </span>
    );
  }
  if (freeName) {
    return (
      <span style={{ color: body }}>
        <span style={{ font: "var(--fw-semibold) 1em/1.35 var(--font-sans)", color: body }}>{freeName} free</span>
        <span style={{ color: muted }}> · </span>
        <LiveStatusNum onDark={onDark}>{liveCount}</LiveStatusNum>
        <span style={{ color: muted }}> waiting</span>
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
  waitHeadline,
}: {
  liveCount: number;
  members: QueueStaffMember[];
  waitHeadline: string;
}) {
  const freeCount = members.filter((m) => !m.busy).length;
  const assignedWaiting = members.reduce((n, m) => n + m.count, 0);
  const unassignedWaiting = Math.max(0, liveCount - assignedWaiting);
  const shown = members.slice(0, QUEUE_STAFF_PREVIEW);
  const overflow = members.length - shown.length;
  const isClear = liveCount === 0 && (members.length === 0 || freeCount > 0);

  const headline =
    members.length === 0 ? (
      <>
        <span className="ttWaitCountNum" style={{ fontVariantNumeric: "tabular-nums" }}>{liveCount}</span>
        <span className="ttWaitCountLabel" style={{ font: "var(--fw-bold) 0.55em/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-muted)", marginLeft: "0.28em" }}>
          in queue
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
            min wait
          </span>
        </span>
      </span>
    ) : (
      <>
        <span className="ttWaitCountNum" style={{ fontVariantNumeric: "tabular-nums" }}>{liveCount}</span>
        <span className="ttWaitCountLabel" style={{ font: "var(--fw-bold) 0.55em/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-muted)", marginLeft: "0.28em" }}>
          waiting
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
          color: isClear ? "var(--success)" : "var(--text-strong)",
        }}
      >
        {headline}
      </div>
      <div
        className="ttWaitEstimate"
        style={{
          marginTop: 10,
          font: "var(--fw-semibold) clamp(16px, 4vw, 18px)/1.35 var(--font-sans)",
          color: "var(--text-body)",
        }}
      >
        {waitHeadline}
      </div>
      {members.length > 0 && (
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
  return waitMinutes > 0 ? format(t.microsite.wait.minShort, { min: waitMinutes }) : t.microsite.wait.free;
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
  const [cart, setCart] = useState<string | null>(null);
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
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [booking, setBooking] = useState<{ serviceName: string | null; scheduledStartAt: string } | null>(null);
  const [justTurn, setJustTurn] = useState(false);
  const [initialAhead, setInitialAhead] = useState(0);
  // Wall-clock tick that drives the live countdown. null until mount (keeps SSR/first paint equal
  // to the server value — no hydration mismatch); then updated every 15s while a ticket is active.
  const [nowTs, setNowTs] = useState<number | null>(null);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leftMsg, setLeftMsg] = useState("");
  const [held, setHeld] = useState<HeldRecord | null>(null);
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
    if (!store.hold) return;
    const rec = store.hold;
    publicApi
      .getTicket(rec.ticketId)
      .then((t) => {
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
  const services = (site.services ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    dur: `${s.durationMinutes} min`,
    price: Math.round(s.price.amount / 100),
  }));
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
    if (next === "details" && mode === "book") await fetchSlotsForToday(cart);
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

  // Render each About piece only when it has real content; collapse the section otherwise.
  const hasHeading = !!site.aboutHeading?.trim();
  const hasDescription = !!site.description?.trim();
  const hasAmenities = amenities.length > 0;
  const hasAboutText = hasHeading || hasDescription || hasAmenities;
  const hasAboutImage = !!site.aboutImageUrl;
  const showAbout = hasAboutText || hasAboutImage || isDemo;
  const rating = site.rating ?? 0;
  const reviewCount = site.reviewCount ?? 0;
  const establishedYear = site.establishedYear ?? 2014;
  const yearsOpen = Math.max(1, new Date().getFullYear() - establishedYear);

  // Trust stats — only surface cells with real data (no "in town" / "0 team members" / "★ 0"
  // placeholders). Rendered as a row at the bottom of the About section.
  const trustCells = [
    site.establishedYear != null && site.area
      ? [format(t.microsite.ticker.yearsOpen, { years: yearsOpen }), format(t.microsite.ticker.inArea, { area: site.area })]
      : null,
    members.length > 0
      ? [format(t.microsite.ticker.membersCount, { count: members.length }), t.microsite.ticker.expertTeam]
      : null,
    site.statValue && site.statLabel ? [site.statValue, site.statLabel] : null,
    reviewCount > 0
      ? [format(t.microsite.ticker.ratingStars, { rating }), format(t.microsite.ticker.reviewsCount, { count: reviewCount })]
      : null,
  ].filter(Boolean) as [string, string][];

  // ---- modal control ----
  const openJoin = (m: "queue" | "book", preselectMember = "any") => {
    setMode(m);
    setConfirmLeave(false);
    setFormError("");
    const store = storeRef.current;
    const lp = store.lastPhone;
    if (lp && store.blocked[lp]) {
      seedPhone(lp);
      setView("blocked");
      setJoinOpen(true);
      return;
    }
    if (held) {
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
    setCart(null);
    setVisitorType(null);
    setName(store.lastName || "");
    seedPhone(lp || "");
    setMember(preselectMember);
    setTicket(null);
    setBooking(null);
    setJustTurn(false);
    setSlots([]);
    setSelectedSlot(null);
    setJoinOpen(true);
    if (firstScreen === "details" && m === "book") fetchSlotsForToday(null);
  };
  const openQueue = () => openJoin("queue");
  const openBook = () => openJoin("book");
  const openWith = (memberId: string) => openJoin("queue", memberId);

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
      const r = await publicApi.trackByPhone(site.slug, { phone: p });
      const store = storeRef.current;
      store.lastPhone = p;
      const knownName = r.customerName ?? "";
      setTrackedName(knownName);
      if (knownName) store.lastName = knownName;
      if (r.found) {
        const t: Ticket = r;
        setTicket(t);
        setInitialAhead(t.ahead);
        setJustTurn(!!t.isYourTurn);
        // Persist the hold so THIS browser now also restores on reload.
        store.hold = {
          phone: p,
          name: store.lastName || name.trim(),
          ticketId: t.ticketId,
          ticketKey: t.socket?.ticketKey ?? "",
          businessId: t.socket?.businessId ?? site.id,
          token: t.token,
        };
        writeStore(storeKey, store);
        setHeld(store.hold);
        if (t.socket) openSocket({ businessId: t.socket.businessId, ticketId: t.ticketId, ticketKey: t.socket.ticketKey });
        startTicketPoll(t.ticketId);
        setView("already");
      } else {
        writeStore(storeKey, store);
        setTstep(3);
      }
    } catch (e) {
      setFormError((e as Error)?.message ?? t.microsite.join.errGeneric);
    } finally {
      setSubmitting(false);
    }
  };
  // From the Track "no active booking" screen: carry the phone + known name into a
  // fresh Join; only service selection is left.
  const joinAfterTrack = () => {
    setMode("queue");
    setView("flow");
    setScreen(flowScreens[0]);
    setCart(null);
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

  const fetchSlotsForToday = async (serviceId: string | null) => {
    setSlotsLoading(true);
    setSelectedSlot(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await publicApi.getSlots(site.slug, { date: today, serviceId: serviceId ?? undefined });
      setSlots(r.slots);
    } catch {
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  };
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
    if (blockGuard(phone.trim())) return;
    performJoinOrBook();
  };

  // Perform the REAL join/book — the single place that talks to the join/book API.
  const performJoinOrBook = async () => {
    if (services.length > 0 && !cart) return;
    const p = phone.trim();
    setSubmitting(true);
    setFormError("");
    try {
      if (mode === "queue") {
        const t = await publicApi.joinQueue(site.slug, {
          serviceId: cart ?? undefined,
          name: name.trim(),
          phone: p,
          preferredStaffId: member,
          visitorType: visitorType ?? undefined,
        });
        setTicket(t);
        setInitialAhead(t.ahead);
        setJustTurn(!!t.isYourTurn);
        const store = storeRef.current;
        store.hold = {
          phone: p,
          name: name.trim(),
          ticketId: t.ticketId,
          ticketKey: t.socket?.ticketKey ?? "",
          businessId: t.socket?.businessId ?? site.id,
          token: t.token,
        };
        store.lastPhone = p;
        store.lastName = name.trim();
        // Only count a genuinely new join toward the abuse counter — a day-scoped dedup hit
        // (the phone was already in today's queue) is a no-op, not a fresh join.
        if (!t.alreadyInQueue) store.attempts[p] = (store.attempts[p] || 0) + 1;
        writeStore(storeKey, store);
        setHeld(store.hold);
        if (t.socket) openSocket({ businessId: t.socket.businessId, ticketId: t.ticketId, ticketKey: t.socket.ticketKey });
        startTicketPoll(t.ticketId);
        // Backend found this phone already holds a live ticket today → show it, don't dupe.
        if (t.alreadyInQueue) setView("already");
        else setScreen("success");
      } else {
        const b = await publicApi.bookSlot(site.slug, {
          serviceId: cart ?? undefined,
          name: name.trim(),
          phone: p,
          preferredStaffId: member,
          slotStart: selectedSlot!,
          visitorType: visitorType ?? undefined,
        });
        setBooking({ serviceName: b.serviceName, scheduledStartAt: b.scheduledStartAt });
        const store = storeRef.current;
        store.lastPhone = p;
        store.lastName = name.trim();
        writeStore(storeKey, store);
        setScreen("success");
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "RATE_LIMITED") {
        const store = storeRef.current;
        store.blocked[p] = true;
        store.lastPhone = p;
        writeStore(storeKey, store);
        setView("blocked");
      } else {
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
  const confirmLeaveQueue = async () => {
    const store = storeRef.current;
    const p = (phone || store.lastPhone).trim();
    const tid = held?.ticketId ?? ticket?.ticketId;
    if (tid) {
      try {
        await publicApi.leaveTicket(tid);
      } catch {
        /* ignore */
      }
    }
    store.hold = null;
    writeStore(storeKey, store);
    setHeld(null);
    stopTicketPoll();
    openSocket({ businessId: site.id });
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
    setCart(null);
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
  };

  // ---- derived render values ----
  const sel = services.find((x) => x.id === cart);
  // Shop-wide "soonest free chair" wait. A 0 means a chair is open right now, so read
  // it as an invitation ("Walk in now") rather than the nonsensical "~0 min wait".
  const displayLiveWait = displayStaffWaitMinutes(liveWait, liveAsOf, nowTs);
  const waitHeadline = displayLiveWait > 0 ? format(t.microsite.wait.minWait, { min: displayLiveWait }) : t.microsite.wait.walkInNow;
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

  // In-page jump links, shared by the desktop bar and the mobile dropdown so the
  // two never drift. Each is shown only when its section actually renders.
  const navLinks = (
    [
      [showAbout, t.microsite.nav.about, "#about"],
      [gallery.length > 0 || isDemo, t.microsite.nav.gallery, "#gallery"],
      [services.length > 0, t.microsite.nav.services, "#services"],
      [members.length > 0, t.microsite.nav.team, "#team"],
      [Boolean(site.address || site.area || site.hours.length > 0), t.microsite.nav.visitUs, "#visit"],
    ] as [boolean, string, string][]
  ).filter(([show]) => show);


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

  const cantConfirm = !name.trim() || phone.replace(/\D/g, "").length < 4 || (mode === "book" && !selectedSlot);

  // Theming root. The colour tokens themselves are server-rendered by <ThemeStyle/> into a
  // <style> block keyed on [data-tt-theme]; this element only carries the two attributes that
  // select which of its light/dark blocks applies. useThemePreview is a no-op unless the URL
  // carries ?preview=1 (admin live preview), in which case it overwrites the tokens in place.
  // Wording and section order for this store's vertical. A clinic should not be told it has
  // "stylists", and a restaurant's photos matter more than its staff roster. Unknown
  // categories fall through to the current salon copy, so nothing regresses.
  const domain = domainFor(site.category);
  const queueWord = domain.id === "clinic" ? t.microsite.queueWord.waitingList : domain.id === "food" ? t.microsite.queueWord.waitlist : t.microsite.queueWord.queue;
  const svcEyebrow = domain.id === "clinic" ? t.microsite.sections.svcEyebrowTreatments : t.microsite.sections.svcEyebrowMenu;
  // v3's live sub-line: an empty queue is an invitation, never a "0".
  const freeMembers = members.filter((m) => !m.busy);
  const liveStatus = (
    <LiveStatusLine
      membersLength={members.length}
      liveCount={liveCount}
      freeCount={freeMembers.length}
      freeName={freeMembers[0]?.name ?? null}
    />
  );
  const liveStatusDark = (
    <LiveStatusLine
      membersLength={members.length}
      liveCount={liveCount}
      freeCount={freeMembers.length}
      freeName={freeMembers[0]?.name ?? null}
      onDark
    />
  );
  // v3's four icon cards. Built from the same guarded data as the old trust row, so a store
  // without an established year or reviews simply shows fewer cards rather than zeroes.
  // v3's accent marquee: what the store offers, then where and how well rated.
  const tickerItems = [
    ...services.map((sv) => `${sv.name} · ${curSym}${sv.price}`),
    site.area ?? null,
    site.establishedYear != null ? format(t.microsite.hero.since, { year: site.establishedYear }) : null,
    reviewCount > 0 ? format(t.microsite.ticker.ratingReviews, { rating, reviewCount }) : null,
  ].filter(Boolean) as string[];
  const statCards = [
    site.establishedYear != null && site.area
      ? { icon: "calendar" as const, value: format(t.microsite.ticker.yearsServing, { years: yearsOpen }), label: format(t.microsite.ticker.servingArea, { area: site.area }) }
      : null,
    reviewCount > 0
      ? { icon: "star" as const, value: String(rating), label: format(t.microsite.ticker.verifiedReviews, { count: reviewCount }) }
      : null,
    { icon: "hourglass" as const, value: waitHeadline, label: liveCount === 0 ? "walk in right now" : "shortest wait now" },
    members.length > 0
      ? { icon: "users" as const, value: String(members.length), label: "on the floor" }
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

  // Tapping a service card opens the join flow with that service already chosen. openJoin
  // clears the cart, so the selection is applied after it — both run in one batched handler.
  const openServiceBooking = (serviceId: string) => {
    openJoin("queue");
    setCart(serviceId);
  };

  /* Sections whose position varies by domain are built here and placed by the order map in
     the return. Their internals are unchanged apart from the trust row, which is now a
     the live floor as v3 stat cards. */
  const aboutSection = (showAbout || trustCells.length > 0) ? (
      
        <div id="about" style={{ maxWidth: 1180, margin: "0 auto", padding: "clamp(28px, 7vw, 72px) clamp(16px, 4vw, 32px) 40px" }}>
          <div style={{ ...revealStyle, display: "flex", gap: "clamp(20px, 4vw, 48px)", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
            {hasAboutText && (
              <div style={{ flex: 1, minWidth: 300 }}>
                <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>{t.microsite.about.eyebrow}</div>
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
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
                  <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "rgba(15,23,42,.4)", display: "flex", alignItems: "center", gap: 7 }}>
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
    <Section>
      <ReviewsBlock reviews={reviews} rating={rating} reviewCount={reviewCount} avatarColors={AVATAR_COLORS} />
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
          <span className="ttLogo" style={{ width: 40, height: 40, borderRadius: "calc(12px * var(--radius-scale, 1))", overflow: "hidden", flexShrink: 0, background: site.logoUrl ? "transparent" : "var(--primary)", color: "var(--text-on-brand)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {site.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoUrl} alt={site.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <Icon name="sparkle" size={20} />
            )}
          </span>
          <span className="ttName" style={{ font: "var(--fw-extrabold) 18px/1.1 var(--font-sans)", letterSpacing: "-.025em", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{site.name}</span>

          <span className="ttHeaderSpacer" style={{ flex: 1 }} />

          <div data-shed="1" data-desk="1" style={{ display: "flex", alignItems: "center", gap: 26 }}>
            {navLinks.map(([, label, href]) => (
              <a key={href} href={href} className="salonNavLink" style={{ font: "var(--fw-medium) 13.5px/1 var(--font-sans)", letterSpacing: ".01em", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</a>
            ))}
          </div>

          <span data-desk="1" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button variant="outline" onClick={onSaveContact} leadingIcon={<Icon name="user" size={16} />}>{t.microsite.header.saveContact}</Button>
            <Button variant="outline" onClick={openTrack}>{t.microsite.header.trackMyTurn}</Button>
          </span>
          <span data-desk="1">
            <Button variant="primary" onClick={openQueue}>{domain.id === "clinic" ? t.microsite.header.takeToken : t.microsite.header.checkIn} →</Button>
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
              <Button fullWidth variant="outline" onClick={() => { setMenuOpen(false); onSaveContact(); }} leadingIcon={<Icon name="user" size={16} />}>{t.microsite.header.saveContact}</Button>
            </div>
          </div>
        )}

        {/* --- hero body --- */}
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "12px clamp(18px, 4vw, 30px) clamp(28px, 6vw, 72px)", display: "flex", flexWrap: "wrap", gap: "clamp(22px, 4vw, 44px)", alignItems: "center" }}>
          <div style={{ flex: "1.05 1 300px", minWidth: 300 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 11, borderRadius: 999, padding: "9px 18px 9px 14px", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)" }}>
              <span style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: site.openStatus.isOpen ? "var(--success)" : "var(--text-subtle)" }} />
                <span className="ttPing" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: site.openStatus.isOpen ? "var(--success)" : "var(--text-subtle)" }} />
              </span>
              <span style={{ font: "var(--fw-bold) 12.5px/1 var(--font-sans)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-strong)" }}>{site.openStatus.label}</span>
            </div>

            <h1 style={{ font: "var(--fw-extrabold) clamp(32px, 5.9vw, 100px)/0.96 var(--font-display, var(--font-sans))", letterSpacing: "-.045em", color: "var(--text-strong)", margin: "22px 0 0", overflowWrap: "break-word", textWrap: "balance" }}>
              {site.tagline ?? site.name}
            </h1>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 26 }}>
              {reviewCount > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--fw-bold) 15px/1 var(--font-sans)", color: "var(--text-strong)" }}>
                  <span style={{ color: "var(--warning)", display: "flex" }}><Icon name="star" size={17} fill="currentColor" /></span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{rating}</span>
                  <span style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-subtle)" }}>({reviewCount})</span>
                </span>
              )}
              {site.area && <span style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-muted)" }}>{site.area}</span>}
              {site.establishedYear != null && <span style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-muted)" }}>{format(t.microsite.hero.since, { year: site.establishedYear })}</span>}
            </div>

            {/* The "Right now" card — v3's centrepiece and the page's primary action. */}
            <div className="ttWaitCard" style={{ maxWidth: 430, marginTop: "clamp(20px, 3vw, 32px)", borderRadius: "calc(26px * var(--radius-scale, 1))", padding: "clamp(18px, 2.4vw, 26px)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "0 26px 60px rgba(15,23,42,.16)" }}>
              <div style={{ font: "var(--fw-bold) 10.5px/1 var(--font-sans)", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--primary)" }}>{t.microsite.hero.rightNow}</div>
              <div style={{ marginTop: 14 }}>
                <QueueWaitSummary liveCount={liveCount} members={members} waitHeadline={waitHeadline} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
                <Button size="lg" fullWidth onClick={openQueue}>{domain.id === "clinic" ? t.microsite.hero.takeAToken : t.microsite.hero.checkIn} →</Button>
                <Button size="lg" variant="outline" fullWidth onClick={openBook}>{t.microsite.hero.bookSlot}</Button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, font: "var(--fw-medium) 12.5px/1.4 var(--font-sans)", color: "var(--text-subtle)" }}>
                <Icon name="check" size={14} />
                <span>{t.microsite.hero.noAppNote}</span>
              </div>
            </div>
          </div>

          <div style={{ flex: "1 1 300px", minWidth: 300, alignSelf: "stretch", minHeight: "clamp(280px, 46vw, 460px)", position: "relative", borderRadius: "calc(26px * var(--radius-scale, 1))", overflow: "hidden", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", boxShadow: "0 26px 60px rgba(15,23,42,.13)" }}>
            {site.heroImageUrl ? (
              <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${site.heroImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-subtle)" }}>
                <Icon name="building" size={16} />
                {t.microsite.hero.heroPhoto}
              </div>
            )}
          </div>
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
                queueWord={queueWord}
                liveHeadline={waitHeadline}
                liveSub={liveStatusDark}
                ctaLabel={domain.liveCta}
                onJoin={openWith}
              />
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
                currencySymbol={curSym}
                onPick={openServiceBooking}
              />
            </Section>
          );
        }
        if (key === "gallery" && galleryPhotos.length > 0) {
          return (
            <Section key={key} id="gallery" tone="tint">
              <GalleryMosaic photos={galleryPhotos} heading={domain.galleryHeading} onOpen={setLightbox} />
            </Section>
          );
        }
        if (key === "about") return <div key={key}>{aboutSection}</div>;
        if (key === "reviews") return <div key={key}>{reviewsSection}</div>;
        return null;
      })}

      {/* ===== FAQ (only when the store has Q&A) ===== */}
      {faqs.length > 0 && (
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px clamp(16px, 4vw, 32px) 56px" }}>
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
      {(site.address || site.area || site.hours.length > 0) && (
      <div id="visit" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: 0, display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, padding: "calc(clamp(28px, 7vw, 56px) * var(--density-scale, 1)) clamp(16px, 4vw, 32px)" }}>
            <div style={eyebrow}>{t.microsite.visit.eyebrow}</div>
            {site.address && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-medium) 15px/1.4 var(--font-sans)", color: "var(--text-body)", marginBottom: 22 }}>
                <span style={{ color: "var(--primary)", display: "flex" }}>
                  <Icon name="building" size={18} />
                </span>
                {site.address}
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
          {(site.address || site.area) && (
            <iframe
              title={format(t.microsite.visit.mapTitle, { name: site.name })}
              src={`https://www.google.com/maps?q=${encodeURIComponent(site.address ?? site.area ?? site.name)}&output=embed`}
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
          <h2 style={{ font: "var(--fw-extrabold) clamp(24px, 5.2vw, 42px)/1.08 var(--font-display, var(--font-sans))", letterSpacing: "-.025em", color: "var(--on-hero)", margin: "0 0 10px" }}>{domain.ctaHeading}</h2>
          <p style={{ font: "var(--fw-medium) 16px/1.5 var(--font-sans)", color: "rgba(255,255,255,.85)", margin: "0 0 26px" }}>{format(t.microsite.cta.sub, { count: liveCount, wait: waitHeadline })}</p>
          {domain.urgentLabel && (
            <p style={{ font: "var(--fw-semibold) 13px/1.4 var(--font-sans)", color: "rgba(255,255,255,.72)", margin: "-14px 0 22px" }}>{domain.urgentLabel}</p>
          )}
          <div onClick={openQueue} className="salonCtaBtn" style={{ display: "inline-block", cursor: "pointer", background: "#fff", color: "var(--primary)", font: "var(--fw-bold) 17px/1 var(--font-sans)", padding: "16px 32px", borderRadius: "calc(12px * var(--radius-scale, 1))", boxShadow: "var(--shadow-lg)" }}>
            {t.microsite.cta.button}
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
            {t.brand.terms}
            {" · "}
            <Link href="/privacy" style={{ color: "inherit" }}>
              {t.brand.privacy}
            </Link>
          </span>
        </div>
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
      {!showResume && !joinOpen && (
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
            <div className="ttMobileBarWait" style={{ font: "var(--fw-extrabold) 16px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{waitHeadline}</div>
            <div className="ttMobileBarCount" style={{ font: "var(--fw-semibold) 15px/1.35 var(--font-sans)", color: "var(--text-body)", marginTop: 4 }}>{liveStatus}</div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <Button size="lg" onClick={openQueue}>{t.microsite.mobileBar.checkIn}</Button>
          </div>
        </div>
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
                              <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--primary)" : "var(--border-default)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <span style={{ display: "flex", color: "var(--primary)", transition: "opacity .15s ease", opacity: on ? 1 : 0 }}>
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
                      <p style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 16px" }}>{t.microsite.join.serviceQuestion}</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                        {services.map((sv) => {
                          const on = cart === sv.id;
                          return (
                            <div key={sv.id} onClick={() => setCart(sv.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 13, borderRadius: "calc(12px * var(--radius-scale, 1))", padding: "13px 15px", transition: "border-color .15s ease, background .15s ease", background: on ? "color-mix(in srgb, var(--primary) 6%, var(--surface-card))" : "var(--surface-card)", border: `1.5px solid ${on ? "var(--primary)" : "var(--border-subtle)"}` }}>
                              <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--primary)" : "var(--border-default)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <span style={{ display: "flex", color: "var(--primary)", transition: "opacity .15s ease", opacity: on ? 1 : 0 }}>
                                  <Icon name="check" size={13} />
                                </span>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ font: "var(--fw-semibold) 15px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{sv.name}</div>
                                <div style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{sv.dur}</div>
                              </div>
                              <span style={{ font: "var(--fw-bold) 16px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{curSym}{sv.price}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                        {flowScreens.indexOf("service") > 0 && (
                          <Button variant="outline" size="lg" onClick={() => goBack("service")}>{t.common.back}</Button>
                        )}
                        <div style={{ flex: 1 }}>
                          <Button variant="primary" size="lg" fullWidth disabled={!cart} onClick={() => goNext("service")}>
                            {cart ? format(t.microsite.join.serviceContinue, { name: sel!.name }) : t.microsite.join.servicePickOne}
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
                      <PhoneField country={phoneCountry} national={national} onCountryChange={setPhoneCountry} onNationalChange={setNational} marginBottom={16} />
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>{t.microsite.join.memberLabel}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                        {[{ id: "any", name: t.microsite.join.memberAny }, ...members.map((b) => ({ id: b.id, name: b.name }))].map((c) => {
                          const on = member === c.id;
                          return (
                            <span key={c.id} onClick={() => setMember(c.id)} style={{ cursor: "pointer", font: "var(--fw-semibold) 13px/1 var(--font-sans)", padding: "8px 15px", borderRadius: 999, transition: "all .15s ease", ...(on ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" } : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }) }}>
                              {c.name}
                            </span>
                          );
                        })}
                      </div>

                      {mode === "book" && (
                        <>
                          <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>{t.microsite.join.timeLabel}</div>
                          {slotsLoading ? (
                            <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", marginBottom: 18 }}>{t.microsite.join.slotsLoading}</div>
                          ) : slots.length === 0 ? (
                            <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", marginBottom: 18 }}>{t.microsite.join.slotsEmpty}</div>
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
                        </>
                      )}

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: "calc(12px * var(--radius-scale, 1))", padding: "13px 15px", marginBottom: 14 }}>
                        <span style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--text-body)" }}>
                          {(sel ? `${sel.name} · ` : "") + (mode === "book" ? (selectedSlot ? t.microsite.join.timeSelected : t.microsite.join.chooseTimeAbove) : joinWaitText)}
                        </span>
                        <span style={{ font: "var(--fw-bold) 16px/1 var(--font-sans)", color: "var(--text-strong)" }}>{sel ? `${curSym}${sel.price}` : ""}</span>
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
                          ? t.microsite.success.booked
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
                          ? booking
                            ? format(t.microsite.success.bookingLine, { service: booking.serviceName || t.microsite.success.yourVisit, when: new Date(booking.scheduledStartAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) })
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

                      {mode === "queue" && ticket && isActive(ticket.status) && !confirmLeave && (
                        <>
                          <Button variant="primary" fullWidth onClick={closeJoin}>{t.common.done}</Button>
                          {canLeaveQueue(ticket.status) && (
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
                          <Button variant="primary" fullWidth onClick={joinAfterTrack}>{t.microsite.track.checkIn}</Button>
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
                      {canLeaveQueue(ticket?.status) ? (
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
