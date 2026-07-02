import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import {
  AppointmentEntry,
  appointments as seedAppts,
  customers as seedCustomers,
  QueueEntry,
  queue as seedQueue,
  services as seedServices,
  Service,
  Staff,
  staff as seedStaff,
} from '@/data/sample';
import { estMins, soonestSeat } from '@/lib/queue';

export type TabId = 'dashboard' | 'queue' | 'appointments' | 'customers' | 'settings';
export type Plan = 'free' | 'premium';
type Sheet = 'walkin' | null;
export type WalkInPosition = 'end' | 'next';
type WalkIn = {
  name: string;
  phone: string;
  service: string | null;
  position: WalkInPosition;
  staffId: string; // 'auto' | staff id
  error: string;
};

type State = {
  authed: boolean;
  userId: string;
  password: string;
  loginError: string;
  tab: TabId;
  queueStaff: string; // 'all' | staff id
  plan: Plan;
  sheet: Sheet;
  qr: boolean;
  detail: QueueEntry | null;
  dragId: number | null;
  toast: string;
  completed: number;
  walkin: WalkIn;
  search: string;
  staff: Staff[];
  queue: QueueEntry[];
  appts: AppointmentEntry[];
  customers: typeof seedCustomers;
  services: Service[];
};

type Store = State & {
  setUserId: (v: string) => void;
  setPassword: (v: string) => void;
  signIn: () => void;
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
  openDetail: (item: QueueEntry) => void;
  closeDetail: () => void;
  startService: (id: number) => void;
  checkout: (id: number) => void;
  noShow: (id: number) => void;
  reassign: (id: number, staffId: string) => void;
  extendService: (id: number, label: string, mins: number) => void;
  setDragId: (id: number | null) => void;
  moveWithinSeat: (staffId: string, id: number, toIndex: number) => void;
  checkInAppt: (a: AppointmentEntry) => void;
  upgrade: () => void;
};

const AppStateContext = createContext<Store | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>({
    authed: false,
    userId: '',
    password: '',
    loginError: '',
    tab: 'dashboard',
    queueStaff: 'all',
    plan: 'free',
    sheet: null,
    qr: false,
    detail: null,
    dragId: null,
    toast: '',
    completed: 11,
    walkin: { name: '', phone: '', service: null, position: 'end', staffId: 'auto', error: '' },
    search: '',
    staff: seedStaff.map((st) => ({ ...st })),
    queue: seedQueue.map((q) => ({ ...q })),
    appts: seedAppts.map((a) => ({ ...a })),
    customers: seedCustomers.map((c) => ({ ...c })),
    services: seedServices.map((sv) => ({ ...sv })),
  });

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setS((p) => ({ ...p, toast: msg }));
    toastTimer.current = setTimeout(() => setS((p) => ({ ...p, toast: '' })), 2200);
  }, []);

  const seatName = useCallback(
    (list: Staff[], staffId: string) => list.find((st) => st.id === staffId)?.name ?? '',
    [],
  );

  const store = useMemo<Store>(() => {
    const patch = (fn: (p: State) => Partial<State>) => setS((p) => ({ ...p, ...fn(p) }));
    return {
      ...s,
      setUserId: (v) => patch(() => ({ userId: v, loginError: '' })),
      setPassword: (v) => patch(() => ({ password: v, loginError: '' })),
      signIn: () =>
        setS((p) =>
          !p.userId.trim() || !p.password.trim()
            ? { ...p, loginError: 'Enter your user ID and password' }
            : { ...p, authed: true, loginError: '' },
        ),
      setTab: (id) => patch(() => ({ tab: id, detail: null })),
      setQueueStaff: (id) => patch(() => ({ queueStaff: id })),
      setSearch: (v) => patch(() => ({ search: v })),
      openAlerts: () => showToast('No new notifications'),
      openWalkin: () =>
        patch(() => ({
          sheet: 'walkin',
          walkin: { name: '', phone: '', service: null, position: 'end', staffId: 'auto', error: '' },
        })),
      closeWalkin: () => patch(() => ({ sheet: null })),
      openQr: () => patch(() => ({ qr: true })),
      closeQr: () => patch(() => ({ qr: false })),
      setWalkinField: (k) => (v) => patch((p) => ({ walkin: { ...p.walkin, [k]: v, error: '' } })),
      setWalkinPosition: (position) => patch((p) => ({ walkin: { ...p.walkin, position } })),
      setWalkinStaff: (staffId) => patch((p) => ({ walkin: { ...p.walkin, staffId } })),
      pickService: (name) => patch((p) => ({ walkin: { ...p.walkin, service: name, error: '' } })),
      addWalkin: () =>
        setS((p) => {
          const w = p.walkin;
          if (!w.name.trim()) return { ...p, walkin: { ...w, error: 'Enter a customer name' } };
          if (!w.service) return { ...p, walkin: { ...w, error: 'Pick a service' } };
          const staffId = w.staffId === 'auto' ? soonestSeat(p.queue, p.staff, p.services) : w.staffId;
          const item: QueueEntry = {
            id: Date.now(),
            name: w.name.trim(),
            service: w.service,
            time: 'Just now',
            status: 'waiting',
            wait: 0,
            staffId,
            src: 'walk-in',
          };
          const queue = [...p.queue];
          if (w.position === 'next') {
            let idx = queue.findIndex((q) => q.staffId === staffId && q.status === 'waiting');
            if (idx < 0) idx = queue.length;
            queue.splice(idx, 0, item);
          } else {
            let last = -1;
            queue.forEach((q, i) => {
              if (q.staffId === staffId && (q.status === 'waiting' || q.status === 'in-service')) last = i;
            });
            queue.splice(last + 1, 0, item);
          }
          const nm = seatName(p.staff, staffId);
          showToast((w.position === 'next' ? 'Added as next' : 'Added to queue') + (nm ? ` · ${nm}` : ''));
          return { ...p, queue, sheet: null };
        }),
      openDetail: (item) => patch(() => ({ detail: item })),
      closeDetail: () => patch(() => ({ detail: null })),
      startService: (id) => {
        patch((p) => ({
          queue: p.queue.map((q) => (q.id === id ? { ...q, status: 'in-service', wait: 0 } : q)),
          detail: null,
        }));
        showToast('Service started');
      },
      checkout: (id) =>
        setS((p) => {
          const done = p.queue.find((q) => q.id === id);
          const seat = done?.staffId;
          const queue = p.queue.map((q) => (q.id === id ? { ...q, status: 'completed' as const } : q));
          let promotedName: string | null = null;
          if (seat && !queue.some((q) => q.staffId === seat && q.status === 'in-service')) {
            const nextIdx = queue.findIndex((q) => q.staffId === seat && q.status === 'waiting');
            if (nextIdx >= 0) {
              queue[nextIdx] = { ...queue[nextIdx], status: 'in-service', wait: 0 };
              promotedName = queue[nextIdx].name.split(' ')[0];
            }
          }
          const nm = seat ? seatName(p.staff, seat) : '';
          setTimeout(
            () => showToast(promotedName ? `${promotedName} now in service · ${nm}` : 'Checked out'),
            0,
          );
          return { ...p, queue, completed: p.completed + 1, detail: null };
        }),
      noShow: (id) => {
        patch((p) => ({
          queue: p.queue.map((q) => (q.id === id ? { ...q, status: 'no-show' } : q)),
          detail: null,
        }));
        showToast('Marked no-show');
      },
      reassign: (id, staffId) =>
        setS((p) => {
          const item = p.queue.find((q) => q.id === id);
          if (!item) return p;
          const rest = p.queue.filter((q) => q.id !== id);
          let last = -1;
          rest.forEach((q, i) => {
            if (q.staffId === staffId && (q.status === 'waiting' || q.status === 'in-service')) last = i;
          });
          const moved: QueueEntry = { ...item, staffId, status: 'waiting' };
          rest.splice(last + 1, 0, moved);
          showToast(`Moved to ${seatName(p.staff, staffId)}`);
          return { ...p, queue: rest, detail: { ...moved } };
        }),
      extendService: (id, label, mins) => {
        patch((p) => ({
          queue: p.queue.map((q) => {
            if (q.id !== id) return q.status === 'waiting' ? { ...q, wait: q.wait + mins } : q;
            const has = q.service.toLowerCase().includes(label.toLowerCase());
            return { ...q, service: has ? q.service : `${q.service} + ${label}`, extra: (q.extra || 0) + mins };
          }),
        }));
        showToast(`+${mins} min · ${label} added`);
      },
      setDragId: (id) => patch(() => ({ dragId: id })),
      moveWithinSeat: (staffId, id, toIndex) =>
        setS((p) => {
          const slots: number[] = [];
          p.queue.forEach((x, i) => {
            if (x.staffId === staffId && x.status === 'waiting') slots.push(i);
          });
          const ids = slots.map((i) => p.queue[i].id);
          const order = ids.filter((x) => x !== id);
          const clamped = Math.max(0, Math.min(order.length, toIndex));
          order.splice(clamped, 0, id);
          const byId: Record<number, QueueEntry> = {};
          p.queue.forEach((x) => (byId[x.id] = x));
          const out = [...p.queue];
          slots.forEach((pos, k) => (out[pos] = byId[order[k]]));
          return { ...p, queue: out };
        }),
      checkInAppt: (a) => {
        patch((p) => {
          const staffId = soonestSeat(p.queue, p.staff, p.services);
          const item: QueueEntry = {
            id: a.id,
            name: a.name,
            service: a.service,
            time: 'Just arrived',
            status: 'waiting',
            wait: 0,
            staffId,
            src: 'online',
          };
          return { queue: [...p.queue, item], appts: p.appts.filter((x) => x.id !== a.id), tab: 'queue' };
        });
        showToast(`${a.name} added to queue`);
      },
      upgrade: () => {
        patch(() => ({ plan: 'premium' }));
        showToast('Welcome to Premium');
      },
    };
  }, [s, showToast, seatName]);

  return <AppStateContext.Provider value={store}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Store {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

/** Estimated minutes helper bound to the current service list. */
export function useEstMins() {
  const { services } = useAppState();
  return (item: QueueEntry) => estMins(item, services);
}
