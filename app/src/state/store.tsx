import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import type { Socket } from 'socket.io-client';

import { AppointmentEntry, Customer, ServiceVM, Staff } from '@/data/sample';
import { SeatGroupVM, CardVM, flatCards } from '@/lib/queue';
import { api, ApiError, getAccessToken, initSession, setOnAuthFail } from '@/lib/api';
import { connectOwner } from '@/lib/socket';
import {
  COLOR_PALETTE,
  mapAppointment,
  mapBusinessDetail,
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

export type Plan = 'free' | 'premium';
type Sheet = 'walkin' | null;
export type WalkInPosition = 'end' | 'next';

type WalkIn = {
  service: string | null; // service name
  position: WalkInPosition;
  staffId: string; // 'auto' | staff id
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

interface BusinessInfo {
  id?: string;
  name: string;
  area?: string;
  slug?: string;
  address?: string;
  countryCode?: string | null;
  phoneNumber?: string | null;
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
  checkInId: string | null; // appointment id currently being checked in
  queueStaff: string; // 'all' | staff id
  plan: Plan;
  sheet: Sheet;
  qr: boolean;
  detailId: string | null;
  dragId: string | null;
  walkin: WalkIn;
  search: string;
  business: BusinessInfo | null;
  seats: SeatGroupVM[];
  services: ServiceVM[];
  staff: Staff[];
  appts: AppointmentEntry[];
  customers: Customer[];
  customerMeta: { shown: number; total: number; lockedCount: number };
  dashboard: DashboardKpis | null;
};

type Store = State & {
  signIn: (phone: string, password: string) => void;
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
  pickService: (name: string) => void;
  addWalkin: (fields: { name: string; phone: string }) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  startService: (id: string) => void;
  checkout: (id: string) => void;
  noShow: (id: string) => void;
  reassign: (id: string, staffId: string) => void;
  extendService: (id: string, label: string, mins: number) => void;
  setDragId: (id: string | null) => void;
  moveWithinSeat: (staffId: string, id: string, toIndex: number) => void;
  commitMove: (staffId: string, id: string) => void;
  checkInAppt: (a: AppointmentEntry) => void;
  upgrade: () => void;
  saveProfile: (f: { name: string; address: string }) => Promise<boolean>;
  saveHours: (next: DayHoursVM[]) => void;
  createService: (f: { name: string; durationMinutes: number; priceRupees: number }) => Promise<boolean>;
  updateService: (id: string, f: { name: string; durationMinutes: number; priceRupees: number }) => Promise<boolean>;
  removeService: (id: string) => Promise<boolean>;
  createStaffMember: (f: { name: string; roleLabel: string }) => Promise<boolean>;
  updateStaffMember: (id: string, f: { name: string; roleLabel: string }) => Promise<boolean>;
};

const emptyWalkin: WalkIn = { service: null, position: 'end', staffId: 'auto', error: '' };

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
  return { ...seat, cards: [...newServing, ...newWaiting] };
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
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
    checkInId: null,
    queueStaff: 'all',
    plan: 'free',
    sheet: null,
    qr: false,
    detailId: null,
    dragId: null,
    walkin: { ...emptyWalkin },
    search: '',
    business: null,
    seats: [],
    services: [],
    staff: [],
    appts: [],
    customers: [],
    customerMeta: { shown: 0, total: 0, lockedCount: 0 },
    dashboard: null,
  });

  const socketRef = useRef<Socket | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoursSeq = useRef(0);

  const patch = useCallback((fn: (p: State) => Partial<State>) => setS((p) => ({ ...p, ...fn(p) })), []);

  // ---------- loaders ----------
  const loadQueue = useCallback(async () => {
    try {
      const r = await api.getQueue();
      setS((p) => ({ ...p, seats: mapSeats(r.seats) }));
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
  const loadDashboard = useCallback(async () => {
    try {
      const r = await api.getDashboard();
      setS((p) => ({ ...p, dashboard: r.kpis }));
    } catch {
      /* ignore */
    }
  }, []);
  const loadBusiness = useCallback(async () => {
    try {
      const r = await api.getBusiness();
      setS((p) => ({ ...p, business: mapBusinessDetail(r), plan: r.plan ?? p.plan }));
    } catch {
      /* ignore */
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadQueue(),
      loadServices(),
      loadStaff(),
      loadAppointments(),
      loadCustomers(),
      loadDashboard(),
      loadBusiness(),
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
    sock.on('queue:snapshot', (d: any) => setS((p) => ({ ...p, seats: mapSeats(d.seats) })));
    sock.on('appointment:created', () => {
      loadAppointments();
      loadDashboard();
    });
    sock.on('appointment:checked_in', () => {
      loadAppointments();
      loadDashboard();
      loadQueue();
    });
    sock.on('appointment:updated', () => loadAppointments());
    sock.on('subscription:updated', (d: any) => {
      setS((p) => ({ ...p, plan: d.plan }));
      loadCustomers();
    });
    sock.on('notification:new', (d: any) => showToast(d?.body ?? t.toast.newNotification, 'info'));
  }, [loadAppointments, loadDashboard, loadQueue, loadCustomers]);

  const teardown = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  // ---------- session restore on mount ----------
  useEffect(() => {
    let alive = true;
    setOnAuthFail(() => {
      teardown();
      setS((p) => ({ ...p, authed: false, authLoading: false }));
      showToast(t.toast.sessionExpired, 'error');
    });
    (async () => {
      const has = await initSession();
      if (has) {
        try {
          const me: any = await api.me();
          if (!alive) return;
          setS((p) => ({
            ...p,
            authed: true,
            authLoading: false,
            business: me.business ? { id: me.business.id, name: me.business.name, slug: me.business.slug } : null,
            plan: me.business?.plan ?? 'free',
          }));
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
      signIn: async (phone, password) => {
        if (!phone.trim() || !password.trim()) {
          showToast(t.toast.enterPhonePassword, 'error');
          return;
        }
        patch(() => ({ signInLoading: true }));
        try {
          const res: any = await api.login(phone.trim(), password);
          const message =
            res?.message ??
            (res?.user?.name ? format(t.toast.welcomeBackName, { name: res.user.name }) : t.toast.signedIn);
          setS((p) => ({
            ...p,
            authed: true,
            signInLoading: false,
            business: res.business ? { id: res.business.id, name: res.business.name, slug: res.business.slug } : null,
            plan: res.business?.plan ?? 'free',
          }));
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
        setS((p) => ({ ...p, authed: false, signOutLoading: false }));
        showToast(message, type);
      },
      refresh,
      setQueueStaff: (id) => patch(() => ({ queueStaff: id })),
      setSearch: (v) => {
        patch(() => ({ search: v }));
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => loadCustomers(v || undefined), 300);
      },
      openAlerts: () => showToast(t.toast.noNewNotifications, 'info'),
      openWalkin: () => patch(() => ({ sheet: 'walkin', walkin: { ...emptyWalkin } })),
      closeWalkin: () => patch(() => ({ sheet: null })),
      openQr: () => patch(() => ({ qr: true })),
      closeQr: () => patch(() => ({ qr: false })),
      setWalkinPosition: (position) => patch((p) => ({ walkin: { ...p.walkin, position } })),
      setWalkinStaff: (staffId) => patch((p) => ({ walkin: { ...p.walkin, staffId } })),
      pickService: (name) => patch((p) => ({ walkin: { ...p.walkin, service: name, error: '' } })),
      addWalkin: async ({ name, phone }) => {
        const w = s.walkin;
        if (!name.trim()) return patch(() => ({ walkin: { ...w, error: t.toast.enterName } }));
        if (!w.service) return patch(() => ({ walkin: { ...w, error: t.toast.pickService } }));
        const serviceId = s.services.find((sv) => sv.name === w.service)?.id ?? null;
        patch(() => ({ walkinLoading: true }));
        try {
          const res: any = await api.addWalkin({
            name: name.trim(),
            phone: phone.trim() || undefined,
            serviceId,
            staffId: w.staffId,
            position: w.position,
          });
          setS((p) => ({ ...p, seats: mapSeats(res.seats), sheet: null, walkinLoading: false }));
          showToast(w.position === 'next' ? t.toast.addedAsNext : t.toast.addedToQueue, 'success');
          loadDashboard();
        } catch (e) {
          patch(() => ({ walkinLoading: false, walkin: { ...s.walkin, error: (e as ApiError)?.message ?? t.toast.couldNotAdd } }));
        }
      },
      openDetail: (id) => patch(() => ({ detailId: id })),
      closeDetail: () => patch(() => ({ detailId: null })),
      startService: async (id) => {
        patch(() => ({ detailBusy: true }));
        try {
          const res: any = await api.startService(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null, detailBusy: false }));
          showToast(t.toast.serviceStarted, 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false }));
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
      checkout: async (id) => {
        patch(() => ({ detailBusy: true }));
        try {
          const res: any = await api.checkout(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null, detailBusy: false }));
          showToast(
            res.promoted ? format(t.toast.nowInService, { name: String(res.promoted.name).split(' ')[0] }) : t.toast.checkedOut,
            'success',
          );
          loadDashboard();
        } catch (e) {
          patch(() => ({ detailBusy: false }));
          showToast((e as ApiError)?.message ?? t.toast.couldNotCheckOut, 'error');
        }
      },
      noShow: async (id) => {
        patch(() => ({ detailBusy: true }));
        try {
          const res: any = await api.noShow(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null, detailBusy: false }));
          showToast(t.toast.markedNoShow, 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false }));
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      reassign: async (id, staffId) => {
        patch(() => ({ detailBusy: true }));
        try {
          const res: any = await api.reassign(id, staffId);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailBusy: false }));
          const nm = s.staff.find((st) => st.id === staffId)?.name ?? '';
          showToast(nm ? format(t.toast.movedTo, { name: nm }) : t.toast.moved, 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false }));
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      extendService: async (id, label, mins) => {
        patch(() => ({ detailBusy: true }));
        try {
          const res: any = await api.extend(id, label, mins);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailBusy: false }));
          showToast(format(t.toast.extendAdded, { mins, label }), 'success');
        } catch (e) {
          patch(() => ({ detailBusy: false }));
          showToast((e as ApiError)?.message ?? t.toast.error, 'error');
        }
      },
      setDragId: (id) => patch(() => ({ dragId: id })),
      moveWithinSeat: (staffId, id, toIndex) =>
        setS((p) => ({
          ...p,
          seats: p.seats.map((g) => (g.id === staffId ? reorderSeat(g, id, toIndex) : g)),
        })),
      commitMove: async (staffId, id) => {
        const seat = s.seats.find((g) => g.id === staffId);
        const waiting = seat ? seat.cards.filter((c) => c.isWaiting) : [];
        const idx = waiting.findIndex((c) => c.id === id);
        if (idx < 0) return;
        try {
          const res: any = await api.move(id, idx);
          setS((p) => ({ ...p, seats: mapSeats(res.seats) }));
        } catch {
          loadQueue();
        }
      },
      checkInAppt: async (a) => {
        patch(() => ({ checkInId: a.id }));
        try {
          await api.checkIn(a.id);
          setS((p) => ({ ...p, checkInId: null, appts: p.appts.filter((x) => x.id !== a.id) }));
          router.push(TAB_ROUTES.queue as any);
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
      saveProfile: async ({ name, address }) => {
        try {
          const res: any = await api.updateBusiness({ name, address });
          setS((p) => ({ ...p, business: mapBusinessDetail(res) }));
          showToast(t.toast.profileSaved, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotSaveProfile, 'error');
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
      createStaffMember: async ({ name, roleLabel }) => {
        try {
          await api.createStaff({
            name,
            roleLabel: roleLabel || t.common.stylist,
            colorToken: COLOR_PALETTE[s.staff.length % COLOR_PALETTE.length],
            position: s.staff.length,
          });
          await loadStaff();
          showToast(t.toast.staffAdded, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotAddStaff, 'error');
          return false;
        }
      },
      updateStaffMember: async (id, { name, roleLabel }) => {
        try {
          await api.updateStaff(id, { name, roleLabel: roleLabel || t.common.stylist });
          await loadStaff();
          showToast(t.toast.staffUpdated, 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? t.toast.couldNotUpdateStaff, 'error');
          return false;
        }
      },
    };
  }, [s, patch, refresh, connectSocket, bootstrap, teardown, loadCustomers, loadDashboard, loadQueue, loadServices, loadStaff, loadBusiness]);

  return <AppStateContext.Provider value={store}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Store {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
