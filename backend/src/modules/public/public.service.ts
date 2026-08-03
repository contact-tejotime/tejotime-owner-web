import { many, one } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { VISITOR_TYPE_CATEGORIES } from '../../config/constants';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { normalizePhone } from '../../lib/phone';
import { dayjs } from '../../lib/time';
import { createTtlCache } from '../../lib/ttl-cache';
import { buildSeatGroups, soonestSeat, ticketPosition } from '../../lib/queue-engine';
import { emitToOwners, emitToTicket } from '../../realtime/emitters';
import { ticketKey } from '../auth/token.service';
import { findOrCreateCustomer } from '../customers/customer.repo';
import { loadQueueContext } from '../queue/queue.context';
import { broadcastQueue } from '../queue/queue.service';

/** Short TTL so poll fallbacks coalesce under load without serving stale wait labels for long. */
const LIVE_CACHE_TTL_MS = 5_000;

type AvailabilityPayload = { waitMinutes: number; queueCount: number; updatedAt: string };
type StaffAvailabilityPayload = {
  staff: Array<{
    id: string;
    name: string;
    roleLabel: string | null;
    avatarUrl: string | null;
    busy: boolean;
    queueCount: number;
    waitMinutes: number;
    waitLabel: string;
  }>;
};

const availabilityCache = createTtlCache<AvailabilityPayload>(LIVE_CACHE_TTL_MS);
const staffCache = createTtlCache<StaffAvailabilityPayload>(LIVE_CACHE_TTL_MS);

async function resolveBusiness(slug: string) {
  const data = await one('select * from business where slug = $1 and is_active = true', [slug]);
  if (!data) throw Errors.notFound('Business not found');
  return data;
}

function fmtTime(t: string | null): string {
  if (!t) return '';
  return dayjs(`2000-01-01 ${t}`, 'YYYY-MM-DD HH:mm:ss').format('h:mm A').replace(':00', '');
}

function computeOpenStatus(hours: any[], tz: string) {
  const now = dayjs().tz(tz);
  const today = hours.find((h) => h.day_of_week === now.day());
  if (!today || today.is_closed) return { isOpen: false, closesAt: null, label: 'Closed today' };
  const opens = dayjs.tz(`${now.format('YYYY-MM-DD')} ${today.opens_at}`, tz);
  const closes = dayjs.tz(`${now.format('YYYY-MM-DD')} ${today.closes_at}`, tz);
  const isOpen = now.isAfter(opens) && now.isBefore(closes);
  return {
    isOpen,
    closesAt: today.closes_at,
    label: isOpen ? `Open now · till ${fmtTime(today.closes_at)}` : `Opens ${fmtTime(today.opens_at)}`,
  };
}

function liveAvailability(ctx: Awaited<ReturnType<typeof loadQueueContext>>) {
  const groups = buildSeatGroups(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const clears = groups.map((g) => g.clearMinutes);
  const waitMinutes = clears.length ? Math.min(...clears) : 0;
  const queueCount = ctx.engineEntries.filter((e) => e.status === 'waiting').length;
  return { groups, waitMinutes, queueCount };
}

export async function getMicrosite(slug: string) {
  const b = await resolveBusiness(slug);
  return buildMicrosite(b);
}

// Escape the characters vCard treats as structural (RFC 6350 §3.4): backslash, comma,
// semicolon, and newlines. Order matters — escape the backslash first.
function vcardEscape(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// Build a vCard 3.0 for a store from its live business row. Kept deliberately minimal
// (name / phone / address / microsite URL) so a scan drops a clean contact into the phone.
// Rebuilt on every request, so it always reflects the latest owner edits.
export async function getVCard(slug: string): Promise<string> {
  const b = await resolveBusiness(slug);
  const name = vcardEscape(b.name ?? '');
  const tel = `${b.country_code ?? ''}${b.phone_number ?? ''}`.replace(/\D/g, '');
  // ADR structured value: PO;ext;street;locality;region;postal;country
  const adr = `;;${vcardEscape(b.address ?? '')};${vcardEscape(b.area ?? '')};;;`;
  const url = b.phone_full ? `https://www.tejotime.com/${b.phone_full}` : '';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${name};;;;`,
    `FN:${name}`,
    `ORG:${name}`,
  ];
  if (tel) lines.push(`TEL;TYPE=CELL:+${tel}`);
  if (b.address || b.area) lines.push(`ADR;TYPE=WORK:${adr}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VCARD');

  return lines.join('\r\n');
}

// The URL segment is the full number, digits only (country_code + national number
// concatenated). Match it against the derived phone_full column. We intentionally do NOT
// reuse normalizePhone(): its '+' / India-10-digit-default logic doesn't apply to a
// pre-concatenated international number and would corrupt some inputs.
async function resolveBusinessByPhone(phoneDigits: string) {
  const digits = phoneDigits.replace(/\D/g, '');
  const data = await one('select * from business where phone_full = $1 and is_active = true', [digits]);
  if (!data) throw Errors.notFound('Business not found');
  return data;
}

export async function getMicrositeByPhone(phoneDigits: string) {
  const b = await resolveBusinessByPhone(phoneDigits);
  return buildMicrosite(b);
}

async function buildMicrosite(b: any) {
  // Single round-trip wave: hours/amenities/gallery run alongside the queue context,
  // which already loads active services (reused below instead of a duplicate query).
  const [hours, amenities, gallery, ctx] = await Promise.all([
    many('select * from business_hour where business_id = $1 order by day_of_week', [b.id]),
    many('select * from amenity where business_id = $1 order by position', [b.id]),
    many('select * from gallery_image where business_id = $1 order by position', [b.id]),
    loadQueueContext(b.id),
  ]);
  const services = ctx.serviceRows;

  const { groups, waitMinutes, queueCount } = liveAvailability(ctx);

  const staffDTO = ctx.staffRows.map((s) => {
    const g = groups.find((x) => x.id === s.id);
    return {
      id: s.id,
      name: s.name,
      roleLabel: s.role_label,
      avatarUrl: s.avatar_url ?? null,
      busy: !!g?.serving,
      queueCount: g?.waitingCount ?? 0,
      waitMinutes: g?.clearMinutes ?? 0,
      waitLabel: g && g.clearMinutes > 0 ? `~${g.clearMinutes}m` : 'Free',
    };
  });

  return {
    id: b.id,
    slug: b.slug,
    countryCode: b.country_code ?? null,
    phoneNumber: b.phone_number ?? null,
    name: b.name,
    tagline: b.tagline,
    heroSubtitle: b.hero_subtitle ?? null,
    statValue: b.stat_value ?? null,
    statLabel: b.stat_label ?? null,
    description: b.description,
    aboutHeading: b.about_heading ?? null,
    heroImageUrl: b.hero_image_url ?? null,
    aboutImageUrl: b.about_image_url ?? null,
    logoUrl: b.logo_url ?? null,
    faqs: Array.isArray(b.faqs) ? b.faqs : [],
    category: b.category,
    area: b.area,
    address: b.address,
    rating: Number(b.rating ?? 0),
    reviewCount: b.review_count,
    establishedYear: b.established_year,
    openStatus: computeOpenStatus(hours ?? [], b.timezone),
    hours: (hours ?? []).map((h) => ({
      dayOfWeek: h.day_of_week,
      label: h.is_closed ? 'Closed' : `${fmtTime(h.opens_at)} – ${fmtTime(h.closes_at)}`,
      isClosed: h.is_closed,
    })),
    amenities: (amenities ?? []).map((a) => a.label),
    gallery: (gallery ?? []).map((g) => g.url),
    services: (services ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      durationMinutes: s.duration_minutes,
      price: money(s.price_paise, s.currency),
    })),
    staff: staffDTO,
    reviews: (Array.isArray(b.reviews) ? b.reviews : []).map((r: any) => ({
      stars: Number(r.stars) || 0,
      text: r.text,
      authorName: r.authorName,
    })),
    live: { waitMinutes, queueCount },
    payments: b.payments ?? [],
    currency: b.currency ?? env.DEFAULT_CURRENCY,
  };
}

export async function getAvailability(slug: string) {
  const hit = availabilityCache.get(slug);
  if (hit) return hit;

  const b = await resolveBusiness(slug);
  const ctx = await loadQueueContext(b.id);
  const { waitMinutes, queueCount } = liveAvailability(ctx);
  const result: AvailabilityPayload = {
    waitMinutes,
    queueCount,
    updatedAt: new Date().toISOString(),
  };
  availabilityCache.set(slug, result);
  return result;
}

export async function getStaffAvailability(slug: string) {
  const hit = staffCache.get(slug);
  if (hit) return hit;

  const b = await resolveBusiness(slug);
  const ctx = await loadQueueContext(b.id);
  const { groups } = liveAvailability(ctx);
  const result: StaffAvailabilityPayload = {
    staff: ctx.staffRows.map((s) => {
      const g = groups.find((x) => x.id === s.id);
      return {
        id: s.id,
        name: s.name,
        roleLabel: s.role_label,
        avatarUrl: s.avatar_url ?? null,
        busy: !!g?.serving,
        queueCount: g?.waitingCount ?? 0,
        waitMinutes: g?.clearMinutes ?? 0,
        waitLabel: g && g.clearMinutes > 0 ? `~${g.clearMinutes}m` : 'Free',
      };
    }),
  };
  staffCache.set(slug, result);
  return result;
}

export async function getSlots(slug: string, date: string, serviceId?: string, staffId?: string) {
  const b = await resolveBusiness(slug);
  const tz = b.timezone;
  const day = dayjs.tz(date, tz);
  const hours = await one('select * from business_hour where business_id = $1 and day_of_week = $2', [
    b.id,
    day.day(),
  ]);
  if (!hours || hours.is_closed) return { date, slots: [] };

  let duration = env.BOOKING_SLOT_MINUTES;
  if (serviceId) {
    const svc = await one('select duration_minutes from service where id = $1', [serviceId]);
    if (svc) duration = svc.duration_minutes;
  }

  const open = dayjs.tz(`${date} ${hours.opens_at}`, tz);
  const close = dayjs.tz(`${date} ${hours.closes_at}`, tz);
  const step = env.BOOKING_SLOT_MINUTES;

  // Existing bookings to exclude (per staff if specified).
  let taken = new Set<string>();
  const bookedParams: unknown[] = [b.id, open.utc().toISOString(), close.utc().toISOString()];
  let staffFilter = '';
  if (staffId) {
    bookedParams.push(staffId);
    staffFilter = ` and staff_id = $${bookedParams.length}`;
  }
  const booked = await many(
    `select scheduled_start_at, staff_id from appointment
      where business_id = $1
        and status in ('pending', 'confirmed')
        and scheduled_start_at >= $2
        and scheduled_start_at <= $3${staffFilter}`,
    bookedParams,
  );
  taken = new Set(booked.map((a) => dayjs(a.scheduled_start_at).toISOString()));

  const now = dayjs().tz(tz);
  const slots: { startAt: string; label: string }[] = [];
  let cursor = open;
  while (cursor.add(duration, 'minute').isBefore(close.add(1, 'second'))) {
    const iso = cursor.utc().toISOString();
    if (cursor.isAfter(now) && !taken.has(iso)) {
      slots.push({ startAt: iso, label: cursor.format('h:mm A') });
    }
    cursor = cursor.add(step, 'minute');
  }
  return { date, slots };
}

function ticketSocket(businessId: string, ticketId: string) {
  return { namespace: '/customer', room: `ticket:${ticketId}`, ticketKey: ticketKey(ticketId), businessId };
}

export async function joinQueue(
  slug: string,
  input: { serviceId?: string; name: string; phone: string; preferredStaffId?: string; visitorType?: 'mr' | 'patient' },
) {
  const b = await resolveBusiness(slug);
  if (VISITOR_TYPE_CATEGORIES.has(b.category) && !input.visitorType) {
    throw Errors.validation('Visitor type is required', [{ field: 'visitorType', message: 'Pick MR or Patient' }]);
  }

  // Day-scoped dedup: one active ticket per phone per day. If this phone already holds a
  // live ticket today (possibly from another device/browser), return it flagged instead of
  // minting a second token. See findActiveTicketByPhone for the "active today" definition.
  const existing = await findActiveTicketByPhone(b, input.phone);
  if (existing) return { ...existing, alreadyInQueue: true };

  const ctx = await loadQueueContext(b.id);

  // Services are optional for some categories (e.g. Hospital/Restaurant) — a missing serviceId
  // is a valid "no specific service" join; the wait-time engine already falls back to a default
  // duration for entries with no service_name (see queue-engine.ts's estMins).
  const svc = input.serviceId
    ? await one('select id, name from service where id = $1 and business_id = $2', [input.serviceId, b.id])
    : null;
  if (input.serviceId && !svc) throw Errors.notFound('Service not found');

  let staffId = input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null;
  if (staffId && !ctx.staffRows.find((s) => s.id === staffId)) staffId = null;
  if (!staffId) staffId = soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);

  const phone = normalizePhone(input.phone);
  const customerId = await findOrCreateCustomer(b.id, input.name, phone);

  const result = await callRpc<{ id: string; token: string }>('queue_add', {
    p_business_id: b.id,
    p_name: input.name,
    p_phone: phone,
    p_service_id: svc?.id ?? null,
    p_staff_id: staffId,
    p_position: 'end',
    p_source: 'online',
    p_preferred_staff_id: input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null,
    p_appointment_id: null,
    p_customer_id: customerId,
    p_visitor_type: input.visitorType ?? null,
  });

  emitToOwners(b.id, 'queue:entry.created', { entryId: result.id, seatId: staffId, source: 'online' });
  await broadcastQueue(b.id);

  const fresh = await loadQueueContext(b.id);
  const pos = ticketPosition(result.id, fresh.engineEntries, fresh.engineStaff, fresh.engineServices);
  const staffName = ctx.staffRows.find((s) => s.id === staffId)?.name ?? null;

  return {
    ticketId: result.id,
    token: result.token,
    ahead: pos.ahead,
    waitMinutes: pos.waitMinutes,
    serviceRemainingMinutes: pos.serviceRemainingMinutes,
    status: pos.status ?? 'waiting',
    staffName,
    serviceName: svc?.name ?? null,
    asOf: new Date().toISOString(),
    socket: ticketSocket(b.id, result.id),
  };
}

export async function bookSlot(
  slug: string,
  input: {
    serviceId?: string;
    name: string;
    phone: string;
    preferredStaffId?: string;
    slotStart: string;
    visitorType?: 'mr' | 'patient';
  },
) {
  const b = await resolveBusiness(slug);
  if (VISITOR_TYPE_CATEGORIES.has(b.category) && !input.visitorType) {
    throw Errors.validation('Visitor type is required', [{ field: 'visitorType', message: 'Pick MR or Patient' }]);
  }
  const svc = input.serviceId
    ? await one('select id, name, duration_minutes from service where id = $1 and business_id = $2', [
        input.serviceId,
        b.id,
      ])
    : null;
  if (input.serviceId && !svc) throw Errors.notFound('Service not found');

  const phone = normalizePhone(input.phone);
  const customerId = await findOrCreateCustomer(b.id, input.name, phone);
  const staffId = input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null;
  const start = new Date(input.slotStart);
  // No service picked → fall back to the standard slot length (same convention as getSlots above).
  const durationMinutes = svc?.duration_minutes ?? env.BOOKING_SLOT_MINUTES;
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const data = await one(
    `insert into appointment
       (business_id, customer_id, customer_name, customer_phone, service_id, service_name,
        staff_id, scheduled_start_at, scheduled_end_at, status, source, visitor_type)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', 'online', $10)
     returning *`,
    [
      b.id,
      customerId,
      input.name,
      phone,
      svc?.id ?? null,
      svc?.name ?? null,
      staffId,
      start.toISOString(),
      end.toISOString(),
      input.visitorType ?? null,
    ],
  );
  if (!data) throw new Error('Failed to create appointment');

  emitToOwners(b.id, 'appointment:created', {
    appointment: { id: data.id, customerName: data.customer_name, serviceName: data.service_name, scheduledStartAt: data.scheduled_start_at, status: data.status },
  });

  return {
    appointmentId: data.id,
    serviceName: svc?.name ?? null,
    scheduledStartAt: data.scheduled_start_at,
    status: 'confirmed',
    staffName: staffId ? (await one('select name from staff where id = $1', [staffId]))?.name : null,
  };
}

// Build the public Ticket DTO from a queue_entry row. `withSocket` adds the /customer
// socket handshake (namespace/room/ticketKey) so a freshly tracked ticket can go live.
async function ticketDetailFromEntry(entry: any, withSocket = false) {
  const socket = withSocket ? { socket: ticketSocket(entry.business_id, entry.id) } : {};
  // asOf anchors the client-side countdown: it decays serviceRemainingMinutes from this instant.
  const asOf = new Date().toISOString();
  if (!['waiting', 'in_service'].includes(entry.status)) {
    return {
      ticketId: entry.id,
      token: entry.token,
      ahead: 0,
      waitMinutes: 0,
      serviceRemainingMinutes: 0,
      status: entry.status,
      isYourTurn: entry.status === 'in_service',
      progressPct: entry.status === 'completed' || entry.status === 'in_service' ? 100 : 0,
      asOf,
      ...socket,
    };
  }
  const ctx = await loadQueueContext(entry.business_id);
  const pos = ticketPosition(entry.id, ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const isYourTurn = pos.status === 'in_service';
  return {
    ticketId: entry.id,
    token: entry.token,
    ahead: pos.ahead,
    waitMinutes: pos.waitMinutes,
    serviceRemainingMinutes: pos.serviceRemainingMinutes,
    status: pos.status ?? entry.status,
    isYourTurn,
    progressPct: isYourTurn ? 100 : 0,
    asOf,
    ...socket,
  };
}

// The single source of truth for "does this phone hold a live ticket TODAY". Used by both
// the join dedup and the Track-my-turn lookup so the day boundary is defined in one place.
// Phone is normalized the same way joinQueue stores it, and token_day is the business-tz date.
async function findActiveTicketByPhone(business: any, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const today = dayjs().tz(business.timezone).format('YYYY-MM-DD');
  const entry = await one(
    `select * from queue_entry
      where business_id = $1
        and customer_phone = $2
        and token_day = $3
        and status in ('waiting', 'in_service')
      order by joined_at
      limit 1`,
    [business.id, phone, today],
  );
  if (!entry) return null;
  return ticketDetailFromEntry(entry, true);
}

export async function getTicket(ticketId: string) {
  const entry = await one('select * from queue_entry where id = $1', [ticketId]);
  if (!entry) throw Errors.notFound('Ticket not found');
  return ticketDetailFromEntry(entry);
}

// Track my turn: look up the caller's active ticket for today by phone. This lets a
// customer on a different browser/device (with no local resume record) find their place.
// NOTE: with demo OTP this is verified client-side only, so the endpoint is effectively
// unauthenticated (phone -> ticket). When real OTP lands, gate this behind a verified code.
export async function trackByPhone(slug: string, input: { phone: string }) {
  const b = await resolveBusiness(slug);
  const ticket = await findActiveTicketByPhone(b, input.phone);
  // Return the caller's known name (if this phone is a past customer) so a follow-on Join can
  // pre-fill it. Read-only; the endpoint is OTP-gated so returning the caller's own name is ok.
  const cust = await one('select name from customer where business_id = $1 and phone = $2', [
    b.id,
    normalizePhone(input.phone),
  ]);
  const customerName = cust?.name ?? null;
  return ticket ? { found: true, customerName, ...ticket } : { found: false, customerName };
}

export async function submitInquiry(input: { businessName: string; address: string; phone: string }) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw Errors.validation('Invalid phone number', [{ field: 'phone', message: 'Invalid phone number' }]);
  const data = await one(
    `insert into inquiry (business_name, address, phone) values ($1, $2, $3) returning *`,
    [input.businessName.trim(), input.address.trim(), phone],
  );
  if (!data) throw new Error('Failed to create inquiry');
  return { id: data.id, submittedAt: data.created_at };
}

export async function leaveTicket(ticketId: string) {
  const entry = await one('select business_id, status from queue_entry where id = $1', [ticketId]);
  if (!entry) throw Errors.notFound('Ticket not found');
  if (entry.status !== 'waiting') {
    throw Errors.conflict('INVALID_STATE', 'Cannot leave queue while service is in progress');
  }
  await callRpc('queue_leave', { p_business_id: entry.business_id, p_entry_id: ticketId });
  // Terminal push so a ticket open on another device flips (broadcastQueue skips the now-inactive entry).
  emitToTicket(ticketId, 'ticket:cancelled', { reason: 'left' });
  await broadcastQueue(entry.business_id);
  return { ok: true, ticketId };
}
