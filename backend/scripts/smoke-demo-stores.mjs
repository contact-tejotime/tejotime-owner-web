// End-to-end smoke test for the nine homepage industry stores (docs/demo-stores.md).
//
// Unlike smoke-rest.mjs this needs NO seed: it runs against an environment where
// provision-demo-stores.mjs has already created the stores (preprod, prod, or a local API you
// provisioned). It is read-only apart from owner logins, whose sessions it revokes again.
//
// RUNNING IT
//   bash:
//     SMOKE_BASE_URL=https://api-preprod.tejotime.com/api/v1 \
//     SMOKE_WEB_URL=https://preprod.tejotime.com node scripts/smoke-demo-stores.mjs
//   PowerShell:
//     $env:SMOKE_BASE_URL='https://api-preprod.tejotime.com/api/v1'
//     $env:SMOKE_WEB_URL='https://preprod.tejotime.com'; node scripts/smoke-demo-stores.mjs
//
//   SMOKE_WEB_URL is optional: without it the WEB section is reported SKIPPED, which is the
//   right first run — provision the stores, check the API side, THEN deploy the frontend.
//   SMOKE_ADMIN_MOBILE + SMOKE_ADMIN_PASSWORD (an owner-role admin) are optional too: they enable
//   the ADMIN section — the stores are flagged isDemo, left out of the dashboard and Team counts,
//   and refuse to be disabled. That refusal is sent as a bare { isActive: false }, which the API
//   checks BEFORE validating the body: if the guard were broken it would fail validation (400),
//   never write, so it is safe against a live environment.
//
// What it proves, per store: the page a homepage card opens is that store, in USD and the right
// US time zone, with the agreed services/staff/hours/reviews/theme and no "demo" anywhere;
// tomorrow has bookable times; the owner login works on its own store and is premium. And on the
// web: /<word> renders the store with an invisible noindex, every old industry URL 308s straight
// to it, the cards open in a new tab, and /demo-store and plain phone pages are untouched.
//
// Budget: ~20 publicRead calls (60/min) and 11 logins (loginIp 60 per 5 min). A name check
// fails if an admin renamed a store in the panel — update demo-stores.json when that is intended.
import { readFileSync } from 'node:fs';

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1').replace(/\/+$/, '');
const WEB = process.env.SMOKE_WEB_URL?.trim().replace(/\/+$/, '');
const ADMIN_MOBILE = process.env.SMOKE_ADMIN_MOBILE?.trim();
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const SHEET = JSON.parse(readFileSync(new URL('./demo-stores.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Bing's UA is on Next's "HTML-limited bot" list, so metadata is rendered into <head> before the
// body rather than streamed after it. The noindex check below searches the whole document either
// way; this just makes the response look like what a crawler actually receives.
const BOT_UA = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
async function page(path) {
  const res = await fetch(WEB + path, { redirect: 'manual', headers: { 'user-agent': BOT_UA } });
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location'), html };
}

const phoneOf = (e) => `${e.store.countryCode}${e.store.phoneNumber}`;
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const hasNoindex = (html) => /<meta[^>]+name="robots"[^>]+content="noindex/i.test(html);
/** Tomorrow's calendar date in the store's own zone — the date the slots endpoint expects. */
const tomorrowIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + 864e5));

async function apiSection() {
  console.log(`API  ${BASE}`);
  for (const e of SHEET.stores) {
    const s = e.store;
    console.log(`/${e.path} — ${s.name}`);
    const r = await call('GET', `/public/businesses/by-phone/${phoneOf(e)}`);
    ok(r.status === 200, `store page resolves by phone ${phoneOf(e)} (got ${r.status})`);
    if (r.status !== 200) continue;
    const site = r.json;
    ok(site.name === s.name, `name is "${s.name}" (got "${site.name}")`);
    ok(site.currency === 'USD', `currency USD (got ${site.currency})`);
    ok(site.timezone === e.verify.timezone, `timezone ${e.verify.timezone} from the area code (got ${site.timezone})`);
    ok(site.hours?.length === 7 && site.hours.every((h) => !h.isClosed), 'open all 7 days');

    const byName = new Map((site.services ?? []).map((x) => [x.name, x]));
    ok(byName.size === s.services.length, `${s.services.length} services (got ${byName.size})`);
    ok(
      s.services.every((x) => byName.get(x.name)?.priceType === x.priceType),
      `service price types match the sheet (${s.services.map((x) => x.priceType).join('/')})`,
    );
    ok(site.services.every((x) => !x.price || x.price.currency === 'USD'), 'every priced service is in USD');
    ok(site.staff?.length === s.staff.length, `${s.staff.length} staff (got ${site.staff?.length})`);
    ok(site.reviews?.length === 3 && site.rating > 0 && site.reviewCount > 0, 'rating, review count and 3 reviews');
    ok(site.theme?.preset === s.theme.preset && site.theme?.mode === s.theme.mode, `theme ${s.theme.preset}/${s.theme.mode}`);
    ok(!/demo/i.test(JSON.stringify(site)), 'no "demo" anywhere in the store payload');

    const date = tomorrowIn(site.timezone);
    const slots = await call('GET', `/public/businesses/${site.slug}/slots?date=${date}`);
    ok(slots.status === 200 && slots.json.slots?.length > 0, `bookable tomorrow (${date}): ${slots.json.slots?.length ?? 0} free times`);

    const login = await call('POST', '/auth/login', {
      body: { phone: `${s.countryCode}${e.owner.phone}`, password: e.owner.password, accountType: 'owner' },
    });
    ok(login.status === 200, `owner login +${s.countryCode} ${e.owner.phone} (got ${login.status})`);
    if (login.status === 200) {
      ok(login.json.business?.id === site.id, 'owner login opens THIS store');
      ok(login.json.business?.plan === 'premium', `plan is premium (got ${login.json.business?.plan})`);
      await call('POST', '/auth/logout', { body: { refreshToken: login.json.refreshToken } });
    }
  }

  // Negative cases, once each — the per-(IP, phone) login bucket is only 10 per 5 minutes.
  console.log('login negatives');
  const first = SHEET.stores[0];
  const wrong = await call('POST', '/auth/login', {
    body: { phone: `${first.store.countryCode}${first.owner.phone}`, password: 'not-the-password', accountType: 'owner' },
  });
  ok(wrong.status === 401, `wrong password → 401 (got ${wrong.status})`);
  // The natural slip for a US user: ten 1s instead of nine. Must not match the 9-digit login.
  const typo = await call('POST', '/auth/login', {
    body: { phone: `${first.store.countryCode}${first.owner.phone}1`, password: first.owner.password, accountType: 'owner' },
  });
  ok(typo.status === 401, `10-digit phone typo → 401 (got ${typo.status})`);
}

async function adminSection() {
  if (!ADMIN_MOBILE || !ADMIN_PASSWORD) {
    console.log('ADMIN SKIPPED — set SMOKE_ADMIN_MOBILE / SMOKE_ADMIN_PASSWORD (owner-role admin) to check the admin panel rules');
    return;
  }
  console.log('ADMIN');
  const login = await call('POST', '/admin/auth/login', { body: { mobile: ADMIN_MOBILE, password: ADMIN_PASSWORD } });
  ok(login.status === 200 && login.json.token, `admin login (got ${login.status})`);
  if (login.status !== 200) return;
  const token = login.json.token;
  const me = await call('GET', '/admin/me', { token });

  const list = await call('GET', '/admin/businesses', { token });
  ok(list.status === 200, 'admin store list');
  const rows = list.json.data ?? [];
  const sheetPhones = new Set(SHEET.stores.map(phoneOf));
  for (const e of SHEET.stores) {
    const row = rows.find((r) => r.phoneFull === phoneOf(e));
    ok(row?.isDemo === true && row?.isActive === true, `/${e.path} is listed as an active demo store (isDemo=${row?.isDemo})`);
    ok(typeof row?.demoIndustry === 'string' && row.demoIndustry.length > 0, `/${e.path} is labelled with its homepage card (${row?.demoIndustry})`);
  }
  ok(!rows.some((r) => r.isDemo && !sheetPhones.has(r.phoneFull)), 'no other store is flagged as demo');

  // Never disable-able — and checked before the body is validated (see the header).
  const target = rows.find((r) => r.phoneFull === phoneOf(SHEET.stores[0]));
  if (target) {
    const detail = await call('GET', `/admin/businesses/${target.id}`, { token });
    ok(detail.json.isDemo === true, 'store detail carries isDemo');
    const off = await call('PUT', `/admin/businesses/${target.id}`, { token, body: { isActive: false } });
    ok(off.status === 409 && off.json.error?.code === 'DEMO_STORE_ALWAYS_ON', `disabling a demo store → 409 DEMO_STORE_ALWAYS_ON (got ${off.status} ${off.json.error?.code ?? ''})`);
    const still = await call('GET', `/public/businesses/by-phone/${target.phoneFull}`);
    ok(still.status === 200, 'and its page is still live');
  }

  if (me.json.role !== 'owner') {
    console.log(`  - signed in as "${me.json.role}": dashboard/Team checks need an owner-role admin — not checked`);
    return;
  }
  // The dashboard counts exactly the platform's stores: not the nine, not /demo-store.
  const platformCount = rows.filter((r) => !r.isDemo && r.slug !== 'demo-store').length;
  const overview = await call('GET', '/admin/analytics/overview', { token });
  ok(overview.json.stores?.total === platformCount, `dashboard counts ${platformCount} platform stores, demo stores excluded (got ${overview.json.stores?.total})`);
  // Team: no admin's store count can include them, so the counts can't exceed the platform's stores.
  const admins = await call('GET', '/admin/admins', { token });
  const counted = (admins.json.data ?? []).reduce((n, a) => n + (a.storesCount ?? 0), 0);
  ok(admins.status === 200 && counted <= platformCount, `Team store counts leave the demo stores out (${counted} ≤ ${platformCount})`);
}

async function webSection() {
  if (!WEB) {
    console.log('WEB  SKIPPED — set SMOKE_WEB_URL to check the frontend routes');
    return;
  }
  console.log(`WEB  ${WEB}`);
  for (const e of SHEET.stores) {
    const p = await page(`/${e.path}`);
    ok(p.status === 200 && !p.location, `/${e.path} → 200 in place, no redirect (got ${p.status}${p.location ? ` → ${p.location}` : ''})`);
    ok(p.html.includes(escapeHtml(e.store.name)) || p.html.includes(e.store.name), `/${e.path} renders "${e.store.name}"`);
    ok(hasNoindex(p.html), `/${e.path} carries noindex`);
    for (const legacy of [`/${e.legacySlug}`, `/industries/${e.legacySlug}`]) {
      const r = await page(legacy);
      const to = r.location ? new URL(r.location, WEB).pathname : null;
      ok(r.status === 308 && to === `/${e.path}`, `${legacy} → 308 /${e.path} (got ${r.status} ${to ?? ''})`);
    }
  }

  const direct = SHEET.stores[1];
  const byPhone = await page(`/${phoneOf(direct)}`);
  ok(byPhone.status === 200 && hasNoindex(byPhone.html), `/${phoneOf(direct)} (the phone URL itself) also carries noindex`);

  const demo = await page('/demo-store');
  if (demo.status === 200) ok(!hasNoindex(demo.html), '/demo-store is untouched (no noindex)');
  else console.log(`  - /demo-store returned ${demo.status} here (not seeded in this environment) — not checked`);

  const unknown = await page('/12345');
  ok(unknown.status === 404, `/12345 (no store) → 404 as before (got ${unknown.status})`);

  const home = await page('/');
  ok(home.status === 200, 'homepage renders');
  for (const e of SHEET.stores) {
    const tags = home.html.match(new RegExp(`<a\\b[^>]*href="/${e.path}"[^>]*>`, 'g')) ?? [];
    ok(
      tags.length > 0 && tags.every((t) => t.includes('target="_blank"') && t.includes('rel="noopener noreferrer"')),
      `homepage links to /${e.path} open in a new tab (${tags.length} link${tags.length === 1 ? '' : 's'})`,
    );
  }
  ok(!SHEET.stores.some((e) => home.html.includes(`href="/${e.legacySlug}"`)), 'no homepage link still points at an old industry page');
}

async function main() {
  await apiSection();
  await adminSection();
  await webSection();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
