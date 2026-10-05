/** Payload shapes shared between the store form and the API route handlers.
 *  These mirror the backend zod schema in backend/src/modules/admin/admin.routes.ts. */

import { t } from "@/i18n";
import { LEGACY_THEME_CONFIG, normalizeThemeConfig, type ThemeConfig } from "@/theme/engine";

export const DAY_LABELS = t.days.long;

export interface HourRow {
  dayOfWeek: number;
  opensAt: string; // "HH:MM" ("" when closed)
  closesAt: string;
  isClosed: boolean;
}
/**
 * How a service is priced. `unset` is "no price": the microsite shows none for it and staff type
 * the amount at checkout. It began as the reading of legacy zero-priced rows (migration 0024) and
 * is now a mode an admin can choose on purpose — price is optional.
 */
export type ServicePriceType = "fixed" | "range" | "unset";

export interface ServiceRow {
  name: string;
  durationMinutes: number;
  /** The fixed price, or the MINIMUM of a range — `priceType` says which. Whole rupees. */
  priceRupees: number;
  priceType: ServicePriceType;
  /** The maximum of a range, in rupees. Null in every other mode. */
  priceMaxRupees: number | null;
}
export interface StaffRow {
  name: string;
  roleLabel: string;
  avatarUrl: string; // "" when no photo
  /**
   * Commission as typed ("20", "37.5"). "" means no rate. Kept as text so a draft can hold a
   * half-typed value; `toPayload` turns a finished percent into basis points.
   */
  commissionPercent: string;
}

/**
 * What the admin typed into the commission box, as basis points: "20" → 2000, "37.5" → 3750,
 * "12,25" → 1225. Null unless it is 0–100 with at most two decimals. The same reading as the
 * owner's rate box (owner-web `parseRateInput`).
 */
export function parseCommissionPercent(raw: string): number | null {
  const s = raw.trim().replace(/%$/, "").trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

/** 2000 → "20", 3750 → "37.5". Null (no rate) → "". */
export function commissionPercentFromRateBp(bp: number | null | undefined): string {
  if (bp == null || Number.isNaN(Number(bp))) return "";
  const pct = Number(bp) / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, "");
}
export interface GalleryRow {
  url: string;
  alt: string;
}
export interface FaqRow {
  q: string;
  a: string;
}
export interface ReviewRow {
  stars: number;
  text: string;
  authorName: string;
}

/** The full form state. Sent to the API route, which forwards it to the backend. */
export interface StoreForm {
  name: string;
  category: string;
  area: string;
  address: string;
  city: string;
  tagline: string;
  heroSubtitle: string;
  description: string;
  aboutHeading: string;
  heroImageUrl: string;
  aboutImageUrl: string;
  logoUrl: string;
  /**
   * The heading above the microsite's photo gallery. "" = the default for the store's type (the
   * first of `t.galleryHeadings[familyFor(category)]`), so the page keeps following the category.
   */
  galleryHeading: string;
  establishedYear: string;
  rating: string;
  reviewCount: string;
  /** Social profile URLs — rendered as icon links on the public microsite. */
  instagramUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
  yelpUrl: string;
  /** Post-visit review SMS link — owner-side only, never on the microsite. */
  googleReviewUrl: string;
  payments: string; // comma-separated in the form; split before send
  currency: string; // ISO 4217 code; symbol/name come from lib/currencies.ts
  /** IANA zone the store's open/closed hours run in. "" = Automatic: the API derives it from the phone number. */
  timezone: string;
  /** Brand/accent hex for the customer microsite (#RRGGBB). Always mirrors `theme.brand`. */
  themeColor: string;
  /**
   * Full microsite appearance config (stored as the `business.theme` jsonb).
   *
   * `brand` is the same hex as `themeColor` — the two are dual-written on the backend, and
   * the Appearance panel keeps them in step so the legacy field never goes stale. The four
   * modifier axes stay OPTIONAL on purpose: absent means "whatever this preset ships with",
   * which is how switching preset picks up that preset's radius/shadow/density/animation
   * instead of dragging the previous one's along.
   */
  theme: ThemeConfig;
  isActive: boolean; // toggled in edit only; inactive stores' microsites 404
  countryCode: string;
  phoneNumber: string;
  hours: HourRow[];
  amenities: string[];
  gallery: GalleryRow[];
  services: ServiceRow[];
  staff: StaffRow[];
  faqs: FaqRow[];
  reviews: ReviewRow[];
  ownerPhone: string;
  ownerPassword: string;
}

/** A category option from the master_data lookup. */
export interface Category {
  id: string;
  name: string;
}

/** A row in the sidebar store list (from GET /admin/businesses). */
export interface StoreListItem {
  id: string;
  name: string;
  slug: string;
  phoneFull: string;
  category: string | null;
  city: string | null;
  isActive: boolean;
  /**
   * One of the nine homepage industry stores (docs/demo-stores.md): listed under "Demo stores",
   * left out of every platform page, and never disable-able. Optional so a backend that predates
   * the flag reads as "not demo" rather than breaking the list.
   */
  isDemo?: boolean;
  /**
   * For a demo store, the homepage card it backs ("Hair salons", "Barbershops", …). All nine share
   * the category "Salon & Barber", so the panel shows this in its place. Null for other stores.
   */
  demoIndustry?: string | null;
  createdAt: string;
}

/** Backend response from POST /admin/businesses and PUT /admin/businesses/:id. */
export interface StoreMutationResult {
  id: string;
  slug?: string;
  phoneFull: string;
  micrositePath: string;
}

/** Seven blank weekday rows with a neutral 09:00–18:00 default (not store-specific). */
function blankHours(): HourRow[] {
  return DAY_LABELS.map((_, dayOfWeek) => ({ dayOfWeek, opensAt: "09:00", closesAt: "18:00", isClosed: false }));
}

/** A blank form — no demo/store data pre-filled (one empty service + staff row; ≥1 each is required). */
export const EMPTY_FORM: StoreForm = {
  name: "",
  category: "",
  area: "",
  address: "",
  city: "",
  tagline: "",
  heroSubtitle: "",
  description: "",
  aboutHeading: "",
  isActive: true,
  heroImageUrl: "",
  aboutImageUrl: "",
  logoUrl: "",
  galleryHeading: "",
  establishedYear: "",
  rating: "",
  reviewCount: "",
  instagramUrl: "",
  facebookUrl: "",
  twitterUrl: "",
  linkedinUrl: "",
  yelpUrl: "",
  googleReviewUrl: "",
  payments: t.storeForm.paymentsDefault,
  currency: "INR",
  timezone: "",
  themeColor: "#2563EB",
  /**
   * A brand-new store starts on the pixel-parity config, so "create a store and change
   * nothing" produces exactly the microsite this admin panel produced before the Appearance
   * panel existed. The Appearance panel may re-seed `preset` from the chosen category — a
   * suggestion for NEW stores only, never applied to a store that already exists.
   */
  theme: { ...LEGACY_THEME_CONFIG },
  countryCode: "1",
  phoneNumber: "",
  hours: blankHours(),
  amenities: [],
  gallery: [],
  services: [{ name: "", durationMinutes: 30, priceRupees: 0, priceType: "fixed", priceMaxRupees: null }],
  staff: [{ name: "", roleLabel: "", avatarUrl: "", commissionPercent: "" }],
  faqs: [],
  reviews: [],
  ownerPhone: "",
  ownerPassword: "",
};

/** The store-detail shape returned by GET /admin/businesses/:id. */
export interface StoreDetail {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  /** Homepage demo store — the hub shows it as always on, with no Enabled toggle. See StoreListItem. */
  isDemo?: boolean;
  /** Its homepage card ("Hair salons"), shown in place of the category. See StoreListItem. */
  demoIndustry?: string | null;
  category: string;
  area: string;
  address: string;
  city: string;
  tagline: string;
  heroSubtitle: string;
  description: string;
  aboutHeading: string;
  heroImageUrl: string;
  aboutImageUrl: string;
  logoUrl: string;
  /** "" or null when unset (= the default for the store's type). Optional: a backend older than migration 0038. */
  galleryHeading?: string | null;
  establishedYear: string;
  rating: string;
  reviewCount: string;
  /** Social profile URLs — rendered as icon links on the public microsite. */
  instagramUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
  yelpUrl: string;
  /** Post-visit review SMS link — owner-side only, never on the microsite. */
  googleReviewUrl: string;
  payments: string;
  currency: string;
  /** Optional so a response from an older backend (no field yet) still type-checks and reads as Automatic. */
  timezone?: string;
  themeColor: string;
  /**
   * The stored `business.theme` jsonb, straight from Postgres — `null` for every store that
   * has never saved an appearance, and possibly from an older schema version. Never read it
   * directly; run it through `normalizeThemeConfig`, which repairs anything.
   */
  theme?: ThemeConfig | null;
  countryCode: string;
  phoneNumber: string;
  phoneFull: string;
  /** Super owner's login phone — read-only on the edit form. */
  ownerPhone: string;
  hours: HourRow[];
  amenities: string[];
  gallery: GalleryRow[];
  services: ServiceRow[];
  staff: {
    name: string;
    roleLabel: string;
    avatarUrl: string;
    /** Basis points in force now. Null when this stylist has no rate. */
    rateBp?: number | null;
  }[];
  faqs: FaqRow[];
  reviews: ReviewRow[];
}

/** Map a backend store detail into editable form state (fills any missing weekday rows). */
export function fromDetail(d: StoreDetail): StoreForm {
  const byDay = new Map(d.hours.map((h) => [h.dayOfWeek, h]));
  const hours = DAY_LABELS.map(
    (_, dayOfWeek) => byDay.get(dayOfWeek) ?? { dayOfWeek, opensAt: "09:00", closesAt: "18:00", isClosed: false },
  );
  /**
   * Appearance: the stored `theme` jsonb wins, and the legacy `theme_color` column seeds the
   * brand for every store that predates it (i.e. all of them today). Passing the legacy hex as
   * the normaliser's *base* is what makes that work — `theme.brand` overrides it when present,
   * and a store with neither lands back on the frozen parity config.
   */
  const legacyBrand = /^#[0-9A-Fa-f]{6}$/.test(d.themeColor) ? d.themeColor.toUpperCase() : "#2563EB";
  const theme = normalizeThemeConfig(d.theme, { ...LEGACY_THEME_CONFIG, brand: legacyBrand });
  return {
    name: d.name,
    category: d.category,
    area: d.area,
    address: d.address,
    city: d.city,
    tagline: d.tagline,
    heroSubtitle: d.heroSubtitle,
    description: d.description,
    aboutHeading: d.aboutHeading,
    heroImageUrl: d.heroImageUrl,
    aboutImageUrl: d.aboutImageUrl,
    logoUrl: d.logoUrl,
    galleryHeading: d.galleryHeading ?? "",
    establishedYear: d.establishedYear,
    rating: d.rating,
    reviewCount: d.reviewCount,
    instagramUrl: d.instagramUrl ?? "",
    facebookUrl: d.facebookUrl ?? "",
    twitterUrl: d.twitterUrl ?? "",
    linkedinUrl: d.linkedinUrl ?? "",
    yelpUrl: d.yelpUrl ?? "",
    googleReviewUrl: d.googleReviewUrl ?? "",
    payments: d.payments,
    currency: d.currency || "INR",
    timezone: d.timezone ?? "",
    // Kept in lockstep with theme.brand — the panel edits one colour, not two.
    themeColor: theme.brand,
    theme,
    isActive: d.isActive,
    countryCode: d.countryCode,
    phoneNumber: d.phoneNumber,
    hours,
    amenities: d.amenities,
    gallery: d.gallery,
    // Normalised rather than passed straight through: a service written before pricing modes
    // (or a response cached from a backend without them) arrives with no `priceType`, and the
    // form would then render a mode select bound to undefined.
    services: d.services.length
      ? d.services.map((s) => ({
          ...s,
          priceType: s.priceType ?? (s.priceRupees > 0 ? "fixed" : "unset"),
          priceMaxRupees: s.priceMaxRupees ?? null,
        }))
      : EMPTY_FORM.services,
    staff: d.staff.length
      ? d.staff.map((s) => ({
          name: s.name,
          roleLabel: s.roleLabel ?? "",
          avatarUrl: s.avatarUrl ?? "",
          commissionPercent: commissionPercentFromRateBp(s.rateBp),
        }))
      : EMPTY_FORM.staff,
    faqs: d.faqs,
    reviews: d.reviews ?? [],
    ownerPhone: d.ownerPhone ?? "",
    ownerPassword: "",
  };
}

/** A row in the sidebar's Drafts list (from GET /admin/store-drafts). */
export interface StoreDraftListItem {
  id: string;
  name: string | null;
  category: string | null;
  phoneFull: string | null;
  updatedAt: string;
}

/** A parked Create store form (GET /admin/store-drafts/:id). `data` is raw, possibly stale, form state. */
export interface StoreDraft {
  id: string;
  data: Partial<StoreForm>;
  updatedAt: string;
}

/**
 * What a draft stores: the raw form state minus the owner's password. The backend strips it as
 * well, but a plaintext secret should not even leave the browser for a table that is not for it.
 */
export function draftData(form: StoreForm): Partial<StoreForm> {
  const copy: Partial<StoreForm> = { ...form };
  delete copy.ownerPassword;
  return copy;
}

/**
 * Rebuild editable form state from a stored draft. Never trusts the blob: a draft saved by an older
 * build lacks fields added since, and one field of the wrong type would crash a controlled input
 * ("uncontrolled to controlled") or `.map` over a non-array. So every key is taken from the draft
 * only when its type matches the blank form's, and anything else falls back to the blank value.
 * The password is never restored, so it always comes back empty.
 */
export function draftToForm(data: Partial<StoreForm> | null | undefined): StoreForm {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...EMPTY_FORM };
  for (const key of Object.keys(EMPTY_FORM) as (keyof StoreForm)[]) {
    const v = d[key];
    const blank = EMPTY_FORM[key];
    if (v === undefined || v === null) continue;
    if (Array.isArray(blank) ? Array.isArray(v) : typeof v === typeof blank) out[key] = v;
  }
  const form = out as unknown as StoreForm;

  const legacyBrand = /^#[0-9A-Fa-f]{6}$/.test(form.themeColor) ? form.themeColor.toUpperCase() : "#2563EB";
  const theme = normalizeThemeConfig(d.theme as ThemeConfig | null | undefined, { ...LEGACY_THEME_CONFIG, brand: legacyBrand });

  const byDay = new Map(form.hours.map((h) => [h.dayOfWeek, h]));
  return {
    ...form,
    theme,
    themeColor: theme.brand,
    hours: DAY_LABELS.map(
      (_, dayOfWeek) => byDay.get(dayOfWeek) ?? { dayOfWeek, opensAt: "09:00", closesAt: "18:00", isClosed: false },
    ),
    services: form.services.length
      ? form.services.map((s) => ({
          ...s,
          priceType: s.priceType ?? (s.priceRupees > 0 ? "fixed" : "unset"),
          priceMaxRupees: s.priceMaxRupees ?? null,
        }))
      : EMPTY_FORM.services,
    staff: form.staff.length
      ? form.staff.map((s) => ({
          ...s,
          // A draft saved before this field exists has no commissionPercent; a controlled
          // input cannot be handed undefined.
          commissionPercent: typeof s.commissionPercent === "string" ? s.commissionPercent : "",
        }))
      : EMPTY_FORM.staff,
    ownerPassword: "",
  };
}

/** Shape the form state into the backend's expected JSON body. `includeOwner` for create only. */
export function toPayload(f: StoreForm, includeOwner: boolean) {
  const num = (s: string) => {
    const t = s.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isNaN(n) ? undefined : n; // never ship NaN (serializes to null)
  };
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    category: f.category.trim() || undefined,
    area: f.area.trim() || undefined,
    address: f.address.trim() || undefined,
    city: f.city.trim() || undefined,
    tagline: f.tagline.trim() || undefined,
    heroSubtitle: f.heroSubtitle.trim() || undefined,
    description: f.description.trim() || undefined,
    aboutHeading: f.aboutHeading.trim() || undefined,
    heroImageUrl: f.heroImageUrl.trim() || undefined,
    aboutImageUrl: f.aboutImageUrl.trim() || undefined,
    logoUrl: f.logoUrl.trim() || undefined,
    // Always sent, "" included: the backend writes it only when present, and "" is how "Default for
    // your store type" clears a heading chosen earlier. `undefined` would leave the old one standing.
    galleryHeading: f.galleryHeading.trim(),
    establishedYear: num(f.establishedYear),
    rating: num(f.rating),
    reviewCount: num(f.reviewCount),
    // Sent even when empty — `undefined` would leave the stored link untouched, so an admin
    // deleting a URL would watch it reappear on the next load.
    instagramUrl: f.instagramUrl.trim(),
    facebookUrl: f.facebookUrl.trim(),
    twitterUrl: f.twitterUrl.trim(),
    linkedinUrl: f.linkedinUrl.trim(),
    yelpUrl: f.yelpUrl.trim(),
    googleReviewUrl: f.googleReviewUrl.trim(),
    payments: f.payments
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    currency: f.currency || undefined,
    // "" is sent on purpose: create derives the zone from the number, edit keeps the stored one.
    timezone: f.timezone,
    themeColor: /^#[0-9A-Fa-f]{6}$/.test(f.themeColor.trim())
      ? f.themeColor.trim().toUpperCase()
      : undefined,
    /**
     * Both are sent. The backend dual-writes them (`theme.brand` wins and is copied into the
     * legacy `theme_color` column), so anything still reading the old column — including the
     * microsite's pre-engine code path — keeps working untouched.
     *
     * Normalised on the way out so a hand-edited or stale field can never reach Postgres, and
     * so the optional modifier axes stay ABSENT when they were never overridden.
     */
    theme: normalizeThemeConfig({
      ...f.theme,
      brand: /^#[0-9A-Fa-f]{6}$/.test(f.themeColor.trim()) ? f.themeColor.trim() : f.theme.brand,
    }),
    isActive: f.isActive,
    countryCode: f.countryCode.replace(/\D/g, ""),
    phoneNumber: f.phoneNumber.replace(/\D/g, ""),
    hours: f.hours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      opensAt: h.isClosed ? null : h.opensAt || null,
      closesAt: h.isClosed ? null : h.closesAt || null,
      isClosed: h.isClosed,
    })),
    amenities: f.amenities.map((a) => a.trim()).filter(Boolean),
    gallery: f.gallery.filter((g) => g.url.trim()).map((g) => ({ url: g.url.trim(), alt: g.alt.trim() || null })),
    services: f.services
      .filter((s) => s.name.trim())
      .map((s) => ({
        name: s.name.trim(),
        durationMinutes: Number(s.durationMinutes),
        // No amount at all for an unpriced service — the API stores it as 0 itself.
        priceRupees: s.priceType === "unset" ? undefined : Number(s.priceRupees),
        priceType: s.priceType === "range" || s.priceType === "unset" ? s.priceType : "fixed",
        priceMaxRupees: s.priceType === "range" && s.priceMaxRupees != null ? Number(s.priceMaxRupees) : null,
      })),
    staff: f.staff
      .filter((s) => s.name.trim())
      .map((s) => {
        const raw = (s.commissionPercent ?? "").trim();
        // onSubmit refuses a bad string first. Throwing here is the backstop: turning it into
        // null would save "no rate" and, for a stylist who already has one, the API rejects
        // that clear — or worse, would drop a rate if the check were ever skipped.
        const rateBp = raw ? parseCommissionPercent(raw) : null;
        if (raw && rateBp == null) throw new Error("Invalid commission");
        return {
          name: s.name.trim(),
          roleLabel: s.roleLabel.trim() || null,
          avatarUrl: s.avatarUrl.trim() || null,
          rateBp,
        };
      }),
    faqs: f.faqs.filter((x) => x.q.trim() && x.a.trim()).map((x) => ({ q: x.q.trim(), a: x.a.trim() })),
    reviews: f.reviews
      .filter((r) => r.text.trim() && r.authorName.trim())
      .map((r) => ({ stars: r.stars, text: r.text.trim(), authorName: r.authorName.trim() })),
  };
  if (includeOwner) {
    const ownerPhone = f.ownerPhone.replace(/\D/g, "");
    body.owner = { password: f.ownerPassword, phone: ownerPhone || undefined };
  }
  return body;
}

// ---------------------------------------------------------------------------
// Analytics (read-only) — shapes mirror the /admin analytics endpoints.
// ---------------------------------------------------------------------------

/** Money is integer minor units (paise), matching the backend. */
export interface Money {
  amount: number;
  currency: string;
}

/** Per-store metrics merged into GET /admin/businesses?withMetrics=1. */
export interface StoreMetrics {
  customersCount: number;
  visits30d: number;
  revenue30d: Money;
  plan: "free" | "premium";
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled";
  lastActivityAt: string | null;
}

export type StoreListItemWithMetrics = StoreListItem & StoreMetrics;

/** One day in a zero-filled daily series. */
export interface TrendPoint {
  date: string;
  visits: number;
  revenue: Money;
}

/** GET /admin/analytics/overview — no cross-store money (stores may use different currencies). */
export interface PlatformOverview {
  date: string;
  stores: { total: number; active: number; inactive: number };
  totalCustomers: number;
  today: { visits: number; onlineBookings: number };
  storesByCity: { city: string | null; count: number }[];
  storesByCategory: { category: string | null; count: number }[];
}

/** GET /admin/businesses/:id/analytics */
export interface StoreAnalytics {
  range: "30d" | "90d";
  from: string;
  to: string;
  timezone: string;
  today: { appointments: number; activeQueue: number; completed: number; revenue: Money };
  allTime: {
    customers: number;
    visits: number;
    revenue: Money;
    avgTicket: Money;
    repeatRate: number;
    vipCount: number;
  };
  revenueByDay: TrendPoint[];
  visitSources: { walkIn: number; online: number };
  topServices: { name: string; visits: number; revenue: Money }[];
  topStaff: { id: string; name: string; visits: number; revenue: Money }[];
}

/** GET /admin/businesses/:id/customers */
export interface AdminCustomer {
  id: string;
  name: string;
  phone: string;
  isVip: boolean;
  visitsCount: number;
  lastVisitAt: string | null;
  lastVisitLabel: string;
  totalSpend: Money;
  notes: string | null;
  createdAt: string;
}

export interface CustomersResponse {
  data: AdminCustomer[];
  meta: { shown: number; total: number };
}

/** One (store, customer) record behind a merged platform customer row. */
export interface PlatformCustomerMembership {
  storeId: string;
  customerId: string;
  storeName: string;
}

/** A customer aggregated across stores (same phone across stores = one row). */
export interface PlatformCustomer {
  key: string; // digits-only phone; falls back to storeId:customerId when phone is missing
  name: string;
  phone: string;
  isVip: boolean;
  visitsCount: number; // summed across memberships
  lastVisitAt: string | null;
  lastVisitLabel: string;
  totalSpend: Money | null; // summed only when all memberships share a currency; else the primary store's
  notes: string | null;
  createdAt: string | null; // earliest across memberships
  memberships: PlatformCustomerMembership[];
}

/** GET /admin/businesses/:id/customers/:customerId/visits */
export interface CustomerVisit {
  id: string;
  serviceName: string | null;
  staffName: string | null;
  amount: Money;
  completedAt: string;
}

/** GET /admin/businesses/:id/visits */
export interface VisitRow extends CustomerVisit {
  customerId: string | null;
  customerName: string;
  /**
   * The stylist's commission rate on the visit's own day, in basis points (2000 = 20%) — null when
   * no rate applied (none set yet, or no stylist). Optional: an API older than migration 0034.
   */
  rateBp?: number | null;
  commission?: Money | null;
}

export interface VisitsResponse {
  from: string;
  to: string;
  data: VisitRow[];
  summary: { visits: number; revenue: Money; avgTicket: Money; commission?: Money; salonKeeps?: Money };
  meta: { shown: number; total: number; limit: number };
}

/** One stretch paid at one rate. `from`/`to` are store-local wall times. `rateBp` null = no rate was set. */
export interface CommissionSegment {
  rateBp: number | null;
  from: string;
  to: string;
  visits: number;
  revenue: Money;
  commission: Money;
}

/**
 * GET /admin/businesses/:id/commission — the store's own commission report (each visit at the rate
 * of its own day). This page does not edit rates; the current percent is on the store staff form.
 * See docs/staff-commission.md.
 */
export interface StoreCommission {
  from: string;
  to: string;
  today: string;
  periodLabel: string;
  totals: { visits: number; revenue: Money; commission: Money; salonKeeps: Money | null };
  staff: {
    staffId: string;
    name: string;
    isActive: boolean;
    visits: number;
    revenue: Money;
    commission: Money;
    unratedVisits: number;
    currentRateBp: number | null;
    currentRateFrom: string | null;
    nextRate: { rateBp: number; from: string } | null;
    segments: CommissionSegment[];
  }[];
  unassigned: { visits: number; revenue: Money } | null;
}

/** GET /admin/inquiries — "Request access" leads from the public marketing site. */
export interface InquiryRow {
  id: string;
  businessName: string;
  address: string;
  phone: string;
  submittedAt: string;
}

export interface InquiriesResponse {
  from: string;
  to: string;
  data: InquiryRow[];
  meta: { shown: number; total: number; limit: number };
}

/** GET /admin/businesses/:id/appointments */
export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "no_show";

export interface AppointmentRow {
  id: string;
  customerName: string;
  customerPhone: string | null;
  serviceName: string | null;
  staffName: string | null;
  scheduledStartAt: string;
  status: AppointmentStatus;
  source: "online" | "owner";
}

export interface AppointmentStats {
  total: number;
  byStatus: Record<"pending" | "confirmed" | "checkedIn" | "completed" | "cancelled" | "noShow", number>;
  bySource: { online: number; owner: number };
  noShowRate: number;
  completionRate: number;
  onlineShare: number;
}

export interface AppointmentsResponse {
  from: string;
  to: string;
  data: AppointmentRow[];
  stats: AppointmentStats;
  meta: { shown: number; limit: number };
}

// ---- Platform admins (multi-admin logins + per-employee store scoping) ----

export type AdminRole = "owner" | "employee";

/** The signed-in admin. `role` drives which navigation renders; the backend enforces the rest. */
export interface AdminMe {
  id: string;
  mobile: string;
  name: string;
  role: AdminRole;
}

/** A row on the owner-only Team page. `password_hash` is never sent by the backend. */
export interface AdminTeamMember {
  id: string;
  mobile: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  /** Stores this admin created — what an employee would lose sight of if deactivated. */
  storesCount: number;
  createdAt: string;
}
