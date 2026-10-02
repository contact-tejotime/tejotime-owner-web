// Admin store form: an optional commission percent on each staff row.
//
// RUNNING IT
//   cd backend && npm run dev            # a migrated database; no seed required
//   SMOKE_ADMIN_MOBILE=... SMOKE_ADMIN_PASSWORD=... node scripts/smoke-admin-staff-commission.mjs
//
// Without those two variables the script skips and exits 0 — it cannot log in as an admin, and
// the seed does not create one. Same login pair as smoke-store-drafts.mjs.
//
// What it proves, over the real create/update store endpoints:
//   - a staff row with rateBp 2000 comes back as 2000
//   - saving the store again with the same 2000 still reads 2000 (the "do not insert a duplicate
//     row" decision itself is staffRateWrite in tests/unit/commission-summary.test.ts — two
//     now() rows in the same minute are not distinguishable from the HTTP report)
//   - saving 3000 replaces the rate the form shows
//   - clearing it (null) is 400, and the 3000 is still what the form shows
//   - a new stylist with no rate is accepted beside one who has one
//
// It deactivates the throwaway store when it finishes (success or failure) so the microsite
// 404s. The row stays; there is no delete-store endpoint. Use a throwaway database.
// SMOKE_BASE_URL targets a non-default port. A 429 on login is the in-memory limiter.
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

const phoneNumber = `9${String(Date.now()).slice(-9)}`;

function storeBody(staff) {
  return {
    name: 'Commission smoke',
    category: 'Salon & Barber',
    area: 'Downtown',
    address: '1 Smoke St',
    city: 'Pune',
    tagline: 'Commission smoke',
    description: 'Throwaway store for the admin staff commission smoke.',
    aboutHeading: 'About',
    countryCode: '91',
    phoneNumber,
    timezone: 'Asia/Kolkata',
    hours: [],
    services: [],
    staff,
  };
}

const stylist = (rateBp) => [{ name: 'Lalu', roleLabel: 'Hair master', rateBp }];

async function main() {
  const mobile = process.env.SMOKE_ADMIN_MOBILE;
  const password = process.env.SMOKE_ADMIN_PASSWORD;
  if (!mobile || !password) {
    skip('SMOKE_ADMIN_MOBILE / SMOKE_ADMIN_PASSWORD not set — admin staff commission smoke did not run');
    return;
  }

  const login = await call('POST', '/admin/auth/login', { body: { mobile, password } });
  const token = login.json.accessToken ?? login.json.token ?? null;
  if (!token) {
    ok(false, `admin login → token (status ${login.status})`);
    return;
  }
  ok(true, 'admin login');

  let id = null;
  // What the form currently shows, so deactivating the throwaway store does not also change the rate.
  let shown = 2000;
  try {
    const created = await call('POST', '/admin/businesses', {
      token,
      body: { ...storeBody(stylist(2000)), owner: { password: 'secret123' } },
    });
    id = created.json.id ?? null;
    ok(created.status === 201 && !!id, `create store with 20% → 201 (status ${created.status})`);
    if (!id) return;

    const read = await call('GET', `/admin/businesses/${id}`, { token });
    ok(read.status === 200 && read.json.staff?.[0]?.rateBp === 2000, 'detail returns rateBp 2000');

    const same = await call('PUT', `/admin/businesses/${id}`, { token, body: storeBody(stylist(2000)) });
    ok(same.status === 200, `save the same 20% → 200 (status ${same.status})`);
    const still = await call('GET', `/admin/businesses/${id}`, { token });
    ok(still.json.staff?.[0]?.rateBp === 2000, 'the form still shows 20%');

    const changed = await call('PUT', `/admin/businesses/${id}`, { token, body: storeBody(stylist(3000)) });
    ok(changed.status === 200, `save 30% → 200 (status ${changed.status})`);
    const after = await call('GET', `/admin/businesses/${id}`, { token });
    ok(after.json.staff?.[0]?.rateBp === 3000, 'the form now shows 30%');
    if (after.json.staff?.[0]?.rateBp === 3000) shown = 3000;

    const cleared = await call('PUT', `/admin/businesses/${id}`, { token, body: storeBody(stylist(null)) });
    ok(cleared.status === 400, `clearing a started rate → 400 (status ${cleared.status})`);
    ok(
      String(cleared.json?.error?.message ?? '').includes('already has a commission rate'),
      'the 400 says to enter 0 instead of clearing it',
    );
    const kept = await call('GET', `/admin/businesses/${id}`, { token });
    ok(kept.json.staff?.[0]?.rateBp === 3000, 'the 30% is still in force after the rejected clear');

    const added = await call('PUT', `/admin/businesses/${id}`, {
      token,
      body: storeBody([
        { name: 'Lalu', roleLabel: 'Hair master', rateBp: 3000 },
        { name: 'Sinann', roleLabel: 'Stylist', rateBp: null },
      ]),
    });
    ok(added.status === 200, `a new stylist with no rate beside one who has one → 200 (status ${added.status})`);
    const both = await call('GET', `/admin/businesses/${id}`, { token });
    const byName = new Map((both.json.staff ?? []).map((s) => [s.name, s.rateBp]));
    ok(byName.get('Lalu') === 3000 && byName.get('Sinann') === null, 'Lalu stays at 30%, Sinann has no rate');
  } finally {
    if (id && token) {
      await call('PUT', `/admin/businesses/${id}`, {
        token,
        body: { ...storeBody(stylist(shown)), isActive: false },
      }).catch(() => {});
    }
  }
}

await main();
console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
