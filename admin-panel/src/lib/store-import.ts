/**
 * "Autofill from a link" — the client half. Pure (no React, no fetch), so the review/merge rules
 * are easy to reason about.
 *
 * `ImportedFields` is HAND-MIRRORED from backend/src/modules/admin/store-import.service.ts. Nothing
 * type-checks the two together (the API route casts JSON straight to it), so a field added on one
 * side and not the other renders `undefined` at runtime — change both together.
 */
import { t } from "@/i18n";
import { currencySymbol } from "@/lib/currencies";
import {
  DAY_LABELS,
  type FaqRow,
  type HourRow,
  type ServiceRow,
  type StaffRow,
  type StoreForm,
} from "@/lib/types";

export interface ImportedHour {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

/**
 * A service as the API returns it. `durationMinutes` is null when the page stated no time — the
 * backend no longer guesses one — and `applyImport` turns that into a blank box in the form.
 */
export type ImportedService = Omit<
  Pick<ServiceRow, "name" | "durationMinutes" | "priceRupees" | "priceType" | "priceMaxRupees">,
  "durationMinutes"
> & { durationMinutes: number | null };

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
  faqs?: FaqRow[];
}

export interface StoreImportResponse {
  source: { url: string; title: string };
  fields: ImportedFields;
  warnings: string[];
}

/** One tickable row in the review dialog. `key` is what `applyImport` switches on. */
export type ImportKey =
  | "name" | "category" | "tagline" | "heroSubtitle" | "address" | "area" | "city" | "phone"
  | "aboutHeading" | "description" | "establishedYear"
  | "instagramUrl" | "facebookUrl" | "twitterUrl" | "linkedinUrl" | "yelpUrl"
  | "hours" | "services" | "staff" | "faqs" | "amenities" | "payments";

export type ImportGroup = "basics" | "address" | "about" | "social" | "hours" | "services" | "team" | "faqs" | "extras";

export interface ImportItem {
  key: ImportKey;
  group: ImportGroup;
  label: string;
  /** What we found, rendered for the eye. */
  found: string;
  /** What is in the form now — shown only for a replace. */
  current: string;
  /** True when applying would overwrite something the admin already has. */
  replaces: boolean;
  /** Lists append rather than overwrite; the row says how many are already there. */
  existingCount?: number;
}

export const IMPORT_GROUP_ORDER: ImportGroup[] = ["basics", "address", "about", "social", "hours", "services", "team", "faqs", "extras"];

export const IMPORT_GROUP_LABEL: Record<ImportGroup, string> = {
  basics: t.storeImport.groupBasics,
  address: t.storeImport.groupAddress,
  about: t.storeImport.groupAbout,
  social: t.storeImport.groupSocial,
  hours: t.storeImport.groupHours,
  services: t.storeImport.groupServices,
  team: t.storeImport.groupTeam,
  faqs: t.storeImport.groupFaqs,
  extras: t.storeImport.groupExtras,
};

/** Monday-first, like the form's own hours table. */
const HOURS_ORDER = [1, 2, 3, 4, 5, 6, 0];

const SCALARS: Array<{ key: Extract<ImportKey, keyof StoreForm & keyof ImportedFields>; group: ImportGroup; label: string }> = [
  { key: "name", group: "basics", label: t.storeImport.fieldName },
  { key: "category", group: "basics", label: t.storeImport.fieldCategory },
  { key: "tagline", group: "basics", label: t.storeImport.fieldTagline },
  { key: "heroSubtitle", group: "basics", label: t.storeImport.fieldHeroSubtitle },
  { key: "address", group: "address", label: t.storeImport.fieldAddress },
  { key: "area", group: "address", label: t.storeImport.fieldArea },
  { key: "city", group: "address", label: t.storeImport.fieldCity },
  { key: "aboutHeading", group: "about", label: t.storeImport.fieldAboutHeading },
  { key: "description", group: "about", label: t.storeImport.fieldDescription },
  { key: "establishedYear", group: "about", label: t.storeImport.fieldEstablishedYear },
  { key: "instagramUrl", group: "social", label: t.storeImport.fieldInstagram },
  { key: "facebookUrl", group: "social", label: t.storeImport.fieldFacebook },
  { key: "twitterUrl", group: "social", label: t.storeImport.fieldTwitter },
  { key: "linkedinUrl", group: "social", label: t.storeImport.fieldLinkedin },
  { key: "yelpUrl", group: "social", label: t.storeImport.fieldYelp },
];

const clock = (h: ImportedHour | HourRow) => (h.isClosed ? t.storeImport.closed : `${h.opensAt}–${h.closesAt}`);

/** `sym` is the form's currency symbol — the store's, not a fixed ₹ (a USD store showed ₹ here). */
function priceLabel(s: NonNullable<ImportedFields["services"]>[number], sym: string): string {
  if (s.priceType === "range") return ` ${sym}${s.priceRupees}–${sym}${s.priceMaxRupees}`;
  if (s.priceType === "fixed") return ` ${sym}${s.priceRupees}`;
  return "";
}

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

const hasName = (rows: Array<{ name: string }>) => rows.filter((r) => r.name.trim());

/**
 * What is worth showing the admin: only values that would change something. A found value that is
 * already in the form (case-insensitively) is dropped, so the dialog is a list of decisions, not
 * a wall of no-ops.
 *
 * `phoneLocked` mirrors StoreForm's rule that a saved store's phone can never change (the backend
 * answers 409 PHONE_LOCKED), so offering it on such a store would be offering an error.
 */
export function buildImportItems(form: StoreForm, fields: ImportedFields, opts: { phoneLocked: boolean }): ImportItem[] {
  const items: ImportItem[] = [];

  for (const { key, group, label } of SCALARS) {
    const raw = fields[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const found = String(raw);
    const current = String(form[key] ?? "").trim();
    if (current.toLowerCase() === found.toLowerCase()) continue;
    items.push({ key, group, label, found: clip(found), current: clip(current), replaces: current !== "" });
  }

  if (fields.phoneNumber && fields.countryCode && !opts.phoneLocked) {
    const found = `+${fields.countryCode} ${fields.phoneNumber}`;
    const current = form.phoneNumber.trim() ? `+${form.countryCode} ${form.phoneNumber}` : "";
    if (current !== found) {
      items.push({ key: "phone", group: "address", label: t.storeImport.fieldPhone, found, current, replaces: current !== "" });
    }
  }

  if (fields.hours?.length) {
    const byDay = new Map(fields.hours.map((h) => [h.dayOfWeek, h]));
    const changed = HOURS_ORDER.filter((d) => {
      const f = byDay.get(d);
      const cur = form.hours.find((h) => h.dayOfWeek === d);
      return f && cur && (f.isClosed !== cur.isClosed || (!f.isClosed && (f.opensAt !== cur.opensAt || f.closesAt !== cur.closesAt)));
    });
    if (changed.length) {
      items.push({
        key: "hours",
        group: "hours",
        label: t.storeImport.fieldHours,
        found: changed.map((d) => `${DAY_LABELS[d].slice(0, 3)} ${clock(byDay.get(d)!)}`).join("\n"),
        current: changed.map((d) => `${DAY_LABELS[d].slice(0, 3)} ${clock(form.hours.find((h) => h.dayOfWeek === d)!)}`).join("\n"),
        // A blank create form ships 09:00–18:00 placeholders, not the admin's data — overwriting
        // them is the point, so it only counts as a "replace" when editing a real store.
        replaces: Boolean(form.name.trim()),
      });
    }
  }

  const appendList = <T extends { name: string }>(
    key: ImportKey,
    group: ImportGroup,
    label: string,
    found: T[] | undefined,
    existing: T[],
    show: (r: T) => string,
  ) => {
    if (!found?.length) return;
    const have = new Set(hasName(existing).map((r) => r.name.trim().toLowerCase()));
    const fresh = found.filter((r) => !have.has(r.name.trim().toLowerCase()));
    if (!fresh.length) return;
    items.push({
      key, group, label,
      found: fresh.map(show).join("\n"),
      current: "",
      replaces: false,
      existingCount: hasName(existing).length || undefined,
    });
  };
  appendList("services", "services", t.storeImport.fieldServices, fields.services, form.services, (s) => `${s.name}${s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}${priceLabel(s, currencySymbol(form.currency))}`);
  appendList<{ name: string; roleLabel: string }>("staff", "team", t.storeImport.fieldStaff, fields.staff, form.staff, (s) => (s.roleLabel ? `${s.name} — ${s.roleLabel}` : s.name));

  if (fields.faqs?.length) {
    const have = new Set(form.faqs.map((f) => f.q.trim().toLowerCase()));
    const fresh = fields.faqs.filter((f) => !have.has(f.q.trim().toLowerCase()));
    if (fresh.length) {
      items.push({
        key: "faqs", group: "faqs", label: t.storeImport.fieldFaqs,
        found: fresh.map((f) => `Q: ${f.q}\nA: ${clip(f.a, 160)}`).join("\n\n"),
        current: "", replaces: false, existingCount: form.faqs.length || undefined,
      });
    }
  }

  if (fields.amenities?.length) {
    const have = new Set(form.amenities.map((a) => a.trim().toLowerCase()));
    const fresh = fields.amenities.filter((a) => !have.has(a.toLowerCase()));
    if (fresh.length) {
      items.push({
        key: "amenities", group: "extras", label: t.storeImport.fieldAmenities,
        found: fresh.join(", "), current: "", replaces: false, existingCount: form.amenities.filter((a) => a.trim()).length || undefined,
      });
    }
  }

  if (fields.payments?.length) {
    const current = form.payments.trim();
    const found = fields.payments.join(", ");
    if (current.toLowerCase() !== found.toLowerCase()) {
      items.push({ key: "payments", group: "extras", label: t.storeImport.fieldPayments, found, current, replaces: current !== "" });
    }
  }

  return items;
}

/** Tick the rows that only fill gaps; leave the ones that overwrite for the admin to opt into. */
export function defaultSelection(items: ImportItem[]): Set<ImportKey> {
  return new Set(items.filter((i) => !i.replaces).map((i) => i.key));
}

/** A blank placeholder row (the form ships one empty service and staff row) is not user data. */
const nonBlank = <T extends { name: string }>(rows: T[]) => rows.filter((r) => r.name.trim());

/**
 * True while a CREATE form holds nothing the admin typed: no identity text and no real service or
 * staff row (the blank placeholder rows and the default hours/payments do not count). Only then may
 * a fetch be applied without the review dialog — every row is a gap-fill and nothing can be
 * overwritten. The dialog stays for anything else, because its "Replaces / Currently: …" rows are
 * the only thing standing between a fetch and the admin's own edits.
 */
export function isPristineCreate(form: StoreForm): boolean {
  const typed = [form.name, form.category, form.tagline, form.description, form.address, form.area, form.city];
  return typed.every((v) => !v.trim()) && nonBlank(form.services).length === 0 && nonBlank(form.staff).length === 0;
}

/**
 * Merge the ticked items into the form. Scalars overwrite; hours overwrite only the days the page
 * named (an unmentioned day is unknown, not closed); services / staff / FAQs / amenities append and
 * never duplicate. Untouched fields — images, theme, reviews, the owner login — are never read here.
 */
export function applyImport(form: StoreForm, fields: ImportedFields, selected: ReadonlySet<ImportKey>): StoreForm {
  const next: StoreForm = { ...form };

  for (const { key } of SCALARS) {
    const v = fields[key];
    if (selected.has(key) && v !== undefined && v !== null && v !== "") {
      (next as unknown as Record<string, string>)[key] = String(v);
    }
  }

  if (selected.has("phone") && fields.phoneNumber && fields.countryCode) {
    next.countryCode = fields.countryCode;
    next.phoneNumber = fields.phoneNumber;
  }

  if (selected.has("hours") && fields.hours) {
    const byDay = new Map(fields.hours.map((h) => [h.dayOfWeek, h]));
    next.hours = form.hours.map((h) => {
      const f = byDay.get(h.dayOfWeek);
      if (!f) return h;
      return f.isClosed
        ? { ...h, isClosed: true }
        : { ...h, isClosed: false, opensAt: f.opensAt ?? h.opensAt, closesAt: f.closesAt ?? h.closesAt };
    });
  }

  if (selected.has("services") && fields.services) {
    const kept = nonBlank(form.services);
    const have = new Set(kept.map((s) => s.name.trim().toLowerCase()));
    const added: ServiceRow[] = fields.services
      .filter((s) => !have.has(s.name.trim().toLowerCase()))
      // A page that states no time gives null, and the form's number field holds 0 for "blank"
      // (it renders `durationMinutes || ""`). Nothing is invented here: saving is blocked until
      // the admin types the real time.
      .map((s) => ({ ...s, durationMinutes: s.durationMinutes ?? 0 }));
    next.services = [...kept, ...added].slice(0, 50);
  }

  if (selected.has("staff") && fields.staff) {
    const kept = nonBlank(form.staff);
    const have = new Set(kept.map((s) => s.name.trim().toLowerCase()));
    const added: StaffRow[] = fields.staff
      .filter((s) => !have.has(s.name.trim().toLowerCase()))
      .map((s) => ({ name: s.name, roleLabel: s.roleLabel, avatarUrl: "", commissionPercent: "" }));
    next.staff = [...kept, ...added].slice(0, 50);
  }

  if (selected.has("faqs") && fields.faqs) {
    const have = new Set(form.faqs.map((f) => f.q.trim().toLowerCase()));
    next.faqs = [...form.faqs, ...fields.faqs.filter((f) => !have.has(f.q.trim().toLowerCase()))].slice(0, 30);
  }

  if (selected.has("amenities") && fields.amenities) {
    const have = new Set(form.amenities.map((a) => a.trim().toLowerCase()));
    next.amenities = [...form.amenities.filter((a) => a.trim()), ...fields.amenities.filter((a) => !have.has(a.toLowerCase()))].slice(0, 30);
  }

  if (selected.has("payments") && fields.payments) next.payments = fields.payments.join(", ");

  return next;
}

/** Client-side check before spending a request (and an hourly-limited LLM call) on a typo. */
export function normalizeImportUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Admins paste "www.site.com" all the time; assume https rather than reject it.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
