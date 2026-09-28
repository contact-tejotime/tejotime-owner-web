/**
 * Store-draft form-state self-check.
 *
 * Framework-free, like import-diff-check.ts: it runs under the `tsx` that backend/ already depends
 * on, so admin-panel gets no test runner (CLAUDE.md §12.2.6). `types.ts` imports through the `@/`
 * alias, so tsx is pointed at admin-panel's tsconfig to resolve it:
 *
 *   npm run test:draft
 *   # or: cd backend && npx tsx --tsconfig ../admin-panel/tsconfig.json ../admin-panel/src/lib/__tests__/draft-check.ts
 *
 * The rules under test: a draft never carries the owner's password, and whatever blob comes back
 * from the server — written by an older build, hand-edited, or half-empty — turns into a form the
 * controlled inputs and the `.map` calls can render without crashing.
 */
import assert from "node:assert/strict";
import { DAY_LABELS, EMPTY_FORM, draftData, draftToForm, type StoreForm } from "../types";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  ✓", name);
};

check("draftData never includes the owner password", () => {
  const data = draftData({ ...EMPTY_FORM, name: "Sharp Cuts", ownerPassword: "hunter2hunter2" });
  assert.equal("ownerPassword" in data, false);
  assert.ok(!JSON.stringify(data).includes("hunter2"));
  assert.equal(data.name, "Sharp Cuts");
});

check("a draft round-trips: every typed field survives draftData -> JSON -> draftToForm", () => {
  const typed: StoreForm = {
    ...EMPTY_FORM,
    name: "Sharp Cuts",
    city: "Pune",
    ownerPhone: "919812345678",
    ownerPassword: "",
    services: [{ name: "Haircut", durationMinutes: 45, priceRupees: 350, priceType: "fixed", priceMaxRupees: null }],
    staff: [{ name: "John", roleLabel: "Barber", avatarUrl: "" }],
    faqs: [{ q: "Walk-ins?", a: "Yes" }],
  };
  const back = draftToForm(JSON.parse(JSON.stringify(draftData(typed))));
  assert.deepEqual(back, typed);
});

check("the password is never restored, even if a stale blob somehow holds one", () => {
  const back = draftToForm({ name: "x", ownerPassword: "leaked" } as never);
  assert.equal(back.ownerPassword, "");
});

check("an empty or missing blob gives the blank form", () => {
  assert.deepEqual(draftToForm({}), EMPTY_FORM);
  assert.deepEqual(draftToForm(null), EMPTY_FORM);
  assert.deepEqual(draftToForm(undefined), EMPTY_FORM);
});

check("an old-shape draft (fields added since are absent) is filled from the blank form", () => {
  const back = draftToForm({ name: "Old store", city: "Pune" });
  assert.equal(back.name, "Old store");
  assert.equal(back.yelpUrl, ""); // a field this draft predates
  assert.equal(back.currency, "INR");
  assert.equal(back.hours.length, DAY_LABELS.length);
});

check("a field of the wrong type is dropped, not passed through", () => {
  const back = draftToForm({
    name: 42,
    city: null,
    services: "nope",
    faqs: { q: "x" },
    isActive: "yes",
  } as never);
  assert.equal(back.name, "");
  assert.equal(back.city, "");
  assert.ok(Array.isArray(back.services) && back.services.length === 1);
  assert.deepEqual(back.faqs, []);
  assert.equal(back.isActive, true);
});

check("missing weekdays are filled in, in weekday order", () => {
  const back = draftToForm({ hours: [{ dayOfWeek: 3, opensAt: "10:00", closesAt: "20:00", isClosed: false }] });
  assert.deepEqual(back.hours.map((h) => h.dayOfWeek), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(back.hours[3]!.opensAt, "10:00");
  assert.equal(back.hours[0]!.opensAt, "09:00");
});

check("empty services / staff lists fall back to one blank row (the form needs a row to type in)", () => {
  const back = draftToForm({ services: [], staff: [] });
  assert.equal(back.services.length, 1);
  assert.equal(back.staff.length, 1);
});

check("a service saved before pricing modes gets a priceType", () => {
  const back = draftToForm({
    services: [
      { name: "A", durationMinutes: 30, priceRupees: 200 },
      { name: "B", durationMinutes: 30, priceRupees: 0 },
    ] as never,
  });
  assert.equal(back.services[0]!.priceType, "fixed");
  assert.equal(back.services[1]!.priceType, "unset");
  assert.equal(back.services[0]!.priceMaxRupees, null);
});

check("a corrupt theme is repaired, and themeColor stays in lockstep with theme.brand", () => {
  const back = draftToForm({ themeColor: "#123456", theme: { preset: "not-a-preset", brand: "nope" } } as never);
  assert.match(back.theme.brand, /^#[0-9A-Fa-f]{6}$/);
  assert.equal(back.themeColor, back.theme.brand);
});

console.log(`\n${n} draft checks passed`);
