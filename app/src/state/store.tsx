import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import type { Socket } from 'socket.io-client';

import { AppointmentEntry, CalendarAppointmentEntry, Customer, ServiceVM, Staff } from '@/data/sample';
import { SeatGroupVM, CardVM, flatCards } from '@/lib/queue';
import type { ServiceFormValues } from '@/components/settings';
import { AppState as RNAppState } from 'react-native';
import {
  api,
  ApiError,
  getAccessToken,
  initSession,
  refreshSession,
  setOnAuthFail,
  type SeriesDTO,
  type SeriesIssueDTO,
} from '@/lib/api';
import { connectOwner } from '@/lib/socket';
import { getOnboarded, setOnboarded } from '@/lib/tokenStore';
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
import { setStoreTimeZone } from '@/lib/zoned';
import { t, format } from '@/i18n';
import { can, toSessionUser, type ModuleAccess, type SessionUser } from '@/lib/permissions';
import type { CommissionSummary, ReportQuery, ReportRange as PeriodRange } from '@/lib/commission';
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

// Mirrors backend/src/config/constants.ts — the category where the visitor must be identified as
// MR or Patient before adding a walk-in. A service is never required, for any category.
const VISITOR_TYPE_CATEGORIES = new Set(['Hospital']);

type WalkIn = {
  /**
   * The visit's services by NAME, in pick order. A visit is routinely more than one thing, and
   * picking one used to drop the rest — the board sized the visit by the first service and
   * checkout rang up its price alone.
   */
  services: string[]; // service name
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

/** Today / This week / This month / Custom — the same four periods as owner-web's Reports. */
export type ReportRange = PeriodRange;

export interface DashboardStaffRow {
  staffId: string;
  name: string;
  /** False for a chair removed during the period — listed because it still did that work. */
  isActive?: boolean;
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
  /**
   * ISO 4217 code the store prices in (set in the admin panel). From /auth/me and login as well
   * as GET /business, because staff never load the latter and the price prefixes need it.
   */
  currency?: string;
  city?: string;
  countryCode?: string | null;
  phoneNumber?: string | null;
  tagline?: string;
  heroSubtitle?: string;
  description?: string;
  aboutHeading?: string;
  establishedYear?: number | null;
  /** '' = the store type's default gallery heading (see lib/store-family). */
  galleryHeading?: string;
  logoUrl?: string;
  heroImageUrl?: string;
  aboutImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  yelpUrl?: string;
  googleReviewUrl?: string;
  payments?: string[];
  amenities?: string[];
  faqs?: { q: string; a: string }[];
  reviews?: { stars: number; text: string; authorName: string }[];
  gallery?: { id?: string; url: string; alt?: string | null }[];
  hours?: DayHoursVM[];
  /** Offer "Repeat this booking?" on the store page. Only GET /business carries it (owners). */
  recurringEnabled?: boolean;
  /**
   * The store's IANA zone. From /auth/me and login (every role) as well as GET /business; every
   * booking time is printed on it (lib/zoned.ts).
   */
  timezone?: string;
}

/** A row action on one booking (Appointments tab, the series sheet). */
export type ApptAction = 'skip' | 'cancel' | 'noShow' | 'reschedule';

/** Where a booking moves to: a slot's `startAt` from the slots API, and a stylist (or 'any'). */
export type MoveTarget = { slotStart: string; staffId?: string };

type State = {
  authed: boolean;
  authLoading: boolean;
  /** First-run tour finished (or skipped). Read alongside the session, so `authLoading` covers it. */
  onboarded: boolean;
  signInLoading: boolean;
  signOutLoading: boolean;
  bootstrapping: boolean; // first parallel data load after auth
  refreshing: boolean; // pull-to-refresh in progress
  walkinLoading: boolean;
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
  /**
   * The period's first and last store-local day, and the store's today — all from the API. The app
   * never knows the store's timezone, so it never works out "today" from the device clock.
   */
  reportFrom: string | null;
  reportTo: string | null;
  reportToday: string | null;
  /** Commission for the Reports period. Null when this login is not allowed to see it. */
  commission: CommissionSummary | null;
  /** The stylist whose visits sheet is open (a Reports card, or "View visits"). */
  commissionVisitsFor: { staffId: string; name: string } | null;
  /** Regulars: active + paused repeating bookings (docs/recurring-appointments.md). */
  series: SeriesDTO[];
  /** False until the first Regulars load lands, so the tab can skeleton instead of "No regulars". */
  seriesLoaded: boolean;
  /** Needs attention: series dates the background job could not book. */
  seriesIssues: SeriesIssueDTO[];
  /** The repeating booking whose sheet is open. */
  seriesSheetId: string | null;
  /**
   * Bumped whenever something the open series sheet shows may have changed — a socket event, or an
   * action taken elsewhere. The sheet reads its detail live and refetches on every bump.
   */
  seriesRev: number;
  /** The booking row action in flight, so only that button spins. */
  apptAction: { id: string; kind: ApptAction } | null;
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
  completeOnboarding: () => void;
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
  /**
   * Skip (series visit), Cancel (one-off), Mark no-show, or Reschedule (with `move`) one booking.
   * True when it worked.
   */
  actOnAppt: (a: Pick<AppointmentEntry, 'id' | 'seriesId'>, kind: ApptAction, move?: MoveTarget) => Promise<boolean>;
  /** "Book another time" for a Needs attention date. True when it worked. */
  bookSeriesIssue: (issueId: string, move: MoveTarget) => Promise<boolean>;
  openSeries: (id: string) => void;
  closeSeries: () => void;
  /** Re-read everything a series change can move: Regulars, Needs attention, the lists, the sheet. */
  refreshSeriesViews: () => void;
  resolveSeriesIssue: (issueId: string) => Promise<void>;
  setRecurringEnabled: (next: boolean) => Promise<void>;
  loadCalendarAppointments: (from: string, to: string) => Promise<void>;
  /** Switch the Reports period; `from`/`to` (store-local days) only for `custom`. */
  setReportQuery: (q: ReportQuery) => void;
  openCommissionVisits: (staffId: string, name: string) => void;
  closeCommissionVisits: () => void;
  saveProfile: (
    patch: BusinessProfilePatch,
    extras?: { amenities?: string[]; gallery?: GalleryImageInput[] },
  ) => Promise<boolean>;
  saveAppearance: (theme: ThemeConfig) => Promise<boolean>;
  saveHours: (next: DayHoursVM[]) => void;
  createService: (f: ServiceFormValues) => Promise<boolean>;
  updateService: (id: string, f: ServiceFormValues) => Promise<boolean>;
  removeService: (id: string) => Promise<boolean>;
  createStaffMember: (f: { name: string; roleLabel: string; photoUrl: string | null }) => Promise<boolean>;
  updateStaffMember: (id: string, f: { name: string; roleLabel: string; photoUrl: string | null }) => Promise<boolean>;
  removeStaffMember: (id: string) => Promise<boolean>;
};

const emptyWalkin: WalkIn = { services: [], position: 'end', staffId: 'auto', visitorType: null, error: '' };

/**
 * Regulars are customers' names and phone numbers, scoped to whoever signed in (a staff login sees
 * only its chair's). Dropped on sign-out so the next person on this device never sees them.
 */
const SIGNED_OUT_SERIES: Pick<State, 'series' | 'seriesLoaded' | 'seriesIssues' | 'seriesSheetId' | 'apptAction'> = {
  series: [],
  seriesLoaded: false,
  seriesIssues: [],
  seriesSheetId: null,
  apptAction: null,
};

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
    onboarded: false,
    signInLoading: false,
    signOutLoading: false,
    bootstrapping: false,
    refreshing: false,
    walkinLoading: false,
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
    reportFrom: null,
    reportTo: null,
    reportToday: null,
    commission: null,
    commissionVisitsFor: null,
    series: [],
    seriesLoaded: false,
    seriesIssues: [],
    seriesSheetId: null,
    seriesRev: 0,
    apptAction: null,
  });

  const socketRef = useRef<Socket | null>(null);
  const seriesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoursSeq = useRef(0);
  /** Range currently shown on the calendar screen, so socket events can keep it fresh. */
  const calendarRangeRef = useRef<{ from: string; to: string } | null>(null);
  /** Reports period — loadDashboard reads this on refresh so the switch (and custom dates) stick. */
  const reportQueryRef = useRef<ReportQuery>({ range: 'today' });
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
  /** Re-read the month the Calendar tab is showing, if it has been opened. */
  const refreshVisibleCalendarRange = useCallback(() => {
    const range = calendarRangeRef.current;
    if (range) void loadCalendarAppointments(range.from, range.to);
  }, [loadCalendarAppointments]);
  const loadSeries = useCallback(async () => {
    try {
      const r = await api.listSeries();
      setS((p) => ({ ...p, series: r.data ?? [], seriesLoaded: true }));
    } catch {
      // Still "loaded": an API from before migration 0036 404s here, and the tab should then say
      // "No regulars yet" rather than skeleton forever.
      setS((p) => ({ ...p, seriesLoaded: true }));
    }
  }, []);
  const loadSeriesIssues = useCallback(async () => {
    try {
      const r = await api.listSeriesIssues();
      setS((p) => ({ ...p, seriesIssues: r.data ?? [] }));
    } catch {
      /* ignore */
    }
  }, []);
  /**
   * Regulars, Needs attention and the open series sheet, re-read together — debounced.
   *
   * The hourly job books visits in bursts, and each one emits `appointment:created` and
   * `series:updated`. Re-reading per event fired two requests per visit; collapsing a burst into
   * one read keeps the owner's phone quiet and the ownerRead limiter well clear.
   */
  const scheduleSeriesRefresh = useCallback(() => {
    if (!can(accessRef.current, 'appointments')) return;
    if (seriesTimer.current) clearTimeout(seriesTimer.current);
    seriesTimer.current = setTimeout(() => {
      seriesTimer.current = null;
      void loadSeries();
      void loadSeriesIssues();
      setS((p) => ({ ...p, seriesRev: p.seriesRev + 1 }));
    }, 300);
  }, [loadSeries, loadSeriesIssues]);
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
  /**
   * Everything Reports shows for the current period: the takings (`dashboard`), the per-chair
   * breakdown (store-wide roles only — staff must not call /dashboard/by-staff), and commission —
   * each only if this login may see it. Kept under its old name because every place that changes
   * the figures (checkout, walk-in, check-in, the appointment socket events) already calls it.
   */
  const loadDashboard = useCallback(async (query?: ReportQuery) => {
    const q = query ?? reportQueryRef.current;
    const access = accessRef.current;
    const jobs: Promise<void>[] = [];

    if (can(access, 'dashboard')) {
      jobs.push(
        (async () => {
          try {
            const summary: any = await api.getDashboard(q);
            setS((p) => ({
              ...p,
              dashboard: summary.kpis,
              reportRange: q.range,
              reportPeriodLabel: summary.periodLabel ?? null,
              reportFrom: summary.from ?? p.reportFrom,
              reportTo: summary.to ?? p.reportTo,
              reportToday: summary.today ?? p.reportToday,
            }));
          } catch {
            /* ignore */
          }
        })(),
      );
      if (roleRef.current && roleRef.current !== 'staff') {
        jobs.push(
          (async () => {
            try {
              const byStaff: any = await api.getDashboardByStaff(q);
              setS((p) => ({ ...p, dashboardByStaff: byStaff.data ?? [] }));
            } catch {
              setS((p) => ({ ...p, dashboardByStaff: [] }));
            }
          })(),
        );
      } else {
        setS((p) => ({ ...p, dashboardByStaff: [] }));
      }
    }

    // Commission: each visit at the rate of its own day (docs/staff-commission.md). A staff login
    // gets only its own chair, and only once the owner has shown it its earnings.
    if (can(access, 'commission')) {
      jobs.push(
        (async () => {
          try {
            const commission = await api.getCommissionSummary(q);
            setS((p) => ({
              ...p,
              commission,
              reportRange: q.range,
              reportPeriodLabel: commission.periodLabel ?? p.reportPeriodLabel,
              reportFrom: commission.from,
              reportTo: commission.to,
              reportToday: commission.today,
            }));
          } catch {
            setS((p) => ({ ...p, commission: null }));
          }
        })(),
      );
    } else {
      setS((p) => ({ ...p, commission: null }));
    }

    await Promise.all(jobs);
  }, []);
  const setReportQuery = useCallback(
    (q: ReportQuery) => {
      reportQueryRef.current = q;
      setS((p) => ({
        ...p,
        reportRange: q.range,
        ...(q.range === 'custom' && q.from && q.to ? { reportFrom: q.from, reportTo: q.to } : {}),
      }));
      void loadDashboard(q);
    },
    [loadDashboard],
  );
  const loadBusiness = useCallback(async () => {
    try {
      const r = await api.getBusiness();
      const business = mapBusinessDetail(r);
      if (business.timezone) setStoreTimeZone(business.timezone);
      setS((p) => ({ ...p, business, plan: r.plan ?? p.plan }));
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
      // Regulars and Needs attention live on the Appointments tab, behind the same permission.
      can(access, 'appointments') ? loadSeries() : Promise.resolve(),
      can(access, 'appointments') ? loadSeriesIssues() : Promise.resolve(),
      can(access, 'customers') ? loadCustomers() : Promise.resolve(),
      can(access, 'dashboard') || can(access, 'commission') ? loadDashboard() : Promise.resolve(),
      can(access, 'profile') ? loadBusiness() : Promise.resolve(),
    ]);
  }, [
    loadQueue,
    loadServices,
    loadStaff,
    loadAppointments,
    loadSeries,
    loadSeriesIssues,
    loadCustomers,
    loadDashboard,
    loadBusiness,
  ]);

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

  const redialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectSocket = useCallback(() => {
    if (!getAccessToken()) return;
    socketRef.current?.close();
    if (redialTimer.current) clearTimeout(redialTimer.current);
    redialTimer.current = null;
    const sock = connectOwner(getAccessToken);
    socketRef.current = sock;

    /*
     * The socket has to survive a whole day, idle or not. Idle is fine (the server pings every
     * 25s). What killed it was a refused handshake: after the 15-minute access token expired, a
     * reconnect was rejected and Socket.IO does NOT retry that (`sock.active` goes false). So on
     * a refusal, refresh the access token and re-dial by hand, with backoff. Ordinary drops —
     * phone locked, network switch, a deploy — keep `active` true and Socket.IO retries itself.
     */
    let redialDelay = 2_000;
    let connectedBefore = false;
    const redial = () => {
      if (sock.active || redialTimer.current || socketRef.current !== sock) return;
      redialTimer.current = setTimeout(async () => {
        redialTimer.current = null;
        if (socketRef.current !== sock || sock.connected) return;
        // False means the refresh token is gone too; the next REST call signs the user out.
        if (await refreshSession()) sock.connect();
      }, redialDelay);
      redialDelay = Math.min(redialDelay * 2, 30_000);
    };
    sock.on('connect_error', redial);
    // "io server disconnect" is the other case Socket.IO will not retry on its own.
    sock.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') redial(); // our own close() — sign-out, reconnect
    });
    sock.on('connect', () => {
      redialDelay = 2_000;
      // Events sent while we were offline are gone — re-read instead of trusting the last snapshot.
      if (connectedBefore) {
        loadQueue();
        loadAppointments();
        scheduleSeriesRefresh();
      }
      connectedBefore = true;
    });

    sock.on('queue:snapshot', (d: any) =>
      setS((p) => ({ ...p, seats: seatsForUser(d.seats, p.session) })),
    );
    // Series visits fire the ordinary appointment events too (including the ones the background
    // job books), and each can move a regular's "Next:" line — so they refresh Regulars as well.
    sock.on('appointment:created', () => {
      loadAppointments();
      loadDashboard();
      refreshVisibleCalendarRange();
      scheduleSeriesRefresh();
    });
    sock.on('appointment:checked_in', () => {
      loadAppointments();
      loadDashboard();
      loadQueue();
      refreshVisibleCalendarRange();
      scheduleSeriesRefresh();
    });
    sock.on('appointment:updated', () => {
      loadAppointments();
      refreshVisibleCalendarRange();
      scheduleSeriesRefresh();
    });
    // Pause / resume / cancel, a Needs attention item handled, the job flagging a date — or a
    // change of future visits, which re-books the month the Calendar may be showing.
    sock.on('series:updated', () => {
      refreshVisibleCalendarRange();
      scheduleSeriesRefresh();
    });
    sock.on('subscription:updated', (d: any) => {
      setS((p) => ({ ...p, plan: d.plan }));
      loadCustomers();
    });
    sock.on('notification:new', (d: any) => showToast(d?.body ?? t.toast.newNotification, 'info'));
  }, [loadAppointments, loadDashboard, loadQueue, loadCustomers, refreshVisibleCalendarRange, scheduleSeriesRefresh]);

  const teardown = useCallback(() => {
    const sock = socketRef.current;
    socketRef.current = null;
    sock?.close();
    if (redialTimer.current) clearTimeout(redialTimer.current);
    redialTimer.current = null;
    if (seriesTimer.current) clearTimeout(seriesTimer.current);
    seriesTimer.current = null;
  }, []);

  // Back in the foreground: iOS and Android suspend a backgrounded app's socket, so re-dial now
  // rather than waiting out a backoff, and re-read the queue the owner is about to look at.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const sock = socketRef.current;
      if (!sock) return;
      if (!sock.connected && !sock.active) {
        if (redialTimer.current) clearTimeout(redialTimer.current);
        redialTimer.current = null;
        refreshSession().then((ok) => {
          if (ok && socketRef.current === sock) sock.connect();
        });
      }
      loadQueue();
    });
    return () => sub.remove();
  }, [loadQueue]);

  // ---------- session restore on mount ----------
  useEffect(() => {
    let alive = true;
    setOnAuthFail(() => {
      teardown();
      accessRef.current = null;
      roleRef.current = null;
      reportQueryRef.current = { range: 'today' };
      setThemeConfig(null);
      setStoreTimeZone(null);
      // Earnings are one person's pay: never leave them on screen for whoever signs in next.
      setS((p) => ({
        ...p,
        authed: false,
        authLoading: false,
        session: null,
        commission: null,
        commissionVisitsFor: null,
        ...SIGNED_OUT_SERIES,
      }));
      showToast(t.toast.sessionExpired, 'error');
    });
    (async () => {
      // Read together: the first screen (onboarding, login or dashboard) depends on both, and
      // `authLoading` is what holds the splash until it is known.
      const [has, onboarded] = await Promise.all([initSession(), getOnboarded()]);
      if (has) {
        try {
          const me: any = await api.me();
          if (!alive) return;
          const session = toSessionUser(me.user);
          setS((p) => ({
            ...p,
            authed: true,
            authLoading: false,
            onboarded,
            business: me.business
              ? {
                  id: me.business.id,
                  name: me.business.name,
                  slug: me.business.slug,
                  category: me.business.category ?? '',
                  currency: me.business.currency ?? undefined,
                  timezone: me.business.timezone ?? undefined,
                }
              : null,
            plan: me.business?.plan ?? 'free',
            session,
            // Staff start on their chair — never on the "All" filter.
            queueStaff: session?.role === 'staff' && session.staffId ? session.staffId : p.queueStaff,
          }));
          accessRef.current = session?.permissions ?? null;
          roleRef.current = session?.role ?? null;
          // Before bootstrap: every booking it maps is printed on the store's clock.
          setStoreTimeZone(me.business?.timezone);
          // Every role gets chrome theme from /auth/me — staff often cannot call GET /business.
          setThemeConfig(themeConfigFromBusiness(me.business));
          connectSocket();
          bootstrap();
          return;
        } catch {
          /* fall through to logged-out */
        }
      }
      if (alive) setS((p) => ({ ...p, authLoading: false, onboarded }));
    })();
    return () => {
      alive = false;
      teardown();
      setOnAuthFail(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const store = useMemo<Store>(() => {
    /**
     * Skip / Cancel / No-show on one booking. Owner-side changes text nobody (the client's SMS
     * rule): the screens offer a Call button instead. The row is updated from the API's answer at
     * once, then the lists are re-read — the Today list only keeps bookings still to arrive.
     */
    const runApptAction = async (
      a: Pick<AppointmentEntry, 'id' | 'seriesId'>,
      kind: ApptAction,
      call: () => Promise<unknown>,
      success: string,
    ): Promise<boolean> => {
      patch(() => ({ apptAction: { id: a.id, kind } }));
      try {
        const res = await call();
        const row = res && typeof res === 'object' && 'id' in res ? mapCalendarAppointment(res) : null;
        setS((p) => ({
          ...p,
          apptAction: null,
          // A moved booking is still to arrive — it may have moved off today, which the re-read
          // below decides. Skip, cancel and no-show all leave the Today list at once.
          appts: kind === 'reschedule' ? p.appts : p.appts.filter((x) => x.id !== a.id),
          calendarAppts: row
            ? p.calendarAppts.map((x) => (x.id === a.id ? { ...x, ...row } : x))
            : p.calendarAppts,
        }));
        showToast(success, 'success');
        loadAppointments();
        refreshVisibleCalendarRange();
        if (kind !== 'skip' && kind !== 'reschedule') loadDashboard();
        // A skip, move or no-show changes the series too: its next visit, "Moved", or a pause.
        if (a.seriesId) scheduleSeriesRefresh();
        return true;
      } catch (e) {
        patch(() => ({ apptAction: null }));
        showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        return false;
      }
    };

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
                  currency: res.business.currency ?? undefined,
                  timezone: res.business.timezone ?? undefined,
                }
              : null,
            plan: res.business?.plan ?? 'free',
            session,
            queueStaff: session?.role === 'staff' && session.staffId ? session.staffId : 'all',
          }));
          accessRef.current = session?.permissions ?? null;
          roleRef.current = session?.role ?? null;
          setStoreTimeZone(res.business?.timezone);
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
        reportQueryRef.current = { range: 'today' };
        setThemeConfig(null);
        setStoreTimeZone(null);
        // Earnings are one person's pay: never leave them on screen for whoever signs in next.
        setS((p) => ({
          ...p,
          authed: false,
          signOutLoading: false,
          session: null,
          commission: null,
          commissionVisitsFor: null,
          ...SIGNED_OUT_SERIES,
        }));
        showToast(message, type);
      },
      refresh,
      setReportQuery,
      openCommissionVisits: (staffId, name) => patch(() => ({ commissionVisitsFor: { staffId, name } })),
      closeCommissionVisits: () => patch(() => ({ commissionVisitsFor: null })),
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
          walkin: { ...emptyWalkin, services: firstService ? [firstService] : [] },
        }));
      },
      closeWalkin: () => patch(() => ({ sheet: null })),
      openQr: () => patch(() => ({ qr: true })),
      completeOnboarding: () => {
        patch(() => ({ onboarded: true }));
        // Fire-and-forget: a failed write only means the tour shows once more next launch.
        void setOnboarded().catch(() => {});
      },
      closeQr: () => patch(() => ({ qr: false })),
      setWalkinPosition: (position) => patch((p) => ({ walkin: { ...p.walkin, position } })),
      setWalkinStaff: (staffId) => patch((p) => ({ walkin: { ...p.walkin, staffId } })),
      setWalkinVisitorType: (visitorType) => patch((p) => ({ walkin: { ...p.walkin, visitorType, error: '' } })),
      // Toggle, not set: the sheet is a checklist now. Order is kept because the first pick
      // becomes the entry's primary service on the API side.
      pickService: (name) =>
        patch((p) => ({
          walkin: {
            ...p.walkin,
            services: p.walkin.services.includes(name)
              ? p.walkin.services.filter((x) => x !== name)
              : [...p.walkin.services, name],
            error: '',
          },
        })),
      addWalkin: async ({ name, phone }) => {
        const w = s.walkin;
        const category = s.business?.category ?? '';
        const needsVisitorType = VISITOR_TYPE_CATEGORIES.has(category);
        if (!name.trim()) return patch(() => ({ walkin: { ...w, error: t.toast.enterName } }));
        if (needsVisitorType && !w.visitorType) return patch(() => ({ walkin: { ...w, error: t.toast.pickVisitorType } }));
        // Names → ids in pick order; an unknown name is dropped rather than sent as null.
        const serviceIds = w.services
          .map((n) => s.services.find((sv) => sv.name === n)?.id)
          .filter((id): id is string => !!id);
        patch(() => ({ walkinLoading: true }));
        try {
          const res: any = await api.addWalkin({
            name: name.trim(),
            phone: phone.trim() || undefined,
            serviceIds: serviceIds.length ? serviceIds : undefined,
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
      actOnAppt: (a, kind, move) => {
        switch (kind) {
          case 'skip':
            return runApptAction(a, kind, () => api.skipAppointment(a.id), t.appointments.visitSkipped);
          case 'cancel':
            return runApptAction(a, kind, () => api.cancelAppointment(a.id), t.appointments.bookingCancelled);
          case 'reschedule':
            if (!move) return Promise.resolve(false);
            return runApptAction(
              a,
              kind,
              () => api.rescheduleAppointment(a.id, move.slotStart, move.staffId),
              t.appointments.visitMoved,
            );
          default:
            return runApptAction(a, kind, () => api.noShowAppointment(a.id), t.toast.markedNoShow);
        }
      },
      bookSeriesIssue: async (issueId, move) => {
        try {
          await api.bookSeriesIssue(issueId, move.slotStart, move.staffId);
          setS((p) => ({ ...p, seriesIssues: p.seriesIssues.filter((i) => i.id !== issueId) }));
          showToast(t.series.visitBooked, 'success');
          loadAppointments();
          refreshVisibleCalendarRange();
          scheduleSeriesRefresh();
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
          return false;
        }
      },
      openSeries: (id) => patch(() => ({ seriesSheetId: id })),
      closeSeries: () => patch(() => ({ seriesSheetId: null })),
      refreshSeriesViews: () => {
        loadAppointments();
        refreshVisibleCalendarRange();
        scheduleSeriesRefresh();
      },
      resolveSeriesIssue: async (issueId) => {
        try {
          await api.resolveSeriesIssue(issueId);
          // Gone at once: the debounced re-read below confirms it and fixes Regulars' count.
          setS((p) => ({ ...p, seriesIssues: p.seriesIssues.filter((i) => i.id !== issueId) }));
          showToast(t.series.markedHandled, 'success');
          scheduleSeriesRefresh();
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      setRecurringEnabled: async (next) => {
        const before = s.business?.recurringEnabled;
        // Optimistic, like the other switches: the request is a single boolean.
        setS((p) => ({ ...p, business: p.business ? { ...p.business, recurringEnabled: next } : p.business }));
        try {
          await api.setRecurringEnabled(next);
        } catch (e) {
          setS((p) => ({ ...p, business: p.business ? { ...p.business, recurringEnabled: before } : p.business }));
          showToast((e as ApiError)?.message ?? t.toast.couldNotSaveSetting, 'error');
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
      createService: async ({ name, durationMinutes, priceType, priceRupees, priceMaxRupees }) => {
        try {
          await api.createService({
            name,
            durationMinutes,
            priceType,
            // An unpriced service carries no amount — the API stores it as 0 itself.
            ...(priceType === 'unset' ? {} : { priceAmount: Math.round(priceRupees * 100) }),
            // Only a range carries a ceiling — the API rejects one on a fixed price by design,
            // so that a service switched back from range cannot keep a stale band.
            ...(priceType === 'range' && priceMaxRupees != null
              ? { priceMaxAmount: Math.round(priceMaxRupees * 100) }
              : {}),
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
      updateService: async (id, { name, durationMinutes, priceType, priceRupees, priceMaxRupees }) => {
        try {
          await api.updateService(id, {
            name,
            durationMinutes,
            // Mode and amount always travel together — the API refuses a half-changed price.
            priceType,
            ...(priceType === 'unset' ? {} : { priceAmount: Math.round(priceRupees * 100) }),
            ...(priceType === 'range' && priceMaxRupees != null
              ? { priceMaxAmount: Math.round(priceMaxRupees * 100) }
              : {}),
          });
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
      removeStaffMember: async (id) => {
        try {
          await api.deleteStaff(id);
          // The queue board is keyed on seats, and a removed chair's still-active tickets fall back
          // to an "Any" group, so refresh it alongside the staff list rather than leaving the board
          // showing a chair that no longer exists.
          await Promise.all([loadStaff(), loadQueue()]);
          showToast(t.toast.staffRemoved, 'success');
          return true;
        } catch (e) {
          const err = e as ApiError;
          // The backend refuses while the seat still holds a waiting/in-service entry. Its raw
          // message names the constraint, not the fix, so say what the owner has to do instead.
          const message =
            err?.code === 'SEAT_HAS_ACTIVE_ENTRIES'
              ? t.toast.staffHasActiveEntries
              : (err?.message ?? t.toast.couldNotRemoveStaff);
          showToast(message, 'error');
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
    loadAppointments,
    loadCalendarAppointments,
    refreshVisibleCalendarRange,
    scheduleSeriesRefresh,
    setReportQuery,
    setThemeConfig,
  ]);

  return <AppStateContext.Provider value={store}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Store {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
