/**
 * "Autofill from a link" re-fetch diff self-check.
 *
 * Framework-free, like frontend/src/theme/engine/__tests__/run.ts and
 * app/src/lib/__tests__/responsive-check.ts: it runs under the `tsx` that backend/ already depends
 * on, so admin-panel gets no test runner and no dependency (CLAUDE.md §12.2.6).
 *
 *   npm run test:import-diff
 *   # or: cd backend && npx tsx ../admin-panel/src/lib/__tests__/import-diff-check.ts
 *
 * `diffImportedFields` lives in its own file with type-only imports for exactly this reason —
 * `store-import.ts` pulls in the `@/i18n` alias, which plain tsx cannot resolve.
 *
 * The rule under test: a RE-fetch of the same link offers only what the PAGE changed since the
 * previous fetch — not everything that differs from the form. Fetch once, edit the address on the
 * page, fetch again, and only the address is up for review.
 */
import assert from "node:assert/strict";
import { diffImportedFields } from "../import-diff";
import type { ImportedFields } from "../store-import";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  ✓", name);
};

const first: ImportedFields = {
  name: "Sharp Cuts",
  category: "Salon & Barber",
  tagline: "Fresh cuts",
  address: "12 MG Road",
  city: "Pune",
  countryCode: "91",
  phoneNumber: "9876543210",
  instagramUrl: "https://www.instagram.com/sharpcuts",
  payments: ["UPI", "Cash"],
  amenities: ["Wi-Fi", "AC"],
  hours: [
    { dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00", isClosed: false },
    { dayOfWeek: 2, opensAt: "09:00", closesAt: "18:00", isClosed: false },
    { dayOfWeek: 0, opensAt: null, closesAt: null, isClosed: true },
  ],
  services: [
    { name: "Haircut", durationMinutes: 30, priceRupees: 350, priceType: "fixed", priceMaxRupees: null },
    { name: "Consultation", durationMinutes: null, priceRupees: 0, priceType: "unset", priceMaxRupees: null },
  ],
  staff: [{ name: "John", roleLabel: "Senior stylist" }],
  faqs: [{ q: "Do you take walk-ins?", a: "Yes." }],
};

const clone = (f: ImportedFields): ImportedFields => JSON.parse(JSON.stringify(f));

console.log("DIFF: what the page changed since the last fetch");

check("an unchanged page offers nothing", () => {
  assert.deepEqual(diffImportedFields(first, clone(first)), {});
});

check("only the address changed → only the address is offered", () => {
  const next = clone(first);
  next.address = "99 FC Road";
  assert.deepEqual(diffImportedFields(first, next), { address: "99 FC Road" });
});

check("case and surrounding space are not a change", () => {
  const next = clone(first);
  next.city = "  PUNE ";
  next.tagline = "fresh cuts";
  assert.deepEqual(diffImportedFields(first, next), {});
});

check("a changed phone carries both halves (country code and number)", () => {
  const next = clone(first);
  next.phoneNumber = "9000000001";
  assert.deepEqual(diffImportedFields(first, next), { countryCode: "91", phoneNumber: "9000000001" });
});

check("a field the page no longer states is not offered (absence is not an instruction)", () => {
  const next = clone(first);
  delete next.address;
  delete next.instagramUrl;
  assert.deepEqual(diffImportedFields(first, next), {});
});

check("a field that newly appears is offered", () => {
  const prev = clone(first);
  delete prev.tagline; // the first fetch did not find one
  assert.deepEqual(diffImportedFields(prev, clone(first)), { tagline: "Fresh cuts" });
});

check("hours: only the day that changed is offered", () => {
  const next = clone(first);
  next.hours = next.hours!.map((h) => (h.dayOfWeek === 2 ? { ...h, closesAt: "20:00" } : h));
  assert.deepEqual(diffImportedFields(first, next), {
    hours: [{ dayOfWeek: 2, opensAt: "09:00", closesAt: "20:00", isClosed: false }],
  });
});

check("hours: a day newly closed is offered", () => {
  const next = clone(first);
  next.hours = next.hours!.map((h) => (h.dayOfWeek === 1 ? { dayOfWeek: 1, opensAt: null, closesAt: null, isClosed: true } : h));
  assert.deepEqual(diffImportedFields(first, next).hours, [{ dayOfWeek: 1, opensAt: null, closesAt: null, isClosed: true }]);
});

check("services: only a NEW service (by name) is offered — existing ones, even edited, are not", () => {
  const next = clone(first);
  next.services = [
    { name: "haircut", durationMinutes: 45, priceRupees: 999, priceType: "fixed", priceMaxRupees: null }, // same service, edited
    ...next.services!.slice(1),
    { name: "Beard Trim", durationMinutes: null, priceRupees: 0, priceType: "unset", priceMaxRupees: null },
  ];
  assert.deepEqual(diffImportedFields(first, next).services, [
    { name: "Beard Trim", durationMinutes: null, priceRupees: 0, priceType: "unset", priceMaxRupees: null },
  ]);
});

check("staff, FAQs and amenities: only the new ones are offered", () => {
  const next = clone(first);
  next.staff = [...next.staff!, { name: "Lisa", roleLabel: "Stylist" }];
  next.faqs = [...next.faqs!, { q: "Do you take cards?", a: "Yes." }];
  next.amenities = [...next.amenities!, "Parking"];
  const d = diffImportedFields(first, next);
  assert.deepEqual(d.staff, [{ name: "Lisa", roleLabel: "Stylist" }]);
  assert.deepEqual(d.faqs, [{ q: "Do you take cards?", a: "Yes." }]);
  assert.deepEqual(d.amenities, ["Parking"]);
});

check("payments: same set in a different case/order is unchanged; a new method is a change", () => {
  const same = clone(first);
  same.payments = ["cash", "upi"];
  assert.equal(diffImportedFields(first, same).payments, undefined);
  const more = clone(first);
  more.payments = ["UPI", "Cash", "Card"];
  assert.deepEqual(diffImportedFields(first, more).payments, ["UPI", "Cash", "Card"]);
});

check("only changed keys appear in the result at all", () => {
  const next = clone(first);
  next.address = "99 FC Road";
  next.city = "Mumbai";
  assert.deepEqual(Object.keys(diffImportedFields(first, next)).sort(), ["address", "city"]);
});

console.log(`\nimport-diff self-check: ${n} checks passed`);
