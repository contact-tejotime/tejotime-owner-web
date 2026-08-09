import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { many, one, transaction } from '../../db/pool';
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

/**
 * Microsite theme config as stored in `business.theme` (jsonb).
 *
 * The id unions are mirrored from the frontend theme engine rather than imported: the
 * backend is Docker-built with `COPY . .` from backend/, so frontend/ is not in its build
 * context. Keep in sync with frontend/src/theme/engine (and the zod schema in admin.routes).
 * Every field is optional — the engine fills gaps from the preset's own defaults.
 */
export interface ThemeConfigInput {
  preset?: 'minimal' | 'luxury' | 'modern' | 'bold' | 'medical' | 'warm';
  mode?: 'light' | 'dark' | 'auto';
  /** `#RRGGBB` brand seed. Dual-written to the legacy `theme_color` column. */
  brand?: string;
  radius?: 'sharp' | 'medium' | 'rounded';
  shadow?: 'none' | 'soft' | 'premium';
  density?: 'comfortable' | 'compact';
  animation?: 'subtle' | 'normal' | 'rich';
  heroVariant?: string;
  /** Optional `#RRGGBB` override of the preset accent strategy. */
  accent?: string;
  /** Primary / on-brand label ink. Absent or `auto` → engine picks for WCAG AA. */
  brandInk?: 'auto' | 'white' | 'dark';
}

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
  logoUrl?: string;
  establishedYear?: number;
  rating?: number;
  reviewCount?: number;
  payments?: string[];
  timezone?: string;
  /** ISO 4217 code (e.g. 'INR', 'USD'). Omitted → keeps existing / env default. */
  currency?: string;
  /** Per-store brand/accent hex (#RRGGBB) for the customer microsite. */
  themeColor?: string;
  /** Full microsite theme config. Omitted → whatever is stored is preserved. */
  theme?: ThemeConfigInput;
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

/**
 * Build the `($1, $2), ($3, $4)` placeholder list for a multi-row insert, pushing
 * each value onto `params` as it goes (Array.push returns the new length, which is
 * exactly the 1-based placeholder index).
 */
function bulkValues(rows: unknown[][], params: unknown[]): string {
  return rows.map((row) => `(${row.map((v) => `$${params.push(v)}`).join(', ')})`).join(', ');
}

/** Return a value for a unique text column that isn't already taken (base, base-2, base-3, …). */
async function uniqueValue(column: 'slug' | 'handle', base: string): Promise<string> {
  // `column` and `table` are both from a closed set — never caller-supplied.
  const table = column === 'slug' ? 'business' : 'app_user';
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const row = await one(`select id from ${table} where ${column} = $1`, [candidate]);
    if (!row) return candidate;
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
    logo_url: input.logoUrl ?? null,
    established_year: input.establishedYear ?? null,
    rating: input.rating ?? 0,
    review_count: input.reviewCount ?? 0,
    payments: input.payments && input.payments.length ? input.payments : ['UPI', 'Card', 'Cash'],
    // faqs/reviews are jsonb — serialize explicitly, otherwise pg would send a
    // JS array as a Postgres array literal and the insert would fail.
    faqs: JSON.stringify(input.faqs ?? []),
    reviews: JSON.stringify(input.reviews ?? []),
  };
}

/**
 * Theme columns, write-if-present. Unlike the rest of businessColumns these are spread
 * conditionally (same guarded pattern as currency / is_active): a payload that omits
 * `themeColor` or `theme` must PRESERVE what is stored, never null it out.
 *
 * `theme.brand` and `theme_color` are dual-written in both directions so the legacy
 * column stays a valid fallback for one release.
 *
 * `storedBrand` is the row's current `theme_color` (updates only). Without it a partial save
 * that carries a theme object but neither `theme.brand` nor `themeColor` would persist a
 * BRANDLESS theme jsonb — and since the stored theme wins over `theme_color` at render time,
 * the store's brand would silently fall back to the engine default blue.
 */
function themeColumns(input: StoreFields, storedBrand?: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // A brand hex inside the theme object wins; otherwise the legacy field, then the stored one.
  const brand = (input.theme?.brand ?? input.themeColor ?? storedBrand ?? undefined)?.toUpperCase();

  if (brand !== undefined) out.theme_color = brand;
  if (input.theme !== undefined) {
    out.theme = JSON.stringify(brand !== undefined ? { ...input.theme, brand } : input.theme);
  }
  return out;
}

/** Insert all child rows (hours, amenities, gallery, services, staff) for a business. */
async function insertChildren(client: PoolClient, bid: string, input: StoreFields, currency: string) {
  if (input.hours.length) {
    const params: unknown[] = [];
    const values = bulkValues(
      input.hours.map((h) => [
        bid,
        h.dayOfWeek,
        h.isClosed ? null : h.opensAt || null,
        h.isClosed ? null : h.closesAt || null,
        h.isClosed,
      ]),
      params,
    );
    await client.query(
      `insert into business_hour (business_id, day_of_week, opens_at, closes_at, is_closed) values ${values}`,
      params,
    );
  }

  if (input.amenities.length) {
    const params: unknown[] = [];
    const values = bulkValues(
      input.amenities.map((label, position) => [bid, label, position]),
      params,
    );
    await client.query(`insert into amenity (business_id, label, position) values ${values}`, params);
  }

  if (input.gallery.length) {
    const params: unknown[] = [];
    const values = bulkValues(
      input.gallery.map((g, position) => [bid, g.url, g.alt ?? null, position]),
      params,
    );
    await client.query(`insert into gallery_image (business_id, url, alt, position) values ${values}`, params);
  }

  // Money stored as integer minor units (major × 100), matching domain/money.ts.
  // Service rows carry the business currency so owner-app DTOs stay consistent.
  if (input.services.length) {
    const params: unknown[] = [];
    const values = bulkValues(
      input.services.map((s, position) => [
        bid,
        s.name,
        s.durationMinutes,
        Math.round(s.priceRupees * 100),
        currency,
        position,
      ]),
      params,
    );
    await client.query(
      `insert into service (business_id, name, duration_minutes, price_paise, currency, position) values ${values}`,
      params,
    );
  }

  if (input.staff.length) {
    const params: unknown[] = [];
    const values = bulkValues(
      input.staff.map((s, position) => [bid, s.name, s.roleLabel ?? null, s.avatarUrl ?? null, position]),
      params,
    );
    await client.query(
      `insert into staff (business_id, name, role_label, avatar_url, position) values ${values}`,
      params,
    );
  }
}

/** Ensure a phone_full isn't already used by a *different* business (409 otherwise). */
async function assertPhoneFree(phoneFull: string, exceptId?: string) {
  const params: unknown[] = [phoneFull];
  let exclusion = '';
  if (exceptId) {
    params.push(exceptId);
    exclusion = ` and id <> $${params.length}`;
  }
  const row = await one(`select id from business where phone_full = $1${exclusion}`, params);
  if (row) throw Errors.conflict('PHONE_IN_USE', `A store already uses the number ${phoneFull}`);
}

export async function createBusiness(input: CreateBusinessInput) {
  const countryCode = input.countryCode.replace(/\D/g, '');
  const phoneNumber = input.phoneNumber.replace(/\D/g, '');
  const phoneFull = countryCode + phoneNumber;

  await assertPhoneFree(phoneFull);
  const slug = await uniqueValue('slug', slugify(input.name));
  const currency = input.currency ?? env.DEFAULT_CURRENCY;

  // Owner login — phone (digits-only full number) + password, so the store is usable in the
  // mobile app. Same hashing as db/seed.ts (bcrypt over password + PASSWORD_PEPPER).
  const ownerPhone = (input.owner.phone ?? phoneFull).replace(/\D/g, '');
  const handle = await uniqueValue('handle', slug);
  const passwordHash = await bcrypt.hash(input.owner.password + env.PASSWORD_PEPPER, 10);

  // One transaction for the whole store, so a partial failure can never leave a
  // half-provisioned business behind.
  const bid = await transaction(async (client) => {
    const row = {
      slug,
      country_code: countryCode,
      phone_number: phoneNumber,
      timezone: input.timezone || env.DEFAULT_TIMEZONE,
      currency,
      token_prefix: 'A',
      is_active: true,
      ...businessColumns(input),
      ...themeColumns(input),
    };
    const cols = Object.keys(row);
    const { rows } = await client.query(
      `insert into business (${cols.join(', ')})
       values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       returning id`,
      cols.map((c) => (row as Record<string, unknown>)[c]),
    );
    const id = rows[0].id as string;

    // Subscription (parity with the seed: free plan, trialing).
    await client.query(`insert into subscription (business_id, plan, status) values ($1, 'free', 'trialing')`, [id]);

    await client.query(
      `insert into app_user (business_id, handle, phone, name, role, password_hash)
       values ($1, $2, $3, $4, 'owner', $5)`,
      [id, handle, ownerPhone, `${input.name} Owner`, passwordHash],
    );

    await insertChildren(client, id, input, currency);
    return id;
  });

  return { id: bid, slug, phoneFull, micrositePath: `/${phoneFull}` };
}

export async function updateBusiness(id: string, input: UpdateBusinessInput) {
  const existing = await one('select id, currency, theme_color from business where id = $1', [id]);
  if (!existing) throw Errors.notFound('Store not found');

  const countryCode = input.countryCode.replace(/\D/g, '');
  const phoneNumber = input.phoneNumber.replace(/\D/g, '');
  const phoneFull = countryCode + phoneNumber;
  await assertPhoneFree(phoneFull, id);

  // Payloads that omit currency keep the store's existing one (never reset to the default).
  const currency = input.currency ?? existing.currency ?? env.DEFAULT_CURRENCY;

  // Update the business row itself. Slug + owner login are intentionally left untouched.
  const row = {
    country_code: countryCode,
    phone_number: phoneNumber,
    timezone: input.timezone || env.DEFAULT_TIMEZONE,
    updated_at: new Date().toISOString(),
    // Deactivating hides the public microsite (public routes filter is_active = true).
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.currency !== undefined ? { currency } : {}),
    ...businessColumns(input),
    // Omitted theme fields keep their stored value (see themeColumns). The row's current
    // theme_color is the last-resort brand so a brandless theme object can never orphan it.
    ...themeColumns(input, existing.theme_color as string | null),
  };
  const cols = Object.keys(row);

  // The row update and the child replacement share one transaction: the children are
  // deleted before being re-inserted, so a failure partway through would otherwise
  // strip a live store of its hours, services and staff.
  await transaction(async (client) => {
    await client.query(
      `update business set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} where id = $${cols.length + 1}`,
      [...cols.map((c) => (row as Record<string, unknown>)[c]), id],
    );

    // Replace all children (delete-then-insert, mirroring the owner setHours/setAmenities pattern).
    for (const table of ['business_hour', 'amenity', 'gallery_image', 'service', 'staff']) {
      await client.query(`delete from ${table} where business_id = $1`, [id]);
    }
    await insertChildren(client, id, input, currency);
  });

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
  const row = await one('select mobile from admins where mobile = $1', [mobile]);
  return Boolean(row);
}

/**
 * Admin-panel login: a known-admin mobile plus a password verified against the
 * bcrypt hash stored on the `admins` row and peppered with PASSWORD_PEPPER —
 * identical to owner login (auth.service.ts). Mints the admin JWT the panel
 * sends as `Authorization: Bearer` on every backend call.
 */
export async function loginAdmin(rawMobile: string, password: string) {
  const mobile = rawMobile.replace(/\D/g, '');
  const admin = await one('select mobile, password_hash from admins where mobile = $1', [mobile]);
  if (!admin) throw Errors.unauthenticated('Not a registered admin');
  if (!admin.password_hash) throw Errors.invalidCredentials('Incorrect password');
  const ok = await bcrypt.compare(password + env.PASSWORD_PEPPER, admin.password_hash);
  if (!ok) throw Errors.invalidCredentials('Incorrect password');
  return { ok: true, mobile, token: signAdminToken(mobile) };
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
  const rows = await many('select id, name from master_data where type = $1 and is_active = true order by position', [
    type,
  ]);
  return { data: rows.map((r) => ({ id: r.id, name: r.name })) };
}

export async function listBusinesses(withMetrics = false) {
  const [data, metricRows, subscriptionRows] = await Promise.all([
    many(
      `select id, name, slug, category, city, country_code, phone_number, is_active, currency, created_at
         from business
        order by created_at desc`,
    ),
    withMetrics ? callRpc<any[]>('admin_store_metrics', {}) : Promise.resolve(null),
    withMetrics ? many('select business_id, status from subscription') : Promise.resolve(null),
  ]);

  // admin_store_metrics has no row for the demo store; missing entries fall back to zeros.
  const metricsById = new Map((metricRows ?? []).map((m) => [m.business_id, m]));
  const subscriptionStatusById = new Map((subscriptionRows ?? []).map((s) => [s.business_id, s.status]));

  return {
    data: data.map((b) => {
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
  const b = await one('select * from business where id = $1', [id]);
  if (!b) throw Errors.notFound('Store not found');

  const [hours, amenities, gallery, services, staff] = await Promise.all([
    many('select * from business_hour where business_id = $1 order by day_of_week', [id]),
    many('select * from amenity where business_id = $1 order by position', [id]),
    many('select * from gallery_image where business_id = $1 order by position', [id]),
    many('select * from service where business_id = $1 and is_active = true order by position', [id]),
    many('select * from staff where business_id = $1 and is_active = true order by position', [id]),
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
    logoUrl: b.logo_url ?? '',
    establishedYear: b.established_year != null ? String(b.established_year) : '',
    // numeric(2,1) arrives as a string ('4.0') — normalize so the edit form shows '4'.
    rating: b.rating != null ? String(Number(b.rating)) : '',
    reviewCount: b.review_count != null ? String(b.review_count) : '',
    payments: (b.payments ?? []).join(', '),
    currency: b.currency ?? 'INR',
    themeColor: b.theme_color ?? '',
    theme: (b.theme ?? null) as ThemeConfigInput | null,
    countryCode: b.country_code ?? '',
    phoneNumber: b.phone_number ?? '',
    phoneFull: `${b.country_code ?? ''}${b.phone_number ?? ''}`,
    hours: hours.map((h) => ({
      dayOfWeek: h.day_of_week,
      opensAt: hhmm(h.opens_at),
      closesAt: hhmm(h.closes_at),
      isClosed: h.is_closed,
    })),
    amenities: amenities.map((a) => a.label),
    gallery: gallery.map((g) => ({ url: g.url, alt: g.alt ?? '' })),
    services: services.map((s) => ({
      name: s.name,
      durationMinutes: s.duration_minutes,
      priceRupees: s.price_paise / 100,
    })),
    staff: staff.map((s) => ({
      name: s.name,
      roleLabel: s.role_label ?? '',
      avatarUrl: s.avatar_url ?? '',
    })),
    faqs: (Array.isArray(b.faqs) ? b.faqs : []) as { q: string; a: string }[],
    reviews: (Array.isArray(b.reviews) ? b.reviews : []) as { stars: number; text: string; authorName: string }[],
  };
}
