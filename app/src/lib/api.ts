import { API_BASE_URL } from '@/lib/config';
import { clearTokens, getTokens, setTokens } from '@/lib/tokenStore';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
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

async function tryRefresh(): Promise<boolean> {
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
    throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as any)?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Request failed');
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
    serviceId?: string | null;
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
  checkout: (id: string, amountPaise?: number | null) =>
    raw('POST', `/queue/${id}/checkout`, amountPaise == null ? {} : { amountPaise }),
  /** One entry's detail, including the price breakdown the checkout sheet pre-fills from. */
  getQueueEntry: (id: string) =>
    raw<{
      serviceAmount: { amount: number; currency: string };
      extrasAmount: { amount: number; currency: string };
      suggestedAmount: { amount: number; currency: string };
      extras: { id: string; label: string; minutes: number; pricePaise: number }[];
    }>('GET', `/queue/${id}`),
  noShow: (id: string) => raw('POST', `/queue/${id}/no-show`),
  reassign: (id: string, staffId: string) => raw('POST', `/queue/${id}/reassign`, { staffId }),
  extend: (id: string, label: string, minutes: number) => raw('POST', `/queue/${id}/extend`, { label, minutes }),
  move: (id: string, toIndex: number) => raw('POST', `/queue/${id}/move`, { toIndex }),
  cancel: (id: string) => raw('DELETE', `/queue/${id}`),

  getServices: () => raw('GET', '/services?active=true'),
  getStaff: () => raw('GET', '/staff?active=true'),
  getAppointments: () => raw('GET', '/appointments'),
  getAppointmentsRange: (from: string, to: string) => raw('GET', `/appointments?from=${from}&to=${to}`),
  checkIn: (id: string) => raw('POST', `/appointments/${id}/check-in`),
  getCustomers: (search?: string) =>
    raw('GET', `/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getDashboard: () => raw('GET', '/dashboard/summary'),
  getBusiness: () => raw('GET', '/business'),
  updateBusiness: (b: { name?: string; address?: string }) => raw('PATCH', '/business', b),
  setHours: (hours: { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean }[]) =>
    raw('PUT', '/business/hours', { hours }),

  createService: (b: { name: string; durationMinutes: number; priceAmount: number; colorToken: string; position?: number }) =>
    raw('POST', '/services', b),
  updateService: (id: string, b: { name?: string; durationMinutes?: number; priceAmount?: number }) =>
    raw('PATCH', `/services/${id}`, b),
  deleteService: (id: string) => raw('DELETE', `/services/${id}`),

  createStaff: (b: { name: string; roleLabel?: string; colorToken?: string; position?: number; photoUrl?: string | null }) =>
    raw('POST', '/staff', b),
  updateStaff: (id: string, b: { name?: string; roleLabel?: string; photoUrl?: string | null }) =>
    raw('PATCH', `/staff/${id}`, b),

  /** Get a signed upload URL for an owner-scoped image (logo/hero/gallery/avatar). */
  signUpload: (b: { assetType: string; contentType: string; byteSize: number }) =>
    raw<{ uploadUrl: string; publicUrl: string; fileKey: string }>('POST', '/uploads/sign', b),

  upgrade: () => raw('POST', '/subscription/upgrade'),

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
};
