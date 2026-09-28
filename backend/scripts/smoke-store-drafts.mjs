// End-to-end smoke for the admin panel's Create store drafts (/admin/store-drafts, migration 0031)
// against a RUNNING API and a MIGRATED database. Needs no seed: it uses admin logins you supply.
//
// RUNNING IT
//   cd backend && npm run migrate && npm run dev
//   SMOKE_ADMIN_MOBILE=... SMOKE_ADMIN_PASSWORD=... \
//   SMOKE_ADMIN2_MOBILE=... SMOKE_ADMIN2_PASSWORD=... \
//     node scripts/smoke-store-drafts.mjs
//
// The two logins are two DIFFERENT admins (an owner and an employee, or two employees). Without the
// second one the cross-admin cases are SKIPPED and said to be skipped — that is the case that
// matters most, because drafts are private per admin and only the real SQL can prove it.
//
// It cleans up after itself (every draft it creates is deleted), unlike smoke-rest.mjs. The admin
// login limiter is in-memory: a 429 on login is the harness, not a regression — restart the API.
// SMOKE_BASE_URL targets a non-default port.
//
// Not covered here: the 50-draft cap (50 creates would trip the 120/min write limiter) — that is
// tests/unit/store-drafts.test.ts.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
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

async function login(mobile, password) {
  const r = await call('POST', '/admin/auth/login', { body: { mobile, password } });
  return r.json.accessToken ?? r.json.token ?? null;
}

const made = []; // [token, id] — everything to delete at the end

async function main() {
  console.log('ACCESS');
  ok((await call('GET', '/admin/store-drafts')).status === 401, 'list without a token → 401');
  ok((await call('POST', '/admin/store-drafts', { body: { data: {} } })).status === 401, 'create without a token → 401');

  const [m1, p1] = [process.env.SMOKE_ADMIN_MOBILE, process.env.SMOKE_ADMIN_PASSWORD];
  if (!m1 || !p1) {
    skip('SMOKE_ADMIN_MOBILE / SMOKE_ADMIN_PASSWORD not set — nothing below ran');
    return;
  }
  const a = await login(m1, p1);
  ok(!!a, 'admin A logs in');
  if (!a) return;

  console.log('SAVE AS DRAFT');
  const form = {
    name: 'Draft Salon',
    category: 'Salon & Barber',
    city: 'Pune',
    countryCode: '91',
    phoneNumber: '9812345678',
    services: [{ name: 'Haircut', durationMinutes: 30, priceRupees: 300, priceType: 'fixed', priceMaxRupees: null }],
    ownerPhone: '919812345678',
    ownerPassword: 'hunter2hunter2',
  };
  const created = await call('POST', '/admin/store-drafts', { token: a, body: { data: form } });
  ok(created.status === 201 && !!created.json.id, 'an incomplete form saves (no validation of required store fields)');
  const id = created.json.id;
  if (!id) return;
  made.push([a, id]);
  ok(!JSON.stringify(created.json).includes('hunter2'), 'the create response does not echo the owner password');

  const got = await call('GET', `/admin/store-drafts/${id}`, { token: a });
  ok(got.status === 200 && got.json.data.name === 'Draft Salon', 'reading it back returns the saved form');
  ok(got.json.data.services?.[0]?.name === 'Haircut', 'nested rows (services) survive the round trip');
  ok(!('ownerPassword' in got.json.data) && !JSON.stringify(got.json).includes('hunter2'),
    'the owner password was NEVER stored (not in the stored data either)');

  const listed = await call('GET', '/admin/store-drafts', { token: a });
  const row = (listed.json.data ?? []).find((d) => d.id === id);
  ok(!!row && row.name === 'Draft Salon' && row.category === 'Salon & Barber', 'it appears in the list with its name and category');
  ok(row?.phoneFull === '919812345678', 'the list carries phoneFull, shaped like a store row');
  ok(row && !('data' in row), 'the list does not ship the whole form blob');

  console.log('AUTOSAVE');
  const put = await call('PUT', `/admin/store-drafts/${id}`, { token: a, body: { data: { ...form, name: 'Renamed Salon', ownerPassword: 'again-hunter2' } } });
  ok(put.status === 200, 'PUT overwrites the draft');
  const after = await call('GET', `/admin/store-drafts/${id}`, { token: a });
  ok(after.json.data.name === 'Renamed Salon', 'the change is what a reload would see');
  ok(!JSON.stringify(after.json).includes('hunter2'), 'autosave does not store the password either');
  const relist = await call('GET', '/admin/store-drafts', { token: a });
  ok((relist.json.data ?? []).find((d) => d.id === id)?.name === 'Renamed Salon', 'the sidebar name follows the rename');

  console.log('VALIDATION');
  ok((await call('POST', '/admin/store-drafts', { token: a, body: {} })).status === 400, 'no data → 400');
  ok((await call('POST', '/admin/store-drafts', { token: a, body: { data: {}, extra: 1 } })).status === 400, 'unknown key → 400');
  ok((await call('GET', '/admin/store-drafts/not-a-uuid', { token: a })).status === 400, 'a non-uuid id → 400');
  ok((await call('PUT', '/admin/store-drafts/00000000-0000-4000-8000-000000000000', { token: a, body: { data: {} } })).status === 404,
    'autosaving into a draft that does not exist → 404 (the panel then stops, it does not recreate)');

  console.log('PRIVACY (another admin)');
  const [m2, p2] = [process.env.SMOKE_ADMIN2_MOBILE, process.env.SMOKE_ADMIN2_PASSWORD];
  const b = m2 && p2 ? await login(m2, p2) : null;
  if (!b) {
    skip('SMOKE_ADMIN2_MOBILE / SMOKE_ADMIN2_PASSWORD not set (or login failed) — cross-admin cases did not run');
  } else {
    ok((await call('GET', `/admin/store-drafts/${id}`, { token: b })).status === 404, "admin B reading A's draft → 404, not 403");
    ok((await call('PUT', `/admin/store-drafts/${id}`, { token: b, body: { data: { name: 'hijack' } } })).status === 404, "admin B cannot overwrite A's draft → 404");
    const bList = await call('GET', '/admin/store-drafts', { token: b });
    ok(!(bList.json.data ?? []).some((d) => d.id === id), "A's draft is absent from B's list");
    ok((await call('DELETE', `/admin/store-drafts/${id}`, { token: b })).status === 204, "admin B's delete answers 204 (idempotent) …");
    ok((await call('GET', `/admin/store-drafts/${id}`, { token: a })).status === 200, '… but it did NOT delete A\'s draft');
    const bMade = await call('POST', '/admin/store-drafts', { token: b, body: { data: { name: 'B draft' } } });
    if (bMade.json.id) made.push([b, bMade.json.id]);
    const aList = await call('GET', '/admin/store-drafts', { token: a });
    ok(!(aList.json.data ?? []).some((d) => d.id === bMade.json.id), "B's draft is absent from A's list");
  }

  console.log('DISCARD');
  ok((await call('DELETE', `/admin/store-drafts/${id}`, { token: a })).status === 204, 'delete → 204');
  ok((await call('GET', `/admin/store-drafts/${id}`, { token: a })).status === 404, 'it is gone → 404');
  ok((await call('DELETE', `/admin/store-drafts/${id}`, { token: a })).status === 204, 'deleting it again is still 204 (a double click is not an error)');
}

try {
  await main();
} finally {
  for (const [token, id] of made) await call('DELETE', `/admin/store-drafts/${id}`, { token }).catch(() => {});
}
console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
