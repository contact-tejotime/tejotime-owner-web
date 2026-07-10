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
  /** started_at ISO — set only while/after in_service; null otherwise. Drives elapsed-aware ETA. */
  startedAt?: string | null;
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
  /** Remaining minutes of the entry currently in service on this seat (0 if none / overrun). This
   * is the ONLY part of a waiter's ETA that decays with wall-clock; the rest is fixed queue load. */
  serviceRemainingMinutes: number;
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

/** Whole minutes elapsed since a service started. 0 when unknown/not-yet-started or on a bad date. */
export function elapsedMins(startedAt: string | null | undefined, now: Date): number {
  if (!startedAt) return 0;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 60000));
}

/**
 * Minutes an item still contributes to the queue's wait. A waiting item has not started, so it
 * contributes its full estimate. An in-service item decays with wall-clock — its remaining time is
 * its estimate minus minutes elapsed since started_at, floored at 0 (an over-running chair reads 0).
 */
export function remainingMins(item: EngineEntry, services: EngineService[], now: Date): number {
  const full = estMins(item, services);
  if (item.status !== 'in_service') return full;
  return Math.max(0, full - elapsedMins(item.startedAt, now));
}

/** Total active minutes assigned to a seat (in-service portion decayed by elapsed time). */
export function seatLoad(
  queue: EngineEntry[],
  staffId: string,
  services: EngineService[],
  now: Date = new Date(),
): number {
  return queue
    .filter((q) => q.staffId === staffId && isActiveStatus(q.status))
    .reduce((m, q) => m + remainingMins(q, services, now), 0);
}

/** Seat with the lightest load — used for "Any seat" auto-assignment. */
export function soonestSeat(
  queue: EngineEntry[],
  staff: EngineStaff[],
  services: EngineService[],
  now: Date = new Date(),
): string {
  let best = staff[0]?.id ?? '';
  let bestLoad = Infinity;
  staff.forEach((st) => {
    const l = seatLoad(queue, st.id, services, now);
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
  now: Date = new Date(),
): SeatGroupVM[] {
  return staff.map((st) => {
    const items = queue.filter((q) => q.staffId === st.id && isActiveStatus(q.status));
    const serving = items.filter((q) => q.status === 'in_service');
    const waits = items.filter((q) => q.status === 'waiting');

    // Only the in-service head decays with wall-clock; queued waiters keep their full estimate.
    const serviceRemaining = serving.reduce((m, q) => m + remainingMins(q, services, now), 0);
    let cum = serviceRemaining;
    let n = 0;
    const servCards = serving.map((c) => buildCard(c, ++n, 'In service', 0, st));
    const waitCards = waits.map((c) => {
      const lbl = cum <= 0 ? 'Next up' : `~${cum} min`;
      const card = buildCard(c, ++n, lbl, cum, st);
      cum += estMins(c, services);
      return card;
    });

    const clearM = items.reduce((m, q) => m + remainingMins(q, services, now), 0);
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
      serviceRemainingMinutes: serviceRemaining,
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
  now: Date = new Date(),
): { ahead: number; waitMinutes: number; serviceRemainingMinutes: number; status: QueueStatus | null } {
  const groups = buildSeatGroups(queue, staff, services, now);
  for (const g of groups) {
    const card = g.cards.find((c) => c.id === entryId);
    if (card) {
      const ahead = card.pos - 1; // 1-indexed position within the seat's active line
      // The decaying slice of this ticket's wait is the seat's in-service remainder, never more
      // than the ticket's own wait (0 for the in-service customer, whose wait is already 0).
      const serviceRemainingMinutes = Math.min(g.serviceRemainingMinutes, card.etaMinutes);
      return {
        ahead: Math.max(0, ahead),
        waitMinutes: card.etaMinutes,
        serviceRemainingMinutes,
        status: card.status,
      };
    }
  }
  return { ahead: 0, waitMinutes: 0, serviceRemainingMinutes: 0, status: null };
}
