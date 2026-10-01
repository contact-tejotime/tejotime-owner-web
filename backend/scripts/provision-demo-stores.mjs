// Provision the nine homepage industry stores (docs/demo-stores.md) through the ADMIN API.
//
// WHY THE API, NOT THE DATABASE
//   The stores must be ordinary tenants — visible and editable in the admin panel, bookable, with
//   a working owner login — so they are created by exactly the call the admin panel's "Create
//   store" form makes (POST /admin/businesses). Same validation, same transaction, same
//   created_by_admin_id stamp. This script never opens a DB connection: backend/.env points at a
//   live database, and nothing here should be able to reach it.
//
// ONE COMMAND DOES EVERYTHING (see docs/demo-stores.md → "Production: one command")
//   PowerShell:
//     $env:PROVISION_API_BASE_URL='https://api.tejotime.com/api/v1'
//     $env:PROVISION_WEB_URL='https://www.tejotime.com'          # optional: also check the website
//     $env:PROVISION_ADMIN_MOBILE='<owner-role admin mobile>'; $env:PROVISION_ADMIN_PASSWORD='<password>'
//     node scripts/provision-demo-stores.mjs
//   bash: the same four variables inline, then `node scripts/provision-demo-stores.mjs`.
//
//   In one run it: validates the sheet → creates any store that is missing → makes every owner
//   login sign in with the sheet's password (resetting it through the admin panel's own "Reset
//   owner password" call when it doesn't — that also signs the owner out everywhere) → upgrades
//   to premium → then runs smoke-demo-stores.mjs against the same environment (API + admin rules,
//   plus the website when PROVISION_WEB_URL is set). Exit 0 only if all of that passed.
//
//   --dry-run      validate the sheet; with the env set, also report what exists / would be created.
//                  Never creates, never logs in as an owner, never resets, never upgrades.
//   --only=a,b     limit to these paths (e.g. --only=salon,barber).
//   --no-verify    skip the closing smoke run.
//
// SAFE TO RE-RUN. A store is found by its phone; an existing one is never re-created and its
// content is never overwritten (admins may have edited it — that is the point of them being real
// stores). Only the owner password is brought back to the sheet's: the sheet is the source of
// truth for the logins sales hand out. A login-phone collision can't be fixed by a reset and is
// reported (docs/demo-stores.md).
//
// Use an OWNER-role admin: an employee only sees stores they created, so existing stores fall
// back to the slower 409 path, and new ones would be attributed to the employee.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHEET = JSON.parse(readFileSync(new URL('./demo-stores.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERIFY = !args.includes('--no-verify');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean);
const BASE = process.env.PROVISION_API_BASE_URL?.trim().replace(/\/+$/, '');
const WEB = process.env.PROVISION_WEB_URL?.trim().replace(/\/+$/, '');
const ADMIN_MOBILE = process.env.PROVISION_ADMIN_MOBILE?.trim();
const ADMIN_PASSWORD = process.env.PROVISION_ADMIN_PASSWORD;

const entries = ONLY ? SHEET.stores.filter((s) => ONLY.includes(s.path)) : SHEET.stores;
const phoneFull = (e) => `${e.store.countryCode}${e.store.phoneNumber}`;
/** What the owner-web and app login forms send: +1 picker + the 9 typed digits. */
const ownerLoginPhone = (e) => `${e.store.countryCode}${e.owner.phone}`;
/** The create body. path / legacySlug / verify are sheet-only — the strict schema 400s on them. */
const createBody = (e) => ({ ...SHEET.defaults, ...e.store, owner: e.owner });

// ---------------------------------------------------------------- validation --
// Mirrors the limits of storeFieldsSchema/createSchema (backend/src/modules/admin/admin.routes.ts)
// that this data can plausibly break, plus the shape the client asked for. The server is still
// the real gate (a 400 prints its per-field details); this just fails before any network call.
function validate(list) {
  const problems = [];
  const bad = (e, msg) => problems.push(`${e.path ?? '?'}: ${msg}`);
  const seen = { path: new Set(), phone: new Set(), owner: new Set() };

  if (ONLY && list.length !== ONLY.length) problems.push(`--only names an unknown path: ${ONLY.join(',')}`);

  for (const e of list) {
    const b = createBody(e);
    for (const [k, set, v] of [['path', seen.path, e.path], ['phone', seen.phone, phoneFull(e)], ['owner phone', seen.owner, ownerLoginPhone(e)]]) {
      if (set.has(v)) bad(e, `duplicate ${k} ${v}`);
      set.add(v);
    }
    const max = { name: 120, category: 80, area: 120, address: 300, city: 80, tagline: 160, heroSubtitle: 200, statValue: 40, statLabel: 60, description: 2000, aboutHeading: 160 };
    for (const [field, limit] of Object.entries(max)) {
      const v = b[field];
      if (['name', 'category', 'area', 'address', 'city', 'tagline', 'description', 'aboutHeading'].includes(field) && !String(v ?? '').trim()) bad(e, `${field} is required`);
      if (v != null && String(v).length > limit) bad(e, `${field} longer than ${limit}`);
    }
    if (!/^\d{1,4}$/.test(b.countryCode) || !/^\d{6,14}$/.test(b.phoneNumber)) bad(e, 'store phone must be digits');
    if (!/^\d{7,15}$/.test(e.owner?.phone ?? '')) bad(e, 'owner phone must be 7-15 digits');
    if (!(typeof e.owner?.password === 'string' && e.owner.password.length >= 6 && e.owner.password.length <= 72)) bad(e, 'owner password must be 6-72 chars');
    // The agreed convention, so sales only have to remember one number per store: password = login.
    if (e.owner?.password !== e.owner?.phone) bad(e, `owner password must equal the owner login number (${e.owner?.phone})`);
    if (!(b.rating >= 0 && b.rating <= 5) || !Number.isInteger(b.reviewCount)) bad(e, 'rating 0-5 and an integer reviewCount');

    const open = (b.hours ?? []).filter((h) => !h.isClosed);
    if (new Set(open.map((h) => h.dayOfWeek)).size !== 7) bad(e, 'hours must cover all 7 days, open');
    if (b.services.length < 3 || b.services.length > 4) bad(e, `3-4 services (has ${b.services.length})`);
    if (b.staff.length < 1 || b.staff.length > 2) bad(e, `1-2 staff (has ${b.staff.length})`);
    if (b.reviews.length !== 3) bad(e, `3 reviews (has ${b.reviews.length})`);
    for (const s of b.services) {
      if (!s.name || s.name.length > 80 || !(s.durationMinutes >= 1 && s.durationMinutes <= 600)) bad(e, `service "${s.name}" name/duration`);
      if (s.priceType === 'unset' && (s.priceRupees != null || s.priceMaxRupees != null)) bad(e, `service "${s.name}" is unset but has a price`);
      if (s.priceType !== 'unset' && !(s.priceRupees > 0)) bad(e, `service "${s.name}" needs a price`);
      if (s.priceType === 'range' && !(s.priceMaxRupees >= s.priceRupees)) bad(e, `service "${s.name}" range max must be >= min`);
      if (s.priceType === 'fixed' && s.priceMaxRupees != null) bad(e, `service "${s.name}" is fixed but has a max`);
    }
    for (const r of b.reviews) {
      if (!(r.stars >= 1 && r.stars <= 5) || !r.text || !r.authorName) bad(e, 'each review needs 1-5 stars, text and an author');
    }
    // The stores are presented as real shops — the word must never reach the page.
    if (/demo/i.test(JSON.stringify(e.store))) bad(e, 'store content contains "demo"');
  }
  return problems;
}

// ---------------------------------------------------------------------- http --
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const errText = (r) => `${r.status} ${r.json?.error?.code ?? ''} ${r.json?.error?.message ?? ''}`.trim();

// ---------------------------------------------------------------------- main --
async function main() {
  const problems = validate(entries);
  if (problems.length) {
    console.error('Sheet is invalid — nothing was sent:');
    problems.forEach((p) => console.error('  ✗', p));
    process.exit(1);
  }
  console.log(`✓ sheet valid (${entries.length} store${entries.length === 1 ? '' : 's'})`);

  if (!BASE || !ADMIN_MOBILE || !ADMIN_PASSWORD) {
    if (DRY) {
      console.log('Dry run without PROVISION_API_BASE_URL / ADMIN creds: local validation only.');
      return;
    }
    console.error('Set PROVISION_API_BASE_URL, PROVISION_ADMIN_MOBILE and PROVISION_ADMIN_PASSWORD (no defaults, on purpose).');
    process.exit(1);
  }
  console.log(`Target: ${BASE}  —  ${DRY ? 'DRY RUN (no writes)' : 'LIVE'}`);

  // One admin login per run: the admin limiter is 10 per 5 min per IP, shared by every admin
  // sign-in from this machine.
  const adminLogin = await api('POST', '/admin/auth/login', { body: { mobile: ADMIN_MOBILE, password: ADMIN_PASSWORD } });
  if (adminLogin.status !== 200 || !adminLogin.json.token) {
    console.error(`Admin login failed: ${errText(adminLogin)}`);
    process.exit(1);
  }
  const adminToken = adminLogin.json.token;
  const me = await api('GET', '/admin/me', { token: adminToken });
  if (me.json.role !== 'owner') {
    console.warn(`! Admin role is "${me.json.role}", not "owner": stores created by others are invisible to this account.`);
  }

  const list = await api('GET', '/admin/businesses', { token: adminToken });
  if (list.status !== 200) {
    console.error(`Could not list stores: ${errText(list)}`);
    process.exit(1);
  }
  const byPhone = new Map((list.json.data ?? []).map((b) => [b.phoneFull, b]));

  const results = [];
  for (const e of entries) {
    const r = { path: e.path, phone: phoneFull(e), name: e.store.name, state: '', plan: '', note: '' };
    results.push(r);
    try {
      const existing = byPhone.get(r.phone);
      if (existing && !existing.isActive) {
        r.state = 'ERROR';
        r.note = 'deactivated in the admin panel — reactivate it there';
        continue;
      }

      if (existing) {
        r.state = 'exists';
        if (existing.name !== e.store.name) r.note = `renamed in admin to "${existing.name}"`;
      } else if (DRY) {
        r.state = 'would create';
        continue;
      } else {
        const created = await api('POST', '/admin/businesses', { token: adminToken, body: createBody(e) });
        if (created.status === 201) {
          r.state = 'created';
        } else if (created.status === 409 && created.json?.error?.code === 'PHONE_IN_USE') {
          r.state = 'exists (not visible to this admin)';
        } else {
          r.state = 'ERROR';
          r.note = `create ${errText(created)}`;
          if (created.json?.error?.details) r.note += ` ${JSON.stringify(created.json.error.details)}`;
          // uq_app_user_phone is a unique index; a duplicate owner phone surfaces as a 500 and
          // the whole create rolls back, so nothing half-made is left behind.
          if (created.status === 500) r.note += ' (likely: owner phone already used by another login)';
          continue;
        }
      }

      if (DRY) continue;

      const site = await api('GET', `/public/businesses/by-phone/${r.phone}`);
      if (site.status !== 200) {
        r.state = 'ERROR';
        r.note = `public page ${errText(site)}`;
        continue;
      }

      // Prove the owner login works AND belongs to this store — a phone match alone could be an
      // unrelated tenant that happens to hold the number.
      const signIn = () =>
        api('POST', '/auth/login', { body: { phone: ownerLoginPhone(e), password: e.owner.password, accountType: 'owner' } });
      let login = await signIn();
      if (login.status === 401 && r.state !== 'created') {
        // The sheet's password is the source of truth: apply it the way the admin panel does.
        const reset = await api('POST', `/admin/businesses/${site.json.id}/owner/password`, {
          token: adminToken,
          body: { password: e.owner.password },
        });
        if (reset.status !== 200) {
          r.state = 'ERROR';
          r.note = `password reset ${errText(reset)}`;
          continue;
        }
        r.note = r.note ? `${r.note}; password reset` : 'password reset';
        login = await signIn();
      }
      if (login.status !== 200) {
        r.state = 'ERROR';
        r.note = login.status === 429
          ? 'owner login rate-limited — wait 5 minutes and re-run'
          : `owner login ${errText(login)}${r.note?.includes('password reset') ? ' even after a password reset' : ''} — the login phone collides with another account (docs/demo-stores.md)`;
        continue;
      }
      if (login.json.business?.id !== site.json.id) {
        r.state = 'ERROR';
        r.note = 'owner login opens a DIFFERENT store — phone taken by an unrelated tenant';
        continue;
      }
      const ownerToken = login.json.accessToken;

      r.plan = login.json.business?.plan ?? '?';
      if (r.plan !== 'premium') {
        const up = await api('POST', '/subscription/upgrade', { token: ownerToken });
        const sub = await api('GET', '/subscription', { token: ownerToken });
        if (up.json?.requiresPayment || sub.json?.plan !== 'premium') {
          r.state = 'ERROR';
          r.note = up.json?.requiresPayment
            ? 'upgrade needs payment — PAYMENTS_ENABLED is on in this environment'
            : `upgrade did not stick (${errText(up)})`;
        } else {
          r.plan = 'premium (upgraded)';
        }
      }
      await api('POST', '/auth/logout', { body: { refreshToken: login.json.refreshToken } });
    } catch (err) {
      r.state = 'ERROR';
      r.note = err instanceof Error ? err.message : String(err);
    }
  }

  console.log('');
  for (const r of results) {
    console.log(`  ${r.state === 'ERROR' ? '✗' : '✓'} /${r.path.padEnd(8)} ${r.phone}  ${r.state.padEnd(12)} ${r.plan.padEnd(19)} ${r.name}${r.note ? `  — ${r.note}` : ''}`);
  }
  const failed = results.filter((r) => r.state === 'ERROR').length;
  console.log(`\n${failed ? `${failed} store(s) need attention.` : 'All stores ready.'}`);
  if (failed || DRY || ONLY || !VERIFY) process.exit(failed ? 1 : 0);

  // Same run, end to end: the smoke test against the same environment and admin, so production is
  // one command instead of provision-then-remember-to-verify. (Skipped for --dry-run / --only.)
  console.log(`\nVerifying with smoke-demo-stores.mjs${WEB ? '' : ' (website checks skipped — set PROVISION_WEB_URL to include them)'} …\n`);
  const smoke = spawnSync(process.execPath, [fileURLToPath(new URL('./smoke-demo-stores.mjs', import.meta.url))], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SMOKE_BASE_URL: BASE,
      SMOKE_ADMIN_MOBILE: ADMIN_MOBILE,
      SMOKE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      ...(WEB ? { SMOKE_WEB_URL: WEB } : { SMOKE_WEB_URL: '' }),
    },
  });
  console.log(smoke.status === 0 ? '\n✓ Provisioned and verified.' : '\n✗ Provisioned, but verification failed — see above.');
  process.exit(smoke.status === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
