// Card payments end to end: a running API over real HTTP, against a seeded THROWAWAY database.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-card-payments.mjs
//
// The PayPal reader itself cannot be driven from here — only the phone's native SDK can — so this
// plays the phone's part: it starts a charge, then reports what the reader would have said. What it
// proves, through the endpoints the app calls (docs/card-payments-paypal.md, migration 0043):
//   - MAIN OWNER ONLY: a co-owner and a staff login get 403 on every card route; once card charging
//     is on, neither may record a visit as paid by card (403 CARD_OWNER_ONLY), and GET /queue/:id
//     tells each of them so (`cardAllowed`);
//   - off by default (409 CARD_PAYMENTS_OFF); starting twice returns the SAME reference;
//   - while a charge is in flight nobody can finish that visit another way (409
//     CARD_PAYMENT_IN_PROGRESS, checkout and no-show), and GET /queue/:id names the charge;
//   - an approved card completes the visit in the same step: visit paid by card, revenue up, and a
//     repeat of the same report changes nothing (the retry after a lost response);
//   - a declined card frees the visit for another method;
//   - a card the reader charged after the visit was finished another way is still recorded — paid,
//     needs review, no visit — never refused (the rule: once money has moved, record it);
//   - a refund: revenue and the stylist's commission lose it, the customer's total spend drops, the
//     visit still counts as completed and stays in the history marked refunded; a repeat is a no-op.
//
//   - US stores only (client decision 2026-10-15): the seeded store, priced in rupees, cannot turn
//     card payments on (409 CARD_PAYMENTS_US_ONLY) and is told they are unavailable. Everything
//     else runs in a US store of its own (priced in dollars), created each run by the admin API —
//     so its owner is the store's MAIN owner — and deactivated at the end.
//
// That needs an admin: SMOKE_ADMIN_MOBILE + SMOKE_ADMIN_PASSWORD, or SMOKE_ADMIN_TOKEN, defaulting
// to the demo admin `npm run migrate` gives a throwaway database (919399385943 / admin456). It
// never edits an existing store's currency: the admin store save is a full save that rebuilds
// hours, services and staff. (A store whose currency changed after card payments were turned on is
// pinned by tests/unit/queue-payment-method.test.ts.)
//
// RE-RUNNABLE: it creates its own US store, chair, service, co-owner and staff login each run, and
// removes or deactivates them — and turns card charging back off — at the end. Each run
// spends FIVE logins of the 10-per-5-minutes limiter (five different numbers; see smoke-rest.mjs).
//
// SMOKE_BASE_URL points the run at a non-default port, for when a dev API already holds 8080.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const OWNER_PHONE = '919399385943';
const OWNER_PASSWORD = 'password123';
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

async function main() {
  const run = Date.now();
  const tail = String(run).slice(-8);

  console.log('US STORES ONLY: THE SEEDED STORE (RUPEES) CANNOT HAVE CARD PAYMENTS');
  const inr = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  const inrToken = inr.json.accessToken;
  ok(inr.status === 200 && inr.json.user?.isSuperOwner === true, 'the seeded main owner logs in');
  ok(inr.json.business?.currency === 'INR', `the seeded store is priced in rupees (got ${inr.json.business?.currency})`);
  const inrOn = await call('PUT', '/card-payments/settings', { token: inrToken, body: { enabled: true } });
  ok(inrOn.status === 409 && inrOn.json.error?.code === 'CARD_PAYMENTS_US_ONLY', `a rupee store cannot turn card payments on → 409 (got ${inrOn.status} ${inrOn.json.error?.code})`);
  const inrSettings = (await call('GET', '/card-payments/settings', { token: inrToken })).json;
  ok(inrSettings.available === false && inrSettings.enabled === false, 'and is told it is not available');
  ok((await call('GET', '/business', { token: inrToken })).json.cardPaymentsEnabled === false, 'GET /business agrees');

  console.log('SETUP: A US STORE OF OUR OWN');
  const adminLogin = process.env.SMOKE_ADMIN_TOKEN
    ? null
    : await call('POST', '/admin/auth/login', {
        body: {
          mobile: process.env.SMOKE_ADMIN_MOBILE ?? '919399385943',
          password: process.env.SMOKE_ADMIN_PASSWORD ?? 'admin456',
        },
      });
  const admin = process.env.SMOKE_ADMIN_TOKEN ?? adminLogin?.json.token ?? null;
  ok(!!admin, 'an admin, to create a US store');
  const usNumber = `239558${String(run).slice(-4)}`;
  // Created by the admin, so its owner is the store's MAIN owner — the only login that takes cards.
  const storeFields = {
    name: `Card US Smoke ${run}`,
    category: 'Hair Salon',
    address: '1 Smoke St',
    city: 'Naples',
    tagline: 'Smoke test store',
    countryCode: '1',
    phoneNumber: usNumber,
    timezone: 'America/New_York',
    hours: [],
    services: [],
    staff: [],
  };
  const created = await call('POST', '/admin/businesses', {
    token: admin,
    body: { ...storeFields, currency: 'USD', owner: { password: 'smoke-pass-123' } },
  });
  const usStoreId = created.json.id ?? created.json.business?.id ?? null;
  ok(created.status === 201 && !!usStoreId, `the admin creates a store priced in USD (${created.status}${created.json.error ? `: ${created.json.error.message}` : ''})`);
  const login = await call('POST', '/auth/login', { body: { phone: `1${usNumber}`, password: 'smoke-pass-123' } });
  ok(login.status === 200 && login.json.accessToken, 'its owner logs in');
  const token = login.json.accessToken;
  ok(login.json.user?.isSuperOwner === true && login.json.business?.currency === 'USD', 'the main owner of a US store');
  ok((await call('GET', '/card-payments/settings', { token })).json.available === true, 'card payments are available there');

  const seat = await call('POST', '/staff', {
    token,
    body: { name: `Card Smoke ${run}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(seat.status === 201, 'a fresh chair of our own');
  const chair = seat.json.id;
  const svc = await call('POST', '/services', {
    token,
    body: { name: `Card Cut ${run}`, durationMinutes: 30, colorToken: 'primary', priceType: 'fixed', priceAmount: 30000 },
  });
  ok(svc.status === 201, 'a fixed $300 service of our own');
  // 20% from now, so the visits below earn commission — and a refunded one visibly stops earning.
  const rate = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 2000 } });
  ok(rate.status === 200, 'the chair earns 20%');

  const coPhone = `9197${tail}`;
  const co = await call('POST', '/users', {
    token,
    body: { name: 'Card Smoke Co-owner', phone: coPhone, password: 'smoketest123', role: 'co_owner' },
  });
  ok(co.status === 201, `a co-owner login (got ${co.status} ${co.json.error?.message ?? ''})`);
  const staffPhone = `9196${tail}`;
  const st = await call('POST', '/users', {
    token,
    body: { name: 'Card Smoke Staff', phone: staffPhone, password: 'smoketest123', role: 'staff', staffId: chair },
  });
  ok(st.status === 201, `a staff login on our chair (got ${st.status} ${st.json.error?.message ?? ''})`);
  const coToken = (await call('POST', '/auth/login', { body: { phone: coPhone, password: 'smoketest123' } })).json.accessToken;
  const staffToken = (await call('POST', '/auth/login', { body: { phone: staffPhone, password: 'smoketest123' } })).json.accessToken;
  ok(!!coToken && !!staffToken, 'both log in');

  const revenue = async () => (await call('GET', '/dashboard/summary', { token })).json.kpis;
  const commissionOf = async () =>
    (await call('GET', '/commission/summary', { token })).json.staff?.find((x) => x.staffId === chair)?.commission?.amount;
  const detail = async (id, t = token) => (await call('GET', `/queue/${id}`, { token: t })).json;

  async function inChair(name, phone) {
    const add = await call('POST', '/queue', {
      token,
      body: { name, phone, serviceId: svc.json.id, staffId: chair, position: 'end' },
    });
    ok(add.status === 201, `walk-in ${name}`);
    const id = add.json.entry?.id;
    const start = await call('POST', `/queue/${id}/start`, { token });
    ok(start.status === 200, `start ${name} (got ${start.status} ${start.json.error?.code ?? ''})`);
    return id;
  }

  console.log('MAIN OWNER ONLY');
  for (const [who, t] of [['co-owner', coToken], ['staff', staffToken]]) {
    const r = await call('GET', '/card-payments/settings', { token: t });
    ok(r.status === 403, `${who}: settings → 403 (got ${r.status})`);
    const s = await call('PUT', '/card-payments/settings', { token: t, body: { enabled: true } });
    ok(s.status === 403, `${who}: cannot turn card charging on (got ${s.status})`);
  }

  console.log('OFF BY DEFAULT');
  const settings0 = await call('GET', '/card-payments/settings', { token });
  ok(settings0.status === 200 && settings0.json.enabled === false, 'card charging starts off');
  const aId = await inChair('Card Ada', `+9195${tail}`);
  const offStart = await call('POST', '/card-payments', { token, body: { queueEntryId: aId, amountPaise: 30000 } });
  ok(offStart.status === 409 && offStart.json.error?.code === 'CARD_PAYMENTS_OFF', `starting a charge while off → 409 (got ${offStart.status} ${offStart.json.error?.code})`);

  const on = await call('PUT', '/card-payments/settings', { token, body: { enabled: true, paypalOrgRef: `smoke-org-${run}` } });
  ok(on.status === 200 && on.json.enabled === true && on.json.paypalOrgRef === `smoke-org-${run}`, 'the main owner turns it on, with the PayPal account');
  ok((await call('GET', '/business', { token })).json.cardPaymentsEnabled === true, 'GET /business reports it');

  console.log('ONCE ON, ONLY THE MAIN OWNER TAKES CARDS');
  ok((await detail(aId)).cardAllowed === true, 'main owner: cardAllowed');
  ok((await detail(aId, coToken)).cardAllowed === false, 'co-owner: not cardAllowed');
  ok((await detail(aId, staffToken)).cardAllowed === false, 'staff: not cardAllowed');
  const coCard = await call('POST', `/queue/${aId}/checkout`, { token: coToken, body: { amountPaise: 30000, paymentMethod: 'card' } });
  ok(coCard.status === 403 && coCard.json.error?.code === 'CARD_OWNER_ONLY', `co-owner records Card → 403 CARD_OWNER_ONLY (got ${coCard.status} ${coCard.json.error?.code})`);
  const stCard = await call('POST', `/queue/${aId}/checkout`, { token: staffToken, body: { amountPaise: 30000, paymentMethod: 'card' } });
  ok(stCard.status === 403 && stCard.json.error?.code === 'CARD_OWNER_ONLY', `staff records Card on its own chair → 403 (got ${stCard.status} ${stCard.json.error?.code})`);

  console.log('A CHARGE IN FLIGHT');
  const s1 = await call('POST', '/card-payments', { token, body: { queueEntryId: aId, amountPaise: 30000 } });
  ok(s1.status === 201 && s1.json.payment?.status === 'pending' && s1.json.resumed === false, `start → pending (got ${s1.status} ${s1.json.error?.code ?? ''})`);
  const ref = s1.json.payment?.id;
  const s2 = await call('POST', '/card-payments', { token, body: { queueEntryId: aId, amountPaise: 30000 } });
  ok(s2.json.payment?.id === ref && s2.json.resumed === true, 'starting again returns the SAME reference (no second charge to the reader)');
  const pend = await detail(aId, coToken);
  ok(pend.pendingCardPayment?.id === ref, 'GET /queue/:id names the charge in flight, to every phone');
  const coCash = await call('POST', `/queue/${aId}/checkout`, { token: coToken, body: { amountPaise: 30000, paymentMethod: 'cash' } });
  ok(coCash.status === 409 && coCash.json.error?.code === 'CARD_PAYMENT_IN_PROGRESS', `a cash checkout meanwhile → 409 (got ${coCash.status} ${coCash.json.error?.code})`);
  const noShow = await call('POST', `/queue/${aId}/no-show`, { token: coToken });
  ok(noShow.status === 409, `a no-show meanwhile → 409 (got ${noShow.status})`);
  const coStart = await call('POST', '/card-payments', { token: coToken, body: { queueEntryId: aId, amountPaise: 30000 } });
  ok(coStart.status === 403, 'a co-owner cannot start a charge');

  console.log('THE READER APPROVES: THE VISIT IS COMPLETED WITH IT');
  const k0 = await revenue();
  const c0 = await commissionOf();
  const report = { providerPaymentId: `pp-${run}`, cardBrand: 'VISA', cardLast4: '4242', entryMode: 'CONTACTLESS', chargedAmountPaise: 30000 };
  const done = await call('POST', `/card-payments/${ref}/complete`, { token, body: report });
  ok(done.status === 200 && done.json.payment?.status === 'paid' && done.json.payment?.visitId, `complete → paid, with a visit (got ${done.status} ${done.json.error?.code ?? ''})`);
  const k1 = await revenue();
  ok(k1.revenue.amount - k0.revenue.amount === 30000 && k1.completed - k0.completed === 1, 'revenue +$300, one more completed visit');
  ok((await commissionOf()) - c0 === 6000, 'the stylist earns 20% of it ($60)');
  const again = await call('POST', `/card-payments/${ref}/complete`, { token, body: report });
  ok(again.status === 200 && again.json.payment?.visitId === done.json.payment?.visitId, 'the same report again (a lost response) → the same visit');
  ok((await revenue()).revenue.amount === k1.revenue.amount, 'and nothing is banked twice');

  const listed = await call('GET', '/card-payments?status=paid', { token });
  const row = listed.json.data?.find((p) => p.id === ref);
  ok(row?.cardLast4 === '4242' && row?.cardBrand === 'VISA' && row?.customerName === 'Card Ada', 'it is listed with the card and the customer');
  ok(!('maskedPan' in (row ?? {})), 'and no card number');

  const adaCustomer = (await call('GET', `/customers?search=${tail}`, { token })).json.data?.find((c) => c.name === 'Card Ada');
  const adaVisits = (await call('GET', `/customers/${adaCustomer?.id}/visits`, { token })).json.data ?? [];
  ok(adaVisits[0]?.paymentMethod === 'card' && adaVisits[0]?.refunded === false, "the customer's history: paid by card");
  const spend0 = adaCustomer?.totalSpend?.amount;
  ok(spend0 === 30000, `customer total spend $300 (got ${spend0})`);

  console.log('A DECLINED CARD FREES THE VISIT');
  const bId = await inChair('Card Bo', `+9194${tail}`);
  const sb = await call('POST', '/card-payments', { token, body: { queueEntryId: bId, amountPaise: 30000 } });
  const declined = await call('POST', `/card-payments/${sb.json.payment?.id}/fail`, { token, body: { reason: 'Declined' } });
  ok(declined.status === 200 && declined.json.payment?.status === 'failed', 'fail → failed');
  ok((await detail(bId)).pendingCardPayment === null, 'no charge in flight any more');
  const bCash = await call('POST', `/queue/${bId}/checkout`, { token: coToken, body: { amountPaise: 30000, paymentMethod: 'cash' } });
  ok(bCash.status === 200, `the co-owner checks out with cash (got ${bCash.status} ${bCash.json.error?.code ?? ''})`);

  console.log('CHARGED AFTER ALL, ONCE THE VISIT WAS FINISHED: RECORDED, NEVER REFUSED');
  const cId = await inChair('Card Cy', `+9193${tail}`);
  const sc = await call('POST', '/card-payments', { token, body: { queueEntryId: cId, amountPaise: 30000 } });
  const cRef = sc.json.payment?.id;
  await call('POST', `/card-payments/${cRef}/fail`, { token, body: { reason: 'No answer from the reader' } });
  const cCash = await call('POST', `/queue/${cId}/checkout`, { token, body: { amountPaise: 30000, paymentMethod: 'cash' } });
  ok(cCash.status === 200, 'the visit is finished with cash');
  const kc0 = await revenue();
  const late = await call('POST', `/card-payments/${cRef}/complete`, { token, body: { ...report, providerPaymentId: `pp-late-${run}` } });
  ok(late.status === 200 && late.json.payment?.status === 'paid', `the reader turns out to have charged it → recorded paid (got ${late.status} ${late.json.error?.code ?? ''})`);
  ok(late.json.payment?.needsReview === true && late.json.payment?.visitId === null, 'flagged for review, with no visit');
  ok((await revenue()).revenue.amount === kc0.revenue.amount, 'and no second visit is banked');
  const review = await call('GET', '/card-payments?needsReview=true', { token });
  ok(review.json.data?.some((p) => p.id === cRef), 'it is in the needs-review list');

  console.log('A REFUND: THE MONEY LEAVES, THE VISIT STAYS');
  const kr0 = await revenue();
  const cr0 = await commissionOf();
  const refund = await call('POST', `/card-payments/${ref}/refund`, { token, body: { refundReference: `rf-${run}` } });
  ok(refund.status === 200 && refund.json.payment?.status === 'refunded', `refund → refunded (got ${refund.status} ${refund.json.error?.code ?? ''})`);
  const kr1 = await revenue();
  ok(kr0.revenue.amount - kr1.revenue.amount === 30000, 'revenue −$300');
  ok(kr1.completed === kr0.completed, 'the visit still counts as completed');
  ok(cr0 - (await commissionOf()) === 6000, 'the stylist loses the $60 commission');
  const cv = (await call('GET', `/commission/visits?staffId=${chair}`, { token })).json.data ?? [];
  const refundedVisit = cv.find((v) => v.id === done.json.payment?.visitId);
  ok(refundedVisit?.refunded === true && refundedVisit?.commission?.amount === 0, "the stylist's list shows it refunded, earning nothing");
  const adaAfter = (await call('GET', `/customers/${adaCustomer?.id}`, { token })).json;
  ok(adaAfter.totalSpend?.amount === spend0 - 30000 && adaAfter.visitsCount === adaCustomer.visitsCount, "the customer's spend drops; their visit count does not");
  const adaVisitsAfter = (await call('GET', `/customers/${adaCustomer?.id}/visits`, { token })).json.data ?? [];
  ok(adaVisitsAfter[0]?.refunded === true, 'their history marks it refunded');
  const refundAgain = await call('POST', `/card-payments/${ref}/refund`, { token, body: {} });
  ok(refundAgain.status === 200 && (await revenue()).revenue.amount === kr1.revenue.amount, 'a repeated refund changes nothing');
  const coRefund = await call('POST', `/card-payments/${ref}/refund`, { token: coToken, body: {} });
  ok(coRefund.status === 403, 'a co-owner cannot refund');
  const lateRefund = await call('POST', `/card-payments/${cRef}/refund`, { token, body: {} });
  ok(lateRefund.status === 200 && lateRefund.json.payment?.status === 'refunded', 'the needs-review charge can be refunded too');
  const failedRefund = await call('POST', `/card-payments/${sb.json.payment?.id}/refund`, { token, body: {} });
  ok(failedRefund.status === 422, `a declined charge cannot be refunded (got ${failedRefund.status})`);

  console.log('TURNED OFF: CARD IS ANYONE\'S TO RECORD AGAIN');
  const off = await call('PUT', '/card-payments/settings', { token, body: { enabled: false } });
  ok(off.status === 200 && off.json.enabled === false, 'the main owner turns it off');
  const dId = await inChair('Card Di', `+9192${tail}`);
  ok((await detail(dId, coToken)).cardAllowed === true, 'the co-owner may pick Card again');
  const dCard = await call('POST', `/queue/${dId}/checkout`, { token: coToken, body: { amountPaise: 30000, paymentMethod: 'card' } });
  ok(dCard.status === 200, `and records a card charged elsewhere (got ${dCard.status} ${dCard.json.error?.code ?? ''})`);

  console.log('CLEANUP');
  await call('DELETE', `/users/${co.json.id}`, { token });
  await call('DELETE', `/users/${st.json.id}`, { token });
  const removed = await call('DELETE', `/staff/${chair}`, { token });
  ok(removed.status === 200, 'remove our chair');
  // There is no delete-store endpoint: deactivate our US store (the update schema is strict, so
  // only the store fields the admin form sends).
  if (usStoreId) {
    const off = await call('PUT', `/admin/businesses/${usStoreId}`, { token: admin, body: { ...storeFields, isActive: false } });
    ok(off.status === 200, `deactivate our US store (got ${off.status})`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
