import { exec, many, one, transaction } from '../../db/pool';
import { env } from '../../config/env';
import { Errors } from '../../domain/errors';

function businessDTO(b: any, hours: any[], amenities: any[], gallery: any[], plan: string) {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    category: b.category,
    area: b.area,
    address: b.address,
    city: b.city,
    countryCode: b.country_code ?? null,
    phoneNumber: b.phone_number ?? null,
    tagline: b.tagline,
    description: b.description,
    establishedYear: b.established_year,
    rating: Number(b.rating ?? 0),
    reviewCount: b.review_count,
    logoUrl: b.logo_url,
    heroImageUrl: b.hero_image_url,
    timezone: b.timezone,
    currency: b.currency,
    payments: b.payments ?? [],
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

export async function updateBusiness(businessId: string, patch: Record<string, any>) {
  const map: Record<string, string> = {
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
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) if (map[k] !== undefined) row[map[k]!] = v;
  // Only the keys the caller supplied are assigned; column names come from `map`, never the request.
  const columns = Object.keys(row);
  const sets = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await exec(`update business set ${sets} where id = $${columns.length + 1}`, [
    ...Object.values(row),
    businessId,
  ]);
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
  const b = await one('select slug from business where id = $1', [businessId]);
  if (!b) throw Errors.notFound('Business not found');
  const bookingUrl = `${env.PUBLIC_WEB_URL}/${b.slug}`;
  // QR PNG generation deferred (renders client-side from bookingUrl for now).
  return { slug: b.slug, bookingUrl, qrPngUrl: null };
}
