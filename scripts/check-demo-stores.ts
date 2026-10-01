/**
 * Guard: the homepage industry stores are described in three places that must agree.
 *
 * - `frontend/src/lib/industryStores.ts` — drives the cards, footer links, the /salon → /<phone>
 *   rewrites, the 308s from the old industry URLs, and the noindex rule.
 * - `backend/scripts/demo-stores.json` — the data sheet the provisioning script creates the stores
 *   from and the smoke test verifies them against.
 * - `backend/src/domain/demo-stores.ts` — how the admin API recognises them (isDemo, left out of
 *   platform figures, never disable-able).
 *
 * They are copies because each app is Docker-built from its own folder (CLAUDE.md §1). The failure
 * this catches is silent: change a phone in one and /salon rewrites to a number no store has (a
 * 404 behind a homepage card), or reorder one and "Barbershops" opens the nail salon.
 *
 * Run from the repo root:  npm run check:demo-stores
 *
 * Importing the frontend module through `tsx` also proves it is still dependency-free — an `@/`
 * import added there would fail here before it fails next.config.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDUSTRY_STORES } from '../frontend/src/lib/industryStores';
import { DEMO_STORES, DEMO_STORE_PHONES } from '../backend/src/domain/demo-stores';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sheet = JSON.parse(readFileSync(join(ROOT, 'backend/scripts/demo-stores.json'), 'utf8'));
const landing = JSON.parse(readFileSync(join(ROOT, 'frontend/src/i18n/en.json'), 'utf8')).landingData;

const problems: string[] = [];

if (sheet.stores.length !== INDUSTRY_STORES.length) {
  problems.push(`count: frontend has ${INDUSTRY_STORES.length}, sheet has ${sheet.stores.length}`);
}
// Card copy is paired with a store by position, so the card list must be the same length.
if (landing.industries.length !== INDUSTRY_STORES.length) {
  problems.push(`en.json landingData.industries has ${landing.industries.length} cards for ${INDUSTRY_STORES.length} stores`);
}

INDUSTRY_STORES.forEach((f, i) => {
  const s = sheet.stores[i];
  if (!s) return;
  const sheetPhone = `${s.store.countryCode}${s.store.phoneNumber}`;
  if (f.path !== s.path) problems.push(`[${i}] path: frontend "${f.path}", sheet "${s.path}"`);
  if (f.slug !== s.legacySlug) problems.push(`[${i}] legacy slug: frontend "${f.slug}", sheet "${s.legacySlug}"`);
  if (f.phone !== sheetPhone) problems.push(`[${i}] phone: frontend ${f.phone}, sheet ${sheetPhone}`);
});

// The admin API's list: same phones (order is irrelevant there — it is a membership test).
const frontendPhones = INDUSTRY_STORES.map((s) => s.phone as string).sort();
const backendPhones = [...DEMO_STORE_PHONES].sort();
if (frontendPhones.join() !== backendPhones.join()) {
  const missing = frontendPhones.filter((p) => !backendPhones.includes(p));
  const extra = backendPhones.filter((p) => !frontendPhones.includes(p));
  problems.push(`backend/src/domain/demo-stores.ts: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
}

// The admin panel labels each one with its homepage card ("Hair salons"): same words as the card.
INDUSTRY_STORES.forEach((f, i) => {
  const card = landing.industries[i]?.name;
  const label = DEMO_STORES.find((d) => d.phone === f.phone)?.industry;
  if (card && label !== card) problems.push(`[${i}] admin industry label "${label}" ≠ homepage card "${card}"`);
});

// The footer's Industries column links to the same nine short URLs.
const expected = new Set(INDUSTRY_STORES.map((s) => `/${s.path}`));
const footerHrefs = landing.footerCols
  .flatMap((c: { links: { href: string }[] }) => c.links.map((l) => l.href))
  .filter((h: string) => expected.has(h));
if (new Set(footerHrefs).size !== expected.size) {
  const missing = [...expected].filter((h) => !footerHrefs.includes(h));
  problems.push(`footer is missing store links: ${missing.join(', ')}`);
}

if (problems.length) {
  console.error('✗ industry stores drifted between frontend and the backend data sheet:');
  problems.forEach((p) => console.error('  -', p));
  process.exit(1);
}
console.log(
  `✓ industry stores agree: ${INDUSTRY_STORES.length} stores, frontend map = data sheet = admin API list = footer links`,
);
