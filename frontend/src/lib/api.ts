import { API_BASE_URL } from "./config";
import { t } from "@/i18n";
import type { ThemeConfig } from "@/theme/engine";

/** Thrown on any non-2xx response; carries the backend error envelope's code. */
export class ApiError extends Error {
  code: string;
  status: number;
  /**
   * The envelope's per-field details, when it has them. `CHANGE_CONFLICTS` uses `rule` to name each
   * date that still needs a choice, which is how the manage page knows which ones to re-open.
   */
  details: { field?: string; rule?: string; message?: string }[];
  constructor(status: number, code: string, message: string, details: ApiError["details"] = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE_URL + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? "ERROR",
      err.message ?? t.api.requestFailed,
      Array.isArray(err.details) ? err.details : [],
    );
  }
  return json as T;
}

// ---- Types (mirror the backend public DTOs) ----
export interface Money {
  amount: number;
  currency: string;
}
/**
 * How a service is priced. `unset` covers services that predate pricing modes and were carrying
 * a `price_paise` of 0 to mean "not priced yet" — see the backfill note in
 * backend/db/migrations/0024_service_price_range.sql.
 */
export type ServicePriceType = "fixed" | "range" | "unset";

export interface MicrositeService {
  id: string;
  name: string;
  durationMinutes: number;
  /** The fixed price, or the MINIMUM of a range — `priceType` says which. */
  price: Money;
  /**
   * Optional because a cached response from before pricing modes simply omits it; the label
   * builder then falls back to the old rule (a non-zero amount is a fixed price).
   */
  priceType?: ServicePriceType;
  /** The maximum of a range. Null in every other mode. */
  priceMax?: Money | null;
}
export interface MicrositeStaff {
  id: string;
  name: string;
  roleLabel: string | null;
  avatarUrl: string | null;
  busy: boolean;
  queueCount: number;
  waitMinutes: number;
  waitLabel: string;
}
export interface Microsite {
  id: string;
  slug: string;
  countryCode: string | null;
  phoneNumber: string | null;
  name: string;
  /** Business category (e.g. "Salon & Barber", "Hospital", "Restaurant") — drives category-specific UI. */
  category: string;
  tagline: string | null;
  heroSubtitle: string | null;
  /**
   * The owner's heading for the photo gallery (2026-10-05). null = the default for this kind of
   * store (components/microsite/domains.ts). Optional: an older backend omits it.
   */
  galleryHeading?: string | null;
  description: string | null;
  aboutHeading: string | null;
  heroImageUrl: string | null;
  aboutImageUrl: string | null;
  logoUrl: string | null;
  faqs: { q: string; a: string }[];
  /** "Neighborhood shown on your page" — optional since 2026-10-05; `city` stands in when blank. */
  area: string | null;
  /** Optional: an older backend omits it, and a blank neighborhood then shows nothing. */
  city?: string | null;
  address: string | null;
  rating: number;
  reviewCount: number;
  establishedYear: number | null;
  /**
   * `nextOpenLabel` is "today at 10:00 AM" / "Monday at 10:00 AM", already worded and
   * timezone-resolved by the API. Optional: a response from a backend older than this field
   * simply omits it, and the microsite then falls back to the generic closed copy.
   */
  openStatus: { isOpen: boolean; closesAt: string | null; label: string; nextOpenLabel?: string | null };
  hours: { dayOfWeek: number; label: string; isClosed: boolean }[];
  /**
   * The store's IANA timezone — slot labels and hours are in it. Optional: an older backend (or a
   * cached payload) omits it, and times then fall back to the viewer's own zone.
   */
  timezone?: string;
  amenities: string[];
  gallery: string[];
  services: MicrositeService[];
  staff: MicrositeStaff[];
  reviews: { stars: number; text: string; authorName: string }[];
  live: { waitMinutes: number; queueCount: number };
  payments: string[];
  /**
   * Social profiles the store filled in, already filtered to the non-empty ones by the API.
   * Optional because a cached response from before this shipped simply omits it.
   */
  socials?: { key: "instagram" | "facebook" | "twitter" | "linkedin" | "yelp"; url: string }[];
  /** Store-level ISO 4217 code — picks the symbol for every displayed price. */
  currency: string;
  /** Brand/accent hex (#RRGGBB) for microsite theming; null → default TejoTime blue. */
  themeColor: string | null;
  /**
   * Full theme config (the `business.theme` jsonb). Optional because older backends — and any
   * cached response — simply omit it; `micrositeThemeConfig()` then falls back to `themeColor`
   * on the legacy parity config. Never trust the shape: it is normalised before use.
   */
  theme?: ThemeConfig | null;
  /**
   * Platform flag (backend CHATBOT_ENABLED) that shows the help-chat widget. Optional and
   * treated as false when absent, so a cached payload from before the feature hides it.
   */
  chatbotEnabled?: boolean;
  /**
   * The store takes repeating bookings ("Repeat this booking?" in the booking modal —
   * docs/recurring-appointments.md). Optional and treated as false when absent, so a cached
   * payload or an older backend never offers a choice the API would then refuse.
   */
  recurringEnabled?: boolean;
}
export interface Availability {
  waitMinutes: number;
  queueCount: number;
  updatedAt: string;
}
export interface Slot {
  startAt: string;
  label: string;
}
export interface Ticket {
  ticketId: string;
  token: string;
  ahead: number;
  waitMinutes: number;
  /** The slice of waitMinutes that decays with wall-clock (the in-service head's remaining time). */
  serviceRemainingMinutes?: number;
  /** Server timestamp the wait figures were computed at — anchor for the client-side countdown. */
  asOf?: string;
  status: string;
  isYourTurn?: boolean;
  progressPct?: number;
  staffName?: string | null;
  serviceName?: string | null;
  socket?: { namespace: string; room: string; ticketKey: string; businessId: string };
  /** Set by joinQueue when the phone already held a live ticket today (day-scoped dedup). */
  alreadyInQueue?: boolean;
}
/** Track-my-turn lookup result: the active ticket for today, or { found: false }.
 *  Position only — no `socket` key (so it cannot be used to leave), and `customerName` is no longer
 *  sent (a phone number alone must not reveal who it belongs to). The field stays optional so an
 *  older backend's response still type-checks. */
export type TrackResult =
  | ({ found: true; customerName?: string | null } & Ticket)
  | { found: false; customerName?: string | null };

export interface JoinBody {
  /** Single-service form. Superseded by `serviceIds`; kept because the API still accepts it. */
  serviceId?: string;
  /** The visit's services in pick order — the first becomes the primary service. */
  serviceIds?: string[];
  name: string;
  phone: string;
  preferredStaffId?: string;
  visitorType?: "mr" | "patient";
  /** A2P opt-in to appointment texts (confirmation + 15-min reminder). Omit or false → none. */
  smsOptIn?: boolean;
  /** A2P opt-in to the one post-visit review text. The page's single consent box sets both flags. */
  reviewSmsOptIn?: boolean;
}
// ---- Recurring appointments (docs/recurring-appointments.md) ----
/** When a repeating booking stops. Mirrors the backend's `repeatSchema` end union. */
export type RepeatEnd = { type: "never" } | { type: "count"; count: number } | { type: "until"; date: string };
/** "Every N days, until …" — N is 7–90, a count is 2–26 visits, an until-date at most a year out. */
export interface RepeatRule {
  everyDays: number;
  end: RepeatEnd;
}
/** Why a date inside the first three weeks was not booked. Only `closed` reads as "shop closed". */
export type SeriesSkipReason = "closed" | "taken" | "outside_hours" | "stylist_unavailable" | "service_missing";
/** The series half of a booking response — present only when the booking sent `repeat`. */
export interface BookedSeries {
  seriesId: string;
  /**
   * The customer's way back in (16 url-safe chars). It goes in the manage link's FRAGMENT and is
   * sent as a header, so it never lands in a server or proxy log.
   */
  manageToken: string;
  everyDays: number;
  /** "HH:mm" on the store's clock. */
  startTime: string;
  status: string;
  /** Every visit booked now, the first one included (visits[0] is the top-level appointment). */
  visits: { appointmentId: string; scheduledStartAt: string; appointmentKey: string }[];
  /** "YYYY-MM-DD" store-local dates inside the first three weeks that could not be booked. */
  skipped: { date: string; reason: SeriesSkipReason }[];
}
/** ok = booked on confirm · later = booked by the job ~3 weeks ahead · the rest are skipped. */
export type SeriesPreviewStatus = "ok" | "later" | "closed" | "taken" | "outside_hours";
export interface SeriesPreview {
  /** The first few rule dates (6 at most), each judged the way the booking will judge it. */
  dates: { date: string; startAt: string; status: SeriesPreviewStatus }[];
  everyDays: number;
  /** Null for a series that never ends. */
  totalVisits: number | null;
  lastDate: string | null;
}
export type SeriesStatus = "active" | "paused" | "ended" | "cancelled";
/** GET /public/series (and the skip/cancel responses) — the manage page's whole payload. */
export interface PublicSeries {
  seriesId: string;
  status: SeriesStatus;
  pauseReason: string | null;
  everyDays: number;
  /** "HH:mm" on the store's clock. */
  startTime: string;
  end: RepeatEnd;
  lastDate: string | null;
  totalVisits: number | null;
  staffName: string | null;
  serviceName: string | null;
  store: { name: string; slug: string; phoneFull: string | null; timezone: string };
  visits: {
    appointmentId: string;
    scheduledStartAt: string;
    status: string;
    /** "skipped" for a visit the customer or owner skipped; "cancelled" when the series was. */
    cancelReason: string | null;
    canSkip: boolean;
    // ---- Phase 2. Optional: a backend from before Phase 2 omits them, and the page then simply
    // offers no Reschedule / Change controls rather than breaking.
    staffId?: string | null;
    canReschedule?: boolean;
    /** Moved by hand — it keeps this time through a later "change all future visits". */
    moved?: boolean;
  }[];
  /** The next rule dates the job has not booked yet ("YYYY-MM-DD", store-local). */
  laterDates: string[];
  // ---- Phase 2 (optional for the same reason as the per-visit fields above) ----
  /** The series' stylist; null = any stylist (or, with `staffLocked`, one who has left). */
  staffId?: string | null;
  /** A stylist WAS chosen. With `staffId` null it means they left, and a change must pick someone. */
  staffLocked?: boolean;
  /** The store's active stylists — who a visit or the series can move to. */
  staff?: { id: string; name: string }[];
  /** The range a customer may move into, store-local "YYYY-MM-DD": today … today+20. */
  today?: string;
  lastDay?: string;
  /** Rule dates a "change all future visits" may start from. Empty unless the series is active. */
  changeFromDates?: string[];
}

/** Times for the customer's picker, already worked out on the store's clock. */
export interface SeriesSlots {
  date: string;
  slots: Slot[];
  today: string;
  lastDay: string;
}
/** A stylist choice: a staff id, "any" for no preference. Omitted = keep the current one. */
export type StaffChoice = string;
export interface SeriesChangeBody {
  /** One of `changeFromDates`. */
  fromDate: string;
  /** A slot ON `fromDate`; its time becomes the new time. Omit to keep the current time. */
  slotStart?: string;
  staffId?: StaffChoice;
}
/** A date the new time doesn't fit: another time (any free slot in range) or a skip. */
export type SeriesChangeResolution = { date: string; slotStart: string } | { date: string; skip: true };
/**
 * ok = booked at the new time · taken = the new time isn't free, needs a choice · kept = moved by
 * hand earlier, keeps its time · skipped = already skipped · closed = shop shut that weekday ·
 * later = past the horizon, booked about 3 weeks ahead.
 */
export type SeriesChangeStatus = "ok" | "taken" | "kept" | "skipped" | "closed" | "later";
export interface SeriesChangePreview {
  fromDate: string;
  startTime: string;
  staffId: string | null;
  dates: { date: string; startAt: string; status: SeriesChangeStatus }[];
  /** Every date here needs a resolution before the change can be confirmed. */
  conflicts: string[];
}

export interface BookBody extends JoinBody {
  slotStart: string;
  /** Make this the first visit of a repeating booking. Omit for a single visit. */
  repeat?: RepeatRule;
}
export interface BookResult {
  appointmentId: string;
  serviceName: string | null;
  scheduledStartAt: string;
  status: string;
  staffName: string | null;
  /**
   * Secret for this one booking. Held only by the browser that booked; it is what lets that device
   * read or cancel the appointment later. Optional: an older backend omits it.
   */
  appointmentKey?: string;
  /** Only when the request sent `repeat`. */
  series?: BookedSeries;
}
/**
 * Mirrors the backend's public appointment DTO (status read, move, cancel, and each lookup row).
 * Never carries a key itself — only a lookup row does (`LookedUpAppointment`).
 */
export interface PublicAppointment {
  appointmentId: string;
  serviceName: string | null;
  staffName: string | null;
  scheduledStartAt: string;
  status: string;
  /** Part of a repeating booking — shown with the repeat marker. Optional: older backends omit it. */
  repeats?: boolean;
  // ---- My appointments (2026-10-05). Optional for the same reason as `repeats`: a backend from
  // before it omits them, and the page then offers no Reschedule rather than breaking.
  /** The booking's stylist; null = any stylist. Where a move starts from. */
  staffId?: string | null;
  /** The repeating booking this visit belongs to; null for a one-off. */
  seriesId?: string | null;
  /** Set once the customer (or the store) moved it — shown as "Moved". */
  rescheduledAt?: string | null;
  /** Still pending/confirmed and not started — the only state a customer may move or cancel. */
  canChange?: boolean;
}
/**
 * One row of the My appointments phone lookup. `appointmentKey` is there only when `canChange` is:
 * keys cannot be revoked, so the API hands them out only for bookings that can still be changed.
 *
 * SECURITY (client decision, 2026-10-05): keys and series tokens from a lookup are held in page
 * memory only — never written to localStorage. Saved, they would hand the next person on a shared
 * browser someone else's bookings without typing anything.
 */
export interface LookedUpAppointment extends PublicAppointment {
  appointmentKey?: string;
}
export interface AppointmentLookup {
  /** Upcoming (from the start of the store's today), soonest first, at most 20. */
  appointments: LookedUpAppointment[];
  /** The phone's open repeating bookings, each with the manage token that opens them. */
  series: { seriesId: string; manageToken: string; status: "active" | "paused" }[];
}
export interface InquiryBody {
  businessName: string;
  address: string;
  phone: string;
}

/** Mirrors the zod schema on POST /public/consent. */
export interface ConsentBody {
  visitorId: string;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
  /** ISO 8601. */
  timestamp: string;
  policyVersion: string;
}

// ---- Help chat (docs/customer-chatbot-v1.md) ----
/** `appts` opens the page's My appointments (cancel / reschedule questions — backend chat-faq.ts). */
export type ChatActionType = "track" | "book" | "join" | "call" | "faq" | "appts";
/** A page button the reply suggests; the widget hands it to the page's own handler. */
export interface ChatAction {
  type: ChatActionType;
  label: string;
}
/** `faq_match` = an FAQ verbatim · `facts` = built from page facts · `llm` = a model, grounded on the same facts · `fallback` = escalate. */
export type ChatMode = "faq_match" | "facts" | "llm" | "fallback";

/** Shared reply envelope. `T` is the set of page buttons that surface may suggest. */
export interface ChatReplyOf<T extends string> {
  reply: string;
  mode: ChatMode;
  suggestedActions: { type: T; label: string }[];
}
export type ChatReply = ChatReplyOf<ChatActionType>;

/**
 * The marketing landing page's bot answers about the PRODUCT, so its buttons are landing-page
 * destinations rather than store actions. Different union, same envelope and same widget.
 */
export type PlatformChatActionType = "pilot" | "pricing" | "product" | "industries" | "demo" | "faq" | "signin";
export type PlatformChatReply = ChatReplyOf<PlatformChatActionType>;
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatBody {
  /** 1–500 chars, trimmed server-side. */
  message: string;
  /** A client-generated UUID; correlates log lines only — nothing is stored against it. */
  sessionId: string;
  /** The last few turns (max 8), since the server keeps none. */
  history?: ChatTurn[];
}

export const publicApi = {
  getMicrosite: (slug: string) => req<Microsite>(`/public/businesses/${slug}`),
  getMicrositeByPhone: (phone: string) => req<Microsite>(`/public/businesses/by-phone/${phone}`),
  getAvailability: (slug: string) => req<Availability>(`/public/businesses/${slug}/availability`),
  getStaffAvailability: (slug: string) => req<{ staff: MicrositeStaff[] }>(`/public/businesses/${slug}/staff`),
  getSlots: (
    slug: string,
    params: { date: string; serviceId?: string; serviceIds?: string[]; staffId?: string },
  ) => {
    const q = new URLSearchParams({ date: params.date });
    if (params.serviceId) q.set("serviceId", params.serviceId);
    // Comma-separated: the slot length is the SUM of the chosen services.
    if (params.serviceIds?.length) q.set("serviceIds", params.serviceIds.join(","));
    if (params.staffId) q.set("staffId", params.staffId);
    return req<{ date: string; slots: Slot[] }>(`/public/businesses/${slug}/slots?${q}`);
  },
  joinQueue: (slug: string, body: JoinBody) =>
    req<Ticket>(`/public/businesses/${slug}/queue`, { method: "POST", body: JSON.stringify(body) }),
  bookSlot: (slug: string, body: BookBody) =>
    req<BookResult>(`/public/businesses/${slug}/appointments`, { method: "POST", body: JSON.stringify(body) }),
  // Appointment self-service. Reading, moving and cancelling one needs its key; the booking browser
  // is handed it, and — client decision 2026-10-05 (docs/customer-my-appointments.md) — so is
  // anyone who types the phone number into the lookup, together with the series manage token. The
  // number must be a full +<country code> one: a bare number is a 400. Keys from a lookup stay in
  // page memory only (see LookedUpAppointment). publicWrite-limited (20/hour per network).
  lookupAppointments: (slug: string, body: { phone: string }) =>
    req<AppointmentLookup>(`/public/businesses/${slug}/appointments/lookup`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getAppointment: (appointmentId: string, key: string) =>
    req<PublicAppointment>(`/public/appointments/${appointmentId}`, { headers: { "x-appointment-key": key } }),
  cancelAppointment: (appointmentId: string, key: string) =>
    req<PublicAppointment>(`/public/appointments/${appointmentId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  /**
   * Free times on `date` for moving this booking (its own length; it does not block itself), with
   * the store-local range a customer may move into (`today` … `lastDay` = today+20). `staffId`
   * omitted keeps the booking's stylist; "any" = no preference. The key rides in a header, never
   * the query string, so it stays out of request logs.
   */
  appointmentSlots: (appointmentId: string, key: string, date: string, staffId?: StaffChoice) => {
    const q = new URLSearchParams({ date });
    if (staffId) q.set("staffId", staffId);
    return req<SeriesSlots>(`/public/appointments/${appointmentId}/slots?${q}`, { headers: { "x-appointment-key": key } });
  },
  /** 409 SLOT_UNAVAILABLE = the time is gone (or past today+20); 422 = it can't be moved any more. */
  rescheduleAppointment: (appointmentId: string, key: string, slotStart: string, staffId?: StaffChoice) =>
    req<PublicAppointment>(`/public/appointments/${appointmentId}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ key, slotStart, ...(staffId ? { staffId } : {}) }),
    }),
  /** What a repeat rule would book, before the customer confirms. Read-only. */
  previewSeries: (
    slug: string,
    body: { serviceIds?: string[]; preferredStaffId?: string; slotStart: string; repeat: RepeatRule },
  ) =>
    req<SeriesPreview>(`/public/businesses/${slug}/series-preview`, { method: "POST", body: JSON.stringify(body) }),
  // Repeating-booking self-service. The manage token rides in a header — never the path or query —
  // for the same reason the link carries it after `#`: nothing that logs URLs ever sees it. A
  // missing or wrong token is a 404, never a 403.
  getSeries: (token: string) => req<PublicSeries>(`/public/series`, { headers: { "x-series-token": token } }),
  skipSeriesVisit: (token: string, appointmentId: string) =>
    req<PublicSeries>(`/public/series/visits/${appointmentId}/skip`, {
      method: "POST",
      body: "{}",
      headers: { "x-series-token": token },
    }),
  cancelSeries: (token: string) =>
    req<PublicSeries>(`/public/series/cancel`, { method: "POST", body: "{}", headers: { "x-series-token": token } }),
  /**
   * Free times on `date` for moving one visit (`appointmentId` — its own length; it does not block
   * itself) or for a change (`fromDate` — the visits it replaces don't block it). `staffId` omitted
   * keeps the current stylist.
   */
  getSeriesSlots: (
    token: string,
    q: { date: string; staffId?: StaffChoice; appointmentId?: string; fromDate?: string },
  ) => {
    const params = new URLSearchParams({ date: q.date });
    if (q.staffId) params.set("staffId", q.staffId);
    if (q.appointmentId) params.set("appointmentId", q.appointmentId);
    if (q.fromDate) params.set("fromDate", q.fromDate);
    // Only the date, stylist and ids ride in the query; the token stays in the header.
    return req<SeriesSlots>(`/public/series/slots?${params}`, { headers: { "x-series-token": token } });
  },
  rescheduleSeriesVisit: (token: string, appointmentId: string, body: { slotStart: string; staffId?: StaffChoice }) =>
    req<PublicSeries>(`/public/series/visits/${appointmentId}/reschedule`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-series-token": token },
    }),
  /** Read-only: what "change all future visits" would do, date by date. */
  previewSeriesChange: (token: string, body: SeriesChangeBody) =>
    req<SeriesChangePreview>(`/public/series/preview-change`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-series-token": token },
    }),
  /** 409 CHANGE_CONFLICTS (details[].rule = dates) when a date still needs a choice. */
  changeSeries: (token: string, body: SeriesChangeBody & { resolutions?: SeriesChangeResolution[] }) =>
    req<PublicSeries>(`/public/series/change`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-series-token": token },
    }),
  getTicket: (ticketId: string) => req<Ticket>(`/public/tickets/${ticketId}`),
  /** Needs the ticket key the join returned — without it the API answers 404 (only the browser
   *  that joined may leave; a phone lookup elsewhere can see the place but not cancel it). */
  leaveTicket: (ticketId: string, ticketKey: string) =>
    req<{ ok: boolean }>(`/public/tickets/${ticketId}`, { method: "DELETE", headers: { "x-ticket-key": ticketKey } }),
  trackByPhone: (slug: string, body: { phone: string }) =>
    req<TrackResult>(`/public/businesses/${slug}/track`, { method: "POST", body: JSON.stringify(body) }),
  submitInquiry: (body: InquiryBody) =>
    req<{ id: string; submittedAt: string }>(`/public/inquiries`, { method: "POST", body: JSON.stringify(body) }),
  // Read-only: the reply may *suggest* Join / Book / Track, never perform them.
  chat: (slug: string, body: ChatBody) =>
    req<ChatReply>(`/public/businesses/${slug}/chat`, { method: "POST", body: JSON.stringify(body) }),
  // The marketing site's bot. No business key — it answers about TejoTime itself.
  platformChat: (body: ChatBody) =>
    req<PlatformChatReply>(`/public/chat`, { method: "POST", body: JSON.stringify(body) }),
  // The landing page is static and has no business payload to carry the flag, so it asks.
  chatStatus: () => req<{ enabled: boolean }>(`/public/chat/status`),
  /**
   * Record a cookie-consent choice. Fire-and-forget by contract — the caller never awaits it and
   * never shows an error, because the visitor's own cookie is what governs behaviour; this is
   * only the server-side audit copy. `countryCode` is deliberately NOT sent: the server derives
   * it from edge headers so a client cannot forge it.
   */
  postConsent: (body: ConsentBody) =>
    req<void>(`/public/consent`, { method: "POST", body: JSON.stringify(body) }),
};
