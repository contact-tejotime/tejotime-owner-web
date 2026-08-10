import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import type { Socket } from 'socket.io-client';

import { AppointmentEntry, CalendarAppointmentEntry, Customer, ServiceVM, Staff } from '@/data/sample';
import { SeatGroupVM, CardVM, flatCards } from '@/lib/queue';
import { api, ApiError, getAccessToken, initSession, setOnAuthFail } from '@/lib/api';
import { connectOwner } from '@/lib/socket';
import {
  COLOR_PALETTE,
  mapAppointment,
  mapBusinessDetail,
  mapCalendarAppointment,
  mapCustomer,
  mapSeats,
  mapService,
  mapStaff,
  Money,
} from '@/lib/mappers';
import { DayHoursVM, toApiHours } from '@/lib/hours';
import { TAB_ROUTES } from '@/navigation/routes';
import { showToast } from '@/lib/toast';
import { t, format } from '@/i18n';
import { can, toSessionUser, type ModuleAccess, type SessionUser } from '@/lib/permissions';
import { useTheme } from '@/theme/ThemeProvider';
import type { BusinessProfilePatch, GalleryImageInput } from '@/lib/business-profile';
import { LEGACY_THEME_CONFIG, normalizeThemeConfig, type ThemeConfig } from '@/theme/engine';

/** Staff logins only keep their linked chair — socket/API payloads can still include the whole shop. */
function seatsForUser(raw: unknown, session: SessionUser | null | undefined): SeatGroupVM[] {
  const seats = mapSeats(raw as any);
  if (session?.role === 'staff' && session.staffId) {
    return seats.filter((g) => g.id === session.staffId);
  }
  return seats;
}

/** Adopt Appearance from login/`/auth/me`/GET /business payloads (theme jsonb + legacy color). */
function themeConfigFromBusiness(r: { theme?: unknown; themeColor?: string | null } | null | undefined): ThemeConfig | null {
  if (!r) return null;
  if (!r.theme && !r.themeColor) return null;
  return normalizeThemeConfig(r.theme, {
    ...LEGACY_THEME_CONFIG,
    ...(r.themeColor ? { brand: r.themeColor } : {}),
  });
}

export type Plan = 'free' | 'premium';
type Sheet = 'walkin' | null;
export type WalkInPosition = 'end' | 'next';
export type VisitorType = 'mr' | 'patient';

// Mirrors backend/src/config/constants.ts — categories where a service isn't forced / where
// the visitor must be identified as MR or Patient before adding a walk-in.
const OPTIONAL_SERVICE_CATEGORIES = new Set(['Hospital', 'Restaurant']);
const VISITOR_TYPE_CATEGORIES = new Set(['Hospital']);

type WalkIn = {
  service: string | null; // service name
  position: WalkInPosition;
  staffId: string; // 'auto' | staff id
  visitorType: VisitorType | null;
  error: string;
};

export interface DashboardKpis {
  todaysAppointments: number;
  activeNow: number;
  waitingNow: number;
  checkInCount: number;
  completed: number;
  revenue: Money;
}

export type ReportRange = 'today' | 'month';

export interface DashboardStaffRow {
  staffId: string;
  name: string;
  appointments: number;
  completed: number;
  revenue: Money;
}

interface BusinessInfo {
  id?: string;
  name: string;
  area?: string;
  slug?: string;
  address?: string;
  category?: string;
  city?: string;
  countryCode?: string | null;
  phoneNumber?: string | null;
  tagline?: string;
  heroSubtitle?: string;
  description?: string;
  aboutHeading?: string;
  establishedYear?: number | null;
  statValue?: string;
  statLabel?: string;
  logoUrl?: string;
  heroImageUrl?: string;
  aboutImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  payments?: string[];
  amenities?: string[];
  faqs?: { q: string; a: string }[];
  reviews?: { stars: number; text: string; authorName: string }[];
  gallery?: { id?: string; url: string; alt?: string | null }[];
  hours?: DayHoursVM[];
}

type State = {
  authed: boolean;
  authLoading: boolean;
  signInLoading: boolean;
  signOutLoading: boolean;
  bootstrapping: boolean; // first parallel data load after auth
  refreshing: boolean; // pull-to-refresh in progress
  walkinLoading: boolean;
  upgradeLoading: boolean;
  detailBusy: boolean; // a start/checkout/no-show action on the open detail card
  /**
   * WHICH action is running, not just that one is.
   *
   * `detailBusy` alone put a spinner on every button in the panel at once: pressing Start also
   * span No-show, because both were asking "is the panel busy?". Two spinners for one tap reads
   * as two things happening.
   */
  detailAction: 'start' | 'checkout' | 'noShow' | 'reassign' | 'extend' | null;
  checkInId: string | null; // appointment id currently being checked in
  queueStaff: string; // 'all' | staff id
  plan: Plan;
  sheet: Sheet;
  qr: boolean;
  detailId: string | null;
  dayApptsDate: string | null;
  dragId: string | null;
  walkin: WalkIn;
  search: string;
  business: BusinessInfo | null;
  /**
   * Who is signed in, and what they are allowed to see.
   *
   * `permissions` is the RESOLVED map from /auth/me — role defaults with this business's
   * overrides applied — not something computed here. The API guards enforce the same map, so
   * a tab hidden below is also a request the server refuses.
   */
  session: SessionUser | null;
  seats: SeatGroupVM[];
  services: ServiceVM[];
  staff: Staff[];
  appts: AppointmentEntry[];
  calendarAppts: CalendarAppointmentEntry[];
  calendarLoading: boolean;
  customers: Customer[];
  customerMeta: { shown: number; total: number; lockedCount: number };
  dashboard: DashboardKpis | null;
  reportRange: ReportRange;
  reportPeriodLabel: string | null;
  dashboardByStaff: DashboardStaffRow[];
};

type Store = State & {
  signIn: (phone: string, password: string, accountType?: 'owner' | 'staff') => void;
  signOut: () => void;
  refresh: () => Promise<void>;
  setQueueStaff: (id: string) => void;
  setSearch: (v: string) => void;
  openAlerts: () => void;
  openWalkin: () => void;
  closeWalkin: () => void;
  openQr: () => void;
  closeQr: () => void;
  setWalkinPosition: (p: WalkInPosition) => void;
  setWalkinStaff: (id: string) => void;
  setWalkinVisitorType: (v: VisitorType) => void;
  pickService: (name: string) => void;
  addWalkin: (fields: { name: string; phone: string }) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  openDayAppts: (dateKey: string) => void;
  closeDayAppts: () => void;
  startService: (id: string) => void;
  checkout: (id: string, amountPaise?: number | null) => void;
  noShow: (id: string) => void;
  reassign: (id: string, staffId: string) => void;
  extendService: (id: string, label: string, mins: number) => void;
  setDragId: (id: string | null) => void;
  moveWithinSeat: (staffId: string, id: string, toIndex: number) => void;
  moveCardToSeat: (fromStaffId: string, toStaffId: string, id: string, toIndex: number) => void;
  commitMove: (staffId: string, id: string) => void;
  commitCrossSeatMove: (id: string, toStaffId: string, toIndex: number) => void;
  checkInAppt: (a: AppointmentEntry) => void;
  loadCalendarAppointments: (from: string, to: string) => Promise<void>;
  setReportRange: (range: ReportRange) => void;
  upgrade: () => void;
  saveProfile: (
    patch: BusinessProfilePatch,
    extras?: { amenities?: string[]; gallery?: GalleryImageInput[] },
  ) => Promise<boolean>;
  saveAppearance: (theme: ThemeConfig) => Promise<boolean>;
  saveHours: (next: DayHoursVM[]) => void;
  createService: (f: { name: string; durationMinutes: number; priceRupees: number }) => Promise<boolean>;
  updateService: (id: string, f: { name: string; durationMinutes: number; priceRupees: number }) => Promise<boolean>;
  removeService: (id: string) => Promise<boolean>;
  createStaffMember: (f: { name: string; roleLabel: string; photoUrl: string | null }) => Promise<boolean>;
  updateStaffMember: (id: string, f: { name: string; roleLabel: string; photoUrl: string | null }) => Promise<boolean>;
};

const emptyWalkin: WalkIn = { service: null, position: 'end', staffId: 'auto', visitorType: null, error: '' };

const AppStateContext = createContext<Store | null>(null);

/** Local optimistic reorder of a seat's waiting cards (instant drag feedback). */
function reorderSeat(seat: SeatGroupVM, id: string, toIndex: number): SeatGroupVM {
  const serving = seat.cards.filter((c) => !c.isWaiting);
  const waiting = seat.cards.filter((c) => c.isWaiting);
  const ids = waiting.map((c) => c.id);
  const order = ids.filter((x) => x !== id);
  const clamped = Math.max(0, Math.min(order.length, toIndex));
  order.splice(clamped, 0, id);
  const byId: Record<string, CardVM> = {};
  waiting.forEach((c) => (byId[c.id] = c));
  const newServing = serving.map((c, i) => ({ ...c, pos: i + 1 }));
  const newWaiting = order
    .map((x, i) => (byId[x] ? { ...byId[x], pos: serving.length + i + 1 } : null))
    .filter(Boolean) as CardVM[];
  return { ...seat, cards: [...newServing, ...newWaiting], waitN: newWaiting.length, empty: newServing.length + newWaiting.length === 0 };
}

/** Optimistic move of a waiting card from one seat column to another. */
function moveCardAcrossSeats(
  seats: SeatGroupVM[],
  fromStaffId: string,
  toStaffId: string,
  id: string,
  toIndex: number,
): SeatGroupVM[] {
  if (fromStaffId === toStaffId) {
    return seats.map((g) => (g.id === fromStaffId ? reorderSeat(g, id, toIndex) : g));
  }
  let moving: CardVM | null = null;
  const without = seats.map((g) => {
    if (g.id !== fromStaffId) return g;
    const card = g.cards.find((c) => c.id === id);
    if (!card || !card.isWaiting) return g;
    moving = card;
    const cards = g.cards.filter((c) => c.id !== id);
    const waiting = cards.filter((c) => c.isWaiting);
    const serving = cards.filter((c) => !c.isWaiting);
    return {
      ...g,
      cards,
      waitN: waiting.length,
      empty: cards.length === 0,
      free: serving.length === 0,
      serving: serving.length > 0,
    };
  });
  if (!moving) return seats;
  const target = without.find((g) => g.id === toStaffId);
  if (!target) return seats;
  return without.map((g) => {
    if (g.id !== toStaffId) return g;
    const serving = g.cards.filter((c) => !c.isWaiting);
    const waiting = g.cards.filter((c) => c.isWaiting);
    const clamped = Math.max(0, Math.min(waiting.length, toIndex));
    const nextWaiting = [...waiting];
    nextWaiting.splice(clamped, 0, {
      ...moving!,
      staffId: g.id,
      seatName: g.name,
      seatColor: g.color,
      pos: serving.length + clamped + 1,
    });
    const cards = [
      ...serving.map((c, i) => ({ ...c, pos: i + 1 })),
      ...nextWaiting.map((c, i) => ({ ...c, pos: serving.length + i + 1 })),
    ];
    return {
      ...g,
      cards,
      waitN: nextWaiting.length,
      empty: cards.length === 0,
      free: serving.length === 0,
      serving: serving.length > 0,
    };
  });
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  // ThemeProvider sits above this one in _layout.tsx, so the store can push the business's
  // Appearance config up into it as soon as /business resolves.
  const { setThemeConfig } = useTheme();
  const [s, setS] = useState<State>({
    authed: false,
    authLoading: true,
    signInLoading: false,
    signOutLoading: false,
    bootstrapping: false,
    refreshing: false,
    walkinLoading: false,
    upgradeLoading: false,
    detailBusy: false,
    detailAction: null,
    checkInId: null,
    queueStaff: 'all',
    plan: 'free',
    sheet: null,
    qr: false,
    detailId: null,
    dayApptsDate: null,
    dragId: null,
    walkin: { ...emptyWalkin },
    search: '',
    business: null,
    session: null,
    seats: [],
    services: [],
    staff: [],
    appts: [],
    calendarAppts: [],
    calendarLoading: false,
    customers: [],
    customerMeta: { shown: 0, total: 0, lockedCount: 0 },
    dashboard: null,
    reportRange: 'today',
    reportPeriodLabel: null,
    dashboardByStaff: [],
  });

  const socketRef = useRef<Socket | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoursSeq = useRef(0);
  /** Range currently shown on the calendar screen, so socket events can keep it fresh. */
  const calendarRangeRef = useRef<{ from: string; to: string } | null>(null);
  /** Reports range — loadDashboard reads this on refresh so the toggle sticks. */
  const reportRangeRef = useRef<ReportRange>('today');
  /**
   * The signed-in user's permissions, mirrored into a ref.
   *
   * `bootstrap()` runs immediately after `setS`, before React has committed the new state, so
   * reading `s.session` there would see the previous value. A ref is written synchronously and
   * is therefore the only thing loadAll can trust about who just signed in.
   */
  const accessRef = useRef<ModuleAccess | null>(null);
  /** Role for by-staff reports — staff must not call /dashboard/by-staff. */
  const roleRef = useRef<SessionUser['role'] | null>(null);

  const patch = useCallback((fn: (p: State) => Partial<State>) => setS((p) => ({ ...p, ...fn(p) })), []);

  // ---------- loaders ----------
  const loadQueue = useCallback(async () => {
    try {
      const r = await api.getQueue();
      setS((p) => {
        const seats = seatsForUser(r.seats, p.session);
        let queueStaff = p.queueStaff;
        if (p.session?.role === 'staff') {
          queueStaff = p.session.staffId ?? seats[0]?.id ?? queueStaff;
        } else if (queueStaff !== 'all' && !seats.some((g) => g.id === queueStaff)) {
          queueStaff = 'all';
        }
        return { ...p, seats, queueStaff };
      });
    } catch {
      /* ignore */
    }
  }, []);
  const loadServices = useCallback(async () => {
    try {
      const r = await api.getServices();
      setS((p) => ({ ...p, services: r.data.map(mapService) }));
    } catch {
      /* ignore */
    }
  }, []);
  const loadStaff = useCallback(async () => {
    try {
      const r = await api.getStaff();
      setS((p) => ({ ...p, staff: r.data.map(mapStaff) }));
    } catch {
      /* ignore */
    }
  }, []);
  const loadAppointments = useCallback(async () => {
    try {
      const r = await api.getAppointments();
      const appts = r.data
        .filter((a: any) => a.status === 'pending' || a.status === 'confirmed')
        .map(mapAppointment);
      setS((p) => ({ ...p, appts }));
    } catch {
      /* ignore */
    }
  }, []);
  const loadCalendarAppointments = useCallback(async (from: string, to: string) => {
    calendarRangeRef.current = { from, to };
    setS((p) => ({ ...p, calendarLoading: true }));
    try {
      const r = await api.getAppointmentsRange(from, to);
      const calendarAppts = r.data.map(mapCalendarAppointment);
      setS((p) => ({ ...p, calendarAppts, calendarLoading: false }));
    } catch {
      setS((p) => ({ ...p, calendarLoading: false }));
    }
  }, []);
  const loadCustomers = useCallback(async (search?: string) => {
    try {
      const r = await api.getCustomers(search);
      setS((p) => ({
        ...p,
        customers: r.data.map(mapCustomer),
        customerMeta: r.meta ?? { shown: 0, total: 0, lockedCount: 0 },
        plan: r.plan ?? p.plan,
      }));
    } catch {
      /* ignore */
    }
  }, []);
  const loadDashboard = useCallback(async (range?: ReportRange) => {
    const r = range ?? reportRangeRef.current;
    try {
      const summary: any = await api.getDashboard(r);
      setS((p) => ({
        ...p,
        dashboard: summary.kpis,
        reportRange: r,
        reportPeriodLabel: summary.periodLabel ?? null,
      }));
    } catch {
      /* ignore */
    }
    if (roleRef.current && roleRef.current !== 'staff') {
      try {
        const byStaff: any = await api.getDashboardByStaff(r);
        setS((p) => ({ ...p, dashboardByStaff: byStaff.data ?? [] }));
      } catch {
        setS((p) => ({ ...p, dashboardByStaff: [] }));
      }
    } else {
      setS((p) => ({ ...p, dashboardByStaff: [] }));
    }
  }, []);
  const setReportRange = useCallback(
    (range: ReportRange) => {
      reportRangeRef.current = range;
      setS((p) => ({ ...p, reportRange: range }));
      void loadDashboard(range);
    },
    [loadDashboard],
  );
  const loadBusiness = useCallback(async () => {
    try {
      const r = await api.getBusiness();
      setS((p) => ({ ...p, business: mapBusinessDetail(r), plan: r.plan ?? p.plan }));
      // Adopt the store's Appearance settings so the app matches its own microsite. The
      // normaliser repairs anything malformed and falls back to the legacy theme_color, so a
      // store that has never opened Appearance keeps today's exact TejoTime palette.
      setThemeConfig(themeConfigFromBusiness(r));
    } catch {
      /* ignore */
    }
  }, [setThemeConfig]);

  /**
   * Only fetch what this account is allowed to see.
   *
   * Each loader already swallows its own errors, so an ungated version would still "work" — it
   * would just fire a handful of 403s on every sign-in and every pull-to-refresh for any staff
   * login. Skipping them keeps the log honest and the refresh fast.
   *
   * Services and staff are fetched whenever the queue is visible: they are reference data the
   * queue screen cannot render without, which is why the API gates them the same way.
   */
  const loadAll = useCallback(async () => {
    const access = accessRef.current;
    const queueish = can(access, 'queue') || can(access, 'appointments');
    await Promise.all([
      can(access, 'queue') ? loadQueue() : Promise.resolve(),
      queueish || can(access, 'services') ? loadServices() : Promise.resolve(),
      queueish || can(access, 'staff') ? loadStaff() : Promise.resolve(),
      can(access, 'appointments') ? loadAppointments() : Promise.resolve(),
      can(access, 'customers') ? loadCustomers() : Promise.resolve(),
      can(access, 'dashboard') ? loadDashboard() : Promise.resolve(),
      can(access, 'profile') ? loadBusiness() : Promise.resolve(),
    ]);
  }, [loadQueue, loadServices, loadStaff, loadAppointments, loadCustomers, loadDashboard, loadBusiness]);

  /** First data load after auth — flips `bootstrapping` so screens can show a spinner. */
  const bootstrap = useCallback(async () => {
    setS((p) => ({ ...p, bootstrapping: true }));
    try {
      await loadAll();
    } finally {
      setS((p) => ({ ...p, bootstrapping: false }));
    }
  }, [loadAll]);

  /** Pull-to-refresh — re-fetches everything, surfaced via `refreshing`. */
  const refresh = useCallback(async () => {
    setS((p) => ({ ...p, refreshing: true }));
    try {
      await loadAll();
    } finally {
      setS((p) => ({ ...p, refreshing: false }));
    }
  }, [loadAll]);

  const connectSocket = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;
    socketRef.current?.close();
    const sock = connectOwner(token);
    socketRef.current = sock;
    sock.on('queue:snapshot', (d: any) =>
      setS((p) => ({ ...p, seats: seatsForUser(d.seats, p.session) })),
    );
    const refreshVisibleCalendarRange = () => {
      const range = calendarRangeRef.current;
      if (range) loadCalendarAppointments(range.from, range.to);
    };
    sock.on('appointment:created', () => {
      loadAppointments();
      loadDashboard();
      refreshVisibleCalendarRange();
    });
    sock.on('appointment:checked_in', () => {
      loadAppointments();
      loadDashboard();
      loadQueue();
      refreshVisibleCalendarRange();
    });
    sock.on('appointment:updated', () => {
      loadAppointments();
      refreshVisibleCalendarRange();
    });
    sock.on('subscription:updated', (d: any) => {
      setS((p) => ({ ...p, plan: d.plan }));
      loadCustomers();
    });
    sock.on('notification:new', (d: any) => showToast(d?.body ?? t.toast.newNotification, 'info'));
  }, [loadAppointments, loadDashboard, loadQueue, loadCustomers, loadCalendarAppointments]);

  const teardown = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  // ---------- session restore on mount ----------
  useEffect(() => {
    let alive = true;
    setOnAuthFail(() => {
      teardown();
      accessRef.current = null;
      roleRef.current = null;
      setThemeConfig(null);
      setS((p) => ({ ...p, authed: false, authLoading: false, session: null }));
      showToast(t.toast.sessionExpired, 'error');
    });
    (async () => {
      const has = await initSession();
      if (has) {
        try {
          const me: any = await api.me();
          if (!alive) return;
          const session = toSessionUser(me.user);
          setS((p) => ({
            ...p,
            authed: true,
            authLoading: false,
            business: me.business
              ? {
                  id: me.business.id,
                  name: me.business.name,
                  slug: me.business.slug,
                  category: me.business.category ?? '',
                }
              : null,
            plan: me.business?.plan ?? 'free',
            session,
            // Staff start on their chair — never on the "All" filter.
            queueStaff: session?.role === 'staff' && session.staffId ? session.staffId : p.queueStaff,
          }));
          accessRef.current = session?.permissions ?? null;
          roleRef.current = session?.role ?? null;
          // Every role gets chrome theme from /auth/me — staff often cannot call GET /business.
          setThemeConfig(themeConfigFromBusiness(me.business));
          connectSocket();
          bootstrap();
          return;
        } catch {
          /* fall through to logged-out */
        }
      }
      if (alive) setS((p) => ({ ...p, authLoading: false }));
    })();
    return () => {
      alive = false;
      teardown();
      setOnAuthFail(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const store = useMemo<Store>(() => {
    return {
      ...s,
      signIn: async (phone, password, accountType) => {
        if (!phone.trim() || !password.trim()) {
          showToast(t.toast.enterPhonePassword, 'error');
          return;
        }
        patch(() => ({ signInLoading: true }));
        try {
          const res: any = await api.login(phone.trim(), password, accountType);
          const message =
            res?.message ??
            (res?.user?.name ? format(t.toast.welcomeBackName, { name: res.user.name }) : t.toast.signedIn);
          const session = toSessionUser(res.user);
          setS((p) => ({
            ...p,
            authed: true,
            signInLoading: false,
            business: res.business
              ? {
                  id: res.business.id,
                  name: res.business.name,
                  slug: res.business.slug,
                  category: res.business.category ?? '',
                }
              : null,
            plan: res.business?.plan ?? 'free',
            session,
            queueStaff: session?.role === 'staff' && session.staffId ? session.staffId : 'all',
          }));
          accessRef.current = session?.permissions ?? null;
          roleRef.current = session?.role ?? null;
          setThemeConfig(themeConfigFromBusiness(res.business));
          showToast(message, 'success');
          connectSocket();
          bootstrap();
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.signInFailed, 'error');
          patch(() => ({ signInLoading: false }));
        }
      },
      signOut: async () => {
        patch(() => ({ signOutLoading: true }));
        let message = t.toast.signedOut;
        let type: 'success' | 'error' | 'info' = 'success';
        try {
          const res: any = await api.logout();
          if (res?.message) message = res.message;
        } catch (e) {
          message = (e as ApiError)?.message ?? t.toast.signedOutLocally;
          type = 'info';
        }
        teardown();
        // Clear the identity too. Leaving a stale session behind meant the next person to sign
        // in on this device saw the previous user's nav for a frame.
        accessRef.current = null;
        roleRef.current = null;
        setThemeConfig(null);
        setS((p) => ({ ...p, authed: false, signOutLoading: false, session: null }));
        showToast(message, type);
      },
      refresh,
      setReportRange,
      setQueueStaff: (id) =>
        patch((p) => {
          // Staff cannot switch to the shop-wide "All" view.
          if (p.session?.role === 'staff' && id === 'all') return {};
          return { queueStaff: id };
        }),
      setSearch: (v) => {
        patch(() => ({ search: v }));
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => loadCustomers(v || undefined), 300);
      },
      openAlerts: () => showToast(t.toast.noNewNotifications, 'info'),
      openWalkin: () => {
        const firstService = s.services[0]?.name ?? null;
        patch(() => ({
          sheet: 'walkin',
          walkin: { ...emptyWalkin, service: firstService },
        }));
      },
      closeWalkin: () => patch(() => ({ sheet: null })),
      openQr: () => patch(() => ({ qr: true })),
      closeQr: () => patch(() => ({ qr: false })),
      setWalkinPosition: (position) => patch((p) => ({ walkin: { ...p.walkin, position } })),
      setWalkinStaff: (staffId) => patch((p) => ({ walkin: { ...p.walkin, staffId } })),
      setWalkinVisitorType: (visitorType) => patch((p) => ({ walkin: { ...p.walkin, visitorType, error: '' } })),
      pickService: (name) => patch((p) => ({ walkin: { ...p.walkin, service: name, error: '' } })),
      addWalkin: async ({ name, phone }) => {
        const w = s.walkin;
        const category = s.business?.category ?? '';
        const serviceOptional = OPTIONAL_SERVICE_CATEGORIES.has(category);
        const needsVisitorType = VISITOR_TYPE_CATEGORIES.has(category);
        if (!name.trim()) return patch(() => ({ walkin: { ...w, error: t.toast.enterName } }));
        if (!serviceOptional && !w.service) return patch(() => ({ walkin: { ...w, error: t.toast.pickService } }));
        if (needsVisitorType && !w.visitorType) return patch(() => ({ walkin: { ...w, error: t.toast.pickVisitorType } }));
        const serviceId = s.services.find((sv) => sv.name === w.service)?.id ?? null;
        patch(() => ({ walkinLoading: true }));
        try {
          const res: any = await api.addWalkin({
            name: name.trim(),
            phone: phone.trim() || undefined,
            serviceId,
            staffId: w.staffId,
            position: w.position,
            visitorType: w.visitorType,
          });
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session), sheet: null, walkinLoading: false }));
          showToast(w.position === 'next' ? t.toast.addedAsNext : t.toast.addedToQueue, 'success');
          loadDashboard();
        } catch (e) {
          patch(() => ({ walkinLoading: false, walkin: { ...s.walkin, error: (e as ApiError)?.message ?? t.toast.couldNotAdd } }));
        }
      },
      openDetail: (id) => patch(() => ({ detailId: id })),
      closeDetail: () => patch(() => ({ detailId: null })),
      openDayAppts: (dateKey) => patch(() => ({ dayApptsDate: dateKey })),
      closeDayAppts: () => patch(() => ({ dayApptsDate: null })),
      startService: async (id) => {
        patch(() => ({ detailBusy: true, detailAction: 'start' }));
        try {
          const res: any = await api.startService(id);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session), detailId: null, detailBusy: false, detailAction: null }));
          showToast(t.toast.serviceStarted, 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false, detailAction: null }));
          const err = e as ApiError;
          if (err.code === 'SEAT_BUSY') {
            const card = flatCards(s.seats).find((c) => c.id === id);
            const seat = s.staff.find((st) => st.id === card?.staffId);
            const seatGroup = s.seats.find((g) => g.id === card?.staffId);
            showToast(
              format(t.toast.seatBusyShort, {
                seat: seat?.name ?? t.detail.seatBusyFallback,
                name: seatGroup?.servingName?.split(' ')[0] ?? t.detail.someone,
              }),
              'error',
            );
          } else {
            showToast(err.message ?? t.toast.couldNotStart, 'error');
          }
        }
      },
      checkout: async (id, amountPaise) => {
        patch(() => ({ detailBusy: true, detailAction: 'checkout' }));
        try {
          const res: any = await api.checkout(id, amountPaise);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session), detailId: null, detailBusy: false, detailAction: null }));
          showToast(
            res.promoted ? format(t.toast.nowInService, { name: String(res.promoted.name).split(' ')[0] }) : t.toast.checkedOut,
            'success',
          );
          loadDashboard();
        } catch (e) {
          patch(() => ({ detailBusy: false, detailAction: null }));
          showToast((e as ApiError)?.message ?? t.toast.couldNotCheckOut, 'error');
        }
      },
      noShow: async (id) => {
        patch(() => ({ detailBusy: true, detailAction: 'noShow' }));
        try {
          const res: any = await api.noShow(id);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session), detailId: null, detailBusy: false, detailAction: null }));
          showToast(t.toast.markedNoShow, 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false, detailAction: null }));
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      reassign: async (id, staffId) => {
        patch(() => ({ detailBusy: true, detailAction: 'reassign' }));
        try {
          const res: any = await api.reassign(id, staffId);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session), detailBusy: false, detailAction: null }));
          const nm = s.staff.find((st) => st.id === staffId)?.name ?? '';
          showToast(nm ? format(t.toast.movedTo, { name: nm }) : t.toast.moved, 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false, detailAction: null }));
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      extendService: async (id, label, mins) => {
        patch(() => ({ detailBusy: true, detailAction: 'extend' }));
        try {
          const res: any = await api.extend(id, label, mins);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session), detailBusy: false, detailAction: null }));
          showToast(format(t.toast.extendAdded, { mins, label }), 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false, detailAction: null }));
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      setDragId: (id) => patch(() => ({ dragId: id })),
      moveWithinSeat: (staffId, id, toIndex) =>
        setS((p) => ({
          ...p,
          seats: p.seats.map((g) => (g.id === staffId ? reorderSeat(g, id, toIndex) : g)),
        })),
      moveCardToSeat: (fromStaffId, toStaffId, id, toIndex) =>
        setS((p) => ({
          ...p,
          seats: moveCardAcrossSeats(p.seats, fromStaffId, toStaffId, id, toIndex),
        })),
      commitMove: async (staffId, id) => {
        const seat = s.seats.find((g) => g.id === staffId);
        const waiting = seat ? seat.cards.filter((c) => c.isWaiting) : [];
        const idx = waiting.findIndex((c) => c.id === id);
        if (idx < 0) return;
        try {
          const res: any = await api.move(id, idx);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session) }));
        } catch {
          loadQueue();
        }
      },
      commitCrossSeatMove: async (id, toStaffId, toIndex) => {
        try {
          await api.reassign(id, toStaffId);
          const res: any = await api.move(id, toIndex);
          setS((p) => ({ ...p, seats: seatsForUser(res.seats, p.session) }));
          const nm = s.staff.find((st) => st.id === toStaffId)?.name ?? '';
          showToast(nm ? format(t.toast.movedTo, { name: nm }) : t.toast.moved, 'success');
        } catch {
          loadQueue();
          showToast(t.toast.error, 'error');
        }
      },
      checkInAppt: async (a) => {
        patch(() => ({ checkInId: a.id }));
        try {
          await api.checkIn(a.id);
          setS((p) => ({
            ...p,
            checkInId: null,
            appts: p.appts.filter((x) => x.id !== a.id),
            calendarAppts: p.calendarAppts.filter((x) => x.id !== a.id),
          }));
          router.push(TAB_ROUTES.dashboard as any);
          showToast(format(t.toast.addedToQueueName, { name: a.name }), 'success');
          loadQueue();
          loadDashboard();
        } catch (e) {
          patch(() => ({ checkInId: null }));
          showToast((e as ApiError)?.message ?? t.toast.couldNotCheckIn, 'error');
        }
      },
      upgrade: async () => {
        patch(() => ({ upgradeLoading: true }));
        try {
          await api.upgrade();
          setS((p) => ({ ...p, plan: 'premium', upgradeLoading: false }));
          showToast(t.toast.welcomePremium, 'success');
          loadCustomers(s.search || undefined);
        } catch (e) {
          patch(() => ({ upgradeLoading: false }));
          showToast((e as ApiError)?.message ?? t.toast.upgradeFailed, 'error');
        }
      },
      saveProfile: async (patch, extras) => {
        try {
          let res: any = await api.updateBusiness(patch);
          if (extras?.amenities) {
            res = await api.setAmenities(extras.amenities);
          }
          if (extras?.gallery) {
            res = await api.setGallery(extras.gallery);
          }
          setS((p) => ({ ...p, business: mapBusinessDetail(res), plan: res.plan ?? p.plan }));
          showToast(t.toast.profileSaved, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotSaveProfile, 'error');
          return false;
        }
      },
      saveAppearance: async (theme) => {
        try {
          const res: any = await api.updateBusiness({ theme });
          setS((p) => ({ ...p, business: mapBusinessDetail(res), plan: res.plan ?? p.plan }));
          const legacyBrand =
            typeof res.themeColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(res.themeColor)
              ? res.themeColor
              : theme.brand;
          setThemeConfig(
            normalizeThemeConfig(res.theme ?? theme, { ...LEGACY_THEME_CONFIG, brand: legacyBrand }),
          );
          showToast(t.toast.appearanceSaved, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotSaveAppearance, 'error');
          return false;
        }
      },
      saveHours: async (next) => {
        const seq = ++hoursSeq.current;
        setS((p) => ({ ...p, business: p.business ? { ...p.business, hours: next } : p.business }));
        try {
          const res: any = await api.setHours(toApiHours(next));
          if (seq === hoursSeq.current) setS((p) => ({ ...p, business: mapBusinessDetail(res) }));
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotSaveHours, 'error');
          if (seq === hoursSeq.current) loadBusiness();
        }
      },
      createService: async ({ name, durationMinutes, priceRupees }) => {
        try {
          await api.createService({
            name,
            durationMinutes,
            priceAmount: Math.round(priceRupees * 100),
            colorToken: COLOR_PALETTE[s.services.length % COLOR_PALETTE.length],
            position: s.services.length,
          });
          await loadServices();
          showToast(t.toast.serviceAdded, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotAddService, 'error');
          return false;
        }
      },
      updateService: async (id, { name, durationMinutes, priceRupees }) => {
        try {
          await api.updateService(id, { name, durationMinutes, priceAmount: Math.round(priceRupees * 100) });
          await loadServices();
          showToast(t.toast.serviceUpdated, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotUpdateService, 'error');
          return false;
        }
      },
      removeService: async (id) => {
        try {
          await api.deleteService(id);
          await loadServices();
          showToast(t.toast.serviceRemoved, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotRemoveService, 'error');
          return false;
        }
      },
      createStaffMember: async ({ name, roleLabel, photoUrl }) => {
        try {
          await api.createStaff({
            name,
            roleLabel: roleLabel || t.common.stylist,
            colorToken: COLOR_PALETTE[s.staff.length % COLOR_PALETTE.length],
            position: s.staff.length,
            photoUrl,
          });
          await loadStaff();
          showToast(t.toast.staffAdded, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotAddStaff, 'error');
          return false;
        }
      },
      updateStaffMember: async (id, { name, roleLabel, photoUrl }) => {
        try {
          await api.updateStaff(id, { name, roleLabel: roleLabel || t.common.stylist, photoUrl });
          await loadStaff();
          showToast(t.toast.staffUpdated, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotUpdateStaff, 'error');
          return false;
        }
      },
      loadCalendarAppointments,
    };
  }, [
    s,
    patch,
    refresh,
    connectSocket,
    bootstrap,
    teardown,
    loadCustomers,
    loadDashboard,
    loadQueue,
    loadServices,
    loadStaff,
    loadBusiness,
    loadCalendarAppointments,
    setReportRange,
    setThemeConfig,
  ]);

  return <AppStateContext.Provider value={store}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Store {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
