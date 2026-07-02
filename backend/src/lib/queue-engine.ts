/**
 * Multi-seat queue projection — ported from app/src/lib/queue.ts.
 * Pure functions: given ordered entries + staff + services, produce the seat
 * groups / ETA labels the clients render. The SAME math powers customer tickets.
 */
import { DEFAULT_SERVICE_MINUTES, ColorToken } from '../config/constants';
import { QueueStatus, QueueSource, isActiveStatus } from '../domain/enums';
import { initials } from './format';

export interface EngineEntry {
  id: string;
  name: string;
  /** service_name — may include add-ons e.g. "Haircut + Shave". */
  service: string;
  status: QueueStatus;
  staffId: string | null;
  source: QueueSource;
  /** extra_minutes from add-ons. */
  extra: number;
}

export interface EngineStaff {
  id: string;
  name: string;
  color: ColorToken;
}

export interface EngineService {
  name: string;
  durationMinutes: number;
}

export interface CardVM {
  id: string;
  name: string;
  service: string;
  status: QueueStatus;
  staffId: string | null;
  pos: number;
  initials: string;
  seatName: string;
  seatColor: ColorToken;
  srcLabel: string;
  online: boolean;
  rightText: string;
  etaMinutes: number;
  inService: boolean;
  isWaiting: boolean;
}

export interface SeatGroupVM {
  id: string;
  name: string;
  color: ColorToken;
  initials: string;
  serving: boolean;
  servingName: string;
  subLine: string;
  waitBadge: string;
  waitingCount: number;
  clearMinutes: number;
  free: boolean;
  empty: boolean;
  cards: CardVM[];
}

/** Estimated minutes for an item — exact-match then longest-prefix, plus extras. */
export function estMins(item: EngineEntry, services: EngineService[]): number {
  const name = item.service || '';
  let svc = services.find((sv) => sv.name === name);
  if (!svc) {
    const pre = services
      .filter((sv) => name.indexOf(sv.name) === 0)
      .sort((a, b) => b.name.length - a.name.length);
    svc = pre[0];
  }
  const base = svc ? svc.durationMinutes : DEFAULT_SERVICE_MINUTES;
  return (Number.isNaN(base) ? DEFAULT_SERVICE_MINUTES : base) + (item.extra || 0);
}

/** Total active minutes assigned to a seat. */
export function seatLoad(
  queue: EngineEntry[],
  staffId: string,
  services: EngineService[],
): number {
  return queue
    .filter((q) => q.staffId === staffId && isActiveStatus(q.status))
    .reduce((m, q) => m + estMins(q, services), 0);
}

/** Seat with the lightest load — used for "Any seat" auto-assignment. */
export function soonestSeat(
  queue: EngineEntry[],
  staff: EngineStaff[],
  services: EngineService[],
): string {
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

function buildCard(
  c: EngineEntry,
  pos: number,
  rightText: string,
  etaMinutes: number,
  seat: EngineStaff | undefined,
): CardVM {
  const inService = c.status === 'in_service';
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
    srcLabel: c.source === 'online' ? 'Online' : 'Walk-in',
    online: c.source === 'online',
    rightText: inService ? 'In service' : rightText,
    etaMinutes: inService ? 0 : etaMinutes,
    inService,
    isWaiting: c.status === 'waiting',
  };
}

/** One group per seat, each with running ETA labels on its waiting cards. */
export function buildSeatGroups(
  queue: EngineEntry[],
  staff: EngineStaff[],
  services: EngineService[],
): SeatGroupVM[] {
  return staff.map((st) => {
    const items = queue.filter((q) => q.staffId === st.id && isActiveStatus(q.status));
    const serving = items.filter((q) => q.status === 'in_service');
    const waits = items.filter((q) => q.status === 'waiting');

    let cum = serving.reduce((m, q) => m + estMins(q, services), 0);
    let n = 0;
    const servCards = serving.map((c) => buildCard(c, ++n, 'In service', 0, st));
    const waitCards = waits.map((c) => {
      const lbl = cum <= 0 ? 'Next up' : `~${cum} min`;
      const card = buildCard(c, ++n, lbl, cum, st);
      cum += estMins(c, services);
      return card;
    });

    const clearM = items.reduce((m, q) => m + estMins(q, services), 0);
    return {
      id: st.id,
      name: st.name,
      color: st.color,
      initials: st.name[0] ?? '?',
      serving: serving.length > 0,
      servingName: serving.length ? serving[0]!.name : '',
      subLine: serving.length
        ? `Serving ${serving[0]!.name.split(' ')[0]} · ~${clearM} min`
        : 'Available · ready for walk-in',
      waitBadge: waits.length > 0 ? `${waits.length} waiting` : 'Free',
      waitingCount: waits.length,
      clearMinutes: clearM,
      free: waits.length === 0,
      empty: items.length === 0,
      cards: [...servCards, ...waitCards],
    };
  });
}

/** Flattened cards across all seats (seat order). */
export function flatCards(groups: SeatGroupVM[]): CardVM[] {
  return groups.reduce<CardVM[]>((a, g) => a.concat(g.cards), []);
}

/**
 * Compute how many active entries sit ahead of a given entry on its seat, plus
 * the cumulative wait minutes at that position. Powers the customer ticket
 * ("ahead of you" / "est. wait").
 */
export function ticketPosition(
  entryId: string,
  queue: EngineEntry[],
  staff: EngineStaff[],
  services: EngineService[],
): { ahead: number; waitMinutes: number; status: QueueStatus | null } {
  const groups = buildSeatGroups(queue, staff, services);
  for (const g of groups) {
    const card = g.cards.find((c) => c.id === entryId);
    if (card) {
      const ahead = card.pos - 1; // 1-indexed position within the seat's active line
      return { ahead: Math.max(0, ahead), waitMinutes: card.etaMinutes, status: card.status };
    }
  }
  return { ahead: 0, waitMinutes: 0, status: null };
}
