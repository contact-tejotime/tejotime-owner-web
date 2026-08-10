import { exec, many, one, transaction } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';
import { themeColumns } from '../../domain/business-theme';

function businessDTO(b: any, hours: any[], amenities: any[], gallery: any[], plan: string) {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    isActive: Boolean(b.is_active),
    category: b.category,
    area: b.area,
    address: b.address,
    city: b.city,
    countryCode: b.country_code ?? null,
    phoneNumber: b.phone_number ?? null,
    tagline: b.tagline,
    heroSubtitle: b.hero_subtitle ?? null,
    statValue: b.stat_value ?? null,
    statLabel: b.stat_label ?? null,
    description: b.description,
    aboutHeading: b.about_heading ?? null,
    establishedYear: b.established_year,
    rating: Number(b.rating ?? 0),
    reviewCount: b.review_count,
    logoUrl: b.logo_url,
    heroImageUrl: b.hero_image_url,
    aboutImageUrl: b.about_image_url ?? null,
    // Social profile URLs. '' rather than null: the owner portal binds these straight to text
    // inputs, and null would flip React from a controlled field to an uncontrolled one.
    instagramUrl: b.instagram_url ?? '',
    facebookUrl: b.facebook_url ?? '',
    twitterUrl: b.twitter_url ?? '',
    linkedinUrl: b.linkedin_url ?? '',
    faqs: Array.isArray(b.faqs) ? b.faqs : [],
    reviews: Array.isArray(b.reviews) ? b.reviews : [],
    timezone: b.timezone,
    currency: b.currency,
    payments: b.payments ?? [],
    // Appearance, same pair the public microsite DTO carries: `theme` is the full config and
    // `themeColor` the legacy brand-only column kept as its fallback. The owner app resolves
    // these through the same engine so the app and the store's microsite match.
    theme: b.theme ?? null,
    themeColor: b.theme_color ?? null,
    plan,
    hours: hours.map((h) => ({
      dayOfWeek: h.day_of_week,
      opensAt: h.opens_at,
      closesAt: h.closes_at,
      isClosed: h.is_closed,
    })),
    amenities: amenities.map((a) => a.label),
    gallery: gallery.map((g) => ({ id: g.id, url: g.url, alt: g.alt })),
  };
}

export async function getBusiness(businessId: string) {
  const [b, hours, amenities, gallery, sub] = await Promise.all([
    one('select * from business where id = $1', [businessId]),
    many('select * from business_hour where business_id = $1 order by day_of_week', [businessId]),
    many('select * from amenity where business_id = $1 order by position', [businessId]),
    many('select * from gallery_image where business_id = $1 order by position', [businessId]),
    one('select plan from subscription where business_id = $1', [businessId]),
  ]);
  if (!b) throw Errors.notFound('Business not found');
  return businessDTO(b, hours, amenities, gallery, sub?.plan ?? 'free');
}

/**
 * Columns any caller with `profile: manage` may write.
 *
 * These are the fields the Expo app has always patched plus the rest of the plain contact and
 * description text. Nothing here changes how the store is *presented* beyond its own copy.
 */
const BASE_COLUMNS: Record<string, string> = {
  name: 'name',
  category: 'category',
  area: 'area',
  address: 'address',
  city: 'city',
  tagline: 'tagline',
  description: 'description',
  establishedYear: 'established_year',
  logoUrl: 'logo_url',
  heroImageUrl: 'hero_image_url',
  timezone: 'timezone',
};

/**
 * Columns only an OWNER or CO-OWNER may write.
 *
 * The split is about who speaks for the business in public. Hero copy, the About block, social
 * profiles and the microsite's whole appearance are the shop's public face; a staff member
 * granted `profile: manage` so they can correct an address should not thereby be able to
 * repoint the salon's Instagram or restyle its landing page.
 *
 * Enforced in `updateBusiness` rather than in the route, so no future caller can reach these
 * columns by another path.
 */
const OWNER_ONLY_COLUMNS: Record<string, string> = {
  heroSubtitle: 'hero_subtitle',
  statValue: 'stat_value',
  statLabel: 'stat_label',
  aboutHeading: 'about_heading',
  aboutImageUrl: 'about_image_url',
  instagramUrl: 'instagram_url',
  facebookUrl: 'facebook_url',
  twitterUrl: 'twitter_url',
  linkedinUrl: 'linkedin_url',
};

/** Keys handled specially rather than by a straight column map. */
const OWNER_ONLY_SPECIAL = ['payments', 'theme', 'themeColor', 'faqs', 'reviews'];

export interface UpdateBusinessOptions {
  /** True for owner / co-owner. Gates the public-face fields above. */
  isOwner: boolean;
}

export async function updateBusiness(
  businessId: string,
  patch: Record<string, any>,
  opts: UpdateBusinessOptions = { isOwner: false },
) {
  const allowed: Record<string, string> = opts.isOwner
    ? { ...BASE_COLUMNS, ...OWNER_ONLY_COLUMNS }
    : BASE_COLUMNS;

  // Refuse rather than silently drop. A save that reports success while quietly discarding half
  // the form is the worst outcome here — the owner sees "Saved" and the microsite is unchanged.
  if (!opts.isOwner) {
    const blocked = Object.keys(patch).filter(
      (k) => OWNER_ONLY_COLUMNS[k] !== undefined || OWNER_ONLY_SPECIAL.includes(k),
    );
    if (blocked.length) {
      throw Errors.forbidden('Only the business owner can change how the store is presented');
    }
  }

  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  // Fields that accept '' to mean "clear this column" (socials + images).
  const clearable = new Set([
    ...Object.keys(OWNER_ONLY_COLUMNS),
    'logoUrl',
    'heroImageUrl',
    'aboutImageUrl',
  ]);

  for (const [k, v] of Object.entries(patch)) {
    if (allowed[k] === undefined) continue;
    // '' → NULL so the microsite drops icons / photos instead of keeping a stale URL.
    row[allowed[k]!] = clearable.has(k) && v === '' ? null : v;
  }

  /*
   * `established_year` is the only non-text column in the writable set, so an empty field has
   * to become NULL before it reaches Postgres — `''` in an int column is a 22P02 and surfaces
   * as a 500.
   *
   * NOT gated on `isOwner`: the year is a BASE column, so a staff member with `profile: manage`
   * can write it, and gating the normalisation but not the write is what made clearing the
   * field crash for exactly that role.
   */
  if (allowed.establishedYear && Object.prototype.hasOwnProperty.call(patch, 'establishedYear')) {
    if (patch.establishedYear === null || patch.establishedYear === '') {
      row.established_year = null;
    }
  }

  if (opts.isOwner) {
    if (Array.isArray(patch.payments)) row.payments = patch.payments;
    // jsonb columns must be serialized explicitly, or pg sends a JS array as a Postgres
    // array literal and the update fails.
    if (Array.isArray(patch.faqs)) row.faqs = JSON.stringify(patch.faqs);
    if (Array.isArray(patch.reviews)) row.reviews = JSON.stringify(patch.reviews);

    if (patch.theme !== undefined || patch.themeColor !== undefined) {
      // Read the stored brand first — see themeColumns for why a partial save without it
      // would persist a brandless theme and reset the store to the engine default blue.
      const current = await one<{ theme_color: string | null; theme: unknown }>(
        'select theme_color, theme from business where id = $1',
        [businessId],
      );
      Object.assign(
        row,
        themeColumns(
          { theme: patch.theme, themeColor: patch.themeColor },
          { themeColor: current?.theme_color, theme: current?.theme },
        ),
      );
    }
  }

  // Only the keys the caller supplied are assigned; column names come from the maps above,
  // never from the request. `businessId` is the token's, never the client's.
  const columns = Object.keys(row);
  const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await exec(`update business set ${sets} where id = $${columns.length + 1}`, [
    ...Object.values(row),
    businessId,
  ]);
  return getBusiness(businessId);
}

/** Replace the gallery wholesale — the same shape the admin panel's image list saves. */
export async function setGallery(
  businessId: string,
  images: { url: string; alt?: string | null }[],
) {
  await transaction(async (client) => {
    await client.query('delete from gallery_image where business_id = $1', [businessId]);
    if (!images.length) return;
    const params: any[] = [];
    const tuples = images.map((img, position) => {
      const o = params.length;
      params.push(businessId, img.url, img.alt ?? null, position);
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`;
    });
    await client.query(
      `insert into gallery_image (business_id, url, alt, position) values ${tuples.join(', ')}`,
      params,
    );
  });
  return getBusiness(businessId);
}

export async function setHours(businessId: string, hours: any[]) {
  const rows = hours.map((h) => ({
    business_id: businessId,
    day_of_week: h.dayOfWeek,
    opens_at: h.isClosed ? null : h.opensAt,
    closes_at: h.isClosed ? null : h.closesAt,
    is_closed: !!h.isClosed,
  }));
  // Replace-in-place: the delete must not stand on its own if the insert fails.
  await transaction(async (client) => {
    await client.query('delete from business_hour where business_id = $1', [businessId]);
    if (!rows.length) return;
    const params: any[] = [];
    const tuples = rows.map((r) => {
      const o = params.length;
      params.push(r.business_id, r.day_of_week, r.opens_at, r.closes_at, r.is_closed);
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
    });
    await client.query(
      `insert into business_hour (business_id, day_of_week, opens_at, closes_at, is_closed)
       values ${tuples.join(', ')}`,
      params,
    );
  });
  return getBusiness(businessId);
}

export async function setAmenities(businessId: string, labels: string[]) {
  // Replace-in-place: the delete must not stand on its own if the insert fails.
  await transaction(async (client) => {
    await client.query('delete from amenity where business_id = $1', [businessId]);
    if (!labels.length) return;
    const params: any[] = [];
    const tuples = labels.map((label, position) => {
      const o = params.length;
      params.push(businessId, label, position);
      return `($${o + 1}, $${o + 2}, $${o + 3})`;
    });
    await client.query(
      `insert into amenity (business_id, label, position) values ${tuples.join(', ')}`,
      params,
    );
  });
  return getBusiness(businessId);
}

export async function getQr(businessId: string) {
  const b = await one(
    'select slug, country_code, phone_number from business where id = $1',
    [businessId],
  );
  if (!b) throw Errors.notFound('Business not found');

  // The microsite is keyed by PHONE, not slug — `/<countryCode><phoneNumber>`. This used to
  // return `${PUBLIC_WEB_URL}/${slug}`, which 404s: the web app has no `/[slug]` route, so
  // every QR built from it pointed at a dead page.
  const phoneFull = `${b.country_code ?? ''}${b.phone_number ?? ''}`;
  const bookingUrl = phoneFull ? `${env.PUBLIC_WEB_URL}/${phoneFull}` : null;
  // What a printed QR should encode: a chooser offering "book" or "save contact", rather than
  // dropping the scanner straight into either one.
  const cardUrl = phoneFull ? `${bookingUrl}/card` : null;

  // QR PNG generation deferred (renders client-side from these URLs for now).
  return { slug: b.slug, phoneFull, bookingUrl, cardUrl, qrPngUrl: null };
}
