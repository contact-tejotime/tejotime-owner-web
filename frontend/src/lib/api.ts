import { API_BASE_URL } from "./config";

/** Thrown on any non-2xx response; carries the backend error envelope's code. */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
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
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? "Request failed");
  }
  return json as T;
}

// ---- Types (mirror the backend public DTOs) ----
export interface Money {
  amount: number;
  currency: string;
}
export interface MicrositeService {
  id: string;
  name: string;
  durationMinutes: number;
  price: Money;
}
export interface MicrositeStaff {
  id: string;
  name: string;
  roleLabel: string | null;
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
  tagline: string | null;
  heroSubtitle: string | null;
  statValue: string | null;
  statLabel: string | null;
  description: string | null;
  aboutHeading: string | null;
  heroImageUrl: string | null;
  aboutImageUrl: string | null;
  faqs: { q: string; a: string }[];
  teamNoun: string | null;
  area: string | null;
  address: string | null;
  rating: number;
  reviewCount: number;
  establishedYear: number | null;
  openStatus: { isOpen: boolean; closesAt: string | null; label: string };
  hours: { dayOfWeek: number; label: string; isClosed: boolean }[];
  amenities: string[];
  gallery: string[];
  services: MicrositeService[];
  staff: MicrositeStaff[];
  reviews: { stars: number; text: string; authorName: string }[];
  live: { waitMinutes: number; queueCount: number };
  payments: string[];
  /** Store-level ISO 4217 code — picks the symbol for every displayed price. */
  currency: string;
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
  serviceName?: string;
  socket?: { namespace: string; room: string; ticketKey: string; businessId: string };
  /** Set by joinQueue when the phone already held a live ticket today (day-scoped dedup). */
  alreadyInQueue?: boolean;
}
/** Track-my-turn lookup result: the active ticket for today, or { found: false }.
 *  `customerName` is the caller's known name (past customer) for pre-filling a follow-on Join. */
export type TrackResult =
  | ({ found: true; customerName?: string | null } & Ticket)
  | { found: false; customerName?: string | null };

export interface JoinBody {
  serviceId: string;
  name: string;
  phone: string;
  preferredStaffId?: string;
}
export interface BookBody extends JoinBody {
  slotStart: string;
}

export const publicApi = {
  getMicrosite: (slug: string) => req<Microsite>(`/public/businesses/${slug}`),
  getMicrositeByPhone: (phone: string) => req<Microsite>(`/public/businesses/by-phone/${phone}`),
  getAvailability: (slug: string) => req<Availability>(`/public/businesses/${slug}/availability`),
  getStaffAvailability: (slug: string) => req<{ staff: MicrositeStaff[] }>(`/public/businesses/${slug}/staff`),
  getSlots: (slug: string, params: { date: string; serviceId?: string; staffId?: string }) => {
    const q = new URLSearchParams({ date: params.date });
    if (params.serviceId) q.set("serviceId", params.serviceId);
    if (params.staffId) q.set("staffId", params.staffId);
    return req<{ date: string; slots: Slot[] }>(`/public/businesses/${slug}/slots?${q}`);
  },
  joinQueue: (slug: string, body: JoinBody) =>
    req<Ticket>(`/public/businesses/${slug}/queue`, { method: "POST", body: JSON.stringify(body) }),
  bookSlot: (slug: string, body: BookBody) =>
    req<{ appointmentId: string; serviceName: string; scheduledStartAt: string; status: string; staffName: string | null }>(
      `/public/businesses/${slug}/appointments`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getTicket: (ticketId: string) => req<Ticket>(`/public/tickets/${ticketId}`),
  leaveTicket: (ticketId: string) =>
    req<{ ok: boolean }>(`/public/tickets/${ticketId}`, { method: "DELETE" }),
  trackByPhone: (slug: string, body: { phone: string }) =>
    req<TrackResult>(`/public/businesses/${slug}/track`, { method: "POST", body: JSON.stringify(body) }),
};
