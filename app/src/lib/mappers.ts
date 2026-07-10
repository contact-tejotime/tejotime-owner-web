/** Map backend API DTOs → the view-model shapes the screens already render. */
import { CardVM, SeatGroupVM } from '@/lib/queue';
import { currencySymbol } from '@/lib/currencies';
import { mapHours } from '@/lib/hours';
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

/**
 * Colors are no longer stored per service/staff — the app assigns them automatically by list
 * position, cycling this palette so adjacent items differ (fully distinct up to 4 items).
 */
export const COLOR_PALETTE: ServiceColorToken[] = ['primary', 'secondary', 'amber500', 'green500'];
const colorByIndex = (i: number): ServiceColorToken => COLOR_PALETTE[i % COLOR_PALETTE.length];

export function mapCard(c: any, seatColor: ServiceColorToken = 'secondary'): CardVM {
  return {
    id: c.id,
    name: c.name,
    service: c.service,
    status: toStatusKind(c.status),
    staffId: c.seatId,
    pos: c.position,
    initials: c.initials,
    seatName: c.seatName,
    seatColor,
    srcLabel: c.online ? 'Online' : 'Walk-in',
    online: !!c.online,
    rightText: c.rightText,
    inService: c.status === 'in_service',
    isWaiting: c.status === 'waiting',
  };
}

export function mapSeat(s: any, i = 0): SeatGroupVM {
  const color = colorByIndex(i);
  return {
    id: s.id,
    name: s.name,
    color,
    initials: s.name?.[0] ?? '?',
    serving: !!s.serving,
    servingName: s.servingName ?? '',
    subLine: s.subLine ?? '',
    waitBadge: s.waitBadge ?? 'Free',
    waitN: s.waitingCount ?? 0,
    clearMinutes: s.clearMinutes ?? 0,
    free: !!s.free,
    empty: !!s.empty,
    cards: (s.cards ?? []).map((c: any) => mapCard(c, color)),
  };
}

export function mapSeats(seats: any[]): SeatGroupVM[] {
  return (seats ?? []).map(mapSeat);
}

export function formatMoney(m?: Money): string {
  const value = (m?.amount ?? 0) / 100;
  // Symbol comes from the store's currency (static map — no runtime Intl.DisplayNames on Hermes).
  const symbol = currencySymbol(m?.currency);
  const locale = !m?.currency || m.currency === 'INR' ? 'en-IN' : 'en-US';
  return `${symbol}${value.toLocaleString(locale, { maximumFractionDigits: value % 1 ? 1 : 0 })}`;
}

export function mapService(s: any, i = 0): ServiceVM {
  return {
    id: s.id,
    name: s.name,
    duration: `${s.durationMinutes} min`,
    price: formatMoney(s.price),
    color: colorByIndex(i),
    durationMinutes: s.durationMinutes ?? 0,
    priceRupees: (s.price?.amount ?? 0) / 100,
    colorToken: (s.colorToken ?? 'secondary') as ServiceColorToken,
  };
}

export function mapStaff(s: any, i = 0): Staff {
  return { id: s.id, name: s.name, color: colorByIndex(i), roleLabel: s.roleLabel ?? undefined };
}

export function mapBusinessDetail(r: any) {
  return {
    id: r.id,
    name: r.name,
    area: r.area,
    slug: r.slug,
    address: r.address ?? undefined,
    countryCode: r.countryCode ?? null,
    phoneNumber: r.phoneNumber ?? null,
    hours: mapHours(r.hours ?? []),
  };
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
