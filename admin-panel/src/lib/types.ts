/** Payload shapes shared between the store form and the API route handlers.
 *  These mirror the backend zod schema in backend/src/modules/admin/admin.routes.ts. */

export const DAY_LABELS =["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface HourRow {
  dayOfWeek: number;
  opensAt: string; // "HH:MM" ("" when closed)
  closesAt: string;
  isClosed: boolean;
}
export interface ServiceRow {
  name: string;
  durationMinutes: number;
  priceRupees: number;
}
export interface StaffRow {
  name: string;
  roleLabel: string;
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
  statValue: string;
  statLabel: string;
  description: string;
  aboutHeading: string;
  heroImageUrl: string;
  aboutImageUrl: string;
  establishedYear: string;
  rating: string;
  reviewCount: string;
  payments: string; // comma-separated in the form; split before send
  currency: string; // ISO 4217 code; symbol/name come from lib/currencies.ts
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
  statValue: "",
  statLabel: "",
  description: "",
  aboutHeading: "",
  isActive: true,
  heroImageUrl: "",
  aboutImageUrl: "",
  establishedYear: "",
  rating: "",
  reviewCount: "",
  payments: "UPI, Card, Cash",
  currency: "INR",
  countryCode: "91",
  phoneNumber: "",
  hours: blankHours(),
  amenities: [],
  gallery: [],
  services: [{ name: "", durationMinutes: 30, priceRupees: 0 }],
  staff: [{ name: "", roleLabel: "" }],
  faqs: [],
  reviews: [],
  ownerPassword: "",
};

/** The store-detail shape returned by GET /admin/businesses/:id. */
export interface StoreDetail {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  category: string;
  area: string;
  address: string;
  city: string;
  tagline: string;
  heroSubtitle: string;
  statValue: string;
  statLabel: string;
  description: string;
  aboutHeading: string;
  heroImageUrl: string;
  aboutImageUrl: string;
  establishedYear: string;
  rating: string;
  reviewCount: string;
  payments: string;
  currency: string;
  countryCode: string;
  phoneNumber: string;
  phoneFull: string;
  hours: HourRow[];
  amenities: string[];
  gallery: GalleryRow[];
  services: ServiceRow[];
  staff: StaffRow[];
  faqs: FaqRow[];
  reviews: ReviewRow[];
}

/** Map a backend store detail into editable form state (fills any missing weekday rows). */
export function fromDetail(d: StoreDetail): StoreForm {
  const byDay = new Map(d.hours.map((h) => [h.dayOfWeek, h]));
  const hours = DAY_LABELS.map(
    (_, dayOfWeek) => byDay.get(dayOfWeek) ?? { dayOfWeek, opensAt: "09:00", closesAt: "18:00", isClosed: false },
  );
  return {
    name: d.name,
    category: d.category,
    area: d.area,
    address: d.address,
    city: d.city,
    tagline: d.tagline,
    heroSubtitle: d.heroSubtitle,
    statValue: d.statValue,
    statLabel: d.statLabel,
    description: d.description,
    aboutHeading: d.aboutHeading,
    heroImageUrl: d.heroImageUrl,
    aboutImageUrl: d.aboutImageUrl,
    establishedYear: d.establishedYear,
    rating: d.rating,
    reviewCount: d.reviewCount,
    payments: d.payments,
    currency: d.currency || "INR",
    isActive: d.isActive,
    countryCode: d.countryCode,
    phoneNumber: d.phoneNumber,
    hours,
    amenities: d.amenities,
    gallery: d.gallery,
    services: d.services.length ? d.services : EMPTY_FORM.services,
    staff: d.staff.length ? d.staff : EMPTY_FORM.staff,
    faqs: d.faqs,
    reviews: d.reviews ?? [],
    ownerPassword: "",
  };
}

/** Shape the form state into the backend's expected JSON body. `includeOwner` for create only. */
export function toPayload(f: StoreForm, includeOwner: boolean) {
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    category: f.category.trim() || undefined,
    area: f.area.trim() || undefined,
    address: f.address.trim() || undefined,
    city: f.city.trim() || undefined,
    tagline: f.tagline.trim() || undefined,
    heroSubtitle: f.heroSubtitle.trim() || undefined,
    statValue: f.statValue.trim() || undefined,
    statLabel: f.statLabel.trim() || undefined,
    description: f.description.trim() || undefined,
    aboutHeading: f.aboutHeading.trim() || undefined,
    heroImageUrl: f.heroImageUrl.trim() || undefined,
    aboutImageUrl: f.aboutImageUrl.trim() || undefined,
    establishedYear: num(f.establishedYear),
    rating: num(f.rating),
    reviewCount: num(f.reviewCount),
    payments: f.payments
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    currency: f.currency || undefined,
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
    services: f.services.map((s) => ({
      name: s.name.trim(),
      durationMinutes: Number(s.durationMinutes),
      priceRupees: Number(s.priceRupees),
    })),
    staff: f.staff.map((s) => ({
      name: s.name.trim(),
      roleLabel: s.roleLabel.trim() || null,
    })),
    faqs: f.faqs.filter((x) => x.q.trim() && x.a.trim()).map((x) => ({ q: x.q.trim(), a: x.a.trim() })),
    reviews: f.reviews
      .filter((r) => r.text.trim() && r.authorName.trim())
      .map((r) => ({ stars: r.stars, text: r.text.trim(), authorName: r.authorName.trim() })),
  };
  if (includeOwner) body.owner = { password: f.ownerPassword };
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
}

export interface VisitsResponse {
  from: string;
  to: string;
  data: VisitRow[];
  summary: { visits: number; revenue: Money; avgTicket: Money };
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
