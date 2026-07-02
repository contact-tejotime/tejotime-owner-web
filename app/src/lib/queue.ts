/**
 * Multi-seat queue selectors — ported from the TejoTime Owner App design logic.
 * Pure functions: screens resolve seat color tokens against the theme themselves.
 */
import { QueueEntry, Service, ServiceColorToken, Staff } from '@/data/sample';
import { initials } from '@/lib/format';

const isActive = (q: QueueEntry) => q.status === 'waiting' || q.status === 'in-service';

/** Estimated minutes for an item — matches the service (incl. prefix match) plus extras. */
export function estMins(item: QueueEntry, services: Service[]): number {
  const name = item.service || '';
  let svc = services.find((sv) => sv.name === name);
  if (!svc) {
    const pre = services
      .filter((sv) => name.indexOf(sv.name) === 0)
      .sort((a, b) => b.name.length - a.name.length);
    svc = pre[0];
  }
  const base = svc?.duration ? parseInt(svc.duration, 10) : 20;
  return (isNaN(base) ? 20 : base) + (item.extra || 0);
}

/** Total active minutes assigned to a seat. */
export function seatLoad(queue: QueueEntry[], staffId: string, services: Service[]): number {
  return queue
    .filter((q) => q.staffId === staffId && isActive(q))
    .reduce((m, q) => m + estMins(q, services), 0);
}

/** Seat with the lightest load — used for "Any seat" auto-assignment. */
export function soonestSeat(queue: QueueEntry[], staff: Staff[], services: Service[]): string {
  let best = staff[0]?.id ?? '';
  let bestLoad = Infinity;
  staff.forEach((st) => {
    const l = seatLoad(queue, st.id, services);
    if (l < bestLoad) {
      bestLoad = l;
      best = st.id;
    }
  });
  return best;
}

export type CardVM = {
  id: number;
  name: string;
  service: string;
  status: QueueEntry['status'];
  staffId: string;
  pos: number;
  initials: string;
  seatName: string;
  seatColor: ServiceColorToken;
  srcLabel: string;
  online: boolean;
  rightText: string;
  inService: boolean;
  isWaiting: boolean;
};

export type SeatGroupVM = {
  id: string;
  name: string;
  color: ServiceColorToken;
  initials: string;
  serving: boolean;
  servingName: string;
  subLine: string;
  waitBadge: string;
  waitN: number;
  free: boolean;
  empty: boolean;
  cards: CardVM[];
};

function buildCard(
  c: QueueEntry,
  pos: number,
  rightText: string,
  seat: Staff | undefined,
): CardVM {
  const inService = c.status === 'in-service';
  return {
    id: c.id,
    name: c.name,
    service: c.service,
    status: c.status,
    staffId: c.staffId,
    pos,
    initials: initials(c.name),
    seatName: seat?.name ?? '',
    seatColor: seat?.color ?? 'secondary',
    srcLabel: c.src === 'online' ? 'Online' : 'Walk-in',
    online: c.src === 'online',
    rightText: inService ? 'In service' : rightText,
    inService,
    isWaiting: c.status === 'waiting',
  };
}

/** One group per seat, each with running ETA labels on its waiting cards. */
export function buildSeatGroups(
  queue: QueueEntry[],
  staff: Staff[],
  services: Service[],
): SeatGroupVM[] {
  const seatById: Record<string, Staff> = {};
  staff.forEach((st) => (seatById[st.id] = st));

  return staff.map((st) => {
    const items = queue.filter((q) => q.staffId === st.id && isActive(q));
    const serving = items.filter((q) => q.status === 'in-service');
    const waits = items.filter((q) => q.status === 'waiting');

    let cum = serving.reduce((m, q) => m + estMins(q, services), 0);
    let n = 0;
    const servCards = serving.map((c) => buildCard(c, ++n, 'In service', st));
    const waitCards = waits.map((c) => {
      const lbl = cum <= 0 ? 'Next up' : `~${cum} min`;
      const card = buildCard(c, ++n, lbl, st);
      cum += estMins(c, services);
      return card;
    });

    const clearM = items.reduce((m, q) => m + estMins(q, services), 0);
    return {
      id: st.id,
      name: st.name,
      color: st.color,
      initials: st.name[0],
      serving: serving.length > 0,
      servingName: serving.length ? serving[0].name : '',
      subLine: serving.length
        ? `Serving ${serving[0].name.split(' ')[0]} · ~${clearM} min`
        : 'Available · ready for walk-in',
      waitBadge: waits.length > 0 ? `${waits.length} waiting` : 'Free',
      waitN: waits.length,
      free: waits.length === 0,
      empty: items.length === 0,
      cards: [...servCards, ...waitCards],
    };
  });
}

/** Flattened cards across all seats (seat order) — used by the dashboard preview. */
export function flatCards(groups: SeatGroupVM[]): CardVM[] {
  return groups.reduce<CardVM[]>((a, g) => a.concat(g.cards), []);
}
