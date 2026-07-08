import { supabase } from '../../db/supabase';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { normalizePhone } from '../../lib/phone';
import { dayjs } from '../../lib/time';
import { buildSeatGroups, soonestSeat, ticketPosition } from '../../lib/queue-engine';
import { emitToOwners, emitToTicket } from '../../realtime/emitters';
import { ticketKey } from '../auth/token.service';
import { findOrCreateCustomer } from '../customers/customer.repo';
import { loadQueueContext } from '../queue/queue.context';
import { broadcastQueue } from '../queue/queue.service';

async function resolveBusiness(slug: string) {
  const { data } = await supabase.from('business').select('*').eq('slug', slug).eq('is_active', true).maybeSingle();
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

// The URL segment is the full number, digits only (country_code + national number
// concatenated). Match it against the derived phone_full column. We intentionally do NOT
// reuse normalizePhone(): its '+' / India-10-digit-default logic doesn't apply to a
// pre-concatenated international number and would corrupt some inputs.
async function resolveBusinessByPhone(phoneDigits: string) {
  const digits = phoneDigits.replace(/\D/g, '');
  const { data } = await supabase
    .from('business')
    .select('*')
    .eq('phone_full', digits)
    .eq('is_active', true)
    .maybeSingle();
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
  const [{ data: hours }, { data: amenities }, { data: gallery }, ctx, { data: categoryRow }] = await Promise.all([
    supabase.from('business_hour').select('*').eq('business_id', b.id).order('day_of_week'),
    supabase.from('amenity').select('*').eq('business_id', b.id).order('position'),
    supabase.from('gallery_image').select('*').eq('business_id', b.id).order('position'),
    loadQueueContext(b.id),
    supabase.from('master_data').select('team_noun').eq('type', 'business_category').eq('name', b.category ?? '').maybeSingle(),
  ]);
  const services = ctx.serviceRows;

  const { groups, waitMinutes, queueCount } = liveAvailability(ctx);

  const staffDTO = ctx.staffRows.map((s) => {
    const g = groups.find((x) => x.id === s.id);
    return {
      id: s.id,
      name: s.name,
      roleLabel: s.role_label,
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
    faqs: Array.isArray(b.faqs) ? b.faqs : [],
    category: b.category,
    teamNoun: categoryRow?.team_noun ?? null,
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
  };
}

export async function getAvailability(slug: string) {
  const b = await resolveBusiness(slug);
  const ctx = await loadQueueContext(b.id);
  const { waitMinutes, queueCount } = liveAvailability(ctx);
  return { waitMinutes, queueCount, updatedAt: new Date().toISOString() };
}

export async function getStaffAvailability(slug: string) {
  const b = await resolveBusiness(slug);
  const ctx = await loadQueueContext(b.id);
  const { groups } = liveAvailability(ctx);
  return {
    staff: ctx.staffRows.map((s) => {
      const g = groups.find((x) => x.id === s.id);
      return {
        id: s.id,
        name: s.name,
        roleLabel: s.role_label,
        busy: !!g?.serving,
        queueCount: g?.waitingCount ?? 0,
        waitMinutes: g?.clearMinutes ?? 0,
        waitLabel: g && g.clearMinutes > 0 ? `~${g.clearMinutes}m` : 'Free',
      };
    }),
  };
}

export async function getSlots(slug: string, date: string, serviceId?: string, staffId?: string) {
  const b = await resolveBusiness(slug);
  const tz = b.timezone;
  const day = dayjs.tz(date, tz);
  const { data: hours } = await supabase
    .from('business_hour')
    .select('*')
    .eq('business_id', b.id)
    .eq('day_of_week', day.day())
    .maybeSingle();
  if (!hours || hours.is_closed) return { date, slots: [] };

  let duration = env.BOOKING_SLOT_MINUTES;
  if (serviceId) {
    const { data: svc } = await supabase.from('service').select('duration_minutes').eq('id', serviceId).maybeSingle();
    if (svc) duration = svc.duration_minutes;
  }

  const open = dayjs.tz(`${date} ${hours.opens_at}`, tz);
  const close = dayjs.tz(`${date} ${hours.closes_at}`, tz);
  const step = env.BOOKING_SLOT_MINUTES;

  // Existing bookings to exclude (per staff if specified).
  let taken = new Set<string>();
  let bq = supabase
    .from('appointment')
    .select('scheduled_start_at, staff_id')
    .eq('business_id', b.id)
    .in('status', ['pending', 'confirmed'])
    .gte('scheduled_start_at', open.utc().toISOString())
    .lte('scheduled_start_at', close.utc().toISOString());
  if (staffId) bq = bq.eq('staff_id', staffId);
  const { data: booked } = await bq;
  taken = new Set((booked ?? []).map((a) => dayjs(a.scheduled_start_at).toISOString()));

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
  input: { serviceId: string; name: string; phone: string; preferredStaffId?: string },
) {
  const b = await resolveBusiness(slug);

  // Day-scoped dedup: one active ticket per phone per day. If this phone already holds a
  // live ticket today (possibly from another device/browser), return it flagged instead of
  // minting a second token. See findActiveTicketByPhone for the "active today" definition.
  const existing = await findActiveTicketByPhone(b, input.phone);
  if (existing) return { ...existing, alreadyInQueue: true };

  const ctx = await loadQueueContext(b.id);

  const { data: svc } = await supabase
    .from('service')
    .select('id, name')
    .eq('id', input.serviceId)
    .eq('business_id', b.id)
    .maybeSingle();
  if (!svc) throw Errors.notFound('Service not found');

  let staffId = input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null;
  if (staffId && !ctx.staffRows.find((s) => s.id === staffId)) staffId = null;
  if (!staffId) staffId = soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);

  const phone = normalizePhone(input.phone);
  const customerId = await findOrCreateCustomer(b.id, input.name, phone);

  const result = await callRpc<{ id: string; token: string }>('queue_add', {
    p_business_id: b.id,
    p_name: input.name,
    p_phone: phone,
    p_service_id: svc.id,
    p_staff_id: staffId,
    p_position: 'end',
    p_source: 'online',
    p_preferred_staff_id: input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null,
    p_appointment_id: null,
    p_customer_id: customerId,
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
    status: pos.status ?? 'waiting',
    staffName,
    serviceName: svc.name,
    socket: ticketSocket(b.id, result.id),
  };
}

export async function bookSlot(
  slug: string,
  input: { serviceId: string; name: string; phone: string; preferredStaffId?: string; slotStart: string },
) {
  const b = await resolveBusiness(slug);
  const { data: svc } = await supabase
    .from('service')
    .select('id, name, duration_minutes')
    .eq('id', input.serviceId)
    .eq('business_id', b.id)
    .maybeSingle();
  if (!svc) throw Errors.notFound('Service not found');

  const phone = normalizePhone(input.phone);
  const customerId = await findOrCreateCustomer(b.id, input.name, phone);
  const staffId = input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null;
  const start = new Date(input.slotStart);
  const end = new Date(start.getTime() + svc.duration_minutes * 60_000);

  const { data, error } = await supabase
    .from('appointment')
    .insert({
      business_id: b.id,
      customer_id: customerId,
      customer_name: input.name,
      customer_phone: phone,
      service_id: svc.id,
      service_name: svc.name,
      staff_id: staffId,
      scheduled_start_at: start.toISOString(),
      scheduled_end_at: end.toISOString(),
      status: 'confirmed',
      source: 'online',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  emitToOwners(b.id, 'appointment:created', {
    appointment: { id: data.id, customerName: data.customer_name, serviceName: data.service_name, scheduledStartAt: data.scheduled_start_at, status: data.status },
  });

  return {
    appointmentId: data.id,
    serviceName: svc.name,
    scheduledStartAt: data.scheduled_start_at,
    status: 'confirmed',
    staffName: staffId ? (await supabase.from('staff').select('name').eq('id', staffId).maybeSingle()).data?.name : null,
  };
}

// Build the public Ticket DTO from a queue_entry row. `withSocket` adds the /customer
// socket handshake (namespace/room/ticketKey) so a freshly tracked ticket can go live.
async function ticketDetailFromEntry(entry: any, withSocket = false) {
  const socket = withSocket ? { socket: ticketSocket(entry.business_id, entry.id) } : {};
  if (!['waiting', 'in_service'].includes(entry.status)) {
    return {
      ticketId: entry.id,
      token: entry.token,
      ahead: 0,
      waitMinutes: 0,
      status: entry.status,
      isYourTurn: entry.status === 'in_service',
      progressPct: entry.status === 'completed' || entry.status === 'in_service' ? 100 : 0,
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
    status: pos.status ?? entry.status,
    isYourTurn,
    progressPct: isYourTurn ? 100 : 0,
    ...socket,
  };
}

// The single source of truth for "does this phone hold a live ticket TODAY". Used by both
// the join dedup and the Track-my-turn lookup so the day boundary is defined in one place.
// Phone is normalized the same way joinQueue stores it, and token_day is the business-tz date.
async function findActiveTicketByPhone(business: any, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const today = dayjs().tz(business.timezone).format('YYYY-MM-DD');
  const { data: entry } = await supabase
    .from('queue_entry')
    .select('*')
    .eq('business_id', business.id)
    .eq('customer_phone', phone)
    .eq('token_day', today)
    .in('status', ['waiting', 'in_service'])
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!entry) return null;
  return ticketDetailFromEntry(entry, true);
}

export async function getTicket(ticketId: string) {
  const { data: entry } = await supabase.from('queue_entry').select('*').eq('id', ticketId).maybeSingle();
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
  const { data: cust } = await supabase
    .from('customer')
    .select('name')
    .eq('business_id', b.id)
    .eq('phone', normalizePhone(input.phone))
    .maybeSingle();
  const customerName = cust?.name ?? null;
  return ticket ? { found: true, customerName, ...ticket } : { found: false, customerName };
}

export async function leaveTicket(ticketId: string) {
  const { data: entry } = await supabase.from('queue_entry').select('business_id, status').eq('id', ticketId).maybeSingle();
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
