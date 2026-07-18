"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Socket } from "socket.io-client";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import PhoneField from "@/components/ui/PhoneField";
import { ApiError, publicApi, type Microsite, type MicrositeStaff, type Slot, type Ticket } from "@/lib/api";
import { currencySymbol } from "@/lib/currencies";
import { combineToE164, DEFAULT_DIAL_CODE, DEFAULT_ISO2, formatPhone, splitPhone } from "@/lib/phone";
import { connectCustomer, type CustomerAuth } from "@/lib/socket";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { API_BASE_URL } from "@/lib/config";
import SaveContactSheet from "./SaveContactSheet";
import "./salon.css";

const AVATAR_COLORS = ["var(--primary)", "var(--secondary)", "var(--amber-500)"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Demo verification: the live backend has no OTP endpoint, so the OTP screen is a
// client-side gate (see plan). The real joinQueue/bookSlot fires once it passes.
const DEMO_OTP = "1234";
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

/** Compare two phone strings by their digits only (ignores spacing/formatting). */
const sameDigits = (a: string, b: string) => a.replace(/\D/g, "") === b.replace(/\D/g, "");

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

type View = "flow" | "already" | "blocked" | "left" | "track";

export default function MicrositeClient({ initialSite }: { initialSite: Microsite }) {
  const site = initialSite;
  // Per-business localStorage namespace (see STORE_PREFIX) and the shop's real contact
  // number for the rate-limited "call the shop" view (was a hardcoded demo number).
  const storeKey = `${STORE_PREFIX}${site.slug}`;
  const shopPhone = site.phoneNumber ? formatPhone(combineToE164(site.countryCode ?? "", site.phoneNumber)) : null;
  const [navSolid, setNavSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // mobile hamburger dropdown
  const [saveOpen, setSaveOpen] = useState(false); // "Save contact" (vCard) sheet
  // Live vCard endpoint for this store. The backend rebuilds the .vcf from the current
  // business row on every request, so a saved contact always reflects the latest details.
  // `?open=1` serves it inline so a phone (tap, or scanning the desktop QR) opens the
  // Add-Contact card directly instead of downloading a file to open manually.
  const vcardUrl = `${API_BASE_URL}/public/businesses/${initialSite.slug}/vcard?open=1`;
  // Single mobile breakpoint (JS + inline styles) driving both the nav collapse and the
  // hero stacking — reliably applies via React rendering on every load and hot-reload.
  const isMobile = useMediaQuery("(max-width: 860px)");
  // True touch/handheld (phone / most tablets) vs a computer — decides whether "Save contact"
  // downloads the .vcf directly (phone already in hand) or shows a QR to scan (computer).
  // Distinct from isMobile, which is only viewport width. Evaluated on click (post-hydration),
  // so useMediaQuery's SSR-desktop-first default never causes a wrong branch or flash.
  const isHandheld = useMediaQuery("(pointer: coarse) and (hover: none)");
  const [liveWait, setLiveWait] = useState(initialSite.live.waitMinutes);
  const [liveCount, setLiveCount] = useState(initialSite.live.queueCount);
  const [liveStaff, setLiveStaff] = useState<MicrositeStaff[]>(initialSite.staff ?? []);

  const [joinOpen, setJoinOpen] = useState(false);
  const [mode, setMode] = useState<"queue" | "book">("queue");
  const [view, setView] = useState<View>("flow");
  const [step, setStep] = useState(1);
  const [tstep, setTstep] = useState(1); // Track-my-turn sub-step: 1 phone → 2 OTP → 3 not-found
  const [cart, setCart] = useState<string | null>(null);
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
  const [barber, setBarber] = useState("any");
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [booking, setBooking] = useState<{ serviceName: string; scheduledStartAt: string } | null>(null);
  const [justTurn, setJustTurn] = useState(false);
  const [initialAhead, setInitialAhead] = useState(0);
  // Wall-clock tick that drives the live countdown. null until mount (keeps SSR/first paint equal
  // to the server value — no hydration mismatch); then updated every 15s while a ticket is active.
  const [nowTs, setNowTs] = useState<number | null>(null);

  // OTP + new modal views
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leftMsg, setLeftMsg] = useState("");
  const [held, setHeld] = useState<HeldRecord | null>(null);
  // Phone verified via OTP this session — lets a follow-on Join skip a duplicate OTP.
  const [verifiedPhone, setVerifiedPhone] = useState("");
  // Name pulled from the track lookup (returning customer) to pre-fill Join.
  const [trackedName, setTrackedName] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const ticketPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const storeRef = useRef<Store>(defaultStore());
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // ---- nav shadow on scroll ----
  useEffect(() => {
    const onScroll = () => {
      const solid = (window.scrollY || document.documentElement.scrollTop) > 30;
      setNavSolid((prev) => (prev !== solid ? solid : prev));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ---- realtime: availability (+ poll fallback) ----
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
  const bindSocket = (s: Socket) => {
    s.on("availability:updated", (d: { waitMinutes: number; queueCount: number }) => {
      setLiveWait(d.waitMinutes);
      setLiveCount(d.queueCount);
    });
    s.on("staff:availability", (d: { staff: MicrositeStaff[] }) => {
      if (d.staff) setLiveStaff(d.staff);
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

  const openSocket = (auth: CustomerAuth) => {
    socketRef.current?.close();
    const s = connectCustomer(auth);
    bindSocket(s);
    socketRef.current = s;
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
    const poll = setInterval(() => {
      publicApi
        .getAvailability(site.slug)
        .then((a) => {
          setLiveWait(a.waitMinutes);
          setLiveCount(a.queueCount);
        })
        .catch(() => {});
      publicApi
        .getStaffAvailability(site.slug)
        .then((r) => setLiveStaff(r.staff))
        .catch(() => {});
    }, 15000);
    return () => {
      clearInterval(poll);
      socketRef.current?.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  // ---- live countdown tick (drives displayWaitMinutes between server updates) ----
  // Only re-runs when the ticket flips active/inactive (a primitive), so the 15s interval keeps
  // ticking instead of being torn down on every 5s poll. setState happens only in the timer
  // callback (never synchronously in the effect body). Pushes re-anchor nowTs in bindSocket.
  const ticketActive = !!ticket && isActive(ticket.status);
  useEffect(() => {
    if (!ticketActive) return;
    const id = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(id);
  }, [ticketActive]);

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
      if (resendTimer.current) clearInterval(resendTimer.current);
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
  const barbers = liveStaff.map((s, i) => ({
    id: s.id,
    name: s.name,
    role: s.roleLabel ?? "",
    photo: s.avatarUrl,
    busy: s.busy,
    count: s.queueCount,
    wait: s.waitLabel,
    waitMin: s.waitMinutes,
    avBg: AVATAR_COLORS[i % AVATAR_COLORS.length],
  }));
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
    site.establishedYear != null && site.area ? [`${yearsOpen}+ yrs`, `in ${site.area}`] : null,
    barbers.length > 0 ? [`${barbers.length} ${site.teamNoun ?? "team members"}`, "expert team"] : null,
    site.statValue && site.statLabel ? [site.statValue, site.statLabel] : null,
    reviewCount > 0 ? [`★ ${rating}`, `${reviewCount} reviews`] : null,
  ].filter(Boolean) as [string, string][];

  // ---- resend countdown ----
  const stopResend = () => {
    if (resendTimer.current) clearInterval(resendTimer.current);
    resendTimer.current = null;
  };
  const startResend = () => {
    stopResend();
    setResendIn(30);
    resendTimer.current = setInterval(() => {
      setResendIn((n) => {
        if (n <= 1) {
          stopResend();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  };

  // ---- modal control ----
  const openJoin = (m: "queue" | "book", preselectBarber = "any") => {
    setMode(m);
    setConfirmLeave(false);
    setOtp(["", "", "", ""]);
    setOtpError("");
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
    setStep(1);
    setCart(null);
    setName(store.lastName || "");
    seedPhone(lp || "");
    setBarber(preselectBarber);
    setTicket(null);
    setBooking(null);
    setJustTurn(false);
    setSlots([]);
    setSelectedSlot(null);
    setJoinOpen(true);
  };
  const openQueue = () => openJoin("queue");
  const openBook = () => openJoin("book");
  const openWith = (barberId: string) => openJoin("queue", barberId);

  // ---- Save contact (vCard) ----
  // Phone: navigate to the inline .vcf so the OS opens the Add-Contact card directly (no file to
  // open manually). Same-tab navigation within the tap gesture — the page visually stays put while
  // the OS card appears. Computer: open the QR-only sheet to scan onto a phone.
  const openVcard = () => {
    window.location.href = vcardUrl;
  };
  const onSaveContact = () => (isHandheld ? openVcard() : setSaveOpen(true));

  // ---- Track my turn (look up an existing ticket by phone, e.g. from another browser) ----
  const openTrack = () => {
    setMode("queue");
    setConfirmLeave(false);
    setOtp(["", "", "", ""]);
    setOtpError("");
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
  const trackSendOtp = () => {
    if (phone.replace(/\D/g, "").length < 4) {
      setFormError("Enter your phone number");
      return;
    }
    setFormError("");
    setOtp(["", "", "", ""]);
    setOtpError("");
    setTstep(2);
    startResend();
  };
  const trackBack = () => {
    stopResend();
    setOtpError("");
    setTstep(1);
  };
  const trackVerify = async () => {
    const code = otp.join("");
    if (code.length < 4) {
      setOtpError("Enter the 4-digit code");
      return;
    }
    if (code !== DEMO_OTP) {
      setOtpError("Incorrect code. For this demo, enter 1 2 3 4.");
      setOtp(["", "", "", ""]);
      otpRefs.current[0]?.focus();
      return;
    }
    const p = phone.trim();
    setSubmitting(true);
    setOtpError("");
    setVerifiedPhone(p); // this phone is now OTP-verified for the session → Join can skip re-OTP
    stopResend();
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
      setOtpError((e as Error)?.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };
  // From the Track "no active booking" screen: carry the verified phone + known name into a
  // fresh Join. verifiedPhone stays set so Step 2 skips the second OTP; only service is left.
  const joinAfterTrack = () => {
    setMode("queue");
    setView("flow");
    setStep(1);
    setCart(null);
    setBarber("any");
    setName(trackedName || storeRef.current.lastName || "");
    seedPhone(verifiedPhone);
    setOtp(["", "", "", ""]);
    setOtpError("");
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
    stopResend();
    // Keep the live ticket socket + poll alive when we still hold a ticket, so the
    // resume pill stays current; otherwise fall back to the availability-only socket.
    if (!held) {
      stopTicketPoll();
      openSocket({ businessId: site.id });
    }
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const toggleFaq = (i: number) => setFaqOpen((cur) => (cur === i ? null : i));

  const toStep2 = async () => {
    if (!cart) return;
    setStep(2);
    setFormError("");
    if (mode === "book") {
      setSlotsLoading(true);
      setSelectedSlot(null);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const r = await publicApi.getSlots(site.slug, { date: today, serviceId: cart });
        setSlots(r.slots);
      } catch {
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    }
  };
  const backTo1 = () => setStep(1);

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
      setFormError("Enter your name and phone number");
      return true;
    }
    if (mode === "book" && !selectedSlot) {
      setFormError("Pick a time slot");
      return true;
    }
    return false;
  };
  // Step 2 -> OTP screen (demo verification gate) — used when the phone is NOT yet verified.
  const sendOtp = () => {
    if (detailsInvalid()) return;
    if (blockGuard(phone.trim())) return;
    setFormError("");
    setOtp(["", "", "", ""]);
    setOtpError("");
    setStep(3);
    startResend();
  };
  // Step 2 -> join directly, skipping OTP because this phone was already verified this session.
  const confirmJoin = () => {
    if (detailsInvalid()) return;
    if (blockGuard(phone.trim())) return;
    performJoinOrBook();
  };
  const resendOtp = () => {
    if (resendIn > 0) return;
    setOtp(["", "", "", ""]);
    setOtpError("");
    startResend();
    otpRefs.current[0]?.focus();
  };
  const backToDetails = () => {
    stopResend();
    setOtpError("");
    setStep(2);
  };

  const onOtpInput = (i: number, value: string) => {
    const raw = value.replace(/\D/g, "");
    if (raw.length > 1) {
      // pasted full/partial code
      const next = raw.slice(0, 4).split("");
      while (next.length < 4) next.push("");
      setOtp(next);
      setOtpError("");
      const last = Math.min(raw.length, 4) - 1;
      otpRefs.current[last]?.focus();
      return;
    }
    setOtp((prev) => {
      const next = [...prev];
      next[i] = raw.slice(-1);
      return next;
    });
    setOtpError("");
    if (raw && i < 3) otpRefs.current[i + 1]?.focus();
  };
  const onOtpKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };

  // Perform the REAL join/book. Reached after OTP (verifyOtp) OR directly when the phone was
  // already verified this session (confirmJoin) — the single place that talks to the API.
  const performJoinOrBook = async () => {
    if (!cart) return;
    const p = phone.trim();
    setSubmitting(true);
    setOtpError("");
    setFormError("");
    stopResend();
    try {
      if (mode === "queue") {
        const t = await publicApi.joinQueue(site.slug, {
          serviceId: cart,
          name: name.trim(),
          phone: p,
          preferredStaffId: barber,
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
        else setStep(4);
      } else {
        const b = await publicApi.bookSlot(site.slug, {
          serviceId: cart,
          name: name.trim(),
          phone: p,
          preferredStaffId: barber,
          slotStart: selectedSlot!,
        });
        setBooking({ serviceName: b.serviceName, scheduledStartAt: b.scheduledStartAt });
        const store = storeRef.current;
        store.lastPhone = p;
        store.lastName = name.trim();
        writeStore(storeKey, store);
        setStep(4);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "RATE_LIMITED") {
        const store = storeRef.current;
        store.blocked[p] = true;
        store.lastPhone = p;
        writeStore(storeKey, store);
        setView("blocked");
      } else {
        // Surface on whichever screen we're on: Step 3 shows otpError, Step 2 shows formError.
        const msg = (e as Error)?.message ?? "Something went wrong";
        setOtpError(msg);
        setFormError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };
  // OTP verified -> remember the phone for the session, then perform the real join/book.
  const verifyOtp = () => {
    const code = otp.join("");
    if (code.length < 4) {
      setOtpError("Enter the 4-digit code");
      return;
    }
    if (code !== DEMO_OTP) {
      setOtpError("Incorrect code. For this demo, enter 1 2 3 4.");
      setOtp(["", "", "", ""]);
      otpRefs.current[0]?.focus();
      return;
    }
    setVerifiedPhone(phone.trim());
    performJoinOrBook();
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
        ? "Your spot is freed. Heads up — repeated cancellations may require you to call the shop to rejoin."
        : "Your spot is freed and the next customer has moved up.",
    );
    setTicket(null);
    setConfirmLeave(false);
    setView("left");
  };
  const joinDifferent = () => {
    setView("flow");
    setStep(1);
    setCart(null);
    setName("");
    seedPhone("");
    setBarber("any");
    setOtp(["", "", "", ""]);
    setOtpError("");
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
  const waitHeadline = liveWait > 0 ? `~${liveWait} min wait` : "Walk in now";
  // Join-form summary wait, barber-aware: a specific barber shows their own chair's
  // clear time; "Any" falls back to the shop-wide soonest value.
  const selBarber = barbers.find((b) => b.id === barber);
  const joinWaitMin = barber === "any" ? liveWait : selBarber?.waitMin ?? liveWait;
  const joinWaitText = joinWaitMin > 0 ? `~${joinWaitMin} min wait` : "no wait — walk in";
  const modeTitle =
    view === "track"
      ? tstep === 3
        ? "No active booking"
        : "Check your place in line"
      : view === "already"
        ? "You're already in line"
        : view === "blocked"
          ? "Hold on"
          : mode === "book"
            ? "Book a time slot"
            : "Join the queue";
  const showResume = !!held && !joinOpen && !!ticket && isActive(ticket.status);
  const resumeToken = ticket?.token ?? held?.token ?? "";
  const resumeAhead = justTurn ? 0 : ticket?.ahead ?? 0;
  // Live, wall-clock-aware wait for the pill — ticks down between server updates.
  const displayWait = displayWaitMinutes(ticket, nowTs);
  const resumeLabel = displayWait <= 1 ? "Almost your turn" : `${resumeAhead} ahead · ~${displayWait} min`;
  // Owner has started this customer's service (waiting → in_service) — surface it live.
  const inService = ticket?.status === "in_service" || justTurn;

  // In-page jump links, shared by the desktop bar and the mobile dropdown so the
  // two never drift. Each is shown only when its section actually renders.
  const navLinks = (
    [
      [showAbout, "About", "#about"],
      [gallery.length > 0 || isDemo, "Gallery", "#gallery"],
      [services.length > 0, "Services", "#services"],
      [barbers.length > 0, "Team", "#team"],
      [Boolean(site.address || site.area || site.hours.length > 0), "Visit us", "#visit"],
    ] as [boolean, string, string][]
  ).filter(([show]) => show);

  const navStyle: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 100,
    transition: "background .25s ease, box-shadow .25s ease, border-color .25s ease",
    ...(navSolid
      ? {
          background: "color-mix(in srgb, var(--surface-card) 88%, transparent)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-xs)",
        }
      : { background: "transparent", borderBottom: "1px solid transparent" }),
  };

  const accent = (n: number) => (step >= n ? "var(--primary)" : "var(--surface-sunken)");

  const progressPct =
    justTurn || ticket?.status === "completed"
      ? "100%"
      : ticket && initialAhead > 0
        ? `${Math.max(0, Math.round((1 - ticket.ahead / initialAhead) * 100))}%`
        : "0%";

  const cantConfirm = !name.trim() || phone.replace(/\D/g, "").length < 4 || (mode === "book" && !selectedSlot);
  // This exact phone was already OTP-verified this session → Step 2 joins directly (no 2nd OTP).
  const phoneVerified = !!verifiedPhone && sameDigits(phone, verifiedPhone);

  return (
    <div style={{ position: "relative", overflowX: "hidden" }}>
      {/* ===== NAV ===== */}
      <div style={navStyle}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 clamp(16px, 4vw, 32px)", height: 68, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(135deg, var(--brand-ink), var(--primary))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
              <Icon name="scissors" size={20} />
            </div>
            <span style={{ font: "var(--fw-extrabold) 21px/1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site.name}</span>
          </div>
          {/* Desktop: in-page jump links (hidden on mobile) */}
          {!isMobile && (
            <div style={{ display: "flex", gap: 26, alignItems: "center" }}>
              {navLinks.map(([, label, href]) => (
                <a key={href} href={href} className="salonNavLink" style={{ font: "var(--fw-medium) 14px/1 var(--font-sans)", color: "var(--text-muted)", textDecoration: "none", transition: "color .15s ease" }}>
                  {label}
                </a>
              ))}
            </div>
          )}
          {/* Desktop: action buttons · Mobile: hamburger toggle */}
          {!isMobile ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Button variant="outline" onClick={onSaveContact} leadingIcon={<Icon name="user" size={16} />}>Save contact</Button>
              <Button variant="primary" onClick={openTrack}>Track my turn</Button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Button variant="primary" size="sm" onClick={openTrack}>Track my turn</Button>
              <button
                type="button"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 6, borderRadius: 8, cursor: "pointer", color: "var(--text-strong)" }}
              >
                <Icon name={menuOpen ? "x" : "menu"} size={24} />
              </button>
            </div>
          )}
        </div>
        {/* Mobile dropdown — same links + actions as the desktop bar */}
        {isMobile && menuOpen && (
          <div style={{ display: "flex", flexDirection: "column", padding: "8px clamp(16px, 4vw, 32px) 18px", background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-md)", animation: "ttFade .18s ease both" }}>
            {navLinks.map(([, label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ font: "var(--fw-medium) 15px/1 var(--font-sans)", color: "var(--text-body)", textDecoration: "none", padding: "14px 6px", borderBottom: "1px solid var(--border-subtle)" }}>
                {label}
              </a>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              <Button fullWidth onClick={() => { setMenuOpen(false); openQueue(); }}>Join queue</Button>
              <Button fullWidth variant="outline" onClick={() => { setMenuOpen(false); onSaveContact(); }} leadingIcon={<Icon name="user" size={16} />}>Save contact</Button>
            </div>
          </div>
        )}
      </div>

      {/* ===== HERO ===== */}
      <div style={{ position: "relative", overflow: "hidden", minHeight: "clamp(440px, 68vh, 560px)" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, color-mix(in srgb, var(--brand-ink) 22%, #cfd6e6), color-mix(in srgb, var(--primary) 18%, #dfe6f2) 60%, color-mix(in srgb, var(--secondary) 16%, #e3efed))" }} />
        {/* Desktop only: decorative glow + full-bleed photo behind the copy with a left→right scrim.
            On mobile the copy sits on the clean gradient and the photo becomes a banner below. */}
        {!isMobile && (
          <div style={{ position: "absolute", right: "6%", top: "50%", transform: "translateY(-50%)", width: "clamp(180px, 40vw, 380px)", height: "clamp(180px, 40vw, 380px)", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,.5), transparent 62%)" }} />
        )}
        {site.heroImageUrl && (
          <>
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${site.heroImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
            {/* White scrim keeps the dark hero copy legible over the photo. Desktop fades
                left→right (copy sits on the left); mobile fades top→bottom (copy is full-width). */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: isMobile
                  ? "linear-gradient(180deg, rgba(255,255,255,.90) 0%, rgba(255,255,255,.70) 55%, rgba(255,255,255,.45) 100%)"
                  : "linear-gradient(90deg, rgba(255,255,255,.9) 0%, rgba(255,255,255,.6) 46%, rgba(255,255,255,.12) 100%)",
              }}
            />
          </>
        )}
        {!isMobile && !site.heroImageUrl && (
          <div style={{ position: "absolute", right: "9%", bottom: 34, font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "rgba(15,23,42,.4)", display: "flex", alignItems: "center", gap: 7 }}>
            <Icon name="building" size={15} />
            Hero photo — salon interior
          </div>
        )}
        <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto", minHeight: "inherit", padding: "40px clamp(16px, 4vw, 32px)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ maxWidth: 560, animation: "ttHero .7s ease both" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.85)", border: "1px solid rgba(255,255,255,.7)", borderRadius: 999, padding: "6px 14px", backdropFilter: "blur(6px)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: site.openStatus.isOpen ? "var(--success)" : "var(--text-subtle)", display: "inline-block", animation: "ttPulse 1.8s ease-in-out infinite" }} />
              <span style={{ font: "var(--fw-semibold) 13px/1 var(--font-sans)", color: "var(--text-strong)" }}>{site.openStatus.label}</span>
            </div>
            <h1 style={{ font: "var(--fw-extrabold) clamp(30px, 6vw, 52px)/1.03 var(--font-sans)", letterSpacing: "-.03em", color: "var(--brand-ink)", margin: "18px 0 10px" }}>
              {site.tagline ?? site.name}
            </h1>
            {(() => {
              // Only surface pieces backed by real data — no "★ 0 (0 reviews)" or defaulted
              // "Established 2014" when the store hasn't set them.
              const heroMeta = [
                reviewCount > 0 ? `★ ${rating} (${reviewCount} reviews)` : null,
                site.establishedYear != null ? `Established ${site.establishedYear}` : null,
                site.heroSubtitle?.trim() ? site.heroSubtitle : null,
              ]
                .filter(Boolean)
                .join(" · ");
              if (!heroMeta) return null;
              return (
                <p style={{ font: "var(--fw-medium) 17px/1.5 var(--font-sans)", color: "var(--text-body)", margin: "0 0 26px", maxWidth: 460 }}>
                  {heroMeta}
                </p>
              );
            })()}
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "12px 18px", boxShadow: "var(--shadow-md)" }}>
                <span style={{ display: "flex", color: "var(--secondary)" }}>
                  <Icon name="hourglass" size={22} />
                </span>
                <div>
                  <div style={{ font: "var(--fw-extrabold) 24px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{waitHeadline}</div>
                  <div style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{liveCount} people in queue now</div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
              <Button size="lg" onClick={openQueue}>Join the queue →</Button>
              <Button size="lg" variant="outline" onClick={openBook}>Book a time slot</Button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== TEAM · LIVE AVAILABILITY ===== */}
      {barbers.length > 0 && (
      <div id="team" style={{ maxWidth: 1180, margin: "0 auto", padding: "clamp(40px, 7vw, 64px) clamp(16px, 4vw, 32px)" }}>
        <div style={revealStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ font: "var(--fw-extrabold) clamp(24px, 4vw, 30px)/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: 0 }}>Our team · live availability</h2>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", animation: "ttPulse 1.8s ease-in-out infinite" }} />
              Updated live · pick a barber when you join
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16, marginTop: 24 }}>
            {barbers.map((b) => (
              <div key={b.id} className="salonBarberCard" style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 20, background: "var(--surface-card)", boxShadow: "var(--shadow-xs)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 16 }}>
                  {b.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.photo} alt={b.name} style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 54, height: 54, borderRadius: "50%", background: b.avBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "var(--fw-bold) 19px/1 var(--font-sans)", flexShrink: 0 }}>{b.name[0]}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "var(--fw-bold) 17px/1 var(--font-sans)", color: "var(--text-strong)" }}>{b.name}</div>
                    <div style={{ font: "var(--fw-regular) 13px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{b.role}</div>
                  </div>
                  <span style={{ flexShrink: 0, whiteSpace: "nowrap", font: "var(--fw-semibold) 11px/1 var(--font-sans)", padding: "5px 11px", borderRadius: 999, ...(b.busy ? { background: "var(--surface-sunken)", color: "var(--text-body)" } : { background: "var(--success-soft)", color: "var(--success-soft-fg)" }) }}>
                    {b.busy ? "Busy" : "Free now"}
                  </span>
                </div>
                <div style={{ display: "flex", border: "1px solid var(--border-subtle)", borderRadius: 11, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ flex: 1, textAlign: "center", padding: "11px 4px", borderRight: "1px solid var(--border-subtle)" }}>
                    <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{b.count}</div>
                    <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>in queue</div>
                  </div>
                  <div style={{ flex: 1.3, textAlign: "center", padding: "11px 4px" }}>
                    <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: b.busy ? "var(--text-strong)" : "var(--success)" }}>{b.wait}</div>
                    <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{b.busy ? "wait" : "walk in"}</div>
                  </div>
                </div>
                <Button variant="outline" fullWidth onClick={() => openWith(b.id)}>Join {b.name}&apos;s line</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* ===== ABOUT ===== */}
      {(showAbout || trustCells.length > 0) && (
        <div id="about" style={{ maxWidth: 1180, margin: "0 auto", padding: "clamp(40px, 7vw, 72px) clamp(16px, 4vw, 32px) 40px" }}>
          <div style={{ ...revealStyle, display: "flex", gap: "clamp(24px, 4vw, 48px)", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
            {hasAboutText && (
              <div style={{ flex: 1, minWidth: 300 }}>
                <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>About the salon</div>
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
                    <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 11 }}>Amenities</div>
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
              <div style={{ flex: hasAboutText ? "1 1 0" : "0 1 560px", minWidth: 280, height: 260, borderRadius: 18, background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, var(--surface-card)), color-mix(in srgb, var(--secondary) 12%, var(--surface-card)))", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", ...(hasAboutImage ? { backgroundImage: `url(${site.aboutImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}>
                {!hasAboutImage && (
                  <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "rgba(15,23,42,.4)", display: "flex", alignItems: "center", gap: 7 }}>
                    <Icon name="building" size={15} />
                    About photo
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Trust stats — merged into the bottom of About as a bordered row. */}
          {trustCells.length > 0 && (
            <div style={{ ...revealStyle, display: "flex", justifyContent: "space-around", textAlign: "center", gap: 20, flexWrap: "wrap", marginTop: 40, paddingTop: 32, borderTop: "1px solid var(--border-subtle)" }}>
              {trustCells.map(([big, small]) => (
                <div key={small}>
                  <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--primary)" }}>{big}</div>
                  <div style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 6 }}>{small}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== GALLERY ===== */}
      {(gallery.length > 0 || isDemo) && (
        <div id="gallery" style={{ maxWidth: 1180, margin: "0 auto", padding: "24px clamp(16px, 4vw, 32px) 40px" }}>
          <div style={revealStyle}>
            <div style={eyebrow}>Gallery</div>
            {/* Horizontal strip: fixed-width cells that scroll sideways once they overflow the row.
                Demo store with no photos shows blank placeholder cells so the slot is visible. */}
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x proximity" }}>
              {(gallery.length > 0 ? gallery : [null, null, null, null]).map((g, i) => (
                <div key={i} className="salonGalleryCell" style={{ flex: "0 0 auto", width: 240, height: 160, borderRadius: 14, background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, var(--surface-card)), color-mix(in srgb, var(--secondary) 10%, var(--surface-card)))", border: "1px solid var(--border-subtle)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", scrollSnapAlign: "start", ...(g ? { backgroundImage: `url(${g})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}>
                  {!g && (
                    <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "rgba(15,23,42,.4)", display: "flex", alignItems: "center", gap: 7 }}>
                      <Icon name="grid" size={15} />
                      Gallery photo
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== SERVICES (names only) ===== */}
      {services.length > 0 && (
      <div id="services" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: "clamp(40px, 7vw, 64px) clamp(16px, 4vw, 32px)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ font: "var(--fw-extrabold) clamp(24px, 4vw, 30px)/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: 0 }}>What we offer</h2>
            <span style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>Pricing shown when you join the queue or book</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 14, marginTop: 22 }}>
            {services.map((sv) => (
              <div key={sv.id} className="salonServiceCard" style={{ display: "flex", alignItems: "center", gap: 13, border: "1px solid var(--border-subtle)", borderRadius: 13, padding: 16, background: "var(--surface-page)" }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: "color-mix(in srgb, var(--primary) 10%, var(--surface-card))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)", flexShrink: 0 }}>
                  <Icon name="scissors" size={18} />
                </div>
                <span style={{ flex: 1, font: "var(--fw-semibold) 15px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{sv.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* ===== REVIEWS (only when the store has reviews) ===== */}
      {reviews.length > 0 && (
        <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: "clamp(40px, 7vw, 64px) clamp(16px, 4vw, 32px)" }}>
            <h2 style={{ font: "var(--fw-extrabold) clamp(24px, 4vw, 30px)/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 24px" }}>What customers say · ★ {rating}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
              {reviews.map((r, i) => (
                <div key={i} className="salonReviewCard" style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 22, background: "var(--surface-page)" }}>
                  <div style={{ color: "var(--warning)", fontSize: 15, letterSpacing: 2, marginBottom: 12 }}>{"★".repeat(r.stars) + "☆".repeat(Math.max(0, 5 - r.stars))}</div>
                  <p style={{ font: "var(--fw-regular) 15px/1.6 var(--font-sans)", color: "var(--text-body)", margin: "0 0 18px" }}>{r.text}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "var(--fw-bold) 13px/1 var(--font-sans)" }}>{r.authorName[0]}</div>
                    <span style={{ font: "var(--fw-semibold) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>{r.authorName}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== FAQ (only when the store has Q&A) ===== */}
      {faqs.length > 0 && (
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px clamp(16px, 4vw, 32px) 56px" }}>
          <div style={revealStyle}>
            <div style={eyebrow}>Good to know</div>
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, overflow: "hidden", background: "var(--surface-card)" }}>
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
          <Button fullWidth variant="outline" onClick={onSaveContact} leadingIcon={<Icon name="user" size={16} />}>Save contact</Button>
        </div>
      )}

      {/* ===== VISIT ===== */}
      {(site.address || site.area || site.hours.length > 0) && (
      <div id="visit" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: 0, display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, padding: "clamp(40px, 7vw, 56px) clamp(16px, 4vw, 32px)" }}>
            <div style={eyebrow}>Visit us</div>
            {site.address && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-medium) 15px/1.4 var(--font-sans)", color: "var(--text-body)", marginBottom: 22 }}>
                <span style={{ color: "var(--primary)", display: "flex" }}>
                  <Icon name="building" size={18} />
                </span>
                {site.address}
              </div>
            )}
            {site.hours.length > 0 && (
              <>
                <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>Opening hours</div>
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
              title={`Map of ${site.name}`}
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
        <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto", padding: "clamp(40px, 7vw, 64px) clamp(16px, 4vw, 32px)", textAlign: "center" }}>
          <h2 style={{ font: "var(--fw-extrabold) clamp(26px, 5vw, 36px)/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "#fff", margin: "0 0 10px" }}>Skip the wait — join the live queue</h2>
          <p style={{ font: "var(--fw-medium) 16px/1.5 var(--font-sans)", color: "rgba(255,255,255,.85)", margin: "0 0 26px" }}>{liveCount} in the queue · {waitHeadline} · we&apos;ll text you when you&apos;re close</p>
          <div onClick={openQueue} className="salonCtaBtn" style={{ display: "inline-block", cursor: "pointer", background: "#fff", color: "var(--primary)", font: "var(--fw-bold) 17px/1 var(--font-sans)", padding: "16px 32px", borderRadius: 12, boxShadow: "var(--shadow-lg)" }}>
            Join the queue →
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px clamp(16px, 4vw, 32px)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>
            Powered by{" "}
            <span style={{ font: "var(--fw-extrabold) 14px/1 var(--font-sans)" }}>
              <span style={{ color: "var(--brand-ink)" }}>Tejo</span>
              <span style={{ color: "var(--brand-accent)" }}>Time</span>
            </span>
          </span>
          <span style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-subtle)" }}>Terms · Privacy</span>
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
            {inService ? "It's your turn" : "You're in line"} · {resumeToken}
          </span>
          <span style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: inService ? "var(--success)" : "var(--text-muted)" }}>
            {inService ? "Head to the chair" : resumeLabel}
          </span>
          <span style={{ font: "var(--fw-bold) 13px/1 var(--font-sans)", color: "var(--primary)" }}>Track →</span>
        </div>
      )}

      {/* ===== SAVE CONTACT (vCard) SHEET ===== */}
      <SaveContactSheet open={saveOpen} onClose={() => setSaveOpen(false)} vcardUrl={vcardUrl} storeName={site.name} />

      {/* ===== JOIN / BOOK MODAL ===== */}
      {joinOpen && (
        <div onClick={closeJoin} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "ttFade .22s ease" }}>
          <div onClick={stop} style={{ width: 460, maxWidth: "100%", background: "var(--surface-card)", borderRadius: 20, boxShadow: "var(--shadow-xl)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column", animation: "ttModalIn .42s cubic-bezier(.34,1.4,.5,1) both" }}>
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
                  <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(1) }} />
                  <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(2) }} />
                  <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(3) }} />
                  <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(4) }} />
                </div>
              )}
            </div>

            <div style={{ padding: "22px 24px 26px", overflow: "auto" }}>
              {/* ---------- VIEW: FLOW ---------- */}
              {view === "flow" && (
                <>
                  {/* STEP 1: pick service */}
                  {step === 1 && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <p style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 16px" }}>What are you here for today? Prices &amp; durations below.</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                        {services.map((sv) => {
                          const on = cart === sv.id;
                          return (
                            <div key={sv.id} onClick={() => setCart(sv.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 13, borderRadius: 12, padding: "13px 15px", transition: "border-color .15s ease, background .15s ease", background: on ? "color-mix(in srgb, var(--primary) 6%, var(--surface-card))" : "var(--surface-card)", border: `1.5px solid ${on ? "var(--primary)" : "var(--border-subtle)"}` }}>
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
                      <div style={{ marginTop: 20 }}>
                        <Button variant="primary" size="lg" fullWidth disabled={!cart} onClick={toStep2}>
                          {cart ? `Continue · ${sel!.name} →` : "Pick a service to continue"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 2: details */}
                  {step === 2 && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Your name</div>
                      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aman" className="salonInput" style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--border-default)", borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--text-strong)", outline: "none", marginBottom: 16, background: "var(--surface-card)" }} />
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Phone number</div>
                      <PhoneField country={phoneCountry} national={national} onCountryChange={setPhoneCountry} onNationalChange={setNational} marginBottom={16} />
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>Preferred barber (optional)</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                        {[{ id: "any", name: "Any" }, ...barbers.map((b) => ({ id: b.id, name: b.name }))].map((c) => {
                          const on = barber === c.id;
                          return (
                            <span key={c.id} onClick={() => setBarber(c.id)} style={{ cursor: "pointer", font: "var(--fw-semibold) 13px/1 var(--font-sans)", padding: "8px 15px", borderRadius: 999, transition: "all .15s ease", ...(on ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" } : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }) }}>
                              {c.name}
                            </span>
                          );
                        })}
                      </div>

                      {mode === "book" && (
                        <>
                          <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>Pick a time (today)</div>
                          {slotsLoading ? (
                            <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", marginBottom: 18 }}>Loading slots…</div>
                          ) : slots.length === 0 ? (
                            <div style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", marginBottom: 18 }}>No slots available today — try joining the live queue instead.</div>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                              {slots.map((s) => {
                                const on = selectedSlot === s.startAt;
                                return (
                                  <span key={s.startAt} onClick={() => setSelectedSlot(s.startAt)} style={{ cursor: "pointer", font: "var(--fw-semibold) 13px/1 var(--font-sans)", padding: "8px 13px", borderRadius: 10, transition: "all .15s ease", ...(on ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" } : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }) }}>
                                    {s.label}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "13px 15px", marginBottom: 14 }}>
                        <span style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--text-body)" }}>
                          {(sel ? sel.name : "") + " · " + (mode === "book" ? (selectedSlot ? "time selected" : "choose a time above") : joinWaitText)}
                        </span>
                        <span style={{ font: "var(--fw-bold) 16px/1 var(--font-sans)", color: "var(--text-strong)" }}>{sel ? `${curSym}${sel.price}` : ""}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
                        <span style={{ color: phoneVerified ? "var(--success)" : "var(--secondary)", display: "flex", flexShrink: 0 }}>
                          <Icon name={phoneVerified ? "check" : "bell"} size={15} />
                        </span>
                        <span style={{ font: "var(--fw-medium) 12px/1.35 var(--font-sans)", color: "var(--text-muted)" }}>
                          {phoneVerified
                            ? "Your number is already verified — no code needed. You'll get your token right after you confirm."
                            : "We'll text a 4-digit code to verify your number. No app, no password."}
                        </span>
                      </div>
                      {formError && <div style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--error)", marginBottom: 12 }}>{formError}</div>}
                      <div style={{ display: "flex", gap: 10 }}>
                        <Button variant="outline" size="lg" onClick={backTo1}>Back</Button>
                        <div style={{ flex: 1 }}>
                          <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={cantConfirm || submitting} onClick={phoneVerified ? confirmJoin : sendOtp}>
                            {phoneVerified ? (mode === "book" ? "Confirm booking →" : "Join the queue →") : "Send verification code →"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* STEP 3: OTP verify */}
                  {step === 3 && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <div style={{ width: 52, height: 52, borderRadius: 14, background: "color-mix(in srgb, var(--primary) 10%, var(--surface-card))", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <Icon name="bell" size={24} />
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>Verify your number</h3>
                      <p style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 20px" }}>
                        We sent a 4-digit code to <span style={{ font: "var(--fw-semibold) 13px/1 var(--font-sans)", color: "var(--text-strong)" }}>{formatPhone(phone)}</span>. Enter it to confirm you&apos;re a real customer.
                      </p>
                      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                        {otp.map((v, i) => (
                          <input
                            key={i}
                            ref={(el) => {
                              otpRefs.current[i] = el;
                            }}
                            value={v}
                            onChange={(e) => onOtpInput(i, e.target.value)}
                            onKeyDown={(e) => onOtpKeyDown(i, e)}
                            type="tel"
                            maxLength={1}
                            inputMode="numeric"
                            className="salonOtpBox"
                            style={{ width: 52, height: 60, textAlign: "center", font: "var(--fw-extrabold) 24px/1 var(--font-sans)", color: "var(--text-strong)", borderRadius: 12, outline: "none", background: "var(--surface-card)", border: `1.5px solid ${otpError ? "var(--error)" : v ? "var(--primary)" : "var(--border-default)"}` }}
                          />
                        ))}
                      </div>
                      {otpError && (
                        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--error)", font: "var(--fw-medium) 12px/1.3 var(--font-sans)", marginBottom: 12 }}>
                          <Icon name="x" size={14} />
                          {otpError}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                        <span onClick={resendOtp} style={{ font: "var(--fw-semibold) 12px/1 var(--font-sans)", ...(resendIn > 0 ? { color: "var(--text-subtle)", cursor: "default" } : { color: "var(--primary)", cursor: "pointer" }) }}>
                          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                        </span>
                        <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-subtle)" }}>Demo code: 1 2 3 4</span>
                      </div>
                      <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={submitting} onClick={verifyOtp}>
                        {mode === "book" ? "Verify & book →" : "Verify & join queue →"}
                      </Button>
                      <div onClick={backToDetails} style={{ textAlign: "center", font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 14, cursor: "pointer" }}>← Change number</div>
                    </div>
                  )}

                  {/* STEP 4: ticket / booked */}
                  {step === 4 && (
                    <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                      <div style={{ position: "relative", width: 68, height: 68, margin: "6px auto 16px" }}>
                        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--success)", animation: "ttRing 1.2s ease-out infinite" }} />
                        <div style={{ position: "relative", width: 68, height: 68, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", animation: "ttPop .5s cubic-bezier(.34,1.5,.5,1) both" }}>
                          <Icon name="check" size={34} />
                        </div>
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 22px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>
                        {mode === "book"
                          ? "You're booked!"
                          : ticket?.status === "completed"
                            ? "All done — thanks for visiting!"
                            : ticket && !isActive(ticket.status)
                              ? "You're no longer in the queue"
                              : justTurn
                                ? "It's your turn!"
                                : "You're in the queue!"}
                      </h3>
                      <p style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>
                        {mode === "book"
                          ? booking
                            ? `${booking.serviceName} · ${new Date(booking.scheduledStartAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                            : "See you at your slot."
                          : ticket?.status === "completed"
                            ? "Your service is complete. See you next time!"
                            : ticket && !isActive(ticket.status)
                              ? "You're no longer in the queue."
                              : justTurn
                                ? "Head to the chair — see you inside."
                                : (ticket?.ahead ?? 0) <= 1
                                  ? "You're next — we'll text you the moment the chair's free."
                                  : "We'll text you when you're 2 away."}
                      </p>

                      {mode === "queue" && ticket && (
                        <div style={{ border: "2px solid var(--text-strong)", borderRadius: 16, padding: 20, marginBottom: 16 }}>
                          <div style={{ font: "var(--fw-bold) 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Your token</div>
                          <div style={{ font: "var(--fw-extrabold) 46px/1 var(--font-sans)", color: "var(--text-strong)", margin: "8px 0", letterSpacing: "-.01em" }}>{ticket.token}</div>
                          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 10 }}>
                            <div>
                              <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{justTurn ? 0 : ticket.ahead}</div>
                              <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>ahead of you</div>
                            </div>
                            <div>
                              <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--secondary)", fontVariantNumeric: "tabular-nums" }}>{justTurn ? "Now" : `~${displayWait}m`}</div>
                              <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>est. wait</div>
                            </div>
                          </div>
                          <div style={{ height: 6, background: "var(--surface-sunken)", borderRadius: 999, marginTop: 16, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: progressPct, background: "var(--success)", borderRadius: 999, transition: "width .6s ease" }} />
                          </div>
                        </div>
                      )}

                      {mode === "queue" && ticket && isActive(ticket.status) && !confirmLeave && (
                        <>
                          <Button variant="primary" fullWidth onClick={closeJoin}>Done</Button>
                          {canLeaveQueue(ticket.status) && (
                            <div onClick={askLeave} style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--error)", marginTop: 14, cursor: "pointer" }}>Leave queue</div>
                          )}
                        </>
                      )}
                      {(mode === "book" || !ticket || !isActive(ticket.status)) && !confirmLeave && (
                        <Button variant="primary" fullWidth onClick={closeJoin}>Done</Button>
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
                      <div style={{ width: 52, height: 52, borderRadius: 14, background: "color-mix(in srgb, var(--secondary) 12%, var(--surface-card))", color: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <Icon name="ticket" size={24} />
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>Check your place in line</h3>
                      <p style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>
                        Enter the phone number you joined or booked with. We&apos;ll verify it&apos;s you, then show your slot.
                      </p>
                      <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Phone number</div>
                      <PhoneField country={phoneCountry} national={national} onCountryChange={setPhoneCountry} onNationalChange={setNational} marginBottom={18} />
                      {formError && <div style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--error)", marginBottom: 12 }}>{formError}</div>}
                      <Button variant="primary" size="lg" fullWidth disabled={phone.replace(/\D/g, "").length < 4} onClick={trackSendOtp}>
                        Send verification code →
                      </Button>
                    </div>
                  )}

                  {/* TRACK STEP 2: OTP verify */}
                  {tstep === 2 && (
                    <div style={{ animation: "ttStep .32s ease both" }}>
                      <h3 style={{ font: "var(--fw-extrabold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>Verify your number</h3>
                      <p style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 20px" }}>
                        We sent a 4-digit code to <span style={{ font: "var(--fw-semibold) 13px/1 var(--font-sans)", color: "var(--text-strong)" }}>{formatPhone(phone)}</span>.
                      </p>
                      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                        {otp.map((v, i) => (
                          <input
                            key={i}
                            ref={(el) => {
                              otpRefs.current[i] = el;
                            }}
                            value={v}
                            onChange={(e) => onOtpInput(i, e.target.value)}
                            onKeyDown={(e) => onOtpKeyDown(i, e)}
                            type="tel"
                            maxLength={1}
                            inputMode="numeric"
                            className="salonOtpBox"
                            style={{ width: 52, height: 60, textAlign: "center", font: "var(--fw-extrabold) 24px/1 var(--font-sans)", color: "var(--text-strong)", borderRadius: 12, outline: "none", background: "var(--surface-card)", border: `1.5px solid ${otpError ? "var(--error)" : v ? "var(--primary)" : "var(--border-default)"}` }}
                          />
                        ))}
                      </div>
                      {otpError && (
                        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--error)", font: "var(--fw-medium) 12px/1.3 var(--font-sans)", marginBottom: 12 }}>
                          <Icon name="x" size={14} />
                          {otpError}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                        <span onClick={resendOtp} style={{ font: "var(--fw-semibold) 12px/1 var(--font-sans)", ...(resendIn > 0 ? { color: "var(--text-subtle)", cursor: "default" } : { color: "var(--primary)", cursor: "pointer" }) }}>
                          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                        </span>
                        <span style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-subtle)" }}>Demo code: 1 2 3 4</span>
                      </div>
                      <Button variant="primary" size="lg" fullWidth loading={submitting} disabled={submitting} onClick={trackVerify}>
                        Show my slot →
                      </Button>
                      <div onClick={trackBack} style={{ textAlign: "center", font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 14, cursor: "pointer" }}>← Change number</div>
                    </div>
                  )}

                  {/* TRACK STEP 3: no active booking */}
                  {tstep === 3 && (
                    <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                      <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface-sunken)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
                        <Icon name="search" size={26} />
                      </div>
                      <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>No active booking found</h3>
                      <p style={{ font: "var(--fw-regular) 14px/1.55 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 20px" }}>
                        This number isn&apos;t in today&apos;s queue. It may have been served, cancelled, or expired.
                      </p>
                      <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <Button variant="outline" fullWidth onClick={closeJoin}>Close</Button>
                        </div>
                        <div style={{ flex: 1 }}>
                          <Button variant="primary" fullWidth onClick={joinAfterTrack}>Join the queue</Button>
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
                  <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>{inService ? "It's your turn!" : "You're already in line"}</h3>
                  <p style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>{inService ? "You're up now — head to the chair, we're ready for you." : "This number already holds a live token. One active token per phone — no need to join twice."}</p>
                  <div style={{ border: "2px solid var(--text-strong)", borderRadius: 16, padding: 18, marginBottom: 16 }}>
                    <div style={{ font: "var(--fw-bold) 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Your token</div>
                    <div style={{ font: "var(--fw-extrabold) 40px/1 var(--font-sans)", color: "var(--text-strong)", margin: "8px 0" }}>{ticket?.token ?? held?.token ?? ""}</div>
                    <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6 }}>
                      <div>
                        <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "var(--primary)" }}>{justTurn ? 0 : ticket?.ahead ?? 0}</div>
                        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>ahead of you</div>
                      </div>
                      <div>
                        <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "var(--secondary)" }}>{justTurn ? "Now" : `~${displayWait}m`}</div>
                        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>est. wait</div>
                      </div>
                    </div>
                  </div>
                  {!confirmLeave ? (
                    <>
                      <Button variant="primary" fullWidth onClick={closeJoin}>Track my turn</Button>
                      {canLeaveQueue(ticket?.status) ? (
                        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                          <div style={{ flex: 1 }}>
                            <Button variant="outline" fullWidth onClick={joinDifferent}>Different number</Button>
                          </div>
                          <div style={{ flex: 1 }}>
                            <Button variant="ghost" fullWidth onClick={askLeave}>Leave queue</Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 10 }}>
                          <Button variant="outline" fullWidth onClick={joinDifferent}>Different number</Button>
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
                  <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>Too many attempts today</h3>
                  <p style={{ font: "var(--fw-regular) 14px/1.55 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 8px" }}>
                    This number has joined and cancelled several times. To keep the line fair for everyone, please <span style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--text-strong)" }}>call the shop</span> or come in to join.
                  </p>
                  {shopPhone && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 12, margin: "16px 0" }}>
                      <span style={{ color: "var(--primary)", display: "flex" }}>
                        <Icon name="phone" size={16} />
                      </span>
                      <span style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--text-strong)" }}>{shopPhone}</span>
                    </div>
                  )}
                  <Button variant="primary" fullWidth onClick={closeJoin}>Got it</Button>
                </div>
              )}

              {/* ---------- VIEW: LEFT QUEUE ---------- */}
              {view === "left" && (
                <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--surface-sunken)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 16px" }}>
                    <Icon name="check" size={28} />
                  </div>
                  <h3 style={{ font: "var(--fw-extrabold) 21px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>You&apos;ve left the queue</h3>
                  <p style={{ font: "var(--fw-regular) 14px/1.55 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 20px" }}>{leftMsg}</p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <Button variant="outline" fullWidth onClick={closeJoin}>Close</Button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Button variant="primary" fullWidth onClick={joinDifferent}>Rejoin queue</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline "leave the queue?" confirmation used by the ticket and already-in-line views.
function LeaveConfirm({ token, onStay, onLeave }: { token: string; onStay: () => void; onLeave: () => void }) {
  return (
    <div style={{ border: "1.5px solid var(--error)", borderRadius: 14, padding: 16, background: "color-mix(in srgb, var(--error) 5%, var(--surface-card))", textAlign: "left", animation: "ttStep .25s ease both" }}>
      <div style={{ font: "var(--fw-bold) 15px/1.3 var(--font-sans)", color: "var(--text-strong)", marginBottom: 6 }}>Leave the queue?</div>
      <div style={{ font: "var(--fw-regular) 13px/1.45 var(--font-sans)", color: "var(--text-muted)", marginBottom: 14 }}>
        You&apos;ll lose token {token} and the next customer moves up. You can rejoin, but you&apos;ll go to the back of the line.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Button variant="outline" fullWidth onClick={onStay}>Stay in queue</Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button variant="danger" fullWidth onClick={onLeave}>Yes, leave</Button>
        </div>
      </div>
    </div>
  );
}
