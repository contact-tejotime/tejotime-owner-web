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
  isActive: boolean;
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
  heroImageUrl: "",
  aboutImageUrl: "",
  establishedYear: "",
  rating: "",
  reviewCount: "",
  payments: "UPI, Card, Cash",
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
