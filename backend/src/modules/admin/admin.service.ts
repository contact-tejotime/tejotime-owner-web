import bcrypt from 'bcryptjs';
import { supabase } from '../../db/supabase';
import { callRpc } from '../../db/rpc';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { money } from '../../domain/money';
import { signAdminToken } from '../auth/token.service';

/**
 * Provisioning + management API for the admin panel — a parameterized version of db/seed.ts.
 * This is the single "create/edit a business" path (owner-facing routes only edit an existing
 * business piecemeal). Reached via the admin-JWT–gated /api/v1/admin/* routes.
 */

/** The store fields shared by create and update (everything except the owner login). */
export interface StoreFields {
  name: string;
  category?: string;
  area?: string;
  address?: string;
  city?: string;
  tagline?: string;
  heroSubtitle?: string;
  statValue?: string;
  statLabel?: string;
  description?: string;
  aboutHeading?: string;
  heroImageUrl?: string;
  aboutImageUrl?: string;
  establishedYear?: number;
  rating?: number;
  reviewCount?: number;
  payments?: string[];
  timezone?: string;
  /** ISO 4217 code (e.g. 'INR', 'USD'). Omitted → keeps existing / env default. */
  currency?: string;
  /** Edit only — create always starts active. When false the public microsite 404s. */
  isActive?: boolean;
  countryCode: string;
  phoneNumber: string;
  hours: { dayOfWeek: number; opensAt?: string | null; closesAt?: string | null; isClosed: boolean }[];
  amenities: string[];
  gallery: { url: string; alt?: string | null }[];
  services: { name: string; durationMinutes: number; priceRupees: number }[];
  staff: { name: string; roleLabel?: string | null; avatarUrl?: string | null }[];
  faqs?: { q: string; a: string }[];
  reviews?: { stars: number; text: string; authorName: string }[];
}

export interface CreateBusinessInput extends StoreFields {
  owner: { password: string; phone?: string };
}
export type UpdateBusinessInput = StoreFields;

/** "Sharp Cuts" → "sharp-cuts" (letters/digits, single dashes, trimmed). */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'store'
  );
}

/** Return a value for a unique text column that isn't already taken (base, base-2, base-3, …). */
async function uniqueValue(column: 'slug' | 'handle', base: string): Promise<string> {
  const table = column === 'slug' ? 'business' : 'app_user';
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const { data } = await supabase.from(table).select('id').eq(column, candidate).maybeSingle();
    if (!data) return candidate;
  }
  // Extremely unlikely; keep the flow deterministic rather than throwing.
  return `${base}-${Date.now()}`;
}

/** Columns on the `business` row itself, derived from the shared store fields. */
function businessColumns(input: StoreFields) {
  return {
    name: input.name,
    category: input.category ?? null,
    area: input.area ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    tagline: input.tagline ?? null,
    hero_subtitle: input.heroSubtitle ?? null,
    stat_value: input.statValue ?? null,
    stat_label: input.statLabel ?? null,
    description: input.description ?? null,
    about_heading: input.aboutHeading ?? null,
    hero_image_url: input.heroImageUrl ?? null,
    about_image_url: input.aboutImageUrl ?? null,
    established_year: input.establishedYear ?? null,
    rating: input.rating ?? 0,
    review_count: input.reviewCount ?? 0,
    payments: input.payments && input.payments.length ? input.payments : ['UPI', 'Card', 'Cash'],
    faqs: input.faqs ?? [],
    reviews: input.reviews ?? [],
  };
}

/** Insert all child rows (hours, amenities, gallery, services, staff) for a business. */
async function insertChildren(bid: string, input: StoreFields, currency: string) {
  if (input.hours.length) {
    const rows = input.hours.map((h) => ({
      business_id: bid,
      day_of_week: h.dayOfWeek,
      opens_at: h.isClosed ? null : h.opensAt || null,
      closes_at: h.isClosed ? null : h.closesAt || null,
      is_closed: h.isClosed,
    }));
    const { error } = await supabase.from('business_hour').insert(rows);
    if (error) throw new Error(error.message);
  }

  if (input.amenities.length) {
    const rows = input.amenities.map((label, position) => ({ business_id: bid, label, position }));
    const { error } = await supabase.from('amenity').insert(rows);
    if (error) throw new Error(error.message);
  }

  if (input.gallery.length) {
    const rows = input.gallery.map((g, position) => ({ business_id: bid, url: g.url, alt: g.alt ?? null, position }));
    const { error } = await supabase.from('gallery_image').insert(rows);
    if (error) throw new Error(error.message);
  }

  // Money stored as integer minor units (major × 100), matching domain/money.ts.
  // Service rows carry the business currency so owner-app DTOs stay consistent.
  const serviceRows = input.services.map((s, position) => ({
    business_id: bid,
    name: s.name,
    duration_minutes: s.durationMinutes,
    price_paise: Math.round(s.priceRupees * 100),
    currency,
    position,
  }));
  const { error: svcErr } = await supabase.from('service').insert(serviceRows);
  if (svcErr) throw new Error(svcErr.message);

  const staffRows = input.staff.map((s, position) => ({
    business_id: bid,
    name: s.name,
    role_label: s.roleLabel ?? null,
    avatar_url: s.avatarUrl ?? null,
    position,
  }));
  const { error: staffErr } = await supabase.from('staff').insert(staffRows);
  if (staffErr) throw new Error(staffErr.message);
}

/** Ensure a phone_full isn't already used by a *different* business (409 otherwise). */
async function assertPhoneFree(phoneFull: string, exceptId?: string) {
  let q = supabase.from('business').select('id').eq('phone_full', phoneFull);
  if (exceptId) q = q.neq('id', exceptId);
  const { data } = await q.maybeSingle();
  if (data) throw Errors.conflict('PHONE_IN_USE', `A store already uses the number ${phoneFull}`);
}

export async function createBusiness(input: CreateBusinessInput) {
  const countryCode = input.countryCode.replace(/\D/g, '');
  const phoneNumber = input.phoneNumber.replace(/\D/g, '');
  const phoneFull = countryCode + phoneNumber;

  await assertPhoneFree(phoneFull);
  const slug = await uniqueValue('slug', slugify(input.name));
  const currency = input.currency ?? env.DEFAULT_CURRENCY;

  const { data: business, error: bizErr } = await supabase
    .from('business')
    .insert({
      slug,
      country_code: countryCode,
      phone_number: phoneNumber,
      timezone: input.timezone || env.DEFAULT_TIMEZONE,
      currency,
      token_prefix: 'A',
      is_active: true,
      ...businessColumns(input),
    })
    .select()
    .single();
  if (bizErr || !business) throw new Error(bizErr?.message ?? 'Failed to create business');
  const bid = business.id as string;

  try {
    // Subscription (parity with the seed: free plan, trialing).
    const { error } = await supabase.from('subscription').insert({ business_id: bid, plan: 'free', status: 'trialing' });
    if (error) throw new Error(error.message);

    // Owner login — phone (digits-only full number) + password, so the store is usable in the
    // mobile app. Same hashing as db/seed.ts (bcrypt over password + PASSWORD_PEPPER).
    const ownerPhone = (input.owner.phone ?? phoneFull).replace(/\D/g, '');
    const handle = await uniqueValue('handle', slug);
    const passwordHash = await bcrypt.hash(input.owner.password + env.PASSWORD_PEPPER, 10);
    const { error: userErr } = await supabase.from('app_user').insert({
      business_id: bid,
      handle,
      phone: ownerPhone,
      name: `${input.name} Owner`,
      role: 'owner',
      password_hash: passwordHash,
    });
    if (userErr) throw new Error(userErr.message);

    await insertChildren(bid, input, currency);
  } catch (err) {
    // No cross-table transaction over PostgREST — roll back manually so a partial failure
    // doesn't leave a half-provisioned store. The FK cascade removes all children.
    await supabase.from('business').delete().eq('id', bid);
    throw err;
  }

  return { id: bid, slug, phoneFull, micrositePath: `/${phoneFull}` };
}

export async function updateBusiness(id: string, input: UpdateBusinessInput) {
  const { data: existing } = await supabase.from('business').select('id, currency').eq('id', id).maybeSingle();
  if (!existing) throw Errors.notFound('Store not found');

  const countryCode = input.countryCode.replace(/\D/g, '');
  const phoneNumber = input.phoneNumber.replace(/\D/g, '');
  const phoneFull = countryCode + phoneNumber;
  await assertPhoneFree(phoneFull, id);

  // Payloads that omit currency keep the store's existing one (never reset to the default).
  const currency = input.currency ?? existing.currency ?? env.DEFAULT_CURRENCY;

  // Update the business row itself. Slug + owner login are intentionally left untouched.
  const { error: upErr } = await supabase
    .from('business')
    .update({
      country_code: countryCode,
      phone_number: phoneNumber,
      timezone: input.timezone || env.DEFAULT_TIMEZONE,
      updated_at: new Date().toISOString(),
      // Deactivating hides the public microsite (public routes filter is_active = true).
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      ...(input.currency !== undefined ? { currency } : {}),
      ...businessColumns(input),
    })
    .eq('id', id);
  if (upErr) throw new Error(upErr.message);

  // Replace all children (delete-then-insert, mirroring the owner setHours/setAmenities pattern).
  await Promise.all([
    supabase.from('business_hour').delete().eq('business_id', id),
    supabase.from('amenity').delete().eq('business_id', id),
    supabase.from('gallery_image').delete().eq('business_id', id),
    supabase.from('service').delete().eq('business_id', id),
    supabase.from('staff').delete().eq('business_id', id),
  ]);
  await insertChildren(id, input, currency);

  return { id, phoneFull, micrositePath: `/${phoneFull}` };
}

// ---------------------------------------------------------------------------
// Admin-panel login (mobile + OTP).
//
// The admin panel is gated by a mobile + OTP login. The `admins` table is a
// simple allow-list of mobile numbers (digits-only, incl. country code). OTP is
// a DEMO for now — any known admin logs in with the code below. When the real
// SMS OTP API lands, replace the demo checks here with the existing
// otp_verification table + smsSender (backend/src/integrations/sms.ts), gated on
// env.OTP_ENABLED. Everything OTP-related is intentionally confined to this file
// so the swap never touches the admin-panel UI or its session.
// ---------------------------------------------------------------------------

/** Demo OTP accepted for every admin until the real OTP API is wired up. */
const DEMO_ADMIN_OTP = '1234';

/** Is this digits-only mobile in the admins allow-list? */
export async function isKnownAdmin(mobile: string): Promise<boolean> {
  const { data } = await supabase.from('admins').select('mobile').eq('mobile', mobile).maybeSingle();
  return Boolean(data);
}

/**
 * Step 1 of admin login: the panel submits a mobile number. We verify it's a
 * known admin, then (in the real impl) generate + SMS an OTP. For the demo we
 * just acknowledge — the code is always DEMO_ADMIN_OTP.
 */
export async function requestAdminOtp(rawMobile: string) {
  const mobile = rawMobile.replace(/\D/g, '');
  if (!(await isKnownAdmin(mobile))) throw Errors.unauthenticated('Not a registered admin');
  // TODO(real-otp): when OTP_ENABLED, generate a code, store a hash in
  // otp_verification (purpose 'owner_login'/a new admin purpose) and smsSender.send().
  return { ok: true };
}

/**
 * Step 2 of admin login: verify the submitted OTP for a known admin. On success mints an
 * admin JWT (12h) that the admin panel stores and sends as `Authorization: Bearer` on every
 * backend call — replacing the old x-admin-key shared secret.
 */
export async function verifyAdminOtp(rawMobile: string, otp: string) {
  const mobile = rawMobile.replace(/\D/g, '');
  if (!(await isKnownAdmin(mobile))) throw Errors.unauthenticated('Not a registered admin');
  // TODO(real-otp): when OTP_ENABLED, verify `otp` against otp_verification
  // (check expiry/attempts, mark consumed) instead of the demo constant.
  if (otp !== DEMO_ADMIN_OTP) throw Errors.invalidCredentials('Incorrect OTP');
  return { ok: true, mobile, token: signAdminToken(mobile) };
}

export async function listLookups(type: string) {
  const { data } = await supabase
    .from('master_data')
    .select('id, name')
    .eq('type', type)
    .eq('is_active', true)
    .order('position');
  return { data: (data ?? []).map((r) => ({ id: r.id, name: r.name })) };
}

export async function listBusinesses(withMetrics = false) {
  const [{ data }, metricRows, subscriptionRows] = await Promise.all([
    supabase
      .from('business')
      .select('id, name, slug, category, city, country_code, phone_number, is_active, currency, created_at')
      .order('created_at', { ascending: false }),
    withMetrics ? callRpc<any[]>('admin_store_metrics', {}) : Promise.resolve(null),
    withMetrics
      ? supabase.from('subscription').select('business_id, status').then((r) => r.data)
      : Promise.resolve(null),
  ]);

  // admin_store_metrics has no row for the demo store; missing entries fall back to zeros.
  const metricsById = new Map((metricRows ?? []).map((m) => [m.business_id, m]));
  const subscriptionStatusById = new Map((subscriptionRows ?? []).map((s) => [s.business_id, s.status]));

  return {
    data: (data ?? []).map((b) => {
      const base = {
        id: b.id,
        name: b.name,
        slug: b.slug,
        category: b.category,
        city: b.city ?? null,
        phoneFull: `${b.country_code ?? ''}${b.phone_number ?? ''}`,
        isActive: b.is_active,
        createdAt: b.created_at,
      };
      if (!withMetrics) return base;
      const m = metricsById.get(b.id);
      return {
        ...base,
        customersCount: Number(m?.customers_count ?? 0),
        visits30d: Number(m?.visits_30d ?? 0),
        revenue30d: money(Number(m?.revenue_30d_paise ?? 0), b.currency ?? env.DEFAULT_CURRENCY),
        plan: (m?.plan ?? 'free') as 'free' | 'premium',
        subscriptionStatus: (subscriptionStatusById.get(b.id) ?? 'trialing') as
          | 'trialing'
          | 'active'
          | 'past_due'
          | 'canceled',
        lastActivityAt: m?.last_activity_at ?? null,
      };
    }),
  };
}

/** Full store detail shaped for the edit form (inverse of businessColumns / insertChildren). */
export async function getBusinessDetail(id: string) {
  const { data: b } = await supabase.from('business').select('*').eq('id', id).maybeSingle();
  if (!b) throw Errors.notFound('Store not found');

  const [{ data: hours }, { data: amenities }, { data: gallery }, { data: services }, { data: staff }] =
    await Promise.all([
      supabase.from('business_hour').select('*').eq('business_id', id).order('day_of_week'),
      supabase.from('amenity').select('*').eq('business_id', id).order('position'),
      supabase.from('gallery_image').select('*').eq('business_id', id).order('position'),
      supabase.from('service').select('*').eq('business_id', id).eq('is_active', true).order('position'),
      supabase.from('staff').select('*').eq('business_id', id).eq('is_active', true).order('position'),
    ]);

  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    isActive: b.is_active,
    category: b.category ?? '',
    area: b.area ?? '',
    address: b.address ?? '',
    city: b.city ?? '',
    tagline: b.tagline ?? '',
    heroSubtitle: b.hero_subtitle ?? '',
    statValue: b.stat_value ?? '',
    statLabel: b.stat_label ?? '',
    description: b.description ?? '',
    aboutHeading: b.about_heading ?? '',
    heroImageUrl: b.hero_image_url ?? '',
    aboutImageUrl: b.about_image_url ?? '',
    establishedYear: b.established_year != null ? String(b.established_year) : '',
    rating: b.rating != null ? String(b.rating) : '',
    reviewCount: b.review_count != null ? String(b.review_count) : '',
    payments: (b.payments ?? []).join(', '),
    currency: b.currency ?? 'INR',
    countryCode: b.country_code ?? '',
    phoneNumber: b.phone_number ?? '',
    phoneFull: `${b.country_code ?? ''}${b.phone_number ?? ''}`,
    hours: (hours ?? []).map((h) => ({
      dayOfWeek: h.day_of_week,
      opensAt: hhmm(h.opens_at),
      closesAt: hhmm(h.closes_at),
      isClosed: h.is_closed,
    })),
    amenities: (amenities ?? []).map((a) => a.label),
    gallery: (gallery ?? []).map((g) => ({ url: g.url, alt: g.alt ?? '' })),
    services: (services ?? []).map((s) => ({
      name: s.name,
      durationMinutes: s.duration_minutes,
      priceRupees: s.price_paise / 100,
    })),
    staff: (staff ?? []).map((s) => ({
      name: s.name,
      roleLabel: s.role_label ?? '',
      avatarUrl: s.avatar_url ?? '',
    })),
    faqs: (Array.isArray(b.faqs) ? b.faqs : []) as { q: string; a: string }[],
    reviews: (Array.isArray(b.reviews) ? b.reviews : []) as { stars: number; text: string; authorName: string }[],
  };
}
