/**
 * Turns a fetched web page into (a) facts that can be read deterministically and (b) plain text for
 * the LLM. Pure — no I/O, no dependencies (there is deliberately no cheerio/jsdom in this
 * backend) — so it is unit-testable and cannot be made to fetch anything.
 *
 * Deterministic facts come first because they are exact where a model is fuzzy: a site that ships
 * schema.org `LocalBusiness` JSON-LD has already told us its name, address, phone, hours and
 * social profiles in a machine-readable form. The model then only has to fill what a machine
 * cannot read (tagline, description, service list, FAQs).
 *
 * Everything returned is UNTRUSTED page content. Callers must treat it as data.
 */

export const SOCIAL_KEYS = ['instagramUrl', 'facebookUrl', 'twitterUrl', 'linkedinUrl', 'yelpUrl'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export interface ExtractedHour {
  /** 0 = Sunday … 6 = Saturday, matching business_hour.day_of_week. */
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface JsonLdFacts {
  name?: string;
  description?: string;
  telephone?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  hours: ExtractedHour[];
  foundingYear?: number;
  sameAs: string[];
}

export interface PageFacts {
  title: string;
  description: string;
  siteName: string;
  jsonLd: JsonLdFacts;
  socials: Partial<Record<SocialKey, string>>;
  /** Visible text, whitespace-normalised and truncated to MAX_TEXT_CHARS. */
  text: string;
}

export const MAX_TEXT_CHARS = 12_000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  copy: '©',
  rupee: '₹',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();

function metaContent(html: string, attr: 'name' | 'property', key: string): string {
  // Attribute order varies (`content` before or after `name`), so try both.
  const a = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*?content=["']([^"']*)["']`, 'i').exec(html);
  if (a) return clean(a[1]!);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?${attr}=["']${key}["']`, 'i').exec(html);
  return b ? clean(b[1]!) : '';
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

const DAY_INDEX: Record<string, number> = {
  sunday: 0, su: 0, sun: 0,
  monday: 1, mo: 1, mon: 1,
  tuesday: 2, tu: 2, tue: 2,
  wednesday: 3, we: 3, wed: 3,
  thursday: 4, th: 4, thu: 4,
  friday: 5, fr: 5, fri: 5,
  saturday: 6, sa: 6, sat: 6,
};

export function dayOf(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/^https?:\/\/schema\.org\//, '');
  return key in DAY_INDEX ? DAY_INDEX[key]! : null;
}

export function hhmm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return `${String(h === 24 ? 0 : h).padStart(2, '0')}:${m[2]}`;
}

/** "Mo-Sa 09:00-18:00", "Mo,We,Fr 10:00-14:00", "Tu 09:00-17:00". */
function parseOpeningHoursString(s: string): ExtractedHour[] {
  const out: ExtractedHour[] = [];
  const m = /^\s*([A-Za-z,\- ]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(s);
  if (!m) return out;
  const opens = hhmm(m[2]);
  const closes = hhmm(m[3]);
  if (!opens || !closes) return out;
  for (const part of m[1]!.split(',')) {
    const [from, to] = part.split('-').map((x) => x.trim());
    const a = dayOf(from);
    if (a === null) continue;
    const b = to ? dayOf(to) : a;
    if (b === null) continue;
    // Ranges wrap the week ("Sa-Mo"), and Monday-first ranges are the norm in schema.org.
    let d = a;
    for (let i = 0; i < 7; i++) {
      out.push({ dayOfWeek: d, opensAt: opens, closesAt: closes });
      if (d === b) break;
      d = (d + 1) % 7;
    }
  }
  return out;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function flattenNodes(json: unknown, out: any[] = []): any[] {
  if (Array.isArray(json)) json.forEach((j) => flattenNodes(j, out));
  else if (json && typeof json === 'object') {
    out.push(json);
    flattenNodes((json as any)['@graph'], out);
  }
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? clean(v) : undefined);

function readJsonLd(html: string): JsonLdFacts {
  const facts: JsonLdFacts = { hours: [], sameAs: [] };
  const nodes: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      flattenNodes(JSON.parse(m[1]!.trim()), nodes);
    } catch {
      // A malformed block is common in the wild; skip it, keep the rest.
    }
  }

  const typesOf = (n: any) => asArray<string>(n['@type']).map((t) => String(t));
  // Prefer a real place-of-business node; fall back to an Organization.
  const node =
    nodes.find((n) => typesOf(n).some((t) => /(LocalBusiness|Salon|Barber|Hospital|Restaurant|Store|Physician|Dentist|HealthAndBeauty|BeautySalon|HairSalon|MedicalBusiness|FoodEstablishment|CafeOrCoffeeShop)/i.test(t))) ??
    nodes.find((n) => typesOf(n).some((t) => /Organization/i.test(t)));
  if (!node) return facts;

  facts.name = str(node.name);
  facts.description = str(node.description);
  facts.telephone = str(node.telephone);
  const addr = asArray(node.address)[0];
  if (typeof addr === 'string') facts.streetAddress = str(addr);
  else if (addr && typeof addr === 'object') {
    facts.streetAddress = str(addr.streetAddress);
    facts.locality = str(addr.addressLocality);
    facts.region = str(addr.addressRegion);
    facts.postalCode = str(addr.postalCode);
  }
  const founded = Number.parseInt(String(node.foundingDate ?? '').slice(0, 4), 10);
  if (founded >= 1900 && founded <= 2100) facts.foundingYear = founded;
  facts.sameAs = asArray<unknown>(node.sameAs).filter((x): x is string => typeof x === 'string');

  for (const spec of asArray<any>(node.openingHoursSpecification)) {
    const opens = hhmm(spec?.opens);
    const closes = hhmm(spec?.closes);
    if (!opens || !closes) continue;
    for (const d of asArray(spec.dayOfWeek)) {
      const day = dayOf(d);
      if (day !== null) facts.hours.push({ dayOfWeek: day, opensAt: opens, closesAt: closes });
    }
  }
  if (!facts.hours.length) {
    for (const s of asArray<unknown>(node.openingHours)) {
      if (typeof s === 'string') facts.hours.push(...parseOpeningHoursString(s));
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Social links
// ---------------------------------------------------------------------------

const SOCIAL_RULES: Array<{ key: SocialKey; re: RegExp }> = [
  // `instagram.com/<handle>` but not /p/… /reel/… /explore/… — those are posts, not the profile.
  { key: 'instagramUrl', re: /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|reels\/|explore\/|accounts\/|stories\/|tv\/)([\w.]{2,30})\/?/i },
  { key: 'facebookUrl', re: /^https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|tr\b|plugins|login|policies|help|groups\/|events\/|watch|hashtag)([\w.-]{3,80})\/?/i },
  { key: 'twitterUrl', re: /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|i\/|hashtag)(\w{2,20})\/?/i },
  { key: 'linkedinUrl', re: /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[\w\-%.]{2,100}\/?/i },
  { key: 'yelpUrl', re: /^https?:\/\/(?:www\.)?yelp\.[a-z.]{2,6}\/biz\/[\w\-%.]{2,120}/i },
];

/** Match a profile URL against the known networks; returns a query-free canonical form. */
export function socialFromUrl(raw: string): { key: SocialKey; url: string } | null {
  for (const { key, re } of SOCIAL_RULES) {
    const m = re.exec(raw.trim());
    if (m) return { key, url: m[0]!.replace(/\/$/, '').replace(/^http:\/\//i, 'https://') };
  }
  return null;
}

function readSocials(html: string, sameAs: string[]): Partial<Record<SocialKey, string>> {
  const out: Partial<Record<SocialKey, string>> = {};
  const candidates = [...sameAs];
  const re = /<a\s[^>]*href=["']([^"'#][^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) candidates.push(decodeEntities(m[1]!));
  // sameAs is first, so a declared profile wins over a stray footer link.
  for (const c of candidates) {
    const hit = socialFromUrl(c);
    if (hit && !out[hit.key]) out[hit.key] = hit.url;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visible text
// ---------------------------------------------------------------------------

function visibleText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    // Block-level boundaries become newlines so "Mon 9-5" and the next row don't run together.
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol|\/dd|\/dt)\b[^>]*>/gi, '\n')
    .replace(/<\/(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(stripped)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // Menus and footers repeat the same short line dozens of times; keep the first of each run.
  const seen = new Set<string>();
  const uniq = lines.filter((l) => {
    if (l.length > 80) return true;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
  const text = uniq.join('\n');
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

export function extractPage(html: string): PageFacts {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const jsonLd = readJsonLd(html);
  return {
    title,
    description: metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description'),
    siteName: metaContent(html, 'property', 'og:site_name'),
    jsonLd,
    socials: readSocials(html, jsonLd.sameAs),
    text: visibleText(html),
  };
}
