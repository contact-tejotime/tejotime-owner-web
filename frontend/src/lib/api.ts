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
  waitLabel: string;
}
export interface Microsite {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
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
  status: string;
  isYourTurn?: boolean;
  progressPct?: number;
  staffName?: string | null;
  serviceName?: string;
  socket?: { namespace: string; room: string; ticketKey: string; businessId: string };
}

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
  getAvailability: (slug: string) => req<Availability>(`/public/businesses/${slug}/availability`),
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
};
