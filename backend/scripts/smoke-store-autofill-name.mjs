// End-to-end smoke for "autofill a store from a business name" against a RUNNING API:
//   POST /admin/store-name-search  and  POST /admin/store-name-fill
// Read-only (it writes nothing to a store), so unlike smoke-rest.mjs it needs no re-seed.
//
// RUNNING IT
//   cd backend && npm run dev
//   node scripts/smoke-store-autofill-name.mjs
//
// Always runs (no credentials): both endpoints are behind the admin JWT (no token → 401, an OWNER
// app token → 401).
//
// Needs an admin login (skipped, and SAID to be skipped, if absent):
//   SMOKE_ADMIN_MOBILE / SMOKE_ADMIN_PASSWORD   → validation (400) and the disabled → 503 behaviour.
//
// Opt-in, because it spends BILLED Google Places calls and a Groq call, and is non-deterministic:
//   SMOKE_PLACES_QUERY="Om Beauty Parlour Mota Varachha Surat"  with AUTOFILL_ENABLED=true and a
//   GOOGLE_MAPS_API_KEY on the server. Asserts only the SHAPE of a successful search + fill.
//
// SMOKE_BASE_URL targets a non-default port. The admin login limiter is in-memory: a 429 on login is
// the harness, not a regression — restart the API or wait.
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

const search = (token, query) => call('POST', '/admin/store-name-search', { token, body: { query } });
const fill = (token, placeId) => call('POST', '/admin/store-name-fill', { token, body: { placeId } });

async function main() {
  console.log('ACCESS');
  ok((await search(undefined, 'barber austin')).status === 401, 'search: no token → 401');
  ok((await fill(undefined, 'x')).status === 401, 'fill: no token → 401');

  const owner = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  if (owner.status === 200 && owner.json.accessToken) {
    ok((await search(owner.json.accessToken, 'barber austin')).status === 401, 'an owner-app token cannot use the admin endpoint → 401');
  } else {
    skip(`owner login unavailable (${owner.status}) — seed the DB / restart the API to clear the login limiter`);
  }

  const mobile = process.env.SMOKE_ADMIN_MOBILE;
  const password = process.env.SMOKE_ADMIN_PASSWORD;
  if (!mobile || !password) {
    skip('SMOKE_ADMIN_MOBILE / SMOKE_ADMIN_PASSWORD not set — the authenticated cases below did not run');
    return;
  }
  const login = await call('POST', '/admin/auth/login', { body: { mobile, password } });
  const token = login.json.accessToken ?? login.json.token;
  ok(login.status === 200 && !!token, 'admin login returns a token');
  if (!token) return;

  console.log('VALIDATION');
  ok((await call('POST', '/admin/store-name-search', { token, body: {} })).status === 400, 'search: missing query → 400');
  ok((await call('POST', '/admin/store-name-search', { token, body: { query: 'x' } })).status === 400, 'search: too short → 400');
  ok((await call('POST', '/admin/store-name-fill', { token, body: {} })).status === 400, 'fill: missing placeId → 400');

  console.log('REAL SEARCH + FILL (opt-in)');
  const query = process.env.SMOKE_PLACES_QUERY;
  if (!query) {
    skip('SMOKE_PLACES_QUERY not set');
    return;
  }
  const s = await search(token, query);
  if (s.status === 503) return skip(`server has autofill off or no Google key (${s.json.error?.code})`);
  ok(s.status === 200, `search → 200 (got ${s.status} ${s.json.error?.code ?? ''})`);
  if (s.status !== 200) return;
  ok(Array.isArray(s.json.candidates), 'search returns a candidates array');
  const first = s.json.candidates?.[0];
  if (!first) return skip('no candidates for that query — try a fuller name + area');

  const f = await fill(token, first.placeId);
  if (f.status === 503) return skip(`fill: ${f.json.error?.code} (disabled or daily limit)`);
  ok(f.status === 200, `fill → 200 (got ${f.status} ${f.json.error?.code ?? ''})`);
  if (f.status === 200) {
    ok(typeof f.json.source?.title === 'string', 'fill has source.title');
    ok(f.json.fields && Object.keys(f.json.fields).length > 0, 'fill has at least one field');
    ok(Array.isArray(f.json.warnings), 'fill has a warnings array');
    if (f.json.fields.heroImageUrl) {
      ok(/\/media\//.test(f.json.fields.heroImageUrl), 'hero photo is a /media/... URL (copied into our bucket)');
    }
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
    process.exit(fail ? 1 : 0);
  });
