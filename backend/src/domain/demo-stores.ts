/**
 * The nine homepage industry stores (docs/demo-stores.md). Each homepage card opens one, so they are
 * real, working tenants — but they are TejoTime's showcase, not a customer's business. The admin
 * panel therefore lists them apart as "Demo stores", leaves them out of every platform figure
 * (dashboard, Customers, Reports, Billing, Team), and refuses to disable them: switching one off
 * turns its homepage card into a 404.
 *
 * Identified by `business.phone_full`, the same way the frontend reaches them. A store's phone is
 * its web address and is locked once set (PHONE_LOCKED in admin.service), so this list cannot drift
 * from the stores it names. Same idea as `DEMO_SLUG` for /demo-store, and deliberately not a
 * column: no migration, so a local API running against a shared database keeps working.
 *
 * `industry` is the homepage card the store sits behind, worded exactly as the card
 * (frontend en.json → landingData.industries[].name). Every one of these stores has the category
 * "Salon & Barber" (it gives all nine neutral page wording), so the panel shows the industry instead
 * — that is what tells "Polished Nail Lounge" apart from "Main Street Barber Co.".
 *
 * Mirrored in frontend/src/lib/industryStores.ts and backend/scripts/demo-stores.json — the
 * backend cannot import either (CLAUDE.md §1). `npm run check:demo-stores` fails on drift,
 * including an industry label that no longer matches its card. Keep this file import-free: that
 * guard loads it through tsx.
 */
export const DEMO_STORES: readonly { phone: string; industry: string }[] = [
  { phone: '15125550101', industry: 'Hair salons' }, // /salon
  { phone: '17185550102', industry: 'Barbershops' }, // /barber
  { phone: '13055550103', industry: 'Nail studios' }, // /nail
  { phone: '14805550104', industry: 'Spas' }, // /spa
  { phone: '13105550105', industry: 'Med spas' }, // /medspa
  { phone: '13035550106', industry: 'Massage therapy' }, // /massage
  { phone: '13125550107', industry: 'Physical therapy' }, // /physio
  { phone: '12065550108', industry: 'Tattoo studios' }, // /tattoo
  { phone: '14045550109', industry: 'Pet grooming' }, // /pet
];

export const DEMO_STORE_PHONES: readonly string[] = DEMO_STORES.map((s) => s.phone);

const INDUSTRY_BY_PHONE = new Map(DEMO_STORES.map((s) => [s.phone, s.industry]));

export function isDemoStorePhone(phoneFull: string | null | undefined): boolean {
  return !!phoneFull && INDUSTRY_BY_PHONE.has(phoneFull);
}

/** The homepage card a demo store backs ("Hair salons"), or null for any other store. */
export function demoStoreIndustry(phoneFull: string | null | undefined): string | null {
  return (phoneFull && INDUSTRY_BY_PHONE.get(phoneFull)) || null;
}
