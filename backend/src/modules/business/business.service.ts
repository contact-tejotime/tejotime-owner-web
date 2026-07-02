import { supabase } from '../../db/supabase';
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
  const [{ data: b }, { data: hours }, { data: amenities }, { data: gallery }, { data: sub }] =
    await Promise.all([
      supabase.from('business').select('*').eq('id', businessId).maybeSingle(),
      supabase.from('business_hour').select('*').eq('business_id', businessId).order('day_of_week'),
      supabase.from('amenity').select('*').eq('business_id', businessId).order('position'),
      supabase.from('gallery_image').select('*').eq('business_id', businessId).order('position'),
      supabase.from('subscription').select('plan').eq('business_id', businessId).maybeSingle(),
    ]);
  if (!b) throw Errors.notFound('Business not found');
  return businessDTO(b, hours ?? [], amenities ?? [], gallery ?? [], sub?.plan ?? 'free');
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
  const { error } = await supabase.from('business').update(row).eq('id', businessId);
  if (error) throw new Error(error.message);
  return getBusiness(businessId);
}

export async function setHours(businessId: string, hours: any[]) {
  await supabase.from('business_hour').delete().eq('business_id', businessId);
  const rows = hours.map((h) => ({
    business_id: businessId,
    day_of_week: h.dayOfWeek,
    opens_at: h.isClosed ? null : h.opensAt,
    closes_at: h.isClosed ? null : h.closesAt,
    is_closed: !!h.isClosed,
  }));
  if (rows.length) {
    const { error } = await supabase.from('business_hour').insert(rows);
    if (error) throw new Error(error.message);
  }
  return getBusiness(businessId);
}

export async function setAmenities(businessId: string, labels: string[]) {
  await supabase.from('amenity').delete().eq('business_id', businessId);
  if (labels.length) {
    await supabase
      .from('amenity')
      .insert(labels.map((label, position) => ({ business_id: businessId, label, position })));
  }
  return getBusiness(businessId);
}

export async function getQr(businessId: string) {
  const { data: b } = await supabase.from('business').select('slug').eq('id', businessId).maybeSingle();
  if (!b) throw Errors.notFound('Business not found');
  const bookingUrl = `${env.PUBLIC_WEB_URL}/${b.slug}`;
  // QR PNG generation deferred (renders client-side from bookingUrl for now).
  return { slug: b.slug, bookingUrl, qrPngUrl: null };
}
