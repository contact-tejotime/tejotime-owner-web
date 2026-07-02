import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { AppointmentEntry, Customer, ServiceVM, Staff } from '@/data/sample';
import { SeatGroupVM, CardVM } from '@/lib/queue';
import { api, ApiError, getAccessToken, initSession, setOnAuthFail } from '@/lib/api';
import { connectOwner } from '@/lib/socket';
import {
  mapAppointment,
  mapCustomer,
  mapSeats,
  mapService,
  mapStaff,
  Money,
} from '@/lib/mappers';

export type TabId = 'dashboard' | 'queue' | 'appointments' | 'customers' | 'settings';
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
}

type State = {
  authed: boolean;
  authLoading: boolean;
  userId: string;
  password: string;
  loginError: string;
  tab: TabId;
  queueStaff: string; // 'all' | staff id
  plan: Plan;
  sheet: Sheet;
  qr: boolean;
  detailId: string | null;
  dragId: string | null;
  toast: string;
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
  setUserId: (v: string) => void;
  setPassword: (v: string) => void;
  signIn: () => void;
  signOut: () => void;
  setTab: (id: TabId) => void;
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
    userId: '',
    password: '',
    loginError: '',
    tab: 'dashboard',
    queueStaff: 'all',
    plan: 'free',
    sheet: null,
    qr: false,
    detailId: null,
    dragId: null,
    toast: '',
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((fn: (p: State) => Partial<State>) => setS((p) => ({ ...p, ...fn(p) })), []);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setS((p) => ({ ...p, toast: msg }));
    toastTimer.current = setTimeout(() => setS((p) => ({ ...p, toast: '' })), 2200);
  }, []);

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
      setS((p) => ({ ...p, business: { id: r.id, name: r.name, area: r.area, slug: r.slug }, plan: r.plan ?? p.plan }));
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
    sock.on('notification:new', (d: any) => showToast(d?.body ?? 'New notification'));
  }, [loadAppointments, loadDashboard, loadQueue, loadCustomers, showToast]);

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
      setUserId: (v) => patch(() => ({ userId: v, loginError: '' })),
      setPassword: (v) => patch(() => ({ password: v, loginError: '' })),
      signIn: async () => {
        if (!s.userId.trim() || !s.password.trim()) {
          patch(() => ({ loginError: 'Enter your user ID and password' }));
          return;
        }
        patch(() => ({ loginError: '', authLoading: true }));
        try {
          const res: any = await api.login(s.userId.trim(), s.password);
          setS((p) => ({
            ...p,
            authed: true,
            authLoading: false,
            loginError: '',
            password: '',
            business: res.business ? { id: res.business.id, name: res.business.name, slug: res.business.slug } : null,
            plan: res.business?.plan ?? 'free',
          }));
          connectSocket();
          bootstrap();
        } catch (e) {
          patch(() => ({ loginError: (e as ApiError)?.message ?? 'Sign in failed', authLoading: false }));
        }
      },
      signOut: async () => {
        await api.logout().catch(() => {});
        teardown();
        setS((p) => ({ ...p, authed: false, userId: '', password: '' }));
      },
      setTab: (id) => patch(() => ({ tab: id, detailId: null })),
      setQueueStaff: (id) => patch(() => ({ queueStaff: id })),
      setSearch: (v) => {
        patch(() => ({ search: v }));
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => loadCustomers(v || undefined), 300);
      },
      openAlerts: () => showToast('No new notifications'),
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
          showToast(w.position === 'next' ? 'Added as next' : 'Added to queue');
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
          showToast('Service started');
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not start');
        }
      },
      checkout: async (id) => {
        try {
          const res: any = await api.checkout(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null }));
          showToast(res.promoted ? `${String(res.promoted.name).split(' ')[0]} now in service` : 'Checked out');
          loadDashboard();
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not check out');
        }
      },
      noShow: async (id) => {
        try {
          const res: any = await api.noShow(id);
          setS((p) => ({ ...p, seats: mapSeats(res.seats), detailId: null }));
          showToast('Marked no-show');
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Error');
        }
      },
      reassign: async (id, staffId) => {
        try {
          const res: any = await api.reassign(id, staffId);
          setS((p) => ({ ...p, seats: mapSeats(res.seats) }));
          const nm = s.staff.find((st) => st.id === staffId)?.name ?? '';
          showToast(`Moved${nm ? ` to ${nm}` : ''}`);
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Error');
        }
      },
      extendService: async (id, label, mins) => {
        try {
          const res: any = await api.extend(id, label, mins);
          setS((p) => ({ ...p, seats: mapSeats(res.seats) }));
          showToast(`+${mins} min · ${label} added`);
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Error');
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
          setS((p) => ({ ...p, appts: p.appts.filter((x) => x.id !== a.id), tab: 'queue' }));
          showToast(`${a.name} added to queue`);
          loadQueue();
          loadDashboard();
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Could not check in');
        }
      },
      upgrade: async () => {
        try {
          await api.upgrade();
          setS((p) => ({ ...p, plan: 'premium' }));
          showToast('Welcome to Premium');
          loadCustomers(s.search || undefined);
        } catch (e) {
          showToast((e as ApiError)?.message ?? 'Upgrade failed');
        }
      },
    };
  }, [s, patch, showToast, connectSocket, bootstrap, teardown, loadCustomers, loadDashboard, loadQueue]);

  return <AppStateContext.Provider value={store}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Store {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
