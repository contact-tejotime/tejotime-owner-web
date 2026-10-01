# Homepage industry stores

The homepage "Made for the way your business works" grid has nine cards. Each card opens a
**real, fully working US store**, so the sales team can show a US shop owner TejoTime running for
a business like theirs, straight from www.tejotime.com. This replaced the nine industry marketing
pages (`/hair-salons`, …) on 2026-10-01.

They are **ordinary tenants**: visible and editable in the admin panel, bookable, with walk-in
check-in, and an owner login that works on owner-web, iOS and Android. **Nothing a customer or
prospect sees calls them a demo, and nothing may.** Only the admin panel labels them, so staff can
tell them from real stores (see "In the admin panel").
`/demo-store` (Sharp Cuts (Demo), Mumbai) is a separate thing and is unchanged.

## How a click becomes a store

```
card "Barbershops"  ──►  /barber  (new tab)
                          │  next.config.ts rewrite (afterFiles; address bar keeps /barber)
                          ▼
                        /17185550102  ──►  app/[phone]/page.tsx  ──►  GET /public/businesses/by-phone/17185550102
old /barbershops and /industries/barbershops  ──308──►  /barber   (permanent, direct, no chain)
```

- **New tab**: the store page has no TejoTime menu to come back by.
- **Invisible `noindex`** (Next metadata `robots`) on `/<phone>` and `/<phone>/card` for these nine
  phones only. Nothing on the page changes. Without it, search engines would list made-up US
  shops, addresses and reviews as real businesses, and members of the public could find and book
  them.
- `/demo-store` and every other store are unaffected.

## Where it lives

| File | Role |
|---|---|
| `frontend/src/lib/industryStores.ts` | The map: legacy slug → short path → phone. Drives the cards, footer links, rewrites, 308s and noindex. **No imports** (next.config.ts imports it). |
| `frontend/next.config.ts` | The 18 redirects and 9 rewrites, generated from the map. |
| `backend/scripts/demo-stores.json` | The data sheet: every field of every store, plus the owner logins. |
| `backend/scripts/provision-demo-stores.mjs` | Creates the stores through the admin API and makes them premium. |
| `backend/src/domain/demo-stores.ts` | How the admin API recognises them (by phone): `isDemo`, excluded from platform figures, never disable-able. |
| `backend/scripts/smoke-demo-stores.mjs` | The E2E test (CLAUDE.md §12). |
| `backend/tests/unit/demo-stores-admin.test.ts` | Unit/router tests for the admin rules below. |
| `scripts/check-demo-stores.ts` | `npm run check:demo-stores`: the frontend map, the sheet and the backend list must agree. |

## In the admin panel

The admin panel is the one place they **are** called demo stores. The public pages never are.

- **Listed apart.**
  - The sidebar has a **Demo stores (9)** group below **Stores**, each row with a teal edge.
  - The Stores page has a **Demo stores** table under the main one: same columns, no checkboxes, no bulk actions, and **Always on** instead of the Enabled toggle.
  - A demo store's hub shows **Always on** in place of the toggle. Everything else (Settings, services, staff, hours, photos) is editable like any store.
- **Labelled by their homepage card, not their category.** All nine are "Salon & Barber", so
  wherever the panel would show the category (sidebar sub-line, the table's Category · City
  column, the hub's meta line) it shows the card instead: Hair salons, Barbershops, Nail studios
  and so on. The backend sends this as `demoIndustry`, from `domain/demo-stores.ts`.
  `check:demo-stores` fails if a label stops matching its card's wording in `frontend/src/i18n/en.json`.
- **Left out of every platform figure:**
  - the Stores count and table
  - the Dashboard (store totals, active/inactive, customers, today's visits, online bookings, premium count and MRR, charts)
  - Customers
  - Reports
  - Billing
  - Team (an admin's store count)
- **Never disable-able.** `PUT /admin/businesses/:id` with `isActive: false` for one of them returns
  **409 `DEMO_STORE_ALWAYS_ON`**. The check runs *before* the body is validated, so a bare
  `{ "isActive": false }` gets the 409; if the check ever broke, the same request would fail
  validation (400) rather than write anything.
- **How it's wired:**
  - The backend flags each store row and the store detail with `isDemo`, based on the phone list in `domain/demo-stores.ts`. That list is a constant, not a column, so no migration was needed.
  - The admin panel's `listBusinesses()` / `listBusinessesWithMetrics()` (`admin-panel/src/lib/server-api.ts`) drop flagged stores, and `listDemoBusinesses*()` return only them. Every platform page reads the former.
  - The dashboard overview and the Team count exclude them in the backend.

## The stores

All of them: category **Salon & Barber**, **USD**, timezone automatic from the area code, open
**7 AM–11 PM every day**, payments Credit/Debit Card, Apple Pay and Cash, no photos (uploaded by
hand later), Google review link empty, so no review texts go out.

Store phones are in the **555-0100–555-0199 block, reserved for fiction**, so tapping "Call" never
rings a real person.

| Card | URL | Store | Store phone | Timezone | Theme | Owner login (+1) | Password |
|---|---|---|---|---|---|---|---|
| Hair salons | /salon | Willow & Co. Hair Studio | (512) 555-0101 | Chicago | luxury / light | 101010101 ¹ | 101010101 |
| Barbershops | /barber | Main Street Barber Co. | (718) 555-0102 | New York | bold / light | 222222222 | 222222222 |
| Nail studios | /nail | Polished Nail Lounge | (305) 555-0103 | New York | modern / light | 333333333 | 333333333 |
| Spas | /spa | Still Waters Day Spa | (480) 555-0104 | Phoenix | warm / light | 444444444 | 444444444 |
| Med spas | /medspa | Lumière Aesthetics | (310) 555-0105 | Los Angeles | minimal / light | 555555555 | 555555555 |
| Massage therapy | /massage | Knead & Unwind Massage | (303) 555-0106 | Denver | warm / light | 666666666 | 666666666 |
| Physical therapy | /physio | Forward Motion Physical Therapy | (312) 555-0107 | Chicago | medical / light | 777777777 | 777777777 |
| Tattoo studios | /tattoo | Black Anchor Tattoo | (206) 555-0108 | Los Angeles | bold / dark | 888888888 | 888888888 |
| Pet grooming | /pet | Happy Tails Grooming | (404) 555-0109 | New York | modern / light | 999999999 | 999999999 |

¹ Not `111111111`: on preprod, `1` + `111111111` also matches the "preprod" test store's owner
(+91 1111111111, because the login lookup tries the store's country code in front of what was
typed). `findLoginByPhone` refuses an ambiguous match, so neither account could sign in. Run the
collision check below before choosing any new owner login.

Services, staff, reviews and copy for each: `backend/scripts/demo-stores.json`.

### Owner login

On business.tejotime.com, or the iOS/Android app: choose **Owner**, leave the country on
**United States (+1)** (the default), type **exactly the 9 digits** (e.g. `222222222`), then the
password.

- The app sends `1` + `222222222`. The stored owner phone is the bare `222222222`, and
  `findLoginByPhone` (`backend/src/modules/auth/auth.service.ts`) matches it through
  `business.country_code || app_user.phone`.
- **Typing ten 1s fails, and so does picking +91.** Neither login form checks the length, so the
  9-digit number is accepted on both.
- **Password convention: the password is the same 9 digits as the login**, e.g.
  `222222222` / `222222222`. Sales only have to remember one number per store. The provisioning
  script refuses a sheet that breaks the convention.
- **The sheet is the source of truth for passwords.** Every provisioning run signs in with the
  sheet's password. If that fails for an existing store (someone changed it in the panel or the
  app), the run resets it through the admin panel's own "Reset owner password", which also signs
  that owner out everywhere, then checks again. To change a password, edit `demo-stores.json` and
  re-run.

## Rules

- **Never change these phone numbers or URLs.**
  - The phones are hard-coded in the frontend map, and the old URLs 308 to the paths *permanently*: browsers and search engines cache that.
  - The API already refuses to change a store's phone once it is set (`PHONE_LOCKED`, `admin.service.ts`), for admins too. Don't work around that for these nine.
- **The owner login phone cannot be changed after creation.** Nothing exposes it; the admin panel shows it read-only.
- **Keep the category "Salon & Barber".**
  - It gives every store neutral page wording: "Choose Your Provider", "Choose a Service".
  - A category containing "pet" would switch the page to clinic wording: "Check in with Dr. …" plus a hospital-emergency banner (`frontend/src/components/microsite/domains.ts`).
- **These stores can't be deactivated** (409 `DEMO_STORE_ALWAYS_ON`, see above). A deactivated one would turn its homepage card into a 404. A 10th store means adding its phone to all three lists that `check:demo-stores` compares.
- **No "demo" in any store content, and no medical, HIPAA or insurance claims** for the med spa and physio stores (`.claude/docs/current-work.md`).
- **No `app/` folder may be named like one of the paths** (`salon`, `barber`, …). A real folder wins over the rewrite and silently takes the URL.

## Production: one command

Preprod went through several runs while the details were being decided. Production needs **one
deploy and one command**.

1. **Deploy:** merge `preprod → main`. This ships the backend (no migration), admin panel and
   website together.
2. **Run once,** right after the deploy finishes, with a production **owner-role** admin:
   ```powershell
   cd backend
   $env:PROVISION_API_BASE_URL='https://api.tejotime.com/api/v1'
   $env:PROVISION_WEB_URL='https://www.tejotime.com'
   $env:PROVISION_ADMIN_MOBILE='<prod admin mobile>'; $env:PROVISION_ADMIN_PASSWORD='<prod admin password>'
   node scripts/provision-demo-stores.mjs
   ```
   In one execution it:
   - validates the sheet
   - creates the 9 stores
   - checks every owner login works with its password (login = password, e.g. `222222222` / `222222222`)
   - upgrades each store to Premium
   - runs the full end-to-end test: API, admin-panel rules and the website

   It ends with **`✓ Provisioned and verified.`** Anything else is listed, store by store, with
   the fix in the table below. It's safe to re-run: existing stores are skipped and never
   overwritten.

**Why deploy first:** the closing test checks the new admin rules and the website, which only exist
after the deploy. Between the deploy and the command, the nine homepage cards open "We couldn't
find that business". Run the command straight away. The old industry URLs 308 to `/salon` and
the rest, and those URLs work the moment the stores exist, so nothing wrong gets cached.

**By hand afterwards:**
- Click two or three cards.
- Book once and check in once.
- Sign in as one owner on business.tejotime.com and in the iOS and Android app.

## Other environments, and the details

The same command works for preprod (`https://api-preprod.tejotime.com/api/v1`,
`https://preprod.tejotime.com`) or local (`http://localhost:8080/api/v1`, `http://localhost:3000`).
`--dry-run` shows what would happen without changing anything. `--no-verify` skips the closing
test.

1. **Optional collision check** (read-only, needs DB read access). Any row returned **before**
   provisioning means a login collision. After provisioning, expect exactly one row per number.
   ```sql
   with d(digits) as (values ('1101010101'),('1222222222'),('1333333333'),('1444444444'),
                             ('1555555555'),('1666666666'),('1777777777'),('1888888888'),('1999999999'))
   select d.digits, u.id, u.phone, b.name
     from d
     join app_user u on true
     join business b on b.id = u.business_id
    where u.phone = d.digits or u.phone = b.country_code || d.digits or b.country_code || u.phone = d.digits;
   ```
2. **Use an owner-role admin.** An employee only sees stores they created, so existing stores
   fall back to a slower path and new ones would be attributed to the employee.
3. **The test on its own** (no provisioning) is `node scripts/smoke-demo-stores.mjs` with
   `SMOKE_BASE_URL`, and optionally `SMOKE_WEB_URL` and `SMOKE_ADMIN_MOBILE` / `SMOKE_ADMIN_PASSWORD`.
   Its ADMIN section checks that each store is flagged demo, that disabling one is refused with
   409, and that the dashboard and Team counts leave them out.

### What the provisioning results mean

| Result | Meaning / fix |
|---|---|
| `created` / `exists` | Fine. An existing store is **never overwritten**: admin edits since are kept. |
| `exists (not visible to this admin)` | The store was created by another admin. Use an owner-role admin to see it. |
| `renamed in admin to "…"` | Informational. The smoke name check fails until the sheet matches. |
| `deactivated in the admin panel` | Reactivate it there. The panel can no longer disable these stores, so this only happens if it was done directly in the database. |
| `create 400 …` | The sheet broke a server rule; the per-field details are printed. |
| `create 500 (likely: owner phone already used…)` | `uq_app_user_phone`: another login already uses that owner phone. The create rolled back. |
| `password reset` | Informational. The store's password had been changed, and the run set it back to the sheet's. |
| `owner login 401 … collides with another account` | A reset can't fix this: another account matches the same login number (collision check above). Pick a free 9-digit number, which needs a one-row SQL update since the API can't change an owner's login phone. |
| `owner login opens a DIFFERENT store` | An unrelated tenant holds the 555 number. Investigate before anything else. |
| `PAYMENTS_ENABLED is on` | The upgrade needs real payment in that environment; the plan was not changed. |

## Maintenance

- **The owner logins are shared, so anyone holding them can edit the store.** Restore access with
  the admin panel's **Reset owner password**. Restore content by hand from `demo-stores.json`:
  the provisioning script never overwrites an existing store.
- **Customer data builds up.** Walk-in tickets auto-cancel after `TICKET_ABANDON_HOURS`;
  appointments and customers stay.
- **Known gap.** Every server render of a store page calls the API from the frontend server's IP, so all
  microsite renders likely share one `publicRead` budget (60/min). Homepage traffic to these
  stores makes that more visible. Pre-existing; see `.claude/docs/current-work.md`.
