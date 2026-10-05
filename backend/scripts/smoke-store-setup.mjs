// End-to-end smoke test for the client's store-setup review (docs/store-setup-review-2026-10-05.md),
// over real HTTP against a running server + seeded Sharp Cuts data.
//
// What it proves:
//   - 30: a store can be created with no neighborhood ("area"), and its page payload carries the city
//         the page shows instead;
//   - 23: the owner's gallery heading reaches the page payload; '' clears it back to the default;
//         a staff-only path is not tested here (unit test: store-setup-review.test.ts);
//   - 34: a blank headline is ignored — the page keeps the saved one;
//   - 35: an old client still sending statValue / statLabel saves fine, and the fields come back
//         nowhere.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-store-setup.mjs              # SMOKE_BASE_URL to override
//
// The admin half (creating a store) needs an admin: SMOKE_ADMIN_MOBILE + SMOKE_ADMIN_PASSWORD (as in
// smoke-admin-staff-commission.mjs), or SMOKE_ADMIN_TOKEN (an admin JWT signed with the running API's
// JWT_ACCESS_SECRET for an active admins row). Without either, that half is skipped and says so.
// The admin-created store is deactivated at the end (there is no delete-store endpoint). The owner
// half restores the Sharp Cuts headline it changes. Use a throwaway database.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const OWNER_PHONE = '919399385943';
const OWNER_PASSWORD = 'password123';
let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const skip = (m) => { skipped++; console.log('  - SKIPPED:', m); };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function adminToken() {
  if (process.env.SMOKE_ADMIN_TOKEN) return process.env.SMOKE_ADMIN_TOKEN;
  const mobile = process.env.SMOKE_ADMIN_MOBILE;
  const password = process.env.SMOKE_ADMIN_PASSWORD;
  if (!mobile || !password) return null;
  const login = await call('POST', '/admin/auth/login', { body: { mobile, password } });
  return login.json.accessToken ?? login.json.token ?? null;
}

async function ownerHalf() {
  console.log('OWNER (Sharp Cuts)');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  const token = login.json.accessToken;
  ok(login.status === 200 && !!token, 'owner login');
  if (!token) return;
  const before = await call('GET', '/business', { token });
  const headline = before.json.tagline;
  ok(!!headline, `the store has a headline ("${headline}")`);

  // 23 — the owner's gallery heading.
  const set = await call('PATCH', '/business', { token, body: { galleryHeading: 'Inside the shop' } });
  ok(set.status === 200 && set.json.galleryHeading === 'Inside the shop', `owner sets a gallery heading (${set.status})`);
  const site1 = await call('GET', '/public/businesses/sharp-cuts');
  ok(site1.json.galleryHeading === 'Inside the shop', 'the page payload carries it');
  const tooLong = await call('PATCH', '/business', { token, body: { galleryHeading: 'x'.repeat(41) } });
  ok(tooLong.status === 400, `a 41-character heading → 400 (got ${tooLong.status})`);
  const clear = await call('PATCH', '/business', { token, body: { galleryHeading: '' } });
  const site2 = await call('GET', '/public/businesses/sharp-cuts');
  ok(clear.status === 200 && site2.json.galleryHeading === null, '"" clears it — the page goes back to its default for the store type');

  // 34 — a blank headline is ignored, so the page never shows an empty heading.
  const blank = await call('PATCH', '/business', { token, body: { tagline: '   ', name: before.json.name } });
  const site3 = await call('GET', '/public/businesses/sharp-cuts');
  ok(blank.status === 200 && site3.json.tagline === headline, `a blank headline is ignored — the page keeps "${headline}"`);

  // 35 — an old app build still sends the removed highlight fields with every save.
  const old = await call('PATCH', '/business', { token, body: { name: before.json.name, statValue: '30k+', statLabel: 'haircuts done' } });
  ok(old.status === 200, `an old client sending statValue / statLabel still saves (${old.status})`);
  ok(!('statValue' in old.json) && !('statLabel' in old.json), 'the owner DTO no longer carries them');
  ok(!('statValue' in site3.json) && !('statLabel' in site3.json), 'nor does the page payload');

  // 30 — the page payload carries the city, for when the neighborhood is blank.
  ok(typeof site3.json.city === 'string' && site3.json.city.length > 0, `the page payload carries the city ("${site3.json.city}")`);
}

async function adminHalf() {
  console.log('ADMIN (create a store with no neighborhood)');
  const token = await adminToken();
  if (!token) {
    skip('no SMOKE_ADMIN_TOKEN / SMOKE_ADMIN_MOBILE+PASSWORD — admin half did not run');
    return;
  }
  const phoneNumber = `239555${String(Date.now()).slice(-4)}`;
  const body = {
    name: 'Setup review smoke',
    category: 'Restaurant',
    address: '1 Smoke St',
    city: 'Naples',
    tagline: 'Fresh food, ready when you are',
    description: 'Throwaway store for the store-setup smoke.',
    aboutHeading: 'About',
    countryCode: '1',
    phoneNumber,
    timezone: 'America/New_York',
    hours: [],
    services: [],
    staff: [],
    galleryHeading: 'Inside the restaurant',
    statValue: '30k+', // an old admin build still sends these
    statLabel: 'meals served',
    owner: { password: 'smoke-pass-123' },
  };
  let id = null;
  try {
    const created = await call('POST', '/admin/businesses', { token, body });
    id = created.json.id ?? created.json.business?.id ?? null;
    ok(created.status === 201 && !!id,
      `created with no neighborhood and the old highlight fields (${created.status}${created.json.error ? `: ${created.json.error.message}` : ''})`);
    if (!id) return;
    const detail = await call('GET', `/admin/businesses/${id}`, { token });
    ok(detail.json.galleryHeading === 'Inside the restaurant', 'the admin detail carries the gallery heading');
    ok(!('statValue' in detail.json), 'and not the highlight fields');
    const site = await call('GET', `/public/businesses/by-phone/1${phoneNumber}`);
    ok(site.status === 200 && !site.json.area && site.json.city === 'Naples',
      `the page payload: no neighborhood, city "Naples" for the page to show (${site.status})`);
    const noHeadline = await call('POST', '/admin/businesses', { token, body: { ...body, tagline: '', phoneNumber: `${phoneNumber.slice(0, -1)}9` } });
    ok(noHeadline.status === 400, `creating a store without a headline is still refused (got ${noHeadline.status})`);
  } finally {
    if (id) {
      const detail = await call('GET', `/admin/businesses/${id}`, { token });
      if (detail.status === 200) await call('PUT', `/admin/businesses/${id}`, { token, body: { ...stripForUpdate(detail.json), isActive: false } });
    }
  }
}

// The update schema is strict: send back only the store fields the form would.
function stripForUpdate(d) {
  const keys = ['name', 'category', 'area', 'address', 'city', 'tagline', 'description', 'aboutHeading', 'countryCode', 'phoneNumber', 'timezone'];
  const out = Object.fromEntries(keys.filter((k) => d[k] !== undefined && d[k] !== '').map((k) => [k, d[k]]));
  return { ...out, hours: [], services: [], staff: [] };
}

async function main() {
  await ownerHalf();
  await adminHalf();
}

main()
  .catch((e) => { fail++; console.error('  ✗ CRASH:', e); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`);
    process.exit(fail ? 1 : 0);
  });
