/** Map backend API DTOs → the view-model shapes the screens already render. */
import { CardVM, SeatGroupVM } from '@/lib/queue';
import { AppointmentEntry, Customer, ServiceColorToken, ServiceVM, Staff } from '@/data/sample';
import { StatusKind } from '@/components/ui/StatusBadge';

export interface Money {
  amount: number;
  currency: string;
}

/** API status (snake) → StatusKind (hyphen) used by StatusBadge. */
function toStatusKind(s: string): StatusKind {
  if (s === 'in_service') return 'in-service';
  if (s === 'no_show') return 'no-show';
  return s as StatusKind;
}

export function mapCard(c: any): CardVM {
  return {
    id: c.id,
    name: c.name,
    service: c.service,
    status: toStatusKind(c.status),
    staffId: c.seatId,
    pos: c.position,
    initials: c.initials,
    seatName: c.seatName,
    seatColor: c.seatColor as ServiceColorToken,
    srcLabel: c.online ? 'Online' : 'Walk-in',
    online: !!c.online,
    rightText: c.rightText,
    inService: c.status === 'in_service',
    isWaiting: c.status === 'waiting',
  };
}

export function mapSeat(s: any): SeatGroupVM {
  return {
    id: s.id,
    name: s.name,
    color: s.colorToken as ServiceColorToken,
    initials: s.name?.[0] ?? '?',
    serving: !!s.serving,
    servingName: s.servingName ?? '',
    subLine: s.subLine ?? '',
    waitBadge: s.waitBadge ?? 'Free',
    waitN: s.waitingCount ?? 0,
    clearMinutes: s.clearMinutes ?? 0,
    free: !!s.free,
    empty: !!s.empty,
    cards: (s.cards ?? []).map(mapCard),
  };
}

export function mapSeats(seats: any[]): SeatGroupVM[] {
  return (seats ?? []).map(mapSeat);
}

export function formatMoney(m?: Money): string {
  const rupees = (m?.amount ?? 0) / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 1 ? 1 : 0 })}`;
}

export function mapService(s: any): ServiceVM {
  return {
    id: s.id,
    name: s.name,
    duration: `${s.durationMinutes} min`,
    price: formatMoney(s.price),
    color: s.colorToken as ServiceColorToken,
  };
}

export function mapStaff(s: any): Staff {
  return { id: s.id, name: s.name, color: s.colorToken as ServiceColorToken };
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function mapAppointment(a: any): AppointmentEntry {
  const status = a.status === 'pending' ? 'upcoming' : a.status;
  return {
    id: a.id,
    name: a.customerName,
    service: a.serviceName,
    time: fmtTime(a.scheduledStartAt),
    status: status as StatusKind,
  };
}

export function mapCustomer(c: any): Customer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    visits: c.visitsCount ?? 0,
    last: c.lastVisitLabel ?? '—',
    spend: formatMoney(c.totalSpend),
    vip: !!c.isVip,
  };
}
