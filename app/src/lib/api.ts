import { t } from '@/i18n';
import {
  reportQueryString,
  type CommissionRates,
  type CommissionSummary,
  type CommissionVisits,
  type ReportQuery,
} from '@/lib/commission';
import { API_BASE_URL } from '@/lib/config';
import { clearTokens, getTokens, setTokens } from '@/lib/tokenStore';

/** One entry of the error envelope's `details` — a 409 CHANGE_CONFLICTS lists its dates in `rule`. */
export interface ApiErrorDetail {
  field?: string;
  rule?: string;
  message?: string;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: ApiErrorDetail[];
  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/* ---------------------------------------------------------------------------------------------
 * DTOs hand-mirrored from the backend, with no compiler between them (CLAUDE.md §16): a field the
 * API adds must be added here too, or it type-checks fine and renders `undefined`. owner-web
 * mirrors the same shapes in `owner-web/src/lib/server-api.ts`.
 * ------------------------------------------------------------------------------------------- */

export type AppointmentStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';

/** `backend/src/modules/appointments/appointment.dto.ts` `apptDTO`. */
export interface AppointmentDTO {
  id: string;
  customerName: string;
  customerPhone: string | null;
  serviceId: string | null;
  serviceName: string | null;
  staffId: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  status: AppointmentStatus;
  source: string;
  queueEntryId: string | null;
  notes: string | null;
  visitorType: 'mr' | 'patient' | null;
  /** Recurring appointments (migration 0036). Null on a one-off booking. */
  seriesId: string | null;
  /** The series' rule date ("YYYY-MM-DD", store-local). Unchanged if the visit is ever moved. */
  occurrenceDate: string | null;
  /** Why a cancelled visit was cancelled: a skip is not a cancellation in the reports. */
  cancelReason: 'skipped' | 'cancelled' | 'superseded' | null;
  /**
   * When it was moved by hand (migration 0037), or null. A moved visit is labelled "Moved" and
   * keeps its time through a later "change future visits".
   */
  rescheduledAt: string | null;
}

export type SeriesStatus = 'active' | 'paused' | 'ended' | 'cancelled';
export type SeriesEnd = { type: 'never' } | { type: 'count'; count: number } | { type: 'until'; date: string };
export type SeriesPauseReason = 'owner' | 'stylist_unavailable' | 'no_shows';

/** `series.service.ts` `seriesDTO` — one regular's repeat rule. */
export interface SeriesDTO {
  id: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  staffName: string | null;
  /** True when a stylist was chosen. With `staffId` null it means that stylist has gone. */
  staffLocked: boolean;
  serviceName: string | null;
  visitorType: 'mr' | 'patient' | null;
  /** Store-local "HH:mm" — never converted to the phone's timezone. */
  startTime: string;
  /** Store-local "YYYY-MM-DD" of the first visit under the current rule. */
  anchorDate: string;
  everyDays: number;
  end: SeriesEnd;
  lastDate: string | null;
  totalVisits: number | null;
  status: SeriesStatus;
  pauseReason: SeriesPauseReason | null;
  source: string;
  /** The next booked visit (UTC instant), or null when none is on the calendar yet. */
  nextVisitAt: string | null;
  openIssues: number;
  createdAt: string;
  updatedAt: string;
}

export type SeriesIssueReason = 'outside_hours' | 'stylist_unavailable' | 'slot_taken' | 'service_missing';

/** A series date the background job could not book — the owner's Needs attention list. */
export interface SeriesIssueDTO {
  id: string;
  seriesId: string;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  staffName: string | null;
  serviceName: string | null;
  occurrenceDate: string;
  scheduledStartAt: string;
  reason: SeriesIssueReason;
  createdAt: string;
}

/** `GET /appointments/series/:id`, and what pause / resume / cancel answer with. */
export interface SeriesDetail {
  series: SeriesDTO;
  /** The most recent 30, oldest first. */
  visits: AppointmentDTO[];
  issues: SeriesIssueDTO[];
  /** Rule dates not booked yet ("YYYY-MM-DD"). Only while the series is active. */
  laterDates: string[];
  /**
   * The dates "Change future visits" may start from: today up to the first date not booked yet
   * (starting later would leave the dates between booked by neither rule). Empty unless active.
   */
  changeFromDates: string[];
  /** The store's today ("YYYY-MM-DD"). */
  today: string;
  /** The server's clock — "upcoming" is decided against this, not the phone's. */
  now: string;
}

/**
 * "Due to come back" (docs/customer-due-list.md) — hand-mirrored from the backend's
 * `due.service.ts` DueListDTO, as owner-web's server-api.ts is. Dates are store-local "YYYY-MM-DD".
 */
export type DueStatus = 'due_soon' | 'overdue' | 'lapsed';
export type FollowupOutcome = 'no_answer' | 'call_later' | 'not_interested';
export type FollowupBody =
  | { outcome: 'no_answer' }
  | { outcome: 'call_later'; callBackOn: string }
  | { outcome: 'not_interested' };

export interface FollowupDTO {
  outcome: FollowupOutcome;
  snoozeUntil: string | null;
  aboutLastVisit: string;
  updatedAt: string;
}

export interface DueCustomerDTO {
  customerId: string;
  name: string;
  phone: string;
  isVip: boolean;
  visitsCount: number;
  status: DueStatus;
  usualDays: number;
  bandMin: number;
  bandMax: number;
  lastVisitDate: string;
  daysSinceLast: number;
  expectedDate: string;
  lastServiceName: string | null;
  lastStaff: { id: string; name: string; active: boolean } | null;
  serviceIds: string[];
  servicesResolved: boolean;
  followup: FollowupDTO | null;
  hiddenReason?: 'not_interested' | 'snoozed';
}

export interface DueListDTO {
  today: string;
  callBackRange: { min: string; max: string };
  counts: { overdue: number; dueSoon: number; lapsed: number; hidden: number };
  data: DueCustomerDTO[];
  hidden: DueCustomerDTO[];
}

/** One free time: the instant to send back, and its store-local label ("10:00 AM"). */
export interface SlotDTO {
  startAt: string;
  label: string;
}

/**
 * The times on one store-local day, plus the range a picker may offer (`today` … `lastDay`, both
 * store-local). The app never works out a store day or an instant itself — it sends `startAt` back.
 */
export interface SlotsResponse {
  date: string;
  slots: SlotDTO[];
  today: string;
  lastDay: string;
}

/** What "change future visits" would do to each date. */
export type ChangeDateStatus = 'ok' | 'taken' | 'kept' | 'skipped' | 'closed' | 'later';

export interface ChangePreview {
  fromDate: string;
  /** The series' time after the change, store-local "HH:mm". */
  startTime: string;
  staffId: string | null;
  dates: { date: string; startAt: string; status: ChangeDateStatus }[];
  /** The `taken` dates — each needs another time or a skip before the change can go ahead. */
  conflicts: string[];
}

/** A conflict's choice: another free time on that date, or skip that date. */
export type ChangeResolution = { date: string; slotStart: string } | { date: string; skip: true };

export interface ChangeInput {
  fromDate: string;
  /** A slot ON `fromDate`; its time becomes the series' time. Absent: keep the time. */
  slotStart?: string;
  /** A stylist id or 'any'. Absent: keep the stylist. */
  staffId?: string;
  resolutions?: ChangeResolution[];
}

function slotQuery(date: string, staffId?: string): string {
  return `date=${encodeURIComponent(date)}${staffId ? `&staffId=${encodeURIComponent(staffId)}` : ''}`;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onAuthFail: (() => void) | null = null;

export function setOnAuthFail(fn: (() => void) | null) {
  onAuthFail = fn;
}
export function getAccessToken() {
  return accessToken;
}

/** Restore any persisted session into memory (call on app start). */
export async function initSession(): Promise<boolean> {
  const t = await getTokens();
  accessToken = t.access;
  refreshToken = t.refresh;
  return !!accessToken;
}

async function persist(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  await setTokens(access, refresh);
}

export async function clearSession() {
  accessToken = null;
  refreshToken = null;
  await clearTokens();
}

/**
 * Single-flight: the REST 401 path and the socket re-dial (state/store.tsx) can both need a
 * fresh access token at the same moment. Refresh ROTATES — the backend revokes the old refresh
 * token — so two concurrent calls would have the loser sign the user out. Share one attempt.
 */
let refreshing: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Refresh the access token (e.g. before re-opening the socket). False = session is gone. */
export function refreshSession(): Promise<boolean> {
  return tryRefresh();
}

async function doRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    await persist(j.accessToken, j.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function raw<T = any>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(API_BASE_URL + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && refreshToken) {
    if (await tryRefresh()) return raw<T>(method, path, body, false);
    await clearSession();
    onAuthFail?.();
    throw new ApiError(401, 'UNAUTHENTICATED', t.toast.sessionExpired);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as any)?.error ?? {};
    throw new ApiError(
      res.status,
      e.code ?? 'ERROR',
      e.message ?? t.errors.requestFailed,
      Array.isArray(e.details) ? e.details : [],
    );
  }
  return json as T;
}

export const api = {
  /**
  * `accountType` is the Owner/Staff switch on the sign-in screen. A guard rail, not a second
  * credential: the password still decides everything, and the backend only checks the choice
  * against the account's real role AFTER the password verifies. Optional, so a build without
  * the switch keeps working.
  */
  login: async (phone: string, password: string, accountType?: 'owner' | 'staff') => {
    const j = await raw('POST', '/auth/login', {
      phone,
      password,
      ...(accountType ? { accountType } : {}),
    });
    await persist(j.accessToken, j.refreshToken);
    return j;
  },
  me: () => raw('GET', '/auth/me'),
  logout: async () => {
    let res: { ok?: boolean; message?: string } = { ok: true };
    try {
      if (refreshToken) res = await raw('POST', '/auth/logout', { refreshToken });
    } finally {
      await clearSession();
    }
    return res;
  },

  getQueue: () => raw('GET', '/queue?view=grouped'),
  addWalkin: (b: {
    name: string;
    phone?: string | null;
    /** Single-service form, still accepted by the API. Superseded by `serviceIds`. */
    serviceId?: string | null;
    /** The visit's services in pick order — the first becomes the entry's primary service. */
    serviceIds?: string[];
    staffId: string;
    position: 'end' | 'next';
    visitorType?: 'mr' | 'patient' | null;
  }) => raw('POST', '/queue', b),
  startService: (id: string) => raw('POST', `/queue/${id}/start`),
  /**
   * Complete a service. `amountPaise` overrides the derived total written to `visit`, for the
   * customer who booked one thing and had three. Omit it and the booked service plus recorded
   * add-ons is used, exactly as before.
   */
  checkout: (id: string, amountPaise?: number | null, paymentMethod?: PaymentMethod | null) =>
    raw('POST', `/queue/${id}/checkout`, {
      ...(amountPaise == null ? {} : { amountPaise }),
      // "Paid by" (0042). The sheet requires it; the API still takes a checkout without it.
      ...(paymentMethod ? { paymentMethod } : {}),
    }),
  /** One entry's detail, including the price breakdown the checkout sheet pre-fills from. */
  getQueueEntry: (id: string) =>
    raw<{
      /** The booked service on its own — `service` on the card carries every add-on too. */
      serviceName: string | null;
      serviceAmount: { amount: number; currency: string };
      servicePriceType: 'fixed' | 'range' | 'unset';
      serviceMaxAmount: { amount: number; currency: string } | null;
      extrasAmount: { amount: number; currency: string };
      /**
       * What to pre-fill, or NULL when there is nothing honest to pre-fill — a range-priced or
       * unpriced service. The API rejects a checkout with no amount for those too, so the
       * requirement holds even if a client ignores this.
       */
      suggestedAmount: { amount: number; currency: string } | null;
      amountRequired: boolean;
      /** `priceRequired`: a booked service with no price, stored at a placeholder 0 (0040). */
      extras: { id: string; label: string; minutes: number; pricePaise: number; priceRequired?: boolean }[];
      /**
       * Card payments (0043, docs/card-payments-paypal.md). Optional: an API from before them sends
       * none. `cardAllowed` is answered for the login asking — once the store charges cards in
       * TejoTime, only the main owner may record Card. `pendingCardPayment` is a charge in flight;
       * nobody can complete this customer until it finishes.
       */
      cardPaymentsEnabled?: boolean;
      cardAllowed?: boolean;
      pendingCardPayment?: { id: string; amount: { amount: number; currency: string } } | null;
    }>('GET', `/queue/${id}`),
  noShow: (id: string) => raw('POST', `/queue/${id}/no-show`),
  reassign: (id: string, staffId: string) => raw('POST', `/queue/${id}/reassign`, { staffId }),
  /** Put an add-on on the visit at the price the owner typed (paise). */
  extend: (id: string, label: string, minutes: number, pricePaise: number) =>
    raw('POST', `/queue/${id}/extend`, { label, minutes, pricePaise }),
  /** Take an add-on back off — a tap on a highlighted chip. */
  removeExtra: (id: string, label: string) => raw('POST', `/queue/${id}/remove-extra`, { label }),
  move: (id: string, toIndex: number) => raw('POST', `/queue/${id}/move`, { toIndex }),
  cancel: (id: string) => raw('DELETE', `/queue/${id}`),

  getServices: () => raw('GET', '/services?active=true'),
  getStaff: () => raw('GET', '/staff?active=true'),
  getAppointments: () => raw<{ data: AppointmentDTO[] }>('GET', '/appointments'),
  getAppointmentsRange: (from: string, to: string) =>
    raw<{ data: AppointmentDTO[] }>('GET', `/appointments?from=${from}&to=${to}`),
  checkIn: (id: string) => raw('POST', `/appointments/${id}/check-in`),
  /** Owner-side cancel. No SMS goes to the customer — the owner tells them. */
  cancelAppointment: (id: string) => raw<AppointmentDTO>('POST', `/appointments/${id}/cancel`),
  /** Two owner-marked no-shows in a row pause the visit's series (backend `noteNoShow`). */
  noShowAppointment: (id: string) => raw<AppointmentDTO>('POST', `/appointments/${id}/no-show`),
  /** Skip one visit of a series; 400 for a one-off booking, 422 once its time has passed. */
  skipAppointment: (id: string) => raw<AppointmentDTO>('POST', `/appointments/${id}/skip`),
  /**
   * Free times to move one booking to on `date` (store today … today+60). `staffId` absent = the
   * booking's own stylist; 'any' = no preference.
   */
  getAppointmentSlots: (id: string, date: string, staffId?: string) =>
    raw<SlotsResponse>('GET', `/appointments/${id}/slots?${slotQuery(date, staffId)}`),
  /**
   * Move one booking (one-off or series) to a slot from `getAppointmentSlots`. 409 SLOT_UNAVAILABLE
   * if it was taken meanwhile; a staff login may only move onto its own chair (403). No SMS.
   */
  rescheduleAppointment: (id: string, slotStart: string, staffId?: string) =>
    raw<AppointmentDTO>('POST', `/appointments/${id}/reschedule`, staffId ? { slotStart, staffId } : { slotStart }),

  // ---------- recurring series (docs/recurring-appointments.md) ----------
  /** The Regulars list. Default `open` = active + paused. A staff login gets its own chair's. */
  listSeries: (status?: 'open' | 'active' | 'paused' | 'ended' | 'cancelled' | 'all') =>
    raw<{ data: SeriesDTO[] }>('GET', `/appointments/series${status ? `?status=${status}` : ''}`),
  getSeries: (id: string) => raw<SeriesDetail>('GET', `/appointments/series/${id}`),
  pauseSeries: (id: string) => raw<SeriesDetail>('POST', `/appointments/series/${id}/pause`),
  /**
   * `staffId` hands the series to another stylist, or `'any'` for no preference. Required (the API
   * answers 400 VALIDATION_ERROR on `staffId`) when the series' own stylist has left.
   */
  resumeSeries: (id: string, staffId?: string) =>
    raw<SeriesDetail>('POST', `/appointments/series/${id}/resume`, staffId ? { staffId } : {}),
  cancelSeries: (id: string) => raw<SeriesDetail>('POST', `/appointments/series/${id}/cancel`),
  /**
   * Times a series visit could take on `date`. `fromDate` when picking a change's new time or a
   * conflict's other time (the visits that change replaces then do not block it); omitted for
   * "Book another time".
   */
  getSeriesSlots: (id: string, date: string, staffId?: string, fromDate?: string) =>
    raw<SlotsResponse>(
      'GET',
      `/appointments/series/${id}/slots?${slotQuery(date, staffId)}${fromDate ? `&fromDate=${fromDate}` : ''}`,
    ),
  /** What "change future visits" would do, written nowhere. `slotStart` must be a slot ON `fromDate`. */
  previewSeriesChange: (id: string, body: ChangeInput) =>
    raw<ChangePreview>('POST', `/appointments/series/${id}/preview-change`, body),
  /**
   * Change future visits (time and/or stylist). 409 CHANGE_CONFLICTS — `details[].rule` — names the
   * dates that still need another time or a skip; nothing is written then.
   */
  changeSeries: (id: string, body: ChangeInput) => raw<SeriesDetail>('PATCH', `/appointments/series/${id}`, body),
  listSeriesIssues: () => raw<{ data: SeriesIssueDTO[] }>('GET', '/appointments/series/issues'),
  /** "Book another time" for a Needs attention date; closes the item as booked. No SMS. */
  bookSeriesIssue: (issueId: string, slotStart: string, staffId?: string) =>
    raw<AppointmentDTO>(
      'POST',
      `/appointments/series/issues/${issueId}/book`,
      staffId ? { slotStart, staffId } : { slotStart },
    ),
  resolveSeriesIssue: (issueId: string) =>
    raw<{ ok: true }>('POST', `/appointments/series/issues/${issueId}/resolve`),
  getCustomers: (search?: string) =>
    raw('GET', `/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  /** "Due to come back" — the call list (docs/customer-due-list.md). Staff: own chair only. */
  getDueCustomers: () => raw<DueListDTO>('GET', '/customers/due'),
  /** What a call achieved. "No answer" hides them until the store's tomorrow. */
  setFollowup: (customerId: string, body: FollowupBody) =>
    raw<FollowupDTO>('PUT', `/customers/${customerId}/followup`, body),
  /** Undo: back on the list if still due. */
  clearFollowup: (customerId: string) => raw<{ ok: true }>('DELETE', `/customers/${customerId}/followup`),
  /** Free times for a NEW booking of these services (length = their sum). */
  getNewBookingSlots: (date: string, serviceIds: string[], staffId?: string) =>
    raw<SlotsResponse>(
      'GET',
      `/appointments/slots?${slotQuery(date, staffId)}${
        serviceIds.length ? `&serviceIds=${serviceIds.map(encodeURIComponent).join(',')}` : ''
      }`,
    ),
  /**
   * Book a customer at a slot from `getNewBookingSlots` — "Due to come back" → Book. 409
   * SLOT_UNAVAILABLE when it was taken meanwhile. No SMS: the owner is on the phone with them.
   */
  createAppointment: (body: {
    /** Someone already on the books ("Due to come back")… */
    customerId?: string;
    /** …or a typed customer (Book appointment): the phone is required, an existing number is matched. */
    customerName?: string;
    customerPhone?: string;
    serviceIds: string[];
    slotStart: string;
    staffId?: string;
    visitorType?: 'mr' | 'patient';
  }) => raw<AppointmentDTO>('POST', '/appointments', body),
  getDashboard: (q: ReportQuery = { range: 'today' }) =>
    raw('GET', `/dashboard/summary?${reportQueryString(q)}`),
  getDashboardByStaff: (q: ReportQuery = { range: 'today' }) =>
    raw('GET', `/dashboard/by-staff?${reportQueryString(q)}`),

  // ---------- commission (docs/staff-commission.md) ----------
  /** The period's commission. A staff login always gets it, for its own chair only. */
  getCommissionSummary: (q: ReportQuery) =>
    raw<CommissionSummary>('GET', `/commission/summary?${reportQueryString(q)}`),
  /** One stylist's visits, each at its day's rate. A staff login may only ask for its own chair. */
  getCommissionVisits: (staffId: string, q: ReportQuery) =>
    raw<CommissionVisits>('GET', `/commission/visits?staffId=${encodeURIComponent(staffId)}&${reportQueryString(q)}`),
  /** Owners only. */
  getCommissionRates: () => raw<CommissionRates>('GET', '/commission/rates'),
  /** Owners only. Today's date, or none, starts at now(); a later day starts at store midnight. */
  setCommissionRate: (staffId: string, rateBp: number, effectiveFrom?: string) =>
    raw('PUT', `/commission/rates/${staffId}`, effectiveFrom ? { rateBp, effectiveFrom } : { rateBp }),
  /** Owners only. `effectiveFrom` is the UTC instant. 409 once that instant has passed. */
  deleteCommissionRate: (staffId: string, effectiveFrom: string) =>
    raw('DELETE', `/commission/rates/${staffId}/${encodeURIComponent(effectiveFrom)}`),
  getBusiness: () => raw('GET', '/business'),
  updateBusiness: (b: import('@/lib/business-profile').BusinessProfilePatch) =>
    raw('PATCH', '/business', b),
  /** Owner / co-owner only: offer "Repeat this booking?" on the store page. */
  setRecurringEnabled: (recurringEnabled: boolean) => raw('PATCH', '/business', { recurringEnabled }),
  setHours: (hours: { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean }[]) =>
    raw('PUT', '/business/hours', { hours }),
  setAmenities: (amenities: string[]) => raw('PUT', '/business/amenities', { amenities }),
  setGallery: (images: import('@/lib/business-profile').GalleryImageInput[]) =>
    raw('PUT', '/business/gallery', { images }),

  /**
   * Pricing crosses as a triple — mode, amount (fixed price or range floor) and, for a range
   * only, the ceiling. All in paise. The three fields only make sense together, so the API
   * refuses a PATCH that sends one without the others rather than leaving a fixed service
   * holding the ceiling of a range it used to be.
   */
  createService: (b: {
    name: string;
    durationMinutes: number;
    priceType: 'fixed' | 'range' | 'unset';
    /** Omitted for 'unset' — the API stores that as 0. */
    priceAmount?: number;
    priceMaxAmount?: number;
    colorToken: string;
    position?: number;
  }) => raw('POST', '/services', b),
  updateService: (
    id: string,
    b: {
      name?: string;
      durationMinutes?: number;
      priceType?: 'fixed' | 'range' | 'unset';
      priceAmount?: number;
      priceMaxAmount?: number;
    },
  ) => raw('PATCH', `/services/${id}`, b),
  deleteService: (id: string) => raw('DELETE', `/services/${id}`),

  createStaff: (b: { name: string; roleLabel?: string; colorToken?: string; position?: number; photoUrl?: string | null }) =>
    raw('POST', '/staff', b),
  updateStaff: (id: string, b: { name?: string; roleLabel?: string; photoUrl?: string | null }) =>
    raw('PATCH', `/staff/${id}`, b),
  /**
   * Soft-delete: the backend flips `is_active` rather than removing the row, so completed visits
   * keep their chair. It answers 409 SEAT_HAS_ACTIVE_ENTRIES while the seat still holds a
   * waiting/in-service entry — see `removeStaffMember` in the store for that path.
   */
  deleteStaff: (id: string) => raw('DELETE', `/staff/${id}`),

  /** Get a signed upload URL for an owner-scoped image (logo/hero/gallery/avatar). */
  signUpload: (b: { assetType: string; contentType: string; byteSize: number }) =>
    raw<{ uploadUrl: string; publicUrl: string; fileKey: string }>('POST', '/uploads/sign', b),

  // ---------- team logins (owner roles only; the backend refuses everyone else) ----------
  getTeam: () => raw<{ data: any[] }>('GET', '/users'),
  getPermissionCatalogue: () =>
    raw<{
      modules: { key: string; label: string }[];
      accessLevels: string[];
      defaults: { staff: Record<string, string>; co_owner: Record<string, string> };
    }>('GET', '/users/modules'),
  createUser: (b: {
    name: string;
    phone: string;
    password: string;
    role: 'co_owner' | 'staff';
    staffId?: string | null;
    permissions?: Record<string, string>;
  }) => raw('POST', '/users', b),
  updateUser: (
    id: string,
    b: { name?: string; phone?: string; role?: 'co_owner' | 'staff'; staffId?: string | null; isActive?: boolean },
  ) => raw('PATCH', `/users/${id}`, b),
  setUserPermissions: (id: string, permissions: Record<string, string>) =>
    raw('PUT', `/users/${id}/permissions`, { permissions }),
  resetUserPassword: (id: string, password: string) => raw('POST', `/users/${id}/password`, { password }),
  deactivateUser: (id: string) => raw('DELETE', `/users/${id}`),

  /** Change your own password. Required for every login except the super owner's, which is
   *  the only one not created by somebody else who therefore knows its initial password. */
  changePassword: (currentPassword: string, newPassword: string) =>
    raw('POST', '/auth/password', { currentPassword, newPassword }),

  /* ------------------------------------------------------------------------------------------
   * Card payments on the PayPal reader — MAIN OWNER ONLY (docs/card-payments-paypal.md). The phone
   * charges the card through PayPal's SDK (lib/card-reader.ts); these record it. Everyone else
   * gets 403 from every one of them.
   * ---------------------------------------------------------------------------------------- */
  getCardPaymentSettings: () => raw<CardPaymentSettings>('GET', '/card-payments/settings'),
  setCardPaymentSettings: (enabled: boolean, paypalOrgRef?: string | null) =>
    raw<CardPaymentSettings>('PUT', '/card-payments/settings', {
      enabled,
      ...(paypalOrgRef ? { paypalOrgRef } : {}),
    }),
  /** "Sign out of PayPal": off, and the store forgets its PayPal account. 409 while a charge is unconfirmed. */
  disconnectCardPayments: () => raw<CardPaymentSettings>('POST', '/card-payments/disconnect'),
  listCardPayments: (q: { status?: CardPayment['status']; needsReview?: boolean; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (q.status) qs.set('status', q.status);
    if (q.needsReview !== undefined) qs.set('needsReview', String(q.needsReview));
    qs.set('limit', String(q.limit ?? 50));
    return raw<{ data: CardPayment[] }>('GET', `/card-payments?${qs.toString()}`);
  },
  /** A `pending` charge; its id is the reference handed to the reader. `resumed`: an attempt was already in flight. */
  startCardPayment: (queueEntryId: string, amountPaise: number) =>
    raw<{ payment: CardPayment; resumed: boolean }>('POST', '/card-payments', { queueEntryId, amountPaise }),
  /** The reader approved: records it and completes the visit. Returns the board, like checkout. */
  completeCardPayment: (id: string, b: CardChargeReport) =>
    raw<{ payment: CardPayment; promoted: { id: string; name: string } | null; seats: any[] }>(
      'POST',
      `/card-payments/${id}/complete`,
      b,
    ),
  failCardPayment: (id: string, reason: string) =>
    raw<{ payment: CardPayment }>('POST', `/card-payments/${id}/fail`, { reason }),
  /** The reader refunded the whole amount. */
  refundCardPayment: (id: string, refundReference?: string | null) =>
    raw<{ payment: CardPayment }>('POST', `/card-payments/${id}/refund`, refundReference ? { refundReference } : {}),
};

/** "Paid by" codes (migration 0042) — the same union as `lib/checkout-amount.ts`. */
export type PaymentMethod = import('@/lib/checkout-amount').PaymentMethod;

/** `backend/src/modules/card-payments/card-payments.service.ts` `toDTO`. */
export interface CardPayment {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  amount: { amount: number; currency: string };
  chargedAmount: { amount: number; currency: string } | null;
  /** Paid, but its visit could not be completed with it, or the reader charged a different amount. */
  needsReview: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  entryMode: string | null;
  failureReason: string | null;
  queueEntryId: string | null;
  visitId: string | null;
  customerName: string | null;
  serviceName: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface CardPaymentSettings {
  enabled: boolean;
  paypalOrgRef: string | null;
  currency: string | null;
}

/** What the reader reported for an approved card. Brand and last four only — never the card number. */
export interface CardChargeReport {
  providerPaymentId?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  entryMode?: string | null;
  chargedAmountPaise?: number | null;
}
