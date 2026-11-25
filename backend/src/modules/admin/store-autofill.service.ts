import { logger } from '../../config/logger';
import { AppError } from '../../domain/errors';
import { amenitiesFromGoogle, mergeAmenities, suggestAmenities } from '../../lib/amenities';
import {
  amenitySuggestionsFor,
  categoryForPreset,
  categoryWordFor,
  containsForbiddenClaim,
  type Faq,
  presetFor,
  staffRoleFor,
  starterServices,
  templateCopy,
} from '../../lib/category-content';
import { extractPage } from '../../lib/html-extract';
import { safeFetchBuffer, safeFetchText, isSafeFetchError } from '../../lib/safe-fetch';
import { consumeDailyLookup, googlePlaces, type PlaceCandidate, type PlaceDetails } from '../../integrations/google-places';
import { storeExtractor } from '../../integrations/store-extract';
import { storeCopyWriter } from '../../integrations/store-copy';
import { IMAGE_MIME_EXT, uploadBuffer } from '../../integrations/storage';
import { listLookups } from './admin.service';
import {
  type ImportedFields,
  type ImportedHour,
  type StoreImportResult,
  LIMITS,
  num,
  sanitizeExtraction,
  text,
} from './store-import.service';

/**
 * "Autofill a store from a business NAME" (docs/store-autofill-from-name.md). The admin types a
 * business name + area; this finds it on Google Places (New), maps the result to the Create-a-store
 * form, reads the business's own website for the things Places has no honest answer for (services,
 * team, FAQs), writes category-fitting copy with the LLM (template fallback), and copies the Place
 * photos into our bucket. Like the link importer, it WRITES NOTHING — every value reaches a store
 * only through the admin's review + Save, re-validated by storeFieldsSchema.
 *
 * Two steps on purpose: `searchStoresByName` is one cheap Text Search; `fillStoreFromPlace` is the
 * expensive one (a billed Place Details call, photo downloads, a website fetch, an LLM call), so we
 * pay it only for the place the admin actually picks, and the daily cost guard gates it.
 */

const PHOTO_MAX_WIDTH = 1600;
/** Hero + about + up to 4 gallery. Each photo is a billed Place Photo call plus a download. */
const MAX_PHOTOS = 6;
const MAX_REVIEWS = 6;

function disabled(): never {
  throw new AppError(503, 'AUTOFILL_DISABLED', 'Autofill from a business name is not enabled on this server');
}

export async function searchStoresByName(query: string, regionCode?: string): Promise<{ candidates: PlaceCandidate[] }> {
  if (!googlePlaces.configured) disabled();
  const candidates = await googlePlaces.searchText(query, { regionCode });
  return { candidates };
}

// ---------------------------------------------------------------------------
// Pure mapping — Google details → the Google-derived part of the form. Exported and unit-tested
// (store-autofill-map.test.ts) with realistic Google JSON. No I/O, no LLM, no photos.
// ---------------------------------------------------------------------------

/** The ISO 3166 alpha-2 country from addressComponents (shortText of the `country` component). */
export function countryOf(details: PlaceDetails): string | undefined {
  const c = (details.addressComponents ?? []).find((x) => (x.types ?? []).includes('country'));
  return c?.shortText?.toUpperCase();
}

function componentLong(details: PlaceDetails, type: string): string | undefined {
  const c = (details.addressComponents ?? []).find((x) => (x.types ?? []).includes(type));
  return c?.longText;
}

/**
 * Split Google's `internationalPhoneNumber` ("+91 98765 43210", "+1 650-555-1234") into a dial code
 * and national number. Google always puts a space after the country code, so that split is reliable
 * across markets — unlike the link importer's `parsePhone`, which is India-first and rejects +1.
 * Falls back to the store's country for the two markets we serve, then gives up (the admin types it).
 */
export function splitInternationalPhone(raw: unknown, country?: string): { countryCode: string; phoneNumber: string } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = /^\+(\d{1,4})[\s-]+(.+)$/.exec(trimmed);
  if (m) {
    const national = m[2]!.replace(/\D/g, '');
    if (national.length >= 6 && national.length <= 14) return { countryCode: m[1]!, phoneNumber: national };
  }
  // No space (unusual): derive the dial code from the known country for the markets we support.
  const digits = trimmed.replace(/\D/g, '');
  const cc = country === 'IN' ? '91' : country === 'US' || country === 'CA' ? '1' : null;
  if (cc && digits.startsWith(cc)) {
    const national = digits.slice(cc.length);
    if (national.length >= 6 && national.length <= 14) return { countryCode: cc, phoneNumber: national };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toHHMM = (hour?: number, minute?: number) => `${pad((hour ?? 0) % 24)}:${pad(minute ?? 0)}`;

/**
 * Google opening periods → the form's 7-day table. Day 0 = Sunday. A `minute` Google omits is :00;
 * a day with no period is Closed; an open period with no close is treated as all-day (00:00–23:59)
 * with a warning; a split shift (two periods on one day) collapses to earliest-open/latest-close
 * with a warning. Returns [] when the place has no hours, so the form's defaults stay untouched.
 */
export function mapHours(details: PlaceDetails, warnings: string[]): ImportedHour[] {
  const periods = details.regularOpeningHours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return [];

  const byDay = new Map<number, { opens: string[]; closes: string[] }>();
  let allDay = false;
  for (const p of periods) {
    const day = p.open?.day;
    if (typeof day !== 'number' || day < 0 || day > 6) continue;
    const slot = byDay.get(day) ?? { opens: [], closes: [] };
    slot.opens.push(toHHMM(p.open?.hour, p.open?.minute));
    if (p.close && typeof p.close.hour === 'number') slot.closes.push(toHHMM(p.close.hour, p.close.minute));
    else allDay = true; // open with no close ⇒ open 24h for this day
    byDay.set(day, slot);
  }
  if (allDay) warnings.push('This place lists 24-hour or overnight opening — shown as 00:00–23:59; adjust it if needed.');

  let split = false;
  const hours: ImportedHour[] = [];
  for (let day = 0; day < 7; day++) {
    const slot = byDay.get(day);
    if (!slot || slot.opens.length === 0) {
      hours.push({ dayOfWeek: day, opensAt: null, closesAt: null, isClosed: true });
      continue;
    }
    if (slot.opens.length > 1) split = true;
    const opensAt = slot.opens.slice().sort()[0]!;
    const closesAt = slot.closes.length ? slot.closes.slice().sort().at(-1)! : '23:59';
    hours.push({ dayOfWeek: day, opensAt, closesAt, isClosed: false });
  }
  if (split) warnings.push('Some days have more than one opening period — shown as the earliest open to the latest close.');
  return hours;
}

/** The deterministic, Google-derived fields. Pure — no network, no LLM, no photos. */
export function mapPlaceToFields(details: PlaceDetails, warnings: string[]): ImportedFields {
  const f: ImportedFields = {};
  const country = countryOf(details);

  const name = text(details.displayName?.text, LIMITS.name);
  if (name) f.name = name;

  const address = text(details.formattedAddress, LIMITS.address);
  if (address) f.address = address;

  const city = text(componentLong(details, 'locality'), LIMITS.city);
  if (city) f.city = city;

  const area = text(componentLong(details, 'neighborhood') ?? componentLong(details, 'sublocality_level_1'), LIMITS.area);
  if (area) f.area = area;

  const phone = splitInternationalPhone(details.internationalPhoneNumber ?? details.nationalPhoneNumber, country);
  if (phone) {
    f.countryCode = phone.countryCode;
    f.phoneNumber = phone.phoneNumber;
  } else if (details.internationalPhoneNumber || details.nationalPhoneNumber) {
    warnings.push("We couldn't read the phone number automatically — add it by hand.");
  }

  const rating = num(details.rating);
  if (rating !== null && rating > 0 && rating <= 5) f.rating = Math.round(rating * 10) / 10;
  const count = num(details.userRatingCount);
  if (count !== null && count >= 0) f.reviewCount = Math.round(count);

  const reviewUrl = details.googleMapsLinks?.writeAReviewUri;
  if (typeof reviewUrl === 'string' && /^https:\/\//i.test(reviewUrl) && reviewUrl.length <= 500) f.googleReviewUrl = reviewUrl;

  const hours = mapHours(details, warnings);
  if (hours.length) f.hours = hours;

  // Amenities, source A: Google's own flags (only those it reports TRUE), in canonical names.
  const amenities = amenitiesFromGoogle(details);
  if (amenities.length) f.amenities = amenities;

  return f;
}

function mapReviews(details: PlaceDetails): ImportedFields['reviews'] {
  const out: NonNullable<ImportedFields['reviews']> = [];
  for (const r of details.reviews ?? []) {
    const body = text(r.text?.text ?? r.originalText?.text, LIMITS.faqA);
    if (!body) continue;
    const stars = Math.min(5, Math.max(1, Math.round(num(r.rating) ?? 0)));
    if (stars < 1) continue;
    out.push({ stars, text: body, authorName: text(r.authorAttribution?.displayName, LIMITS.name) ?? 'Google review' });
    if (out.length >= MAX_REVIEWS) break;
  }
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Photos — copy into our own bucket (never hot-link Google), returning stable /media URLs.
// ---------------------------------------------------------------------------

const normalizeImageType = (contentType: string): string | null => {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return base in IMAGE_MIME_EXT ? base : null;
};

async function copyOnePhoto(
  photo: NonNullable<PlaceDetails['photos']>[number],
  assetType: 'hero' | 'about' | 'gallery',
): Promise<{ url: string; alt: string } | null> {
  try {
    const mediaUri = await googlePlaces.photoMediaUri(photo.name, PHOTO_MAX_WIDTH);
    if (!mediaUri) return null;
    const res = await safeFetchBuffer(mediaUri);
    const type = normalizeImageType(res.contentType);
    if (!type) return null;
    const { publicUrl } = await uploadBuffer(type, `admin/${assetType}`, res.body);
    // Google's terms ask that photo attributions be shown; we have no dedicated surface yet, so the
    // author credit rides in the alt text (and the review dialog warns). See the doc's ToS note.
    const credit = photo.authorAttributions?.map((a) => a.displayName).filter(Boolean).join(', ');
    return { url: publicUrl, alt: credit ? `Photo: ${credit}` : '' };
  } catch (err) {
    logger.warn({ err }, 'copying a google place photo failed');
    return null;
  }
}

async function copyPhotos(details: PlaceDetails, warnings: string[]): Promise<Partial<ImportedFields>> {
  const photos = (details.photos ?? []).slice(0, MAX_PHOTOS);
  if (photos.length === 0) return {};
  const slots: Array<'hero' | 'about' | 'gallery'> = photos.map((_, i) => (i === 0 ? 'hero' : i === 1 ? 'about' : 'gallery'));
  const results = await Promise.all(photos.map((p, i) => copyOnePhoto(p, slots[i]!)));

  const out: Partial<ImportedFields> = {};
  const gallery: Array<{ url: string; alt?: string }> = [];
  results.forEach((r, i) => {
    if (!r) return;
    if (i === 0) out.heroImageUrl = r.url;
    else if (i === 1) out.aboutImageUrl = r.url;
    else gallery.push({ url: r.url, alt: r.alt || undefined });
  });
  if (gallery.length) out.gallery = gallery;
  if (results.some((r) => !r)) warnings.push('Some photos could not be downloaded — add any missing ones by hand.');
  return out;
}

// ---------------------------------------------------------------------------
// Website read (optional) — reuse the link importer's stack for what Places lacks.
// ---------------------------------------------------------------------------

const SOCIAL_FIELDS = ['instagramUrl', 'facebookUrl', 'twitterUrl', 'linkedinUrl', 'yelpUrl'] as const;

/** A real website, not a social profile (reading an Instagram/Facebook page yields almost nothing). */
function isOwnWebsite(url: string | undefined): url is string {
  if (!url) return false;
  return !/(instagram|facebook|fb\.com|twitter|x\.com|linkedin|yelp|maps\.google|goo\.gl)/i.test(url);
}

async function readWebsite(
  websiteUri: string | undefined,
  warnings: string[],
): Promise<{ fields: Partial<ImportedFields>; description?: string }> {
  if (!isOwnWebsite(websiteUri)) return { fields: {} };
  try {
    const page = await safeFetchText(websiteUri);
    const facts = extractPage(page.body);
    const categories = (await listLookups('business_category')).data.map((c) => c.name);
    const raw = await storeExtractor.extract({ pageUrl: page.finalUrl, facts, categories });
    const { fields, warnings: w } = sanitizeExtraction(raw, facts, categories);
    for (const warn of w) warnings.push(warn);
    // Take ONLY what Google has no honest answer for. Google wins for name/address/city/area/phone/hours.
    const picked: Partial<ImportedFields> = {};
    if (fields.services) picked.services = fields.services;
    if (fields.staff) picked.staff = fields.staff;
    if (fields.faqs) picked.faqs = fields.faqs;
    if (fields.amenities) picked.amenities = fields.amenities;
    if (fields.payments) picked.payments = fields.payments;
    if (fields.establishedYear) picked.establishedYear = fields.establishedYear;
    for (const key of SOCIAL_FIELDS) if (fields[key]) picked[key] = fields[key];
    return { fields: picked, description: fields.description };
  } catch (err) {
    if (!isSafeFetchError(err)) logger.warn({ err }, 'website read during name autofill failed');
    warnings.push('We could not read the business website, so services and team were not filled in.');
    return { fields: {} };
  }
}

// ---------------------------------------------------------------------------
// LLM copy — validate/clamp the model's output; reject (→ template) on a forbidden claim.
// ---------------------------------------------------------------------------

interface Copy {
  headline: string;
  heroSubtitle: string;
  aboutHeading: string;
  description: string;
  faqs: Faq[];
}

function clampFaqs(v: unknown): Faq[] {
  const out: Faq[] = [];
  for (const row of Array.isArray(v) ? v : []) {
    if (!row || typeof row !== 'object') continue;
    const q = text((row as any).q, LIMITS.faqQ);
    const a = text((row as any).a, LIMITS.faqA);
    if (q && a) out.push({ q, a });
    if (out.length >= LIMITS.faqs) break;
  }
  return out;
}

function validateCopy(raw: unknown): Copy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const headline = text(r.headline, LIMITS.tagline);
  const description = text(r.description, LIMITS.description);
  if (!headline || !description) return null;
  const copy: Copy = {
    headline,
    heroSubtitle: text(r.heroSubtitle, LIMITS.heroSubtitle) ?? '',
    aboutHeading: text(r.aboutHeading, LIMITS.aboutHeading) ?? '',
    description,
    faqs: clampFaqs(r.faqs),
  };
  // The real backstop against the model advertising a feature we don't have: reject the whole thing
  // and use the compliant template instead. (The prompt forbids it too; this never trusts that.)
  const blob = [copy.headline, copy.heroSubtitle, copy.aboutHeading, copy.description, ...copy.faqs.flatMap((f) => [f.q, f.a])].join('\n');
  if (containsForbiddenClaim(blob)) return null;
  return copy;
}

function mergeFaqs(primary: Faq[], extra: Faq[] | undefined): Faq[] {
  const have = new Set(primary.map((f) => f.q.trim().toLowerCase()));
  const out = [...primary];
  for (const f of extra ?? []) {
    if (out.length >= LIMITS.faqs) break;
    if (!have.has(f.q.trim().toLowerCase())) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------

export async function fillStoreFromPlace(placeId: string): Promise<StoreImportResult> {
  if (!googlePlaces.configured) disabled();
  if (!consumeDailyLookup()) {
    throw new AppError(503, 'AUTOFILL_DAILY_LIMIT_REACHED', 'The daily limit for autofill lookups has been reached. Please try again tomorrow.');
  }

  const details = await googlePlaces.placeDetails(placeId);
  if (!details) throw new AppError(422, 'PLACE_NOT_FOUND', "We couldn't load that place from Google. Try another match.");

  const warnings: string[] = [];
  const base = mapPlaceToFields(details, warnings);
  const name = base.name ?? text(details.displayName?.text, LIMITS.name) ?? '';
  const country = countryOf(details);
  // US/Canada both take "US-style" wording (line/salon/"book ahead"); everyone else is India-style.
  const isUs = country === 'US' || country === 'CA';
  const preset = presetFor(details.types, name, country);

  // Website (best-effort) — services, team, FAQs, amenities, payments, year, socials.
  const web = await readWebsite(details.websiteUri, warnings);
  const siteDescription = web.description ?? text(details.editorialSummary?.text, LIMITS.description);

  // Copy — the LLM, validated and compliance-checked, else the deterministic template.
  const ctx = { name, city: base.city, area: base.area, isUsStore: isUs };
  let copy: Copy | null = null;
  if (preset) {
    const template = templateCopy(preset, ctx);
    const raw = await storeCopyWriter.write({
      preset,
      name,
      city: base.city,
      area: base.area,
      isUsStore: isUs,
      categoryWord: categoryWordFor(preset, isUs),
      siteDescription,
      template,
    });
    copy = validateCopy(raw) ?? { ...template };
  }

  // Photos — copied into our bucket.
  const photos = await copyPhotos(details, warnings);

  // Services: the website's, else the preset's starter list (prices left "unset", durations real).
  let services = web.fields.services;
  if ((!services || services.length === 0) && preset) {
    services = starterServices(preset).map((s) => ({
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceRupees: 0,
      priceType: 'unset' as const,
      priceMaxRupees: null,
    }));
    warnings.push('Services are starter suggestions for this kind of business — check them and add prices before saving.');
  }

  // Team: default an empty role to the preset's (e.g. "Barber").
  const staff = (web.fields.staff ?? []).map((s) => ({
    name: s.name,
    roleLabel: s.roleLabel || (preset ? staffRoleFor(preset, isUs) : ''),
  }));

  const reviews = mapReviews(details);

  const fields: ImportedFields = {
    ...base,
    ...photos,
  };
  if (preset) {
    const category = categoryForPreset(preset);
    if (category) fields.category = category;
  }
  if (copy) {
    fields.tagline = copy.headline;
    if (copy.heroSubtitle) fields.heroSubtitle = copy.heroSubtitle;
    if (copy.aboutHeading) fields.aboutHeading = copy.aboutHeading;
    fields.description = copy.description;
    const faqs = mergeFaqs(copy.faqs, web.fields.faqs as Faq[] | undefined);
    if (faqs.length) fields.faqs = faqs;
  } else if (web.fields.faqs) {
    fields.faqs = web.fields.faqs as Faq[];
  }
  // Amenities: A (Google, already in `base`) then B (the website, only what it actually lists),
  // mapped onto the canonical names, de-duplicated and capped at 8 — unmatched text is dropped.
  const amenities = mergeAmenities(base.amenities ?? [], web.fields.amenities ?? []);
  if (amenities.length) fields.amenities = amenities;
  else delete fields.amenities;
  // C: the category's typical amenities, minus the confirmed ones. Unconfirmed — the admin panel
  // shows them as tap-to-add chips and never saves one that is not tapped.
  if (preset) {
    const suggested = suggestAmenities(amenitySuggestionsFor(preset), amenities);
    if (suggested.length) fields.suggestedAmenities = suggested;
  }
  if (web.fields.payments) fields.payments = web.fields.payments;
  if (web.fields.establishedYear) fields.establishedYear = web.fields.establishedYear;
  for (const key of SOCIAL_FIELDS) if (web.fields[key]) fields[key] = web.fields[key];
  if (services && services.length) fields.services = services;
  if (staff.length) fields.staff = staff;
  if (reviews) fields.reviews = reviews;

  if (!preset) {
    warnings.unshift("We couldn't match this to one of your store categories — pick a category before saving.");
  }

  return { source: { url: details.googleMapsUri ?? '', title: name }, fields, warnings };
}
