/**
 * The nine live stores behind the homepage industries grid.
 *
 * Each card used to open a marketing page (`/hair-salons`, …). It now opens a real, fully working
 * store at a short URL (`/salon`), which next.config.ts rewrites onto that store's phone microsite
 * (`/15125550101`). They are ordinary tenants, provisioned by `backend/scripts/provision-demo-stores.mjs`
 * and edited in the admin panel like any other store — nothing on the page calls them a demo.
 *
 * Three rules keep this file honest:
 * - **Order matches `en.json` → `landingData.industries`.** Card copy is paired with a store by
 *   position, so reordering one without the other puts "Barbershops" on the nail salon.
 * - **No imports, ever.** next.config.ts imports this file, and the config transpiler cannot
 *   resolve `@/` or pull in i18n (which is why the old slug list was hand-copied into the config).
 * - **Mirrored in `backend/scripts/demo-stores.json`** (the backend cannot import from frontend/,
 *   CLAUDE.md §1). `npm run check:demo-stores` fails if path, phone, legacy slug or order drift.
 *
 * The phones and paths are frozen: the old industry URLs 308 to `path` permanently (browsers and
 * search engines cache that), and `phone` is the store's `business.phone_full`, which the rewrite
 * targets. See docs/demo-stores.md.
 */
export const INDUSTRY_STORES = [
  { slug: "hair-salons", path: "salon", phone: "15125550101" },
  { slug: "barbershops", path: "barber", phone: "17185550102" },
  { slug: "nail-studios", path: "nail", phone: "13055550103" },
  { slug: "spas", path: "spa", phone: "14805550104" },
  { slug: "med-spas", path: "medspa", phone: "13105550105" },
  { slug: "massage-therapy", path: "massage", phone: "13035550106" },
  { slug: "physical-therapy", path: "physio", phone: "13125550107" },
  { slug: "tattoo-studios", path: "tattoo", phone: "12065550108" },
  { slug: "pet-grooming", path: "pet", phone: "14045550109" },
] as const;

/** The retired industry-page slug, still the key for each card's stock photo. */
export type IndustrySlug = (typeof INDUSTRY_STORES)[number]["slug"];

/** True for one of the nine stores' phone microsites — they are kept out of search engines. */
export function isIndustryStorePhone(phone: string): boolean {
  return INDUSTRY_STORES.some((s) => s.phone === phone);
}

/** True when an href is one of the nine short store URLs (`/salon`, …). */
export function isIndustryStorePath(href: string): boolean {
  return INDUSTRY_STORES.some((s) => `/${s.path}` === href);
}
