import { exec, many, one, transaction } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { VISITOR_TYPE_CATEGORIES } from '../../config/constants';
import { computeSlots, isBookable } from '../../lib/booking-slots';
import { Errors } from '../../domain/errors';
import { servicePricing } from '../../domain/money';
import { normalizePhone } from '../../lib/phone';
import * as rec from '../../lib/recurrence';
import { dayjs } from '../../lib/time';
import { createTtlCache } from '../../lib/ttl-cache';
import { buildSeatGroups, soonestSeat, ticketPosition } from '../../lib/queue-engine';
import { emitToOwners, emitToTicket } from '../../realtime/emitters';
import { ticketKey, verifyTicketKey } from '../auth/token.service';
import { apptDTO } from '../appointments/appointments.service';
import {
  combinedServiceName,
  insertAppointmentServices,
  slotInputFor,
  visitMinutes,
  type Query,
} from '../appointments/booking.repo';
import {
  afterGeneration,
  assertNoOpenSeries,
  previewSeriesDates,
  startSeriesForBooking,
  type GenerationResult,
  type SeriesRow,
} from '../appointments/series.service';
import { customerSlotsForAppointment, rescheduleByCustomer } from '../appointments/reschedule.service';
import { findOrCreateCustomer, recordReviewSmsOptIn, recordSmsOptIn } from '../customers/customer.repo';
import { loadQueueContext } from '../queue/queue.context';
import { sendBookingConfirmation, sendCheckInConfirmation } from '../notifications/sms-dispatch';
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

// Minutes are kept ("10:00 AM", not "10 AM"). The microsite prints these back to a customer as
// the store's business hours, and a bare hour reads like an approximation next to a half-hour
// opening on the row below it.
function fmtTime(t: string | null): string {
  if (!t) return '';
  return dayjs(`2000-01-01 ${t}`, 'YYYY-MM-DD HH:mm:ss').format('h:mm A');
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Next opening in words — "today at 10:00 AM", "tomorrow at 9:30 AM", "Monday at 10:00 AM".
 *
 * Walks today through today+7 so a business open one day a week still resolves, and skips any
 * opening that has already passed (that is what makes a store closed at 8pm say
 * "tomorrow" rather than repeating this morning's time).
 */
function nextOpening(hours: any[], tz: string): string | null {
  const now = dayjs().tz(tz);
  for (let offset = 0; offset <= 7; offset += 1) {
    const d = now.add(offset, 'day');
    const row = hours.find((h) => h.day_of_week === d.day());
    if (!row || row.is_closed || !row.opens_at) continue;
    const opens = dayjs.tz(`${d.format('YYYY-MM-DD')} ${row.opens_at}`, tz);
    if (!opens.isAfter(now)) continue;
    const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : DAY_NAMES[d.day()];
    return `${when} at ${fmtTime(row.opens_at)}`;
  }
  return null;
}

/**
 * Open/closed for the microsite, plus `nextOpenLabel` so a closed page can tell the customer
 * when to come back instead of leaving a dead "Closed today" badge next to a live "Walk in now"
 * button. The microsite gates its whole walk-in call to action on `isOpen`, so the answer to
 * "closed until when?" has to travel with it.
 *
 * `hours` empty (a store that skipped the hours step) still yields isOpen:false — the microsite
 * treats "no hours configured" as "unknown, stay joinable" rather than reading this flag alone.
 *
 * Exported for the unit test: the timezone and week-wrap arithmetic is the part that breaks
 * silently, and it is pure, so it is worth pinning without a database.
 */
export function computeOpenStatus(hours: any[], tz: string) {
  const now = dayjs().tz(tz);
  const nextOpenLabel = nextOpening(hours, tz);
  const today = hours.find((h) => h.day_of_week === now.day());
  const closedLabel = nextOpenLabel ? `Closed · Opens ${nextOpenLabel}` : 'Closed today';
  if (!today || today.is_closed) {
    return { isOpen: false, closesAt: null, label: closedLabel, nextOpenLabel };
  }
  const opens = dayjs.tz(`${now.format('YYYY-MM-DD')} ${today.opens_at}`, tz);
  const closes = dayjs.tz(`${now.format('YYYY-MM-DD')} ${today.closes_at}`, tz);
  const isOpen = now.isAfter(opens) && now.isBefore(closes);
  return {
    isOpen,
    closesAt: today.closes_at,
    label: isOpen ? `Open now · till ${fmtTime(today.closes_at)}` : closedLabel,
    nextOpenLabel,
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
  // Locality is the city: the neighborhood is optional now, and a phone's contacts app expects a
  // town there, not "Downtown".
  const locality = b.city || b.area || '';
  const adr = `;;${vcardEscape(b.address ?? '')};${vcardEscape(locality)};;;`;
  const url = b.phone_full
    ? `${env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/${b.phone_full}`
    : '';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${name};;;;`,
    `FN:${name}`,
    `ORG:${name}`,
  ];
  if (tel) lines.push(`TEL;TYPE=CELL:+${tel}`);
  if (b.address || locality) lines.push(`ADR;TYPE=WORK:${adr}`);
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

/**
 * The store's Google review link, for the `www.tejotime.com/<phone>/r` short link the review SMS
 * carries (carriers filter bit.ly-style shorteners, so we shorten on our own domain). Read live on
 * every click so an owner's edit applies to texts already sent. Not part of the microsite DTO —
 * this is its only public read. Safe to redirect to: the value is owner-saved and https-only
 * (review-url.schema.ts), never taken from the request.
 */
export async function getReviewLinkByPhone(phoneDigits: string): Promise<{ url: string }> {
  const b = await resolveBusinessByPhone(phoneDigits);
  const url = typeof b.google_review_url === 'string' ? b.google_review_url.trim() : '';
  if (!url) throw Errors.notFound('No review link');
  return { url };
}

/**
 * Either key a microsite URL can carry: the slug (`/sharp-cuts`, and every follow-on call the
 * client makes) or the digits-only full phone (`/919399385943`). One query, both columns, so a
 * caller that only has what is in its address bar never has to know which kind it holds.
 */
export async function resolveBusinessByKey(key: string) {
  const k = key.trim();
  const data = await one(
    'select * from business where (slug = $1 or phone_full = $1) and is_active = true',
    [k],
  );
  if (!data) throw Errors.notFound('Business not found');
  return data;
}

export async function getMicrositeByKey(key: string) {
  const b = await resolveBusinessByKey(key);
  return buildMicrosite(b);
}

/** The public microsite payload — what the page renders and what the chatbot may speak from. */
export type MicrositeDTO = Awaited<ReturnType<typeof buildMicrosite>>;

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
    // The owner's gallery heading (0038); null = the page uses its default for this kind of store.
    galleryHeading: b.gallery_heading ?? null,
    description: b.description,
    aboutHeading: b.about_heading ?? null,
    heroImageUrl: b.hero_image_url ?? null,
    aboutImageUrl: b.about_image_url ?? null,
    logoUrl: b.logo_url ?? null,
    faqs: Array.isArray(b.faqs) ? b.faqs : [],
    category: b.category,
    area: b.area,
    // The page shows the city wherever the neighborhood ("area") is blank — area became optional
    // on 2026-10-05 (docs/store-setup-review-2026-10-05.md).
    city: b.city ?? null,
    address: b.address,
    rating: Number(b.rating ?? 0),
    reviewCount: b.review_count,
    establishedYear: b.established_year,
    openStatus: computeOpenStatus(hours ?? [], b.timezone),
    // IANA zone the slot labels and opening hours are in. The page needs it to show a booked time
    // in the STORE's clock — formatting in the viewer's zone put a Phoenix store's 9:00 AM under
    // "Evening" for a visitor in India.
    timezone: b.timezone,
    hours: (hours ?? []).map((h) => ({
      dayOfWeek: h.day_of_week,
      label: h.is_closed ? 'Closed' : `${fmtTime(h.opens_at)} – ${fmtTime(h.closes_at)}`,
      isClosed: h.is_closed,
    })),
    amenities: (amenities ?? []).map((a) => a.label),
    gallery: (gallery ?? []).map((g) => g.url),
    services: (services ?? []).map((s) => {
      const pricing = servicePricing(s, s.currency);
      return {
        id: s.id,
        name: s.name,
        durationMinutes: s.duration_minutes,
        // Fixed price, or the floor of a band — `priceType` says which, and the microsite
        // renders "₹300–₹600" / "From ₹300" from the pair. A cached response from before
        // pricing modes has no `priceType`; the client falls back to the plain amount.
        price: pricing.price,
        priceType: pricing.priceType,
        priceMax: pricing.priceMax,
      };
    }),
    staff: staffDTO,
    reviews: (Array.isArray(b.reviews) ? b.reviews : []).map((r: any) => ({
      stars: Number(r.stars) || 0,
      text: r.text,
      authorName: r.authorName,
    })),
    live: { waitMinutes, queueCount },
    payments: b.payments ?? [],
    // Only the ones actually filled in — the microsite renders whatever this contains, so an
    // entry with a null url would become an icon linking nowhere.
    socials: [
      { key: 'instagram', url: b.instagram_url },
      { key: 'facebook', url: b.facebook_url },
      { key: 'twitter', url: b.twitter_url },
      { key: 'linkedin', url: b.linkedin_url },
      { key: 'yelp', url: b.yelp_url },
    ].filter((s): s is { key: string; url: string } => !!s.url),
    currency: b.currency ?? env.DEFAULT_CURRENCY,
    themeColor: b.theme_color ?? null,
    // Full theme config (jsonb). NULL for stores provisioned before 0017 — the frontend
    // theme engine then falls back to the legacy config, seeded by themeColor.
    theme: b.theme ?? null,
    // Platform-wide flag, surfaced per payload so the page can hide the chat widget without a
    // second request — and so a cached payload from before the feature simply hides it.
    chatbotEnabled: env.CHATBOT_ENABLED,
    // The store offers "Repeat this booking?" (0036). The booking API enforces it as well.
    recurringEnabled: b.recurring_enabled !== false,
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

/**
 * The services a visit is for, in the order the customer picked them, validated against this
 * business.
 *
 * One resolver for all three entry points (slots, join, book) so they can never disagree about
 * what was selected — the slot length, the queue entry's duration and the checkout total are all
 * derived from this same list.
 *
 * `serviceId` (singular) is still accepted: it is what every already-shipped client sends. When
 * both arrive `serviceIds` wins, with the singular folded in first if it is not already present.
 */
async function resolveServices(
  businessId: string,
  input: { serviceId?: string; serviceIds?: string[] },
): Promise<{ id: string; name: string; duration_minutes: number; price_paise: number }[]> {
  const ids: string[] = [];
  for (const id of [...(input.serviceIds ?? []), ...(input.serviceId ? [input.serviceId] : [])]) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return [];

  const rows = await many<{ id: string; name: string; duration_minutes: number; price_paise: number }>(
    'select id, name, duration_minutes, price_paise from service where business_id = $1 and id = any($2::uuid[])',
    [businessId, ids],
  );
  // Any unknown id is a hard error rather than a silent drop: quietly booking a shorter, cheaper
  // visit than the one the customer chose is the failure this whole feature exists to prevent.
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw Errors.notFound('Service not found');
  // Preserve the customer's order — the first pick becomes the primary service.
  return ids.map((id) => rows.find((r) => r.id === id)!);
}

/**
 * The extras payload `queue_attach_services` takes: everything after the primary service.
 * `serviceId` lets each row remember an unpriced service's price type (0040), so the owner is
 * asked its price at checkout even though the customer did not pick it first.
 */
const extraServicesPayload = (svcs: { id: string; name: string; duration_minutes: number; price_paise: number }[]) =>
  svcs.slice(1).map((s) => ({ name: s.name, minutes: s.duration_minutes, price: s.price_paise, serviceId: s.id }));

export async function getSlots(slug: string, date: string, serviceIds?: string[], staffId?: string) {
  const b = await resolveBusiness(slug);
  const svcs = serviceIds?.length ? await resolveServices(b.id, { serviceIds }) : [];
  const input = await slotInputFor(many, b, date, visitMinutes(svcs), staffId ?? null);
  return { date, slots: computeSlots(input) };
}

function ticketSocket(businessId: string, ticketId: string) {
  return { namespace: '/customer', room: `ticket:${ticketId}`, ticketKey: ticketKey(ticketId), businessId };
}

export async function joinQueue(
  slug: string,
  input: {
    serviceId?: string;
    serviceIds?: string[];
    name: string;
    phone: string;
    preferredStaffId?: string;
    visitorType?: 'mr' | 'patient';
    smsOptIn?: boolean;
    reviewSmsOptIn?: boolean;
  },
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
  const svcs = await resolveServices(b.id, input);
  const svc = svcs[0] ?? null;

  // Only an active stylist of THIS store counts as a preference. Anything else (a deleted chair,
  // another store's id) falls back to the soonest seat — and is never passed on to queue_add,
  // where the foreign key would turn it into a 500.
  const preferred =
    input.preferredStaffId && input.preferredStaffId !== 'any' && ctx.staffRows.find((s) => s.id === input.preferredStaffId)
      ? input.preferredStaffId
      : null;
  const staffId = preferred ?? soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);

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
    p_preferred_staff_id: preferred,
    p_appointment_id: null,
    p_customer_id: customerId,
    p_visitor_type: input.visitorType ?? null,
  });

  // Services 2..n become the entry's extras: `extra_minutes` so the wait-time engine sizes the
  // visit correctly, and `queue_entry_extra` rows so checkout totals them. Done before the
  // broadcast, or owners would see the entry flash up as a bare "Haircut" first.
  const extras = extraServicesPayload(svcs);
  if (extras.length) {
    await callRpc('queue_attach_services', {
      p_business_id: b.id,
      p_entry_id: result.id,
      p_services: JSON.stringify(extras),
    });
  }

  emitToOwners(b.id, 'queue:entry.created', { entryId: result.id, seatId: staffId, source: 'online' });

  // The place is final now; the broadcast below only emits, so this is also what the customer is
  // shown. Read before the broadcast because the wait at join must be stored first (see below).
  const fresh = await loadQueueContext(b.id);
  const pos = ticketPosition(result.id, fresh.engineEntries, fresh.engineStaff, fresh.engineServices);

  // Consent flags after the RPC on purpose — do not add a parameter to queue_add (overload trap).
  // A ticked box gets the check-in texts (docs/sms-opt-in-a2p.md): the confirmation below, and the
  // "starts in 15 minutes" text later — but only for a join with more than 15 minutes to wait,
  // which is why `join_wait_minutes` (0041) is stored here, before this join's own broadcast runs
  // the one-shot 15-minute claim. An unticked box leaves it null: no wait-based text, ever.
  const smsOptIn = input.smsOptIn === true;
  const reviewSmsOptIn = input.reviewSmsOptIn === true;
  if (smsOptIn || reviewSmsOptIn) {
    await exec(
      `update queue_entry set sms_opt_in = $3, review_sms_opt_in = $4, join_wait_minutes = $5
        where id = $1 and business_id = $2`,
      [result.id, b.id, smsOptIn, reviewSmsOptIn, smsOptIn ? pos.waitMinutes : null],
    );
    if (customerId && smsOptIn) await recordSmsOptIn(b.id, customerId);
    if (customerId && reviewSmsOptIn) await recordReviewSmsOptIn(b.id, customerId);
  }
  await broadcastQueue(b.id);
  // After the broadcast, like bookSlot: a Twilio hiccup must never fail a check-in already made.
  // A repeat check-in from the same number returned early above, so it is never texted twice.
  if (smsOptIn) await sendCheckInConfirmation(b.id, result.id, pos.waitMinutes).catch(() => undefined);

  const staffName = ctx.staffRows.find((s) => s.id === staffId)?.name ?? null;

  return {
    ticketId: result.id,
    token: result.token,
    ahead: pos.ahead,
    waitMinutes: pos.waitMinutes,
    serviceRemainingMinutes: pos.serviceRemainingMinutes,
    status: pos.status ?? 'waiting',
    staffName,
    serviceName: combinedServiceName(svcs),
    asOf: new Date().toISOString(),
    socket: ticketSocket(b.id, result.id),
  };
}

export async function bookSlot(
  slug: string,
  input: {
    serviceId?: string;
    serviceIds?: string[];
    name: string;
    phone: string;
    preferredStaffId?: string;
    slotStart: string;
    visitorType?: 'mr' | 'patient';
    smsOptIn?: boolean;
    reviewSmsOptIn?: boolean;
    /** Make this the first visit of a recurring series (docs/recurring-appointments.md). */
    repeat?: RepeatInput;
  },
) {
  const b = await resolveBusiness(slug);
  if (VISITOR_TYPE_CATEGORIES.has(b.category) && !input.visitorType) {
    throw Errors.validation('Visitor type is required', [{ field: 'visitorType', message: 'Pick MR or Patient' }]);
  }
  const svcs = await resolveServices(b.id, input);
  const svc = svcs[0] ?? null;

  const phone = normalizePhone(input.phone);
  const staffId = input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null;
  const start = new Date(input.slotStart);
  // The booking blocks out ALL the chosen services, not just the first — the same length the slot
  // list sized the hole with.
  const durationMinutes = visitMinutes(svcs);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const date = dayjs(start).tz(b.timezone).format('YYYY-MM-DD');

  const smsOptIn = input.smsOptIn === true;
  const reviewSmsOptIn = input.reviewSmsOptIn === true;
  const now = new Date();
  const rule = input.repeat ? repeatRule(b, input.repeat, date, now) : null;
  // A series is found again — for the one-per-phone rule and the owner's call-back — by its phone.
  if (rule && !phone) {
    throw Errors.validation('Enter a valid phone number', [{ field: 'phone', message: 'Invalid phone number' }]);
  }
  const seriesPhone = phone ?? '';

  // Check-then-insert under a per-store lock, so two customers confirming the same time cannot
  // both pass the check (QA reproduced exactly that: two "You're booked!" for one slot). The
  // `appt:` namespace keeps this lock from contending with the queue functions' own; the
  // recurring-series job takes the same lock, so a series date and a booking never collide.
  const { data, customerId, staffName, series } = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${b.id}`]);

    // Before anything is written: a refused series must not leave its first visit booked.
    if (rule) await assertNoOpenSeries(q, b.id, seriesPhone);

    const slot = await slotInputFor(q, b, date, durationMinutes, staffId);
    if (staffId && !slot.activeStaffIds.includes(staffId)) {
      throw Errors.validation('Pick a team member from this store', [{ field: 'preferredStaffId', message: 'Unknown team member' }]);
    }
    // The same rule the slot list uses, recomputed inside the lock: rejects a taken or overlapping
    // time, the past, a closed day, outside opening hours, off the 30-minute grid, and beyond the
    // booking window — none of which the endpoint used to check.
    if (!isBookable(slot, start.toISOString())) {
      throw Errors.conflict('SLOT_UNAVAILABLE', 'That time is no longer available. Please pick another time.');
    }

    // Only now, so a rejected booking does not leave an orphan customer row behind.
    const customerId = await findOrCreateCustomer(b.id, input.name, phone);
    const [row] = await q(
      `insert into appointment
         (business_id, customer_id, customer_name, customer_phone, service_id, service_name,
          staff_id, scheduled_start_at, scheduled_end_at, status, source, visitor_type, sms_opt_in,
          review_sms_opt_in)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', 'online', $10, $11, $12)
       returning *`,
      [
        b.id,
        customerId,
        input.name,
        phone,
        svc?.id ?? null,
        combinedServiceName(svcs),
        staffId,
        start.toISOString(),
        end.toISOString(),
        input.visitorType ?? null,
        smsOptIn,
        reviewSmsOptIn,
      ],
    );
    if (!row) throw new Error('Failed to create appointment');

    await insertAppointmentServices(q, row.id, svcs);
    // Scoped to this store: an id from another business must never surface its stylist's name.
    const staffName = staffId
      ? ((await q('select name from staff where id = $1 and business_id = $2', [staffId, b.id]))[0]?.name ?? null)
      : null;

    // Same transaction, same lock: either the whole series exists or none of it does.
    const series = rule
      ? await startSeriesForBooking(
          q,
          b,
          row.id,
          {
            customerId,
            customerName: input.name,
            customerPhone: seriesPhone,
            staffId,
            visitorType: input.visitorType ?? null,
            startTime: rec.storeTime(start, b.timezone),
            rule,
            smsOptIn,
            reviewSmsOptIn,
            source: 'online',
            services: svcs,
          },
          now,
        )
      : null;
    return { data: row, customerId, staffName, series };
  });

  if (smsOptIn && customerId) await recordSmsOptIn(b.id, customerId);
  if (reviewSmsOptIn && customerId) await recordReviewSmsOptIn(b.id, customerId);

  emitToOwners(b.id, 'appointment:created', {
    appointment: { id: data.id, customerName: data.customer_name, serviceName: data.service_name, scheduledStartAt: data.scheduled_start_at, status: data.status },
  });
  // Message 1. After the rows are written (the body reads them back), and never able to fail a
  // booking the customer has already been told succeeded. For a series this is the ONLY text at
  // booking time — the other visits booked just now are on the customer's screen.
  if (smsOptIn) await sendBookingConfirmation(b.id, data.id).catch(() => undefined);
  if (series) await afterGeneration(b.id, series.series.id, series.gen, { confirm: false });

  return {
    appointmentId: data.id,
    serviceName: combinedServiceName(svcs),
    scheduledStartAt: data.scheduled_start_at,
    status: 'confirmed',
    staffName,
    // Held by the browser that booked; it is what lets that device (and only that device) read or
    // cancel this appointment later. See appointmentKey() below.
    appointmentKey: appointmentKey(data.id),
    ...(series ? { series: bookedSeries(data, series.series, series.gen) } : {}),
  };
}

// ---- Recurring series (docs/recurring-appointments.md) ----

export interface RepeatInput {
  everyDays: number;
  end: rec.SeriesEnd;
}

/** The rule a booking asks for, refused here (400) before anything is written. */
function repeatRule(b: any, repeat: RepeatInput, anchorDate: string, now: Date): rec.SeriesRule {
  // Enforced by the API, not just hidden on the page: an older microsite bundle still offers it.
  if (b.recurring_enabled === false) {
    throw Errors.conflict('RECURRING_DISABLED', "This store doesn't take repeating bookings. Book a single visit instead.");
  }
  const rule: rec.SeriesRule = { anchorDate, everyDays: repeat.everyDays, end: repeat.end };
  const problem = rec.ruleProblem(rule, rec.storeToday(now, b.timezone));
  if (problem) throw Errors.validation(problem, [{ field: 'repeat', message: problem }]);
  return rule;
}

/**
 * The series half of the booking response. `manageToken` is the customer's way back in: the page
 * shows it as a link, and the confirmation SMS carries the same link — there is no login. Each
 * visit booked now also gets its own appointmentKey, so this browser's "my bookings" list can
 * cancel them like any other booking.
 */
function bookedSeries(first: any, s: SeriesRow, gen: GenerationResult) {
  const visits = [first, ...gen.created];
  return {
    seriesId: s.id,
    manageToken: s.manage_token,
    everyDays: s.interval_days,
    startTime: s.start_time,
    status: s.status,
    visits: visits.map((v) => ({
      appointmentId: v.id,
      scheduledStartAt: v.scheduled_start_at,
      appointmentKey: appointmentKey(v.id),
    })),
    // Dates inside the first three weeks that could not be booked (closed day, time taken) —
    // shown on the confirmation so nobody turns up for a visit that doesn't exist.
    skipped: gen.skipped.filter((x) => x.reason !== 'past'),
  };
}

/**
 * What a repeat rule would book, before the customer confirms: the first few dates, each judged
 * the way the booking will judge it. Read-only.
 */
export async function previewSeries(
  slug: string,
  input: { serviceId?: string; serviceIds?: string[]; preferredStaffId?: string; slotStart: string; repeat: RepeatInput },
) {
  const b = await resolveBusiness(slug);
  const svcs = await resolveServices(b.id, input);
  const start = new Date(input.slotStart);
  const now = new Date();
  const rule = repeatRule(b, input.repeat, rec.storeDate(start, b.timezone), now);
  const staffId = input.preferredStaffId && input.preferredStaffId !== 'any' ? input.preferredStaffId : null;
  return previewSeriesDates(b, {
    rule,
    startTime: rec.storeTime(start, b.timezone),
    staffId,
    durationMin: visitMinutes(svcs),
    now,
  });
}

// ---- Appointment self-service (store chat + microsite "My appointments") ----
//
// Read, move and cancel need the appointment's HMAC key; a repeating booking needs its manage
// token. The booking response hands both to the booking browser.
//
// CLIENT DECISION, 2026-10-05 (docs/customer-my-appointments.md): the phone number alone is
// enough. Customers lost the link and had no way back from another phone, so the phone lookup now
// returns the same key and token. This reverses the earlier rule "a phone alone never cancels". The
// accepted risk: anyone who knows a customer's number can move or cancel their bookings, and no
// text says so.
//
// What still holds:
//  - the lookup stays on publicWrite (20/hour per network);
//  - it takes only a full +<country code> number;
//  - it hands out keys only for bookings the customer can still change (keys can't be revoked);
//  - it returns nothing else about the customer;
//  - the waitlist (/track) is unchanged and still never returns a ticket key.

/**
 * The same HMAC as ticketKey, over a domain-separated input: without the `appt:` prefix an
 * appointment id's key would also verify as a ticket key for the same UUID (and vice versa).
 */
export function appointmentKey(appointmentId: string): string {
  return ticketKey(`appt:${appointmentId}`);
}

/** A booking the customer can still move or cancel: not checked in, not cancelled, not started. */
function changeable(a: any, now: Date = new Date()): boolean {
  return ['pending', 'confirmed'].includes(a.status) && new Date(a.scheduled_start_at).getTime() > now.getTime();
}

/**
 * The public view of a booking. Deliberately minimal: no customer name, phone, visitor type or
 * notes. A Hospital's "MR or patient" must never reach a stranger who typed someone's number.
 */
function publicAppointment(a: any) {
  return {
    appointmentId: a.id,
    serviceName: a.service_name ?? null,
    staffId: a.staff_id ?? null,
    staffName: a.staff_name ?? null,
    scheduledStartAt: a.scheduled_start_at,
    status: a.status,
    // Part of a recurring series — the page marks it with the repeat icon.
    repeats: !!a.series_id,
    seriesId: a.series_id ?? null,
    // The customer moved it — shown as "Moved".
    rescheduledAt: a.rescheduled_at ?? null,
    canChange: changeable(a),
  };
}

/**
 * Loads an appointment only for a caller holding its key. A missing row and a wrong key are the
 * same 404 on purpose: a distinct 403 would confirm that a guessed UUID exists.
 */
async function appointmentForKey(appointmentId: string, key: string | undefined) {
  if (!key || !verifyTicketKey(`appt:${appointmentId}`, key)) throw Errors.notFound('Appointment not found');
  const a = await one(
    `select a.*, s.name as staff_name
       from appointment a
       left join staff s on s.id = a.staff_id
      where a.id = $1`,
    [appointmentId],
  );
  if (!a) throw Errors.notFound('Appointment not found');
  return a;
}

/**
 * "My appointments": a phone's upcoming bookings at one store, today (store timezone) onward,
 * soonest first. It also returns the credentials that manage them (see the section comment).
 *
 * - **Appointments:** each one the customer can still change carries its key. One from earlier
 *   today is listed but gets no key, because there is nothing left to do with it.
 * - **Series:** the phone's active or paused repeating booking carries its manage token. A
 *   cancelled or ended one is left out.
 *
 * Twenty rows is plenty. A phone has at most one open series per store (assertNoOpenSeries), and
 * that series has only a few visits inside the horizon.
 */
export async function lookupAppointments(slug: string, input: { phone: string }) {
  const b = await resolveBusiness(slug);
  const phone = normalizePhone(input.phone);
  const startOfToday = dayjs().tz(b.timezone).startOf('day').toISOString();
  const [rows, series] = await Promise.all([
    many(
      `select a.*, s.name as staff_name
         from appointment a
         left join staff s on s.id = a.staff_id
        where a.business_id = $1
          and a.customer_phone = $2
          and a.status in ('pending', 'confirmed')
          and a.scheduled_start_at >= $3
        order by a.scheduled_start_at
        limit 20`,
      [b.id, phone, startOfToday],
    ),
    many(
      `select id, manage_token, status
         from appointment_series
        where business_id = $1
          and customer_phone = $2
          and status in ('active', 'paused')
        order by created_at desc`,
      [b.id, phone],
    ),
  ]);
  return {
    appointments: rows.map((a) => {
      const dto = publicAppointment(a);
      return dto.canChange ? { ...dto, appointmentKey: appointmentKey(a.id) } : dto;
    }),
    series: series.map((s) => ({ seriesId: s.id, manageToken: s.manage_token, status: s.status })),
  };
}

export async function getPublicAppointment(appointmentId: string, key: string | undefined) {
  return publicAppointment(await appointmentForKey(appointmentId, key));
}

/** Times the customer could move this booking to on `date` (today … today+20). */
export async function publicAppointmentSlots(
  appointmentId: string,
  key: string | undefined,
  query: { date: string; staffId?: string },
) {
  return customerSlotsForAppointment(await appointmentForKey(appointmentId, key), query);
}

/** The customer moves their booking — the key is the whole authorization (see the section comment). */
export async function reschedulePublicAppointment(
  appointmentId: string,
  input: { key: string; slotStart: string; staffId?: string },
) {
  const a = await appointmentForKey(appointmentId, input.key);
  await rescheduleByCustomer(a.business_id, a.id, { slotStart: input.slotStart, staffId: input.staffId });
  // Read it back through the same query as GET, so the stylist's name comes with it.
  return getPublicAppointment(appointmentId, input.key);
}

export async function cancelPublicAppointment(appointmentId: string, key: string) {
  const a = await appointmentForKey(appointmentId, key);
  // One conditional statement, so a check-in (or owner cancel) racing this request cannot be
  // overwritten: only a still-bookable, still-future appointment flips to cancelled. A customer
  // cancelling one visit of their series is skipping it — the rest of the series carries on.
  const data = await one(
    `update appointment set status = 'cancelled', updated_at = now(),
            cancel_reason = case when series_id is not null then 'skipped' else cancel_reason end
      where id = $1 and status in ('pending', 'confirmed') and scheduled_start_at > now()
      returning *`,
    [appointmentId],
  );
  if (!data) {
    throw Errors.invalidState(
      a.status === 'cancelled'
        ? 'This appointment is already cancelled'
        : "This appointment can't be cancelled any more",
    );
  }
  emitToOwners(data.business_id, 'appointment:updated', { appointment: apptDTO(data) });
  return publicAppointment({ ...data, staff_name: a.staff_name });
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
//
// Returned WITHOUT the ticket key. Both callers are answered to anyone who types a phone number,
// and the key is what authorises leaving the queue and joining the live ticket room — handing it
// out here is how QA removed a stranger from the waitlist knowing only their number. The browser
// that actually joined already holds the key from its own join response.
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
  return ticketDetailFromEntry(entry, false);
}

export async function getTicket(ticketId: string) {
  const entry = await one('select * from queue_entry where id = $1', [ticketId]);
  if (!entry) throw Errors.notFound('Ticket not found');
  return ticketDetailFromEntry(entry);
}

// Track my turn: look up the active ticket for today by phone, so a customer on another
// browser/device can SEE their place. Nothing verifies that the caller owns the number (there is
// no OTP), so the answer carries position only — no customer name and no ticket key. Leaving the
// queue needs the key, which only the browser that joined holds.
export async function trackByPhone(slug: string, input: { phone: string }) {
  const b = await resolveBusiness(slug);
  const ticket = await findActiveTicketByPhone(b, input.phone);
  return ticket ? { found: true, ...ticket } : { found: false };
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

/**
 * Leave the queue — only for the holder of the ticket key (the browser that joined). A missing or
 * wrong key is the same 404 as an unknown ticket, so ids cannot be probed. Before this check,
 * anyone who looked a number up could cancel that person's place (QA, 30 Sep 2026).
 */
export async function leaveTicket(ticketId: string, key: string | undefined) {
  if (!key || !verifyTicketKey(ticketId, key)) throw Errors.notFound('Ticket not found');
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
