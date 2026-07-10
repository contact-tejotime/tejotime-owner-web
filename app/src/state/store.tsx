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

export type Plan = 'free' | 'premium';
type Sheet = 'walkin' | null;
export type WalkInPosition = 'end' | 'next';

type WalkIn = {
  name: string;
  phone: string;
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
  phone: string;
  password: string;
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
  setPhone: (v: string) => void;
  setPassword: (v: string) => void;
  signIn: () => void;
  signOut: () => void;
  setQueueStaff: (id: string) => void;
  setSearch: (v: string) => void;
  openAlerts: () => void;
  openWalkin: () => void;
  closeWalkin: () => void;
  openQr: () => void;
  closeQr: () => void;
  setWalkinField: (k: 'name' | 'phone') => (v: string) => void;
  setWalkinPosition: (p: WalkInPosition) => void;
  setWalkinStaff: (id: string) => void;
  pickService: (name: string) => void;
  addWalkin: () => void;
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

const emptyWalkin: WalkIn = { name: '', phone: '', service: null, position: 'end', staffId: 'auto', error: '' };

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
    phone: '',
    password: '',
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

  const bootstrap = useCallback(async () => {
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
    sock.on('notification:new', (d: any) => showToast(d?.body ?? 'New notification', 'info'));
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
      showToast('Session expired', 'error');
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
      setPhone: (v) => patch(() => ({ phone: v })),
      setPassword: (v) => patch(() => ({ password: v })),
      signIn: async () => {
        if (!s.phone.trim() || !s.password.trim()) {
          showToast('Enter your phone number and password', 'error');
          return;
        }
        patch(() => ({ signInLoading: true }));
        try {
          const res: any = await api.login(s.phone.trim(), s.password);
          const message =
            res?.message ?? (res?.user?.name ? `Welcome back, ${res.user.name}` : 'Signed in successfully');
          setS((p) => ({
            ...p,
            authed: true,
            signInLoading: false,
            password: '',
            business: res.business ? { id: res.business.id, name: res.business.name, slug: res.business.slug } : null,
            plan: res.business?.plan ?? 'free',
          }));
          showToast(message, 'success');
          connectSocket();
          bootstrap();
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Sign in failed', 'error');
          patch(() => ({ signInLoading: false }));
        }
      },
      signOut: async () => {
        let message = 'Signed out successfully';
        let type: 'success' | 'error' | 'info' = 'success';
        try {
          const res: any = await api.logout();
          if (res?.message) message = res.message;
        } catch (e) {
          message = (e as ApiError)?.message ?? 'Signed out locally';
          type = 'info';
        }
        teardown();
        setS((p) => ({ ...p, authed: false, phone: '', password: '' }));
        showToast(message, type);
      },
      setQueueStaff: (id) => patch(() => ({ queueStaff: id })),
      setSearch: (v) => {
        patch(() => ({ search: v }));
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => loadCustomers(v || undefined), 300);
      },
      openAlerts: () => showToast('No new notifications', 'info'),
      openWalkin: () => patch(() => ({ sheet: 'walkin', walkin: { ...emptyWalkin } })),
      closeWalkin: () => patch(() => ({ sheet: null })),
      openQr: () => patch(() => ({ qr: true })),
      closeQr: () => patch(() => ({ qr: false })),
      setWalkinField: (k) => (v) => patch((p) => ({ walkin: { ...p.walkin, [k]: v, error: '' } })),
      setWalkinPosition: (position) => patch((p) => ({ walkin: { ...p.walkin, position } })),
      setWalkinStaff: (staffId) => patch((p) => ({ walkin: { ...p.walkin, staffId } })),
      pickService: (name) => patch((p) => ({ walkin: { ...p.walkin, service: name, error: '' } })),
      addWalkin: async () => {
        const w = s.walkin;
        if (!w.name.trim()) return patch(() => ({ walkin: { ...w, error: 'Enter a customer name' } }));
        if (!w.service) return patch(() => ({ walkin: { ...w, error: 'Pick a service' } }));
        const serviceId = s.services.find((sv) => sv.name === w.service)?.id ?? null;
        try {
          const res: any = await api.addWalkin({
            name: w.name.trim(),
            phone: w.phone.trim() || undefined,
            serviceId,
            staffId: w.staffId,
            position: w.position,
          });
          setS((p) => ({ ...p, seats: mapSeats(res.seats), sheet: null }));
          showToast(w.position === 'next' ? 'Added as next' : 'Added to queue', 'success');
          loadDashboard();
        } catch (e) {
          patch(() => ({ walkin: { ...s.walkin, error: (e as ApiError)?.message ?? 'Could not add' } }));
        }
      },
      openDetail: (id) => patch(() => ({ detailId: id })),
      closeDetail: () => patch(() => ({ detailId: null })),
      startService: async (id) => {
        try {
          const res: any = await api.startService(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null }));
          showToast('Service started', 'success');
        } catch (e) {
          const err = e as ApiError;
          if (err.code === 'SEAT_BUSY') {
            const card = flatCards(s.seats).find((c) => c.id === id);
            const seat = s.staff.find((st) => st.id === card?.staffId);
            const seatGroup = s.seats.find((g) => g.id === card?.staffId);
            showToast(
              `${seat?.name ?? 'This seat'} is already serving ${seatGroup?.servingName?.split(' ')[0] ?? 'someone'}. Finish that first.`,
              'error',
            );
          } else {
            showToast(err.message ?? 'Could not start', 'error');
          }
        }
      },
      checkout: async (id) => {
        try {
          const res: any = await api.checkout(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null }));
          showToast(res.promoted ? `${String(res.promoted.name).split(' ')[0]} now in service` : 'Checked out', 'success');
          loadDashboard();
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not check out', 'error');
        }
      },
      noShow: async (id) => {
        try {
          const res: any = await api.noShow(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null }));
          showToast('Marked no-show', 'success');
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Error', 'error');
        }
      },
      reassign: async (id, staffId) => {
        try {
          const res: any = await api.reassign(id, staffId);
          setS((p) => ({ ...p, seats: mapSeats(res.seats) }));
          const nm = s.staff.find((st) => st.id === staffId)?.name ?? '';
          showToast(`Moved${nm ? ` to ${nm}` : ''}`, 'success');
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Error', 'error');
        }
      },
      extendService: async (id, label, mins) => {
        try {
          const res: any = await api.extend(id, label, mins);
          setS((p) => ({ ...p, seats: mapSeats(res.seats) }));
          showToast(`+${mins} min · ${label} added`, 'success');
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Error', 'error');
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
        try {
          await api.checkIn(a.id);
          setS((p) => ({ ...p, appts: p.appts.filter((x) => x.id !== a.id) }));
          router.push(TAB_ROUTES.queue as any);
          showToast(`${a.name} added to queue`, 'success');
          loadQueue();
          loadDashboard();
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not check in', 'error');
        }
      },
      upgrade: async () => {
        try {
          await api.upgrade();
          setS((p) => ({ ...p, plan: 'premium' }));
          showToast('Welcome to Premium', 'success');
          loadCustomers(s.search || undefined);
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Upgrade failed', 'error');
        }
      },
      saveProfile: async ({ name, address }) => {
        try {
          const res: any = await api.updateBusiness({ name, address });
          setS((p) => ({ ...p, business: mapBusinessDetail(res) }));
          showToast('Profile saved', 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not save profile', 'error');
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
          showToast((e as ApiError)?.message ?? 'Could not save hours', 'error');
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
          showToast('Service added', 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not add service', 'error');
          return false;
        }
      },
      updateService: async (id, { name, durationMinutes, priceRupees }) => {
        try {
          await api.updateService(id, { name, durationMinutes, priceAmount: Math.round(priceRupees * 100) });
          await loadServices();
          showToast('Service updated', 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not update service', 'error');
          return false;
        }
      },
      removeService: async (id) => {
        try {
          await api.deleteService(id);
          await loadServices();
          showToast('Service removed', 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not remove service', 'error');
          return false;
        }
      },
      createStaffMember: async ({ name, roleLabel }) => {
        try {
          await api.createStaff({
            name,
            roleLabel: roleLabel || 'Stylist',
            colorToken: COLOR_PALETTE[s.staff.length % COLOR_PALETTE.length],
            position: s.staff.length,
          });
          await loadStaff();
          showToast('Staff member added', 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not add staff', 'error');
          return false;
        }
      },
      updateStaffMember: async (id, { name, roleLabel }) => {
        try {
          await api.updateStaff(id, { name, roleLabel: roleLabel || 'Stylist' });
          await loadStaff();
          showToast('Staff updated', 'success');
          return true;
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not update staff', 'error');
          return false;
        }
      },
    };
  }, [s, patch, connectSocket, bootstrap, teardown, loadCustomers, loadDashboard, loadQueue, loadServices, loadStaff, loadBusiness]);

  return <AppStateContext.Provider value={store}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Store {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
