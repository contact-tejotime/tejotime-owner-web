/** Map backend API DTOs → the view-model shapes the screens already render. */
import { CardVM, SeatGroupVM } from '@/lib/queue';
import { currencySymbol } from '@/lib/currencies';
import { mapHours } from '@/lib/hours';
import { AppointmentEntry, CalendarAppointmentEntry, Customer, ServiceColorToken, ServicePriceType, ServiceVM, Staff } from '@/data/sample';
import { StatusKind } from '@/components/ui/StatusBadge';
import { t, format } from '@/i18n';
import { storeDayKey, storeTimeLabel } from '@/lib/zoned';

export interface Money {
  amount: number;
  currency: string;
}

/** API status (snake) → StatusKind (hyphen) used by StatusBadge. */
function toStatusKind(s: string): StatusKind {
  if (s === 'in_service') return 'in-service';
  if (s === 'no_show') return 'no-show';
  if (s === 'pending') return 'upcoming';
  if (s === 'checked_in') return 'checked-in';
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
    srcLabel: c.online ? t.format.online : t.format.walkIn,
    online: !!c.online,
    rightText: c.rightText,
    inService: c.status === 'in_service',
    isWaiting: c.status === 'waiting',
    visitorType: c.visitorType ?? null,
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
    waitBadge: s.waitBadge ?? t.format.free,
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
  // Two places or none: a single decimal printed $12.50 as "$12.5".
  const digits = value % 1 ? 2 : 0;
  return `${symbol}${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * A service's price as one display string.
 *
 * Three readings, decided here rather than at each call site: a figure, a band, or nothing yet.
 * The last used to be inferred from a zero and rendered as "₹0" — telling the owner their own
 * unpriced service was free. A response cached from before pricing modes carries no
 * `priceType`, and the old rule (a real amount is a fixed price) still reads it correctly.
 */
export function formatServicePrice(s: {
  price?: Money;
  priceType?: ServicePriceType | null;
  priceMax?: Money | null;
}): string {
  const type = s.priceType ?? ((s.price?.amount ?? 0) > 0 ? 'fixed' : 'unset');
  if (type === 'unset') return t.serviceSheet.unpriced;
  if (type === 'range' && s.priceMax) {
    return format(t.serviceSheet.rangeLabel, { min: formatMoney(s.price), max: formatMoney(s.priceMax) });
  }
  return formatMoney(s.price);
}

export function mapService(s: any, i = 0): ServiceVM {
  const priceType = (s.priceType ?? ((s.price?.amount ?? 0) > 0 ? 'fixed' : 'unset')) as ServicePriceType;
  return {
    id: s.id,
    name: s.name,
    duration: format(t.format.durationMin, { min: s.durationMinutes }),
    price: formatServicePrice(s),
    color: colorByIndex(i),
    durationMinutes: s.durationMinutes ?? 0,
    priceRupees: (s.price?.amount ?? 0) / 100,
    priceType,
    priceMaxRupees: s.priceMax?.amount == null ? null : s.priceMax.amount / 100,
    colorToken: (s.colorToken ?? 'secondary') as ServiceColorToken,
  };
}

export function mapStaff(s: any, i = 0): Staff {
  return {
    id: s.id,
    name: s.name,
    color: colorByIndex(i),
    roleLabel: s.roleLabel ?? undefined,
    photoUrl: s.avatarUrl ?? null,
  };
}

export function mapBusinessDetail(r: any) {
  return {
    id: r.id,
    name: r.name ?? '',
    area: r.area ?? '',
    slug: r.slug,
    address: r.address ?? '',
    category: r.category ?? '',
    // Kept on every GET /business refresh, or this replace would drop what /auth/me set.
    currency: r.currency ?? undefined,
    city: r.city ?? '',
    countryCode: r.countryCode ?? null,
    phoneNumber: r.phoneNumber ?? null,
    tagline: r.tagline ?? '',
    heroSubtitle: r.heroSubtitle ?? '',
    description: r.description ?? '',
    aboutHeading: r.aboutHeading ?? '',
    establishedYear: r.establishedYear != null ? Number(r.establishedYear) : null,
    statValue: r.statValue ?? '',
    statLabel: r.statLabel ?? '',
    logoUrl: r.logoUrl ?? '',
    heroImageUrl: r.heroImageUrl ?? '',
    aboutImageUrl: r.aboutImageUrl ?? '',
    instagramUrl: r.instagramUrl ?? '',
    facebookUrl: r.facebookUrl ?? '',
    twitterUrl: r.twitterUrl ?? '',
    linkedinUrl: r.linkedinUrl ?? '',
    yelpUrl: r.yelpUrl ?? '',
    googleReviewUrl: r.googleReviewUrl ?? '',
    payments: Array.isArray(r.payments) ? r.payments.map(String) : [],
    amenities: Array.isArray(r.amenities) ? r.amenities.map(String) : [],
    faqs: Array.isArray(r.faqs)
      ? r.faqs.map((f: any) => ({ q: String(f.q ?? ''), a: String(f.a ?? '') }))
      : [],
    reviews: Array.isArray(r.reviews)
      ? r.reviews.map((rev: any) => ({
          stars: Number(rev.stars ?? 5),
          text: String(rev.text ?? ''),
          authorName: String(rev.authorName ?? ''),
        }))
      : [],
    gallery: Array.isArray(r.gallery)
      ? r.gallery.map((g: any) => ({
          id: g.id != null ? String(g.id) : undefined,
          url: String(g.url ?? ''),
          alt: g.alt != null ? String(g.alt) : null,
        }))
      : [],
    hours: mapHours(r.hours ?? []),
    // Undefined when the API does not send it (one from before migration 0036): Settings then hides
    // the switch rather than offering one whose save the API would refuse. Same as owner-web.
    recurringEnabled: typeof r.recurringEnabled === 'boolean' ? r.recurringEnabled : undefined,
    // IANA zone the store keeps its hours in — every booking time is printed on it (lib/zoned.ts).
    timezone: typeof r.timezone === 'string' && r.timezone ? r.timezone : undefined,
  };
}

/** The booking's time on the STORE's clock (lib/zoned.ts), not the phone's. */
function fmtTime(iso: string): string {
  try {
    return storeTimeLabel(iso);
  } catch {
    return '';
  }
}

export function mapAppointment(a: any): AppointmentEntry {
  return {
    id: a.id,
    name: a.customerName,
    // Optional now that a store may list no services: '' rather than null, so the list row can
    // omit it instead of printing "null · John".
    service: a.serviceName ?? '',
    time: fmtTime(a.scheduledStartAt),
    status: toStatusKind(a.status),
    staffId: a.staffId ?? null,
    visitorType: a.visitorType ?? null,
    startAt: a.scheduledStartAt,
    // `?? null`: an API from before migration 0036 sends neither field.
    seriesId: a.seriesId ?? null,
    cancelReason: a.cancelReason ?? null,
    // Moved by hand (migration 0037) — labelled "Moved".
    moved: !!a.rescheduledAt,
  };
}

/**
 * The STORE-local `YYYY-MM-DD` of an appointment instant, for grouping bookings onto calendar day
 * cells. The phone's clock put a 10 PM booking on the next day for an owner whose phone was in a
 * zone ahead of the store's. Grid cells themselves are calendar dates, not instants — they use
 * `dayKeyOf` (lib/date-grid), never this.
 */
export function toDateKey(value: string | Date): string {
  return storeDayKey(value);
}

export function mapCalendarAppointment(a: any): CalendarAppointmentEntry {
  return {
    ...mapAppointment(a),
    dateKey: toDateKey(a.scheduledStartAt),
  };
}

export function mapCustomer(c: any): Customer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    visits: c.visitsCount ?? 0,
    last: c.lastVisitLabel ?? t.common.dash,
    spend: formatMoney(c.totalSpend),
    vip: !!c.isVip,
  };
}
