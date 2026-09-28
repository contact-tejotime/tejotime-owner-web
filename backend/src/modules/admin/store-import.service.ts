import { logger } from '../../config/logger';
import { AppError } from '../../domain/errors';
import { storeExtractor } from '../../integrations/store-extract';
import { dayOf, extractPage, hhmm, socialFromUrl, SOCIAL_KEYS, type PageFacts, type SocialKey } from '../../lib/html-extract';
import { safeFetchText, SafeFetchError } from '../../lib/safe-fetch';
import { listLookups } from './admin.service';

/**
 * "Autofill store from a link": fetch → read → (LLM) → sanitise → hand the admin-panel a partial
 * form to REVIEW. Nothing here writes to the database; the result only ever reaches the store
 * through the admin's own review-and-save, which re-validates against `storeFieldsSchema`.
 *
 * Deliberately not extracted (see docs/store-autofill-from-link.md): images/logo/gallery
 * (hot-linking a third party's pictures is fragile and would need a copy-to-bucket step), theme,
 * rating and review counts, review text, and the owner login.
 */

export interface ImportedHour {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export interface ImportedService {
  name: string;
  /** Null when the page states no time. It is deliberately NOT defaulted — see `sanitizeServices`. */
  durationMinutes: number | null;
  priceRupees: number;
  priceType: 'fixed' | 'range' | 'unset';
  priceMaxRupees: number | null;
}

/** Hand-mirrored in admin-panel/src/lib/types.ts (`ImportedFields`) — change both together. */
export interface ImportedFields {
  name?: string;
  category?: string;
  tagline?: string;
  aboutHeading?: string;
  description?: string;
  heroSubtitle?: string;
  area?: string;
  city?: string;
  address?: string;
  establishedYear?: number;
  countryCode?: string;
  phoneNumber?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  yelpUrl?: string;
  payments?: string[];
  amenities?: string[];
  hours?: ImportedHour[];
  services?: ImportedService[];
  staff?: Array<{ name: string; roleLabel: string }>;
  faqs?: Array<{ q: string; a: string }>;
}

export interface StoreImportResult {
  source: { url: string; title: string };
  fields: ImportedFields;
  warnings: string[];
}

// Limits mirror storeFieldsSchema in admin.routes.ts. They are clamped here (not rejected) because
// an over-long tagline from a model should be trimmed for the admin to review, not fail the import.
const LIMITS = {
  name: 120, category: 80, area: 120, address: 300, city: 80, tagline: 160, aboutHeading: 160,
  description: 2000, heroSubtitle: 200, serviceName: 80, staffName: 80, staffRole: 80,
  faqQ: 200, faqA: 1000, amenity: 60, payment: 60,
  services: 50, staff: 50, faqs: 30, amenities: 30, payments: 15,
  maxPriceRupees: 1_000_000,
} as const;

/** Strip markup and control characters; collapse whitespace; clamp. Undefined when nothing is left. */
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v)
    // Drop executable/style blocks WITH their contents first; stripping just the tags would leave
    // `alert(1)` behind as if it were text.
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max).trim() : s;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function uniqueStrings(v: unknown, max: number, count: number): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of asList(v)) {
    const s = text(item, max);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= count) break;
  }
  return out.length ? out : undefined;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** India-first: this platform serves Indian shops, and a bare national number is by far the norm. */
export function parsePhone(raw: unknown): { countryCode: string; phoneNumber: string } | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 10) national = digits;
  // Indian mobiles start 6-9; landlines start with an STD code (2-5). Both are 10 digits with it.
  if (!national || !/^[2-9]\d{9}$/.test(national)) return null;
  return { countryCode: '91', phoneNumber: national };
}

function sanitizeHours(v: unknown): ImportedHour[] {
  const byDay = new Map<number, ImportedHour>();
  for (const row of asList(v)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    // The model names days ("Monday"); JSON-LD hours arrive already as 0–6.
    const numeric = Number.isInteger(r.dayOfWeek) && (r.dayOfWeek as number) >= 0 && (r.dayOfWeek as number) <= 6;
    const day = dayOf(r.day) ?? (numeric ? (r.dayOfWeek as number) : null);
    // First row for a day wins — a split shift (two slots) would otherwise overwrite the morning one.
    if (day === null || byDay.has(day)) continue;
    byDay.set(day, toHour(day, r));
  }
  return [...byDay.values()].filter((h) => h.isClosed || (h.opensAt && h.closesAt));
}

function toHour(dayOfWeek: number, r: Record<string, unknown>): ImportedHour {
  const opensAt = hhmm(r.opens ?? r.opensAt);
  const closesAt = hhmm(r.closes ?? r.closesAt);
  const isClosed = r.closed === true || r.isClosed === true || (!opensAt && !closesAt);
  return { dayOfWeek, opensAt: isClosed ? null : opensAt, closesAt: isClosed ? null : closesAt, isClosed };
}

function sanitizeServices(v: unknown, warnings: string[]): ImportedService[] {
  const seen = new Set<string>();
  const out: ImportedService[] = [];
  let missingDuration = 0;
  for (const row of asList(v)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = text(r.name, LIMITS.serviceName);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    // A page that states no time is left as null rather than filled with a guess (it used to be
    // 20 minutes). A guessed duration is saved as fact: it sizes every slot and wait estimate for
    // the store. The admin form shows a blank box and will not save until someone types the real
    // time. A stated one is still clamped to what the API accepts (1–600).
    const stated = num(r.durationMinutes);
    let duration: number | null = null;
    if (stated !== null && stated >= 1) {
      duration = Math.min(600, Math.round(stated));
    } else {
      missingDuration++;
    }

    const price = num(r.price);
    const max = num(r.priceMax);
    let priceType: ImportedService['priceType'] = 'unset';
    let priceRupees = 0;
    let priceMaxRupees: number | null = null;
    if (price !== null && price > 0 && price <= LIMITS.maxPriceRupees) {
      priceRupees = price;
      priceType = 'fixed';
      // Only a real ceiling above the floor is a range; equal or lower is just noise.
      if (max !== null && max > price && max <= LIMITS.maxPriceRupees) {
        priceType = 'range';
        priceMaxRupees = max;
      }
    }
    out.push({ name, durationMinutes: duration, priceRupees, priceType, priceMaxRupees });
    if (out.length >= LIMITS.services) break;
  }
  if (missingDuration) {
    warnings.push(`${missingDuration} service${missingDuration === 1 ? ' had' : 's had'} no stated duration — enter it before saving.`);
  }
  return out;
}

/**
 * Reduce whatever the model returned (plus the deterministic facts) to a clean `ImportedFields`.
 * Pure. This is the trust boundary: nothing from the page or the model reaches the admin's form
 * except through here, in the named fields, clamped to their limits.
 */
export function sanitizeExtraction(
  raw: unknown,
  facts: PageFacts,
  categories: string[],
): { fields: ImportedFields; warnings: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ld = facts.jsonLd;
  const warnings: string[] = [];
  const f: ImportedFields = {};
  const put = <K extends keyof ImportedFields>(k: K, v: ImportedFields[K] | undefined) => {
    if (v !== undefined) f[k] = v;
  };

  // Machine-readable data the site itself declared beats a model's reading of the same page.
  put('name', text(ld.name, LIMITS.name) ?? text(r.name, LIMITS.name) ?? text(facts.siteName, LIMITS.name));
  put('tagline', text(r.tagline, LIMITS.tagline));
  put('aboutHeading', text(r.aboutHeading, LIMITS.aboutHeading));
  put('description', text(r.description, LIMITS.description) ?? text(ld.description ?? facts.description, LIMITS.description));
  put('heroSubtitle', text(r.heroSubtitle, LIMITS.heroSubtitle));
  put('address', text(ld.streetAddress, LIMITS.address) ?? text(r.address, LIMITS.address));
  put('city', text(ld.locality, LIMITS.city) ?? text(r.city, LIMITS.city));
  put('area', text(r.area, LIMITS.area));

  const wanted = text(r.category, LIMITS.category)?.toLowerCase();
  const category = wanted ? categories.find((c) => c.toLowerCase() === wanted) : undefined;
  put('category', category);
  if (wanted && !category) warnings.push('The business type on the page did not match any of your categories — pick one yourself.');

  const year = ld.foundingYear ?? num(r.establishedYear);
  if (year !== null && year !== undefined && Number.isInteger(year) && year >= 1900 && year <= 2100) f.establishedYear = year;

  const phone = parsePhone(ld.telephone) ?? parsePhone(r.phone);
  if (phone) {
    f.countryCode = phone.countryCode;
    f.phoneNumber = phone.phoneNumber;
  }

  // Social URLs: a link found in the page's own markup wins; a model-supplied one is accepted only
  // if it is a real profile URL on the matching network (so a poisoned page cannot smuggle an
  // arbitrary link into a customer-facing "follow us" button).
  for (const key of SOCIAL_KEYS) {
    let url: string | undefined = facts.socials[key];
    if (!url && typeof r[key] === 'string') {
      const hit = socialFromUrl(r[key] as string);
      if (hit && hit.key === (key as SocialKey)) url = hit.url;
    }
    if (url && url.length <= 300) f[key] = url;
  }

  put('payments', uniqueStrings(r.payments, LIMITS.payment, LIMITS.payments));
  put('amenities', uniqueStrings(r.amenities, LIMITS.amenity, LIMITS.amenities));

  const hours = ld.hours.length
    ? sanitizeHours(ld.hours.map((h) => ({ dayOfWeek: h.dayOfWeek, opens: h.opensAt, closes: h.closesAt })))
    : sanitizeHours(r.hours);
  if (hours.length) f.hours = hours;

  const services = sanitizeServices(r.services, warnings);
  if (services.length) f.services = services;

  const staff: Array<{ name: string; roleLabel: string }> = [];
  const seenStaff = new Set<string>();
  for (const row of asList(r.staff)) {
    if (!row || typeof row !== 'object') continue;
    const name = text((row as any).name, LIMITS.staffName);
    if (!name || seenStaff.has(name.toLowerCase())) continue;
    seenStaff.add(name.toLowerCase());
    staff.push({ name, roleLabel: text((row as any).role ?? (row as any).roleLabel, LIMITS.staffRole) ?? '' });
    if (staff.length >= LIMITS.staff) break;
  }
  if (staff.length) f.staff = staff;

  const faqs: Array<{ q: string; a: string }> = [];
  for (const row of asList(r.faqs)) {
    if (!row || typeof row !== 'object') continue;
    const q = text((row as any).q, LIMITS.faqQ);
    const a = text((row as any).a, LIMITS.faqA);
    if (q && a) faqs.push({ q, a });
    if (faqs.length >= LIMITS.faqs) break;
  }
  if (faqs.length) f.faqs = faqs;

  return { fields: f, warnings };
}

/** A page with next to nothing on it (login wall, JS-only app) gives the model nothing honest to read. */
const MIN_READABLE_CHARS = 200;
/**
 * …unless the page at least DESCRIBES itself. A single-page app (React/Vite/Wix-style) ships an
 * empty `<div id="root">` and builds the rest in the browser, so its visible text is nothing — but
 * its `<meta name="description">` still says what the business is and where. That is "a few
 * details", which is better than refusing the link. A title alone is not enough (a login wall has
 * one), so the description is what counts.
 */
const MIN_META_DESCRIPTION_CHARS = 30;

export async function importStoreFromLink(rawUrl: string): Promise<StoreImportResult> {
  if (!storeExtractor.configured) {
    throw new AppError(503, 'AUTOFILL_DISABLED', 'Autofill from a link is not enabled on this server');
  }

  let page;
  try {
    page = await safeFetchText(rawUrl);
  } catch (err) {
    if (err instanceof SafeFetchError) throw new AppError(422, `LINK_${err.code}`, err.message);
    logger.warn({ err }, 'store import fetch failed unexpectedly');
    throw new AppError(422, 'LINK_NETWORK', 'Could not read that page');
  }

  const facts = extractPage(page.body);
  const hasStructured = Boolean(facts.jsonLd.name || facts.jsonLd.telephone || facts.jsonLd.streetAddress);
  const thin = facts.text.length < MIN_READABLE_CHARS;
  const describesItself = facts.description.trim().length >= MIN_META_DESCRIPTION_CHARS;
  if (thin && !hasStructured && !describesItself) {
    throw new AppError(
      422,
      'PAGE_UNREADABLE',
      "We couldn't read enough from that page. Sites that need a login or load everything with JavaScript (Instagram, Facebook, Google Maps) usually can't be read — try the business's own website.",
    );
  }

  const categories = (await listLookups('business_category')).data.map((c) => c.name);
  const raw = await storeExtractor.extract({ pageUrl: page.finalUrl, facts, categories });
  const { fields, warnings } = sanitizeExtraction(raw, facts, categories);

  if (raw === null) {
    if (!hasStructured) {
      throw new AppError(502, 'EXTRACTION_FAILED', 'The AI reader is unavailable right now. Please try again in a minute.');
    }
    warnings.unshift('The AI reader was unavailable, so only details the site publishes in a machine-readable form were filled in.');
  }
  if (!Object.keys(fields).length) {
    throw new AppError(422, 'NOTHING_FOUND', "We couldn't find any store details on that page.");
  }
  if (thin) {
    // Said plainly, and first: the admin should not mistake a handful of fields for a full read.
    warnings.unshift(
      'This page loads most of its content with JavaScript, so only a little could be read (its title and description). Fill in the rest by hand.',
    );
  }

  return { source: { url: page.finalUrl, title: facts.title }, fields, warnings };
}
