/**
 * What did the PAGE change between two fetches of the same link?
 *
 * Pure, and deliberately free of runtime imports (type-only ones are erased): that is what lets
 * `__tests__/import-diff-check.ts` run under plain `tsx`, where the `@/i18n` alias that
 * `store-import.ts` needs cannot resolve.
 *
 * Why it exists. `buildImportItems` compares a fetch against the FORM, so a re-fetch re-offers
 * everything the admin has since edited by hand ("Replaces / Currently: …"), which buries the one
 * thing that actually changed. Fetch once, change the address on the page, fetch again: the admin
 * wants the address and nothing else. So a re-fetch of the same link is first reduced to what
 * differs from the PREVIOUS fetch, and only then compared against the form as usual.
 *
 * Rules:
 * - Scalars (and the five social links) are included when the new value differs from the old one,
 *   ignoring case and surrounding space. Phone is one unit: country code + number travel together.
 * - A value the page no longer states is NOT included — absence is not an instruction to blank it.
 * - Hours: only the days that changed (or newly appeared).
 * - Services / staff / FAQs / amenities: only entries the previous fetch did not have (by name /
 *   question, case-insensitively). `applyImport` never updates an existing entry either, so an edit
 *   to one already in the form has nowhere to land.
 * - Payments: included when the set of methods differs, ignoring case and order.
 */
import type { ImportedFields, ImportedHour } from "./store-import";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** The plain-value fields, compared one by one. (Phone and the lists are handled separately.) */
const SCALAR_KEYS = [
  "name", "category", "tagline", "aboutHeading", "description", "heroSubtitle",
  "area", "city", "address", "establishedYear",
  "instagramUrl", "facebookUrl", "twitterUrl", "linkedinUrl", "yelpUrl",
] as const;

const sameHour = (a: ImportedHour, b: ImportedHour) =>
  a.isClosed === b.isClosed && (a.isClosed || (a.opensAt === b.opensAt && a.closesAt === b.closesAt));

export function diffImportedFields(prev: ImportedFields, next: ImportedFields): ImportedFields {
  const out: ImportedFields = {};

  for (const key of SCALAR_KEYS) {
    const now = next[key];
    if (now === undefined || now === null || now === "") continue;
    if (norm(prev[key]) !== norm(now)) (out as Record<string, unknown>)[key] = now;
  }

  if (next.phoneNumber && next.countryCode) {
    if (norm(prev.phoneNumber) !== norm(next.phoneNumber) || norm(prev.countryCode) !== norm(next.countryCode)) {
      out.countryCode = next.countryCode;
      out.phoneNumber = next.phoneNumber;
    }
  }

  if (next.hours?.length) {
    const before = new Map((prev.hours ?? []).map((h) => [h.dayOfWeek, h]));
    const changed = next.hours.filter((h) => {
      const old = before.get(h.dayOfWeek);
      return !old || !sameHour(old, h);
    });
    if (changed.length) out.hours = changed;
  }

  const fresh = <T>(now: T[] | undefined, was: T[] | undefined, id: (x: T) => string): T[] => {
    if (!now?.length) return [];
    const had = new Set((was ?? []).map((x) => norm(id(x))));
    return now.filter((x) => !had.has(norm(id(x))));
  };

  const services = fresh(next.services, prev.services, (s) => s.name);
  if (services.length) out.services = services;
  const staff = fresh(next.staff, prev.staff, (s) => s.name);
  if (staff.length) out.staff = staff;
  const faqs = fresh(next.faqs, prev.faqs, (f) => f.q);
  if (faqs.length) out.faqs = faqs;
  const amenities = fresh(next.amenities, prev.amenities, (a) => a);
  if (amenities.length) out.amenities = amenities;

  if (next.payments?.length) {
    const key = (p: string[] | undefined) => (p ?? []).map(norm).sort().join("|");
    if (key(prev.payments) !== key(next.payments)) out.payments = next.payments;
  }

  return out;
}
