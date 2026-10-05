/**
 * Which kind of store a category describes: beauty, clinic, food, fitness or generic.
 *
 * The customer page uses it to pick its wording and section order (components/microsite/domains.ts),
 * including the default gallery heading. The setup screens use the same answer to offer the
 * ready-made gallery headings and headline suggestions for that kind of store
 * (docs/store-setup-review-2026-10-05.md). They must agree, which is why there is only one matcher.
 *
 * SOURCE OF TRUTH: frontend/src/lib/store-family.ts. Copied byte for byte into
 * admin-panel/src/lib, owner-web/src/lib and app/src/lib by scripts/sync-store-family.mjs
 * (`npm run sync:family`; `npm run check:family` verifies). Never edit a copy. Each app builds from
 * its own folder, so a shared package at the repo root would not be in any build context.
 *
 * Import-free on purpose, so all four apps and `npm run test:family` can load it as plain TS.
 *
 * Matching is the lowercased category, substring-matched in the order below, so a new category
 * like "Dental Clinic" lands on clinic. Substring matching has known quirks that are kept for
 * now: "Coworking Space" contains "spa" and so reads as beauty. Anything unmatched is "generic".
 */

export type StoreFamily = "beauty" | "clinic" | "food" | "fitness" | "generic";

export const STORE_FAMILY_KEYWORDS: readonly { family: Exclude<StoreFamily, "generic">; match: readonly string[] }[] = [
  { family: "beauty", match: ["salon", "barber", "beauty", "parlour", "parlor", "spa", "nail", "tattoo"] },
  { family: "clinic", match: ["hospital", "clinic", "dental", "dentist", "medical", "health", "diagnostic", "pet"] },
  { family: "food", match: ["restaurant", "cafe", "coffee", "bakery", "food", "dhaba", "bar", "kitchen"] },
  { family: "fitness", match: ["gym", "fitness", "yoga", "crossfit", "sport", "studio", "academy"] },
];

/** Never throws; an empty or unknown category is "generic". */
export function familyFor(category: string | null | undefined): StoreFamily {
  const c = (category ?? "").toLowerCase();
  if (!c) return "generic";
  for (const { family, match } of STORE_FAMILY_KEYWORDS) {
    if (match.some((m) => c.includes(m))) return family;
  }
  return "generic";
}
