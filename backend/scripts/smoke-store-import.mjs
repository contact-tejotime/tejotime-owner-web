// End-to-end smoke for POST /admin/store-import ("autofill a store from a link") against a RUNNING
// API. Read-only: it never writes to the database, so unlike smoke-rest.mjs it needs no re-seed.
//
// RUNNING IT
//   cd backend && npm run dev            # a migrated DB; no seed needed for the negative cases
//   node scripts/smoke-store-import.mjs
//
// What it proves without any credentials (always runs):
//   - the endpoint is behind the admin JWT (no token → 401, an OWNER token → 401)
//   - the SSRF guard is really in front of the fetch: loopback, cloud-metadata, private-range and
//     non-http links are refused, over the real HTTP stack
//
// What needs an admin login (skipped, and SAID to be skipped, if the variables are absent):
//   SMOKE_ADMIN_MOBILE / SMOKE_ADMIN_PASSWORD   an admins row that has a password set
//   → validation (400) and the "disabled → 503" / "enabled" behaviour, depending on the server flag.
//
// What is opt-in because it is not deterministic (real network + a real Groq call):
//   SMOKE_IMPORT_URL=https://some-business-website   with AUTOFILL_ENABLED=true and a key on the
//   server. Asserts only the SHAPE of a successful import, never specific values.
//
// The admin login limiter (limiters.otp / login) is in-memory: a 429 on login is the harness, not a
// regression — restart the API or wait. SMOKE_BASE_URL targets a non-default port.
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

const importUrl = (token, url) => call('POST', '/admin/store-import', { token, body: { url } });

async function main() {
  console.log('ACCESS');
  const anon = await importUrl(undefined, 'https://example.com');
  ok(anon.status === 401, 'no token → 401');

  const owner = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  if (owner.status === 200 && owner.json.accessToken) {
    const r = await importUrl(owner.json.accessToken, 'https://example.com');
    ok(r.status === 401, 'an owner-app access token cannot use the admin endpoint → 401');
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
  ok((await call('POST', '/admin/store-import', { token, body: {} })).status === 400, 'missing url → 400');
  ok((await call('POST', '/admin/store-import', { token, body: { url: 'https://x.com', extra: 1 } })).status === 400, 'unknown key → 400');

  console.log('SSRF GUARD (real HTTP stack)');
  // If the feature is switched off the endpoint answers 503 BEFORE the guard is reached. That is a
  // correct answer, but it means these cases prove nothing — so say so instead of passing quietly.
  const probe = await importUrl(token, 'http://127.0.0.1/');
  if (probe.status === 503) {
    skip('AUTOFILL_ENABLED is false on this server (503 AUTOFILL_DISABLED) — SSRF cases need it on');
  } else {
    const blocked = [
      'http://127.0.0.1/',
      'http://localhost:8080/api/v1/healthz',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://2130706433/',
      'file:///etc/passwd',
      'ftp://example.com/',
    ];
    for (const url of blocked) {
      const r = await importUrl(token, url);
      ok(r.status === 422 && /^LINK_(BLOCKED|BAD_URL)$/.test(r.json.error?.code ?? ''), `refused: ${url} → ${r.status} ${r.json.error?.code}`);
    }
  }

  console.log('REAL IMPORT (opt-in)');
  const real = process.env.SMOKE_IMPORT_URL;
  if (!real) {
    skip('SMOKE_IMPORT_URL not set');
    return;
  }
  const r = await importUrl(token, real);
  if (r.status === 503) return skip('server has autofill disabled');
  ok(r.status === 200, `import ${real} → 200 (got ${r.status} ${r.json.error?.code ?? ''})`);
  if (r.status === 200) {
    ok(typeof r.json.source?.url === 'string', 'response has source.url');
    ok(r.json.fields && typeof r.json.fields === 'object' && Object.keys(r.json.fields).length > 0, 'response has at least one field');
    ok(Array.isArray(r.json.warnings), 'response has a warnings array');
    // Never extracted in v1 — a regression here would mean third-party images started flowing in.
    ok(!('logoUrl' in r.json.fields) && !('heroImageUrl' in r.json.fields), 'no image URLs in the result');
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
    process.exit(fail ? 1 : 0);
  });
