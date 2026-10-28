// Social media link smoke test (docs/customer-booking-page-copy-2026-09-06.md, "Open a pop-up from
// a link"): GET /business/qr hands every owner surface the store page with Check in already open,
// `<bookingUrl>?open=checkin`, and that link really serves the store page.
//
// Needs a running API + a seeded throwaway DB (the Sharp Cuts owner). Spends one login. Read-only,
// so it is re-runnable without re-seeding. With SMOKE_WEB_URL set (the customer site whose origin
// is the API's PUBLIC_WEB_URL), it also fetches the link itself.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const WEB = process.env.SMOKE_WEB_URL?.replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const login = await call('POST', '/auth/login', { body: { phone: '919399385943', password: 'password123' } });
  const token = login.json.accessToken;
  ok(login.status === 200 && !!token, 'owner signs in');

  console.log('THE LINK');
  const qr = await call('GET', '/business/qr', { token });
  ok(qr.status === 200, 'GET /business/qr → 200');
  const { bookingUrl, socialUrl, phoneFull } = qr.json;
  ok(typeof bookingUrl === 'string' && bookingUrl.endsWith(`/${phoneFull}`), 'booking link is the page by phone');
  ok(socialUrl === `${bookingUrl}?open=checkin`, `social link is the booking link + ?open=checkin (${socialUrl})`);
  ok(new URL(socialUrl).searchParams.get('open') === 'checkin', 'social link parses with open=checkin');

  console.log('NEGATIVE');
  const anon = await call('GET', '/business/qr');
  ok(anon.status === 401, 'no token → 401 (the link is handed out to signed-in owners)');

  if (WEB) {
    console.log('THE PAGE BEHIND IT');
    const path = new URL(socialUrl).pathname + new URL(socialUrl).search;
    const page = await fetch(WEB + path);
    const html = await page.text();
    ok(page.status === 200, `${path} → 200 on ${WEB}`);
    ok(html.includes('Sharp Cuts'), 'it serves the store page, not a 404');
  } else {
    console.log('  (SMOKE_WEB_URL not set — skipped fetching the page itself)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
