# Current work

**Last updated:** 2026-10-05 · branch `feat-jay`.

This is the living document. Update it when the state of play changes; the other five docs describe
the system as designed, this one describes where it actually is.

---

## 1. What is in flight

### My Appointments — manage a booking with the phone number (2026-10-05)

**Client decision:** the phone number alone now views, moves and cancels a customer's appointments,
and fully manages their repeating booking, from any device. This reverses "a phone alone never
cancels". Customers weren't keeping the manage link. Decision record, accepted risk and what was
kept: [docs/customer-my-appointments.md](../../docs/customer-my-appointments.md).

- **Backend:** the phone lookup returns each changeable booking's `appointmentKey` and the open
  series' `manageToken`, and takes only a `+<cc>` number (400 otherwise). New endpoints
  `GET /public/appointments/:id/slots` and `POST …/reschedule` move a booking up to today+20.
  The chat bot's cancel/reschedule answer points at My Appointments (action `appts`). No migration.
- **Customer site:** a My Appointments button in the header and the mobile menu opens a new pop-up
  (`components/microsite/MyAppointments.tsx`). Repeating bookings open the manage view inline
  (`SeriesPanel`). The store chat cancels bookings made on other devices.
  **Lookup results stay in page memory, never in localStorage** (shared browsers).
- **Owner surfaces:** no change. Owner web and the app already show every booking and receive
  `appointment:updated` / `series:updated`.
- **Verified here:**
  - Backend: `npx vitest run` 38 files / 482 tests; tsc and eslint clean (`tsc` still reports the
    2 old errors in `tests/unit/store-drafts.test.ts`).
  - Frontend: tsc, `npm run lint` and `npm run build` clean; `test:chat-flow` 167/167.
  - Smokes, local throwaway DB re-seeded, each script on a freshly started API:
    `smoke-my-appointments.mjs` 23/23 (new), `smoke-selfservice.mjs` 25/25 (flipped: the lookup now
    returns the key), `smoke-recurring.mjs` 39/39, `smoke-recurring-edit.mjs` 32/32,
    `smoke-rest.mjs` 149/149, `smoke-booking-guards.mjs` 14/14, `smoke-recurring-sweep.ts` 50/50.
  - Headless-Chrome walk-through, 29/29 steps, at 390 px and 1280 px:
    - device A books;
    - device B, holding only the phone number, reschedules and cancels the one-off, skips a series
      visit inline, and cancels from the chat;
    - after a reload no key or token is in storage;
    - device A lists without typing.
- **Test harness fix:** `smoke-recurring-edit.mjs` now looks up free times with John instead of
  assuming "slot + n days". A throwaway DB that keeps earlier runs' bookings had made those 409 and
  then crash.
- **Same day, two follow-ups (client):**
  - the repeating-booking success screen no longer shows the manage link;
  - My Appointments and the chat start from the phone number, like Check Waitlist Status, and show
    only that number's bookings. The earlier "booked on this device" list showed every number booked
    from one browser. The page now saves no bookings, keys or tokens, and clears old saved records
    on load. Verified: frontend tsc, lint and build clean; `test:chat-flow` 171/171; headless-Chrome
    walk-through 20/20. In that run one browser books with two numbers; each number lists only its
    own bookings; the chat asks for the number first; nothing is saved; an old record is cleared.
    The walk-through also caught a gap, now fixed: switching back to a number already looked up
    didn't make it the "last number", so the chat offered the wrong one.
- **Not done:** no device pass is needed (no app change). The owner-typed bare 10-digit phone
  stored as `+1…` stays a known limit; such bookings aren't found by `+91…`.

### Recurring appointments — Phase 2 (2026-10-03)

Reschedule one visit (owners: any booking up to today+60; customers: their own series visits up to
today+20), change all future visits (time and/or stylist; a date the new time doesn't fit needs
"another time" or "skip" before anything is written — 409 `CHANGE_CONFLICTS`), "Book another time" on
Needs attention, and the Phase 1 leftovers (open the series sheet from a row, calendar repeat marker,
store-clock times in the app). Migration **0037**. Owner-created bookings/series are out of scope.
Design + decisions: [docs/recurring-appointments.md](../../docs/recurring-appointments.md) §0b.

- **Deploy:** 0037 before the backend.
- **Verified here (backend):** `npx vitest run` 38 files / 470 tests (new `series-edit.test.ts` 11,
  Phase 2 additions to `recurrence.test.ts` and `auth-session-currency.test.ts`); tsc + eslint clean.
  Local throwaway Postgres: 0037 applied and re-applied; `smoke-recurring-sweep.ts` 50/50 (Phase 2
  half: skip survives a change, moved visit kept, taken date needs a choice with nothing written,
  count still ends at its total, Book another time, two race checks); fresh API on :8090:
  `smoke-recurring-edit.mjs` 31/31, `smoke-recurring.mjs` 39/39, `smoke-rest.mjs` 149/149,
  `smoke-booking-guards.mjs` 14/14, `smoke-selfservice.mjs` 25/25.
- **Verified here (clients):** frontend and owner-web tsc + lint + build clean; app tsc + lint
  clean; `test:chat-flow` 158/158. Headless-Chrome walk-throughs on the throwaway API: customer
  (move a visit, change with two taken dates — one re-timed, one skipped — a 409 and a re-pick) and
  owner-web (row Reschedule, series-sheet Reschedule, Change future visits with conflicts and a 409,
  Book another time, open-sheet-from-row, calendar marker, 1280px). Bugs found and fixed: the customer
  rhythm line took its weekday from a moved first visit; owner-web Escape closed two sheets, a stale
  slot list after a 409, an off-screen preview, a squeezed date column; backend preview called a
  booked date past the horizon "later" (regression test added, failed first).
- **Not done:** iOS + Android device pass (Hermes `Intl` with `timeZone` especially), dark mode, the
  owner-web Needs-attention wrap fix (CSS, not re-checked), staff-login flows in a browser.

### Recurring appointments — Phase 1 (2026-10-03)

The client's requirement: a customer books once and the visit repeats (every week / 2 / 3 / 4 weeks
/ every N days; until cancelled, after X visits, or until a date). Migration **0036**; the series
stores the rule, a job books each next visit about three weeks ahead (today+20, 7 days before the
public window can show the date). Customer: repeat option + preview on the booking page, a manage
page from a token link (skip one visit, cancel the series). Owner (web + app): repeat icon,
Regulars, series sheet (pause / resume / cancel / skip), Needs attention, store switch. Check-in
now honours the booked stylist. Plan, decisions and what changed from it:
[docs/recurring-appointments.md](../../docs/recurring-appointments.md).

- **Deploy:** 0036 before the backend (the pipeline runs migrations first). The job starts on boot.
- **Verified here (backend):** `npx tsc --noEmit` (only the 2 pre-existing `store-drafts.test.ts`
  errors), eslint on every changed file, `npx vitest run` — 37 files / 451 tests, including the
  new `recurrence.test.ts` (18) and `public-series.test.ts` (13). On a **local throwaway Postgres
  18** (`tejotime_smoke` on localhost — not preprod): all migrations incl. 0036 applied, 0036
  re-applied cleanly (idempotent), `smoke-recurring-sweep.ts` 23/23, and against a fresh API on
  :8090 `smoke-recurring.mjs` 39/39, `smoke-rest.mjs` 149/149, `smoke-booking-guards.mjs` 14/14,
  `smoke-selfservice.mjs` 25/25.
- **Bug the real-DB smoke caught (fixed, with a regression unit test that failed first):** a
  series was marked `ended` the moment its last visit was *booked*. "Weekly × 3" books all three at
  once, so it vanished from Regulars, could not be paused, and the same phone could open a second
  series. It now ends the day after its last visit.
- **Verified here (clients):** `frontend`, `owner-web` — `tsc --noEmit`, lint and `next build`
  clean; `app` — `tsc --noEmit` and `expo lint` clean; `npm run test:chat-flow` 158/158. Driven in
  headless Chrome against the throwaway API (390px, plus 1280px for owner-web): the booking
  modal's repeat section → Confirm → success screen + Copy link → second series on the same phone
  refused → manage page Skip / Cancel / wrong token; owner-web login → Needs attention (Mark
  handled) → Regulars → series sheet Skip / Pause / Resume / Cancel → Calendar repeat icon →
  Settings switch round-trip. Two layout bugs found and fixed (manage-page button overflow at
  390px; owner-web repeat icon wrapping series rows onto an extra line).
- **Not done:** no device pass on iOS / Android (the app was type-checked and linted only); dark
  mode not checked on any surface.
- **Phase 2 (not built):** reschedule one visit, change all future visits, owner-created series
  (needs an owner "New appointment" screen, which does not exist).

### Staff commission % (2026-10-02)

A dated commission rate per stylist (migration **0034**: `staff_commission_rate` + the
`visit_commission` view — the schema's first view), on owner-web, the app and (read-only) the admin
panel. Every visit is paid at the rate of its own store-local day: "20% from 02/10, 30% from 16/10"
pays 2–15 Oct at 20% for ever. Rates start today or later; earlier days are locked. New
`commission` module, **role-only** (not in the Team grid): every staff login sees its own earnings,
owners set rates. It shipped as a Hidden / View only grant and was made role-only the same day at
the owner's request — stale `commission` override rows on preprod are ignored. Reports
gained This week and Custom dates; `/dashboard/by-staff` now keeps a stylist removed mid-period.
Rules, API, screens and tests: [docs/staff-commission.md](../../docs/staff-commission.md).

- **Deploy:** 0034 must be applied before the backend that reads it (the Coolify pipeline runs
  migrations first). Until then `/commission/*` and the admin Visits page 500; Reports' revenue does
  not depend on the view.
- **Verified here:** backend `npm test` (35 files / 412 tests), `npm run test:commission`, owner-web
  and admin-panel lint + type-check + build, app `tsc` (only the pre-existing missing
  `expo-screen-orientation` module) and lint on every changed file.
- **Verified here (instant rates, 0035):** `npm test` on the four commission unit files (35 tests)
  and `npm run test:commission` (119 checks). The smoke scripts were updated for the 1pm split and
  were not run — they need a throwaway Postgres, and `backend/.env` is preprod.
- **Not run yet:** `smoke-commission-db.mjs` and `smoke-commission.mjs`; no device pass on iOS /
  Android yet.
- **Open:** no tips field (a tip typed into the total earns commission); no payouts / "mark as
  paid"; one rate per stylist (no per-service %).

### A USD store no longer shows ₹ (2026-10-02)

A store set to USD in the admin panel still showed ₹ on price inputs and the checkout box in
owner-web and the app (literal symbols / an i18n `pricePrefix`), owner-web grouped USD in lakhs
(`$12,34,567`), and the admin autofill preview hardcoded ₹. `/auth/me` + login now carry
`business.currency` for every role; owner-web gained the mirrored `lib/currencies.ts`; all three
surfaces format alike (INR-only lakh grouping, 0 or 2 decimals). Rules and what is deliberately
still INR: [docs/store-currency.md](../../docs/store-currency.md). Regression test:
`backend/tests/unit/auth-session-currency.test.ts`; `smoke-rest.mjs` extended (not run — no
throwaway DB here). Still open: the `DEFAULT_CURRENCY=INR` default itself (§2).

### Homepage industry cards open live US stores (2026-10-01)

The nine industry pages are **removed**. Each homepage card now opens (in a new tab) a real, fully
working US store at a short word — `/salon /barber /nail /spa /medspa /massage /physio /tattoo
/pet` — so sales can show a US shop owner the product running for a business like theirs. They are
ordinary tenants (admin-editable, bookable, owner login on web/iOS/Android), never labelled demo in
the UI. Runbook and rules: [docs/demo-stores.md](../../docs/demo-stores.md).

- **Frontend.** `frontend/src/lib/industryStores.ts` (dependency-free, imported by
  `next.config.ts`) drives the cards, footer links, word → phone rewrites, direct 308s from
  `/<old-slug>` and `/industries/<old-slug>`, and an invisible `noindex` on those nine phones'
  `/[phone]` and `/[phone]/card` pages. `app/industries/` and its i18n are deleted. `/demo-store`
  untouched.
- **Stores** are created by `backend/scripts/provision-demo-stores.mjs` through the admin API (never
  the DB) from `backend/scripts/demo-stores.json`. **One run does everything**: create missing
  stores, bring every owner password back to the sheet's (admin "Reset owner password"), upgrade to
  premium, then run `smoke-demo-stores.mjs` (API + admin + website with `PROVISION_WEB_URL`).
  Production = merge to main, then that one command (docs/demo-stores.md → "Production: one
  command"). Never overwrites store content. All "Salon & Barber", USD, 7 AM–11 PM daily, 555-01xx
  phones, owner logins `+1 111111111` (salon), `222222222` … `999999999`, **password = the login
  number** (settled 2026-10-01 after two interim schemes on preprod). The salon's `111111111`
  collided on preprod with the "preprod" test store's owner (+91 1111111111) — ambiguous logins
  are refused — so it ran as `101010101` for a day. On 2026-10-01 the user chose to move that test
  owner to +91 1010120100 and the salon back to `111111111` on preprod **and** production. The API
  can't change a login phone, so this is the one-off SQL in docs/demo-stores.md → "Changing an
  owner login", run by hand, followed by a provisioning re-run that resets the password.
- **Tests.** `backend/scripts/smoke-demo-stores.mjs` (E2E against a provisioned environment) and
  `npm run check:demo-stores` (frontend map ≡ data sheet ≡ backend list). API + web sections pass
  on preprod via the local API (202/203 — the salon login, pending the SQL below).
- **Parity:** owner-web and `app/` unchanged — no new DTOs, endpoints, strings or permissions; both
  login forms already default to +1 and send `1` + the 9 digits.
- **Admin panel (same day):** the nine are listed apart as **Demo stores** (sidebar group, a table
  under the Stores table, a hub badge) and left out of Stores, Dashboard, Customers, Reports,
  Billing and Team figures. They can't be disabled: `PUT /admin/businesses/:id` with
  `isActive:false` → 409 `DEMO_STORE_ALWAYS_ON`, checked before body validation. Recognised by
  phone in `backend/src/domain/demo-stores.ts` (a constant, not a column — no migration, because
  the local API runs against the shared preprod DB). Covered by
  `backend/tests/unit/demo-stores-admin.test.ts` and the ADMIN section of `smoke-demo-stores.mjs`
  (needs an owner-role admin login; **not yet run** — no admin credentials were used).
- **Provisioned on preprod and production 2026-10-01.** Open item: the salon login SQL above
  (production and preprod), then a provisioning re-run per environment to reset the salon password
  to `111111111` and re-verify.

### Store chat: check in, book, status, leave, cancel (2026-09-30)

The microsite help chat can now **act**: check in, book an appointment, show waitlist status,
leave the waitlist, use a different number, and list or cancel "my appointments". It asks one
question at a time with option buttons. Full design, scenario matrix and server rules:
[docs/customer-chatbot-booking.md](../../docs/customer-chatbot-booking.md).

- **How it acts.** A page-side state machine (`frontend/src/components/chat/flow/engine.ts`)
  runs through the **pop-up's own** `submitJoin` / `submitBook` / `trackPhone` / `leaveHeld`. The
  answer bot (`/chat`) is still read-only.
- **Backend.** Booking returns `appointmentKey`; three public endpoints for lookup by phone,
  read with key and cancel with key.
- **Manual QA (30 Sep 2026, browser + API on the preprod demo store):** 113 checks passed, 25 failed.
  The 6 P1s are fixed (below); the P2/P3 list is still open — notably: a question typed at the
  name step is saved as the name; a mistyped 9-digit number is accepted as a foreign (+98) number;
  "check me in" is not recognised; two same-second check-ins of one phone make two tickets; typed
  "yes" sent several times in one instant can double-submit; after "didn't catch that" no option is
  tappable; the removed-stylist message says "Stylist" not the name; booking errors say "help
  assistant"; the walk-in block never expires; owner check-in has no time window.
- **P1 fixes (same day):**
  - **Server is the judge of bookability.** `lib/booking-slots.ts` `computeSlots` serves `/slots`
    and is re-run by `POST /appointments` inside a per-store advisory lock: taken / overlapping /
    past / closed / out-of-hours / off-grid / beyond `BOOKING_WINDOW_DAYS` → 409
    `SLOT_UNAVAILABLE`; foreign or malformed stylist → 400; no orphan customer on rejection.
    Overlap-aware capacity also fixes "No preference hides a time when one stylist is booked".
  - **Leaving needs the ticket key** (`X-Ticket-Key`); `/track` and duplicate joins no longer return
    the key or the customer's name.
  - **Chat:** "yes" to "Shall we carry on?" re-shows the step, never confirms; a blocked number can
    book (block = walk-in line only; pop-up too); 409 `SLOT_UNAVAILABLE` → fresh times.
- **Website changes.** A held walk-in ticket and the walk-in block no longer stop the pop-up's Book;
  the pop-up hides Leave for a place found by phone lookup.
- **A2P.** Chat is a second opt-in path with the identical disclosure. Update `message_flow` and
  the screenshot before resubmitting the campaign.
- **Verified (after the fixes):**
  - backend `npm test`: 27 files, 356/356 (new: `booking-slots` 14, `public-booking-guards` 14).
  - `npm run test:chat-flow`: 158/158. Frontend `tsc` + lint clean.
  - E2E against the local API on the preprod demo store (test rows deleted afterwards):
    `smoke-booking-guards.mjs` 14/14, `smoke-selfservice.mjs` 25/25.
  - Browser re-run of the P1 cases (same-second double booking, "yes" after a topic change,
    stranger leaving a place, blocked number booking) + spot checks: 10/10.
- **Not run:** `next build` after the fixes (the frontend dev server was running in the same folder);
  `smoke-rest.mjs` (needs the seeded `sharp-cuts` tenant — its two leave calls now send the key).
- **Owner surfaces:** nothing needed (customer-only feature); owner apps already handle
  `appointment:updated`.

### App Store / Google Play badges (2026-09-29)

`AppStoreBadges` — one component, **hand-mirrored** in `frontend/src/components/` and
`owner-web/src/components/` (no sync script; change both). Shown in the marketing footer (homepage
`page.tsx` + `MarketingChrome.tsx` for inner pages), owner-web's login page, and owner-web's signed-in
desktop footer (`AppShell` `.main-support`, which is hidden on phone/tablet). Not on store
microsites: the app is for owners, not their customers. The App Store URL is region-less
(`apps.apple.com/app/...`) so each visitor lands in their own storefront; the Play URL drops the
`pcampaignid=web_share` share-sheet tag. Strings under `appBadges` in both `en.json` files.

### Customer SMS: the client's three templates + separate review consent (2026-09-28)

Replaces the four waitlist texts with exactly three: booking confirmation, 15-minute reminder,
post-checkout Google review request. Full write-up and the Twilio campaign paste:
[docs/sms-opt-in-a2p.md](../../docs/sms-opt-in-a2p.md). Uncommitted on `feat-jay`.

- **New:** migration `0032_review_sms_opt_in.sql` (review flags + reminder partial index);
  `modules/notifications/sms-dispatch.ts` (send gate + 3 senders + reminder sweep, wired into the
  scheduler); `googleReviewUrl` (https only) on owner-web, app and admin-panel.
- **Consent UI:** **one** unticked box on Book and Check in, client-approved wording ("…including booking
  confirmations, reminders, and a review request after my visit. Up to 3 messages per visit…"). It sets
  both backend flags (`smsOptIn`, `reviewSmsOptIn`), kept separate so the review consent can be split
  back into its own box (UI-only) if the Twilio reviewer objects to bundling a marketing text.
- **Review short link:** the review SMS texts `www.tejotime.com/<phone>/r` (new frontend route
  `app/[phone]/r/route.ts`, 302 to the live Google link, falls back to the store page) instead of the
  raw Google URL, because carriers filter bit.ly-style shorteners. Backed by the new
  `GET /public/businesses/by-phone/:phone/review-link`. Unit-tested (`public-review-link.test.ts`); the
  route itself and the smoke block additions were **not run** end to end.
- **Applied to preprod (`preprod-tejotime`) on 2026-09-28; not to production.** Run `0032` on production before promoting the backend — `bookSlot` writes
  `review_sms_opt_in`, so a backend ahead of this schema fails every website booking.
- **Verified (executed):** backend `tsc` clean on `src`; `vitest` **303/303** (22 files; rewritten
  `sms-copy.test.ts`, new `public-sms-consent.test.ts`); `tsc --noEmit` clean in frontend, owner-web,
  admin-panel; `app` has two pre-existing errors in untouched files (`index.tsx` typed route,
  `orientation.ts` missing module); eslint clean on the touched files.
- **NOT verified:** the new `smoke-rest.mjs` block was **never run** (`node --check` only — needs a running
  API and a seeded throwaway DB); no real Twilio send; not looked at on iOS / Android simulators.
- **Open:** "Manage your booking" links to the store page — no manage/cancel page exists. Twilio campaign
  must be **edited** to Mixed with the new samples, then resubmitted. Privacy §5 / Terms §18 were rewritten
  to match — have them reviewed.

### Save as draft — admin panel Create store (2026-09-28)

A **Save as draft** button, a **Drafts (N)** sidebar group above Stores, and autosave for open drafts.
A draft is created **only** by clicking the button (a fresh form stores nothing). Full write-up:
[docs/admin-store-drafts.md](../../docs/admin-store-drafts.md). Uncommitted on `feat-jay`.

- **New:** migration `0031_store_draft.sql`; 5 endpoints under `/admin/store-drafts` (endpoints 96–100);
  BFF routes; `StoreForm` autosave + banner; `Sidebar` Drafts group. Admin-panel only, so the
  owner-web / iOS / Android parity rule does not apply.
- **Migration `0031_store_draft.sql` — applied to preprod (`preprod-tejotime`) on 2026-09-28**, that file
  only (table + index confirmed). **Not applied to production.** Run it there before promoting the backend.
  Preprod is now fully migrated through `0032` (`0030` and `0032` were applied in a second run the same day).
  (The review-SMS migration was briefly named `0031_review_sms_opt_in`; it was renumbered to `0032`
  before it was applied, so there is no duplicate `0031` in the migrations table.)
- **Owner password is never stored** in a draft (stripped in the panel and again in the service).
- **Verified (executed):** backend `tsc` clean; `vitest` **290/290** (21 files; new `store-drafts.test.ts`,
  10 tests); admin-panel `tsc` + `eslint` clean on the touched files; `npm run test:draft` 10/10.
- **NOT verified:** `smoke-store-drafts.mjs` was **never run** (`node --check` only), so the real
  draft SQL and the cross-admin privacy check are unproven; the migration itself did apply cleanly on
  preprod. The UI (debounce,
  tab-hide flush, sidebar refresh, remount after the first save) was **never opened in a browser**.
- **Known gaps:** discarded/abandoned drafts leave their uploaded images in the bucket; the sidebar
  draft's name/time only refresh on navigation, not on each autosave.

### Autofill a store from a link — admin panel (2026-09-28)

Paste a business website into Create/Edit Store and review-then-apply the extracted values. Full
write-up: [docs/store-autofill-from-link.md](../../docs/store-autofill-from-link.md). Uncommitted on `feat-jay`.

- **New:** `POST /admin/store-import` (95th endpoint) → SSRF-guarded fetch (`lib/safe-fetch.ts`) →
  JSON-LD/meta extraction (`lib/html-extract.ts`) → Groq (`integrations/store-extract.ts`) →
  sanitiser (`store-import.service.ts`). Admin panel: card in `StoreForm` + `StoreImportReview` dialog.
- **Scope:** admin panel only. **owner-web and the mobile app were deliberately skipped** (edit-only
  profile editors); images, theme, ratings/reviews and the owner login are not extracted.
- **Config:** `AUTOFILL_ENABLED` (default false) + `AUTOFILL_API_KEY` (Groq) — the key is in the local
  `backend/.env` only; **it still has to be added to the Coolify env** and the flag turned on there. The
  key was pasted in chat, so rotate it.
- **Groq model drift:** the first default (`llama-3.3-70b-versatile`) 404'd on this key; default is now
  `openai/gpt-oss-120b`. Change `AUTOFILL_MODEL` if it is retired too.
- **Verified (executed):** backend `tsc` + `eslint` clean; `vitest` 278/278 (3 new files, 113 tests);
  admin-panel `tsc` + `eslint` clean; a real fetch + real Groq call against three public sites
  (script since deleted).
- **NOT verified:** the review dialog was never opened in a browser (no browser runner); the full
  route over real HTTP with a real admin login; `smoke-store-import.mjs` was written but not run.

### Admin autofill: first fetch applies without the dialog; unknown durations stay blank (2026-09-28)

- **First fetch into an empty create form** applies every found item with no "Review what we found"
  dialog (`StoreForm.runImport` + `isPristineCreate`); the notice and the warnings show inline. An edit,
  a form with typed data or a second fetch still opens the dialog (its "Replaces" rows protect typed
  data). Details: [docs/store-autofill-from-link.md](../../docs/store-autofill-from-link.md).
- **No more invented 20 minutes:** a scraped service with no stated duration is `null` from
  `store-import.service.ts`, shows a blank duration box, and **Save is blocked** with a per-service
  message until it is filled. Duration stays required by the DB/API — no migration. No price is
  `priceType: 'unset'` ("No price"), as before.
- **The first-fetch fill is silent** (no "Filled in N items" banner, no warnings box) — only "nothing found" is said.
- **Re-fetch of the same link offers only what the PAGE changed** since the previous fetch
  (`admin-panel/src/lib/import-diff.ts` → `diffImportedFields`), so editing the address on the page and
  re-fetching lists just the address. Recorded on apply; a cancelled dialog does not count. Checked by
  `npm run test:import-diff` — **12/12 passed** (run once before the module existed: it failed).
- **Verified (executed):** backend `store-import.test.ts` updated and run against the OLD code first (it
  failed there), now 34/34; backend `tsc` + `eslint` clean; admin-panel `tsc` + `eslint` clean.
- **NOT verified:** the form behaviour itself (no dialog on the first fetch, blank duration, Save
  blocked, a re-fetch listing only the changed field) was **not exercised in a browser** — it needs
  `AUTOFILL_ENABLED` + a Groq key, and admin-panel has no test runner.

### Optional store data: pictures, stylists, prices, services (2026-09-28)

Client request: customers hesitate when asked for a lot, so ask for as little as possible. Full write-up
in [docs/optional-store-data.md](../../docs/optional-store-data.md). Uncommitted on `feat-jay`.

- **Changed:** all four are optional for every store/category (the Hospital/Restaurant-only
  `OPTIONAL_SERVICES_STAFF_CATEGORIES` is deleted). A service may be `unset` ("No price" — the
  microsite shows none). The hero without a photo puts the wait card in the photo's column instead of
  an empty "Hero photo" box. Owner-web, iOS/Android and the admin panel got a "No price" mode.
- **Migration `0030_optional_seats.sql` — applied to preprod on 2026-09-28; NOT yet on production.** Run it there before promoting the
  backend (`DEPLOY.md`). It makes the queue functions safe for a NULL seat and refuses a derived
  ₹0 checkout for a service-less entry.
- **Also fixed:** `about` images 404'd at `/media/*` (key prefix missing from the route's allow-list).
- **Verified (executed):** backend `tsc` + `eslint` clean, `vitest` **165/165** (17 files; the new
  `optional-store-data.test.ts` was run against the OLD backend first — 7 of its 11 fail there);
  `tsc` clean on `frontend`, `admin-panel`, `owner-web`; `eslint` clean on the files touched.
- **NOT verified — needs a database / running app:** migration 0030 and both smoke scripts
  (`smoke-rest.mjs` new section, `smoke-seatless.mjs`) were syntax-checked only, **never run**
  (no Postgres available; Docker Desktop's engine was not running). The microsite layout, and the
  owner queue with no stylists on owner-web / iOS / Android, were **not looked at in a browser or
  simulator**. `app` `tsc` has 2 pre-existing errors in files this work did not touch
  (`src/app/index.tsx` typed route, `expo-screen-orientation` not installed).
- **Known gaps left:** the server-rendered `/{phone}/card` logo has no broken-URL fallback; dragging
  a card into the "Any" group on owner-web sends a reassign the API rejects (pre-existing); wait times
  for a shared lane overstate when several are served in parallel.

### Mobile: customer detail sheet + live-card figures (2026-09-24)

- **Detail sheet** (`components/feedback/DetailPanel.tsx`): a waiting entry now shows a details card
  (position, seat, service, price, est. wait, source, visitor type) in the space that was blank, laid
  out **two per row** — six stacked full-width rows ran under the footer on a phone with a larger
  system text size and cut "Source" in half. Checked at font scale 1.0 and 1.3: no scroll either way. And
  the status badge is centred under the name (`StatusBadge` pins itself `alignSelf: flex-start`, so
  centring it needs a ROW with `justifyContent`, not a parent's `alignItems`). The middle scrolls;
  the actions stay pinned. An **in-service** entry keeps its one muted line: its footer (amount,
  add-ons, breakdown, two buttons) owns the screen, which is why the details grid was removed from
  here in the first place.
- **Home live card:** the figures dropped two steps (h2 → h4) and the unit rides beside the number
  ("**20** min"), because "60 min" as one h2 string filled its column and crowded the divider. The
  card is also **half as tall**: "Add walk-in" is now a pill in the top row beside the QR button
  instead of a full-width button under the figures. At ~210dp it pushed the seat boards off the
  first screen, and the seats are what an owner works from. `QueueBoard`'s section heading tightened
  to match. Verified on Android: the card, the seat chips and a full seat board now fit above the
  fold.

### Mobile: seat sub-line was cut on narrow phones (2026-09-24)

`"Serving Darshil · ~30 min"` truncated on a 393pt iPhone. The sub-line shares its row with the
avatar and the waiting badge (~26 characters at 411dp), so at 25 characters it fitted on the
Android emulator and cut on the phone.

- **The string is the BACKEND's.** `GET /queue` ships a built `subLine` and `mapSeat` passes it
  through; `app/src/lib/queue.ts::buildSeatGroups` is a parallel, **unimported** implementation, so
  editing the app's `t.format.servingEta` changes nothing on screen. Now noted in that function.
- `backend/src/lib/queue-engine.ts`: `~{n} min` → **`~{n}m`** (the walk-in sheet's existing form),
  and `"Available · ready for walk-in"` → **`"Ready for walk-ins"`**. Two unit tests assert these
  exactly; updated, **150 backend tests pass**.
- Shortening alone is not robust, so the sub-line is now `numberOfLines={2}`. Verified at font
  scale 1.15 with `"Serving Darshil · ~266m"`: wraps, keeps the figure, nothing cut.
- Noticed, not changed: a seat with people queued but nobody started reads "Ready for walk-ins"
  beside a "3 waiting" badge. The chair is genuinely free; the pair still reads oddly.

### Mobile: Settings correctness + density (2026-09-24)

Four **mobile-only** drifts from owner-web, found by reading the two settings screens side by side.
See [docs/mobile-settings-screen.md](../../docs/mobile-settings-screen.md).

- The footer showed a hand-written `"v2.4"` while the app shipped **1.0.3** — now read from
  `expo-constants`, and the key is out of `en.json` (a version is a build fact, not copy).
- "Signed in as **sharpcuts**" — the demo tenant's handle was the fallback when a session had no
  name. The clause is now dropped instead of guessed (`settings.footerNoUser`).
- "Notifications — N of M on" was computed from a hard-coded mock; the Notifications screen has no
  API behind its toggles. Now a static sub, matching owner-web. **Open gap: notification
  preferences still do not persist.**
- Email support used the `bell` icon; a `mail` icon was added to the set.

`TSettingsRow` tightened (14/58 → 11/52) so more than five rows fit on a phone.

Then all eight settings **sub-screens** were walked on a device:

- **Working hours** — every weekday truncated to `Mo…`/`Tu…`/`We…`/`Th…`; the day column had ~38dp.
  Abbreviating to `Mon`–`Sun` looked fixed on a 411dp emulator but still clipped `Mon`/`Wed` on a
  393pt iPhone — the row had ~2pt of slack, so there was nothing to widen it with. The row is now
  **two lines** (full day + switch, times below), which removes the constraint instead of tuning a
  number, and `TimeSelect` chips flex so every row's separator aligns.
- **Team logins** — the super owner was labelled "Co-owner" (the sub-line branched on two roles,
  not three); "Add co-owner" was a filled teal competing with the filled blue primary, now
  `outline`; the phone is formatted.
- **`db/seed.ts` never set `is_super_owner`** — the admin portal does, so only the fixture was
  wrong, but it is the repo's only fixture: `requireSuperOwner` would 403 in any local test.
  **Re-seed after pulling.**
- Appearance had "Brand color" beside "Button colour"; the app is now `color` throughout.
  **owner-web is still mixed and was left alone** — a two-surface copy decision.

### owner-web: live queue without a reload (2026-09-24)

Microsite check-ins showed up on the mobile app immediately but on the web dashboard only after a
hard refresh. The cause: owner-web never had a socket client.

It now uses a 60-second `typ: 'socket'` ticket (`POST /auth/socket-ticket`), which keeps the
access cookie httpOnly. `LiveRefresh` listens on `/owner` and calls `router.refresh()` on
Dashboard, Appointments and Calendar. Staff logins, and any case where the socket can't connect,
poll every 15s instead.

Deploy needs two settings:
- `NEXT_PUBLIC_SOCKET_URL` on owner-web, followed by a redeploy;
- the owner-web origin added to the backend's `CORS_ALLOWED_ORIGINS`.

Also fixed the same day: the **mobile** socket stopped for good about 15 minutes after sign-in.
- Cause: it reconnected with the expired access token captured at login, the server refused it,
  and Socket.IO does not retry a refusal.
- Fix: the socket now uses a token getter; a refused or kicked connection refreshes the session
  and re-dials; and it re-dials when the app returns to the foreground.
- owner-web re-dials the same way.

See [docs/owner-web-live-queue.md](../../docs/owner-web-live-queue.md). The smoke-socket E2E
section is written but has **not been run** yet: it needs a local API and a seeded throwaway DB.

### Theme parity: app vs owner-web (2026-09-22)

Same store, different colours on phone and laptop. The engine copies and the configs matched. The
cause was owner-web CSS ignoring the theme:

- hardcoded white labels on brand fills;
- white cards in dark mode;
- brand-coloured chairs always blue;
- an invisible seat-picker initial;
- blue "In service" chips.

Both surfaces now use one white-first ink rule on brand fills (3:1), and owner-web's surfaces follow
the theme. Details and the full table are in
[docs/18-theming-architecture.md](../../docs/18-theming-architecture.md) ("Why owner-web and the
app looked different").

### Mobile: Home redesign (2026-09-22)

Home is now a greeting header, then one scroll holding:

- a brand-coloured **live queue card**: Waiting · In service · Walk-in wait, plus one Add walk-in
  button and the QR shortcut;
- the **seat boards**, where tapping an empty seat opens the walk-in sheet with that seat chosen.

A Today (appointments) card was added and then removed at the owner's request. The Home and Settings
headers show the store's logo, or its initials on a solid brand tile (`ui/StoreMark.tsx`): the old
pale avatar vanished on warm themes. The duplicate Walk-in actions and the "0 waiting" pill are gone. `withAlpha` (`theme/ink.ts`)
keeps everything on the brand fill legible in dark mode. Home's tab icon is now a house on both
app and owner-web: the known Home/Calendar icon drift is resolved. owner-web's Home layout itself
is unchanged. See [docs/mobile-home-screen.md](../../docs/mobile-home-screen.md).

### Mobile: first-run onboarding tour (2026-09-22)

A four-page tour shown once per install, before sign-in: live queue, bookings, customers and
reports, and the shareable booking page. Each page shows a theme-drawn miniature of the real
screen. The `onboarded` flag (`tt_onboarded_v1` in SecureStore) is read with the session, so the
splash covers it. `app/` only; owner-web deliberately has no equivalent (reason in the doc). See
[docs/mobile-onboarding.md](../../docs/mobile-onboarding.md).

### Mobile: animated launch splash (2026-09-22)

The native splash now shows the calendar-and-clock mark alone (`splash-mark.png`, 150pt/dp, both
platforms). `TAnimatedSplash` starts on that identical frame: the mark glides into the TejoTime
lockup as the wordmark wipes in, then the whole thing lifts and dissolves onto the first screen once
the session is restored. It hides the native splash itself, on the mark's `onDisplay`, so the root
layout no longer does. `splash-logo-android.png` is gone. See
[docs/mobile-splash-and-branding.md](../../docs/mobile-splash-and-branding.md). It needs a native
build.

### Mobile: new app icon (2026-09-22)

The calendar-and-clock icon was re-issued as a clean 1024px master. Every icon asset is now generated by
`app/scripts/make-app-icons.mjs`: the iOS icon (alpha channel stripped for App Store Connect), the
Android adaptive layers (artwork re-fitted into the 66dp safe circle; the old foreground was
clipped by circular launchers), the themed monochrome layer and the favicon. See
[docs/mobile-splash-and-branding.md](../../docs/mobile-splash-and-branding.md) § App icon. It needs
a new native build to appear on devices.

### Mobile: text-size cap, launch screen, first-load skeletons (2026-09-22)

- **Oversized text on real iPhones.** RN followed the phone's text-size setting with no ceiling.
  `MAX_FONT_SCALE` (1.15) in `app/src/styles/scale.ts` now caps it in `TText` and every
  `TextInput`. See [docs/mobile-responsive-tablets.md](../../docs/mobile-responsive-tablets.md) §4.
- **Launch is one screen.** Font loading and session restore both draw `TSplashScreen`, replacing
  the old grey spinner and blank frame. See [docs/mobile-splash-and-branding.md](../../docs/mobile-splash-and-branding.md).
- **First-load skeletons** on Home (seat boards), Appointments and Reports, in place of false
  "No one in queue" / "No appointments" / "—" while `bootstrapping`. Customers already had one.
- `app/` only. owner-web is a browser app and the browser handles zoom itself, so it needs neither
  change.

### Mobile: subscription/upgrade UI removed for App Store (2026-09-17)

App Review rejected 1.0 (2) under guideline 2.1(b): an "Upgrade to Premium" button with no In-App Purchase behind it. Every
plan, subscription and upgrade surface was removed from `app/`. `owner-web` and the backend are
unchanged. See [docs/mobile-no-in-app-purchases.md](../../docs/mobile-no-in-app-purchases.md).

### Admin gallery drag-to-reorder (2026-09-22)

`admin-panel` `GalleryUpload` (`components/ImageUpload.tsx`) tiles are now draggable (native HTML5,
no dependency; Alt+←/→ from the keyboard), and tile 0 carries a "Main" badge because the microsite
mosaic shows it largest. No backend change — array order was already saved as
`gallery_image.position`. owner-web (arrows) and Expo (Move up) already reorder and are unchanged.

### Twilio A2P SMS opt-in (2026-09-21)

Optional, unchecked SMS checkbox on the public Check-in and Book forms. Join/book still succeed
with the box off; Twilio is only called when `queue_entry.sms_opt_in` / `appointment.sms_opt_in`
is true and `customer.sms_opt_out_at` is null. Migration `0027_sms_opt_in.sql`. Campaign paste and
the $15-fee warnings: [docs/sms-opt-in-a2p.md](../../docs/sms-opt-in-a2p.md).
2026-09-22 pre-submit pass (US-only campaign): consent text raised to 13px / `--text-strong`,
Privacy §5 + Terms §18 gained the stock "originator opt-in data" line and now say STOP stops
texts from TejoTime; the doc lists all 4 samples with a pre-submit checklist. Alerts 2–4 (`smsBodyEta`,
`smsBodyYourTurn`) no longer repeat "Reply STOP…HELP" — only the join message carries it — and
the em dash is gone so every body is GSM-7 / one segment. The join message states frequency as
"We'll text you up to 3 more updates for this visit" (was "Up to 4 msgs/visit").
2026-09-28: Privacy §5 gained Twilio's exact required sentence ("We do not sell or share your SMS
opt-in data or personal information with third parties for marketing purposes.") as its own
paragraph, and the policy's "Last updated" date moved to September 28, 2026.

Owner-web and Expo were **not** given an opt-in control — `message_flow` is website-only, so an
owner walk-in with a phone must not text. `SMS_ENABLED` stays false until the campaign is Approved.

### Owner-web help chat (2026-09-14)

The product chatbot now also mounts on `owner-web` (login + signed-in shell) via BFF
`/api/chat` → `POST /public/chat`. Same `CHATBOT_ENABLED` flag as marketing/microsite. Not on
Expo or admin-panel. See [docs/customer-chatbot-v1.md](../../docs/customer-chatbot-v1.md) §5c.

### Cookie consent, GDPR/CCPA (2026-09-11)

Banner + preferences modal + `/cookies` policy + a server-side audit log, across `frontend/` and
`backend/` only. **No new npm dependencies, and no analytics or advertising tag was added** —
Consent Mode here is pure future-proofing. Full write-up:
[docs/cookie-consent-v1.md](../../docs/cookie-consent-v1.md).

Three decisions worth knowing before touching it:

- **The cookie is host-only.** `cookie_consent` is set with NO `Domain` attribute, so it never
  travels to `business.tejotime.com` or `admin.tejotime.com`. `Domain=.tejotime.com` would have
  attached the record and its `visitorId` to every owner-portal and admin API call.
- **Nothing is stored before a choice.** `visitorId` is minted with `crypto.randomUUID()` at the
  click and lives only inside the cookie JSON. Verified: first visit has empty cookies and empty
  localStorage.
- **The banner renders BEFORE `{children}`.** It is `position: fixed`, so DOM order changes
  nothing visually — but rendered last it took 60+ tab stops to reach, and rendered first it takes
  1. Do not move it back.

Server side, `consent_log` (migration 0026) stores no IP and no user agent; `country_code` comes
from the CDN edge header and a client-supplied `countryCode` is a 400, because a forgeable field
would make the audit log worthless as evidence.

Verified (all executed): `npm test` → **12 files, 131 tests**; `tsc`/`eslint` clean both apps;
`next build` clean with `/cookies` prerendered; migration idempotent on a second run; and a
headless-Chrome pass covering storage-before-choice, no banner in server HTML, cookie attributes,
Reject/Accept parity, the full keyboard-only path, 320px, the 1.5s microsite delay, and a console
with no hydration warnings. **Not verified:** a real CDN edge header, and the `_ga` sweep against
genuine analytics cookies (no tag exists to create them).

### Marketing landing page chatbot (2026-09-11, follow-on)

The chatbot now also runs on `tejotime.com/` — asked for after v1 shipped, and out of the
original scope, which deliberately excluded the marketing site.

It is a **different brain on the same machinery**. There is no business context on the landing
page, so it answers about the product from `backend/src/lib/chat-platform.ts` → `PLATFORM_FACTS`
(8 product FAQs, 3 plans, 6 features, 3 steps, 9 industries), hand-mirrored from
`frontend/src/i18n/en.json` → `landingData` and guarded by **`npm run check:chat-facts`** (imports
the module through `tsx` and compares field by field; mutation-tested against a changed price and
a dropped FAQ). Endpoint `POST /public/chat`, plus `GET /public/chat/status` because the landing
page is statically rendered and has no payload to carry the flag — a failed status call leaves
the launcher hidden.

Two refactors made it fit rather than duplicate:
- `backend/src/lib/chat-text.ts` now holds the ranking both bots share. The *vocabulary* stays
  with each bot on purpose — one shared dictionary would make every question look a little like
  every other. `chat-faq.ts` kept its entire public API, so its 24 tests passed unchanged, which
  is what makes the refactor trustworthy.
- `ChatWidget.tsx` is surface-agnostic: `send`, copy, `onAction`. The microsite passes the store
  call; the landing page passes the platform call and routes actions to its own anchors and its
  Request-access modal.

The sharp edge here is different from the store bot's: this one talks to a prospect about money
while the page runs in pilot mode with two of three plans unpriced. `chat-platform.test.ts` pins
the honest-refusal behaviour, including a regex that fails if a dollar figure ever appears in a
pricing answer.

Verified: `npm test` → **11 files, 124 tests**; `tsc`/`eslint` clean both apps; `next build`
clean; `check:chat-facts` passes and fails correctly when mutated; and a headless-Chrome pass over
the real dev stack on desktop and phone — launcher shows, pricing chip answers with the real plan
table, "See pricing" scrolls the page, "Request access" opens the pilot modal, and the store
microsite chat still behaves identically. 0 exceptions, 0 failed requests, 1 navigation.

### Customer microsite chatbot v1 (2026-09-11)

A help chat on the public store page (`frontend/` only — not the homepage, owner-web, mobile or
WhatsApp). **Off by default** (`CHATBOT_ENABLED=false`); **no paid key required**. Full write-up:
[docs/customer-chatbot-v1.md](../../docs/customer-chatbot-v1.md).

- **Layer A, always on:** `backend/src/lib/chat-faq.ts` — a pure, deterministic answerer. Owner
  FAQ verbatim when the question matches (synonym table + coverage/precision score, threshold
  0.5), else a reply built from the page's own facts (hours, open/closed, address, phone,
  services with the page's price labels, team, live wait), else an honest fallback that names the
  page's buttons. Never invents; the facts come from the same microsite DTO the page renders.
- **Layer B, optional:** `backend/src/integrations/chatbot.ts` — Gemini (default) / Groq free
  tiers, OpenAI only if explicitly chosen. Never throws; any failure (no key, 429, timeout) is
  `null` and Layer A answers. Skipped when Layer A already has a confident FAQ (≥ 0.9).
- **Endpoint:** `POST /api/v1/public/businesses/:key/chat` (`:key` = slug or digits-only phone),
  strict zod body, own limiter `publicChat` 20/hr/IP, `404 CHATBOT_DISABLED` while off. Read-only
  by construction — the service imports nothing that can write. Public payload now carries
  `chatbotEnabled`.
- **Widget:** `frontend/src/components/chat/ChatWidget.tsx` + `chat.css`, mounted in
  `MicrositeClient` behind `site.chatbotEnabled`. Theme-token styled; lifts above the resume pill;
  full-height sheet on phones. Suggested actions call the page's own handlers; Call is a `tel:` link.
- **Response `mode`** has a fourth value, `facts`, beyond the three in the brief — a store-fact
  answer is not an FAQ match and labelling it as one would hide what the bot is actually doing.

Verified (all executed): `cd backend && npm test` → **10 files, 105 tests, all passing** (three
new files: `chat-faq`, `chatbot`, `public-chat`); `tsc --noEmit` and `eslint` clean on both apps;
`frontend` `next build` clean; `scripts/smoke-rest.mjs` against a throwaway `tejotime_smoke` DB
with `CHATBOT_ENABLED=true` on `:8090` → **117 passed, 0 failed** (15 new `PUBLIC CHAT`
assertions, including "a 'join for me' message leaves the queue count unchanged and mints no
ticket"); and a second instance with the flag off → `404 CHATBOT_DISABLED` + `chatbotEnabled:false`.
**Not verified:** a real Gemini/Groq call (no key on this machine — the seam is exercised with a
stubbed `fetch`), and the widget in a browser (no browser tests exist; see §4).

Known gaps: platform-wide flag only (no per-store toggle — would need a `business` column and the
owner-web + mobile setting per §11.1); the matcher is English-first; no analytics beyond a log line.

### Mobile tablet support (2026-09-08)

`app/` was portrait-locked and phone-only. Now: **tablets rotate, phones stay portrait**
(`ios.infoPlist` for iPad, `lib/orientation.ts` + `expo-screen-orientation` for Android, since
`android:screenOrientation` has no `sw600dp` variant).

Three bugs found on the way, all of which had been shipping:

1. **`react-native-size-matters` never stops growing.** Its ratio is `window.width / 350` with no
   ceiling, so on an iPad every `moderateScale()` padding, radius and gap inflated **2.4–3.9×** —
   the whole UI rendered as a scaled-up phone. `styles/scale.ts` now shadows the library's
   exports (all 550 call sites already import from there) with a clamped, screen-short-side basis.
2. **It also samples the window once at import time,** which was only safe while the app was
   portrait-locked. `StyleSheet.create` runs at module load, so with rotation enabled the ramp
   would have frozen at whatever the app launched at.
3. **Tablet detection was `width >= 768`,** which misses an iPad mini (744dp) and every small
   Android tablet in portrait, and misfires on a large phone in landscape. Now the *screen's short
   side* ≥ 600dp, which is orientation-invariant.

Layout: `lib/responsive.ts` (pure), `useResponsive` / `useTabContent`, 720→900dp content column,
2-up grids for customers / appointments / stats-by-staff / queue seats, landscape safe-area edges,
height-capped sheets. `QueueBoard`'s drag-and-drop now hit-tests **x as well as y** — with seats
side by side, a y-only test drops cards on the wrong seat.

Verified: `tsc --noEmit`, `expo lint`, `expo export` for both platforms, and
`npm run test:responsive` (1262 assertions, 11 devices, mutation-checked against the old
behaviour). **Not verified on a real device or simulator** — the layout itself is unexercised.
Full write-up: [docs/mobile-responsive-tablets.md](../../docs/mobile-responsive-tablets.md).

### Microsite team avatars (2026-09-07)

Uploaded staff photos never showed on the live page. Not a save or a serving bug — verified end
to end that `staff.avatar_url` persists, the public DTO exposes `avatarUrl`, and `/media/...`
302-redirects to a signed bucket URL that returns `200 image/jpeg`. The card in
`sections.tsx::LiveBoard` simply never rendered it; `photo` and `avBg` had sat unused on the
`LiveMember` interface since the section was written.

`MemberAvatar` renders a round, cover-fitted photo, falling back to the member's **initials on
`avBg`** when there is none, and again via `onError` if the signed redirect fails. Plain `<img>`
(with the gallery's existing `eslint-disable`) because `next/image` would need the bucket host in
`remotePatterns`. Confirmed against the actual server-rendered page: John's photo `src` present,
`SS` / `L` / `M` monograms for the three staff without one.

### Multi-service selection (2026-09-07)

The microsite and the mobile walk-in sheet let a customer pick exactly **one** service. Real
visits are routinely "haircut AND a hair spa", so the second service was invisible: the wait-time
engine sized the visit at 30 minutes instead of 90, and checkout suggested ₹350 instead of ₹1150.

- **No new shape for the queue.** A multi-service visit is stored the way `queue_extend` already
  stores add-ons: `service_id` = first service, `service_name` = "Haircut + Hair Spa",
  `extra_minutes` = Σ of the rest (read by `estMins`), one `queue_entry_extra` row per extra
  (summed by `billingFor`). Both numbers were therefore already correct once the rows existed.
- **Migration 0025** adds `appointment_service` (bookings must itemise — a booking is made now and
  checked in later) and `queue_attach_services()`, which does what `queue_extend` does but works
  on a **`waiting`** entry; `queue_extend` refuses anything not already `in_service`, by design.
  `appointment_check_in` replays those rows so nothing is lost at the counter.
- **APIs** take `serviceIds[]` and still accept the legacy singular `serviceId` (folded in first),
  so already-shipped clients keep working. Slot length is the **sum** of the chosen services — a
  90-minute visit books a 90-minute hole. An unknown id is a **404**, never a silent drop.
- **UI**: microsite service cards are square checkboxes with a running "N selected · M min" total
  and a visit total that stays a range when a range-priced service is in the cart; the mobile
  `ServiceCard` gained a `multiSelect` tick box and the walk-in sheet the same total.
- **Tests**: 11 new Tier-1 assertions ("MULTI-SERVICE VISITS"). Suite now **93/93**, exit 0.

### Multi-day booking on the microsite (2026-09-07)

"Book an Appointment" was **today-only** — `fetchSlotsForToday()` hardcoded one date — so a
customer arriving late in the day saw whatever was left of today and got pushed at the waitlist.
The seeded salon shows the shape of it: **today had 1 slot left at 7:30 PM while the next open
day had 20.**

- **No backend change was needed.** `GET /public/businesses/:slug/slots` already accepted `date`
  and `staffId`, resolved that weekday's hours, excluded taken appointments, and filtered past
  times with `cursor.isAfter(now)` (a no-op for a future day). `bookSlot` already took any
  `slotStart` and `preferredStaffId`. The client API wrapper already forwarded all three params.
- **Client** (`MicrositeClient.tsx`): a `bookDate` state and a 14-day horizontal day strip with
  closed weekdays greyed rather than hidden. `fetchSlots(serviceId, date, staffId)` replaces the
  today-only version and takes its inputs as arguments — every caller fires from the event that
  changes one of them, so reading state there would fetch the previous day. A `slotReq` ref drops
  out-of-order responses.
- **Two latent bugs fixed on the way.** The date was built with `toISOString().slice(0,10)` — the
  **UTC** day — so a customer in IST before 05:30 asked for yesterday and was told nothing was
  available. Now local date parts. And provider choice never reached the slots query, so the
  times shown ignored which chair was picked; a named provider now narrows availability.
- **Check in stays a separate entry point.** "Join the walk-in waitlist instead" is now a
  fallback only: selected day has no times AND it is today AND the store is open. It used to
  appear for any empty day, which will now be most future days a customer browses.
- **Copy**: `timeLabel` → "Choose a date and time"; empty states name the day
  (`slotsEmptyDay` / `slotsClosedDay`); `slotsEmpty` / `slotsEmptyClosed` deleted as dead, keeping
  the microsite dictionary's zero-unused-key property.
- **Out of scope, still absent:** cancel, reschedule, calendar export.
- **Tests**: 12 new Tier-1 assertions in `smoke-rest.mjs` ("MULTI-DAY BOOKING + PREFERRED
  PROVIDER"). Suite now **82/82**, exit 0.

### Service pricing modes — fixed vs range (2026-09-07)

A service can now be priced two ways, and the store says which instead of every surface guessing
from a zero.

- **DB** — migration `0024_service_price_range.sql` adds `service.price_type`
  (`fixed | range | unset`) and `price_max_paise`, with `ck_service_price_shape` enforcing one
  shape per mode. **The backfill is the decision worth knowing:** `price_paise > 0` → `fixed`;
  `price_paise = 0` → **`unset`**, not a fixed zero and not a bounded range. Those rows had no
  price and no bounds to invent, so they are recorded as unpriced and the write schemas refuse
  `unset` — an owner opening one must choose a mode. `unset` can never be created again.
- **Checkout** — `queue_checkout` raises `TEJO:AMOUNT_REQUIRED` (→ 422) when no amount is passed
  for a `range` or `unset` service. Deriving would bank the band's *minimum* into
  `visit.amount_paise`, which is the same under-reporting migration 0020 was written to stop.
  `GET /queue/:id` returns `amountRequired` and a **null** `suggestedAmount` for those, so the
  sheet has nothing dishonest to pre-fill. Fixed services are unchanged end to end.
- **One resolver** — `backend/src/domain/money.ts::servicePricing` reads a row into
  `{ priceType, price, priceMax, amountRequired }`; the owner service list, the public microsite
  DTO and the checkout billing all go through it.
- **UI** — Fixed/Range pickers in `owner-web/ServicesEditor`, `admin-panel/StoreForm` and the
  mobile `ServiceEditSheet`; the microsite renders `₹min–₹max` for a band and **"Price on
  request"** for an unpriced service (the old `priceVaries` key is gone). Range checkout starts
  with an **empty** amount box in both `owner-web/QueueDetailSheet` and mobile `DetailPanel`.
- **Admin provisioning got stricter**: `priceRupees` is now `.positive()`. A named service is a
  priced service. Categories that legitimately have no menu (Hospital, Restaurant) send no
  services at all and are unaffected.
- **Tests — all executed and green** against a local Postgres 17 + migrated + seeded database:
  `backend` vitest **60/60**, `smoke-rest.mjs` **70/70** (exit 0), `smoke-socket.mjs` **6/6**
  (exit 0). The admin create-store (201) and edit-store (200) paths were driven directly with a
  two-range-service payload, and the range→fixed switch verified to clear `price_max_paise`.
- **Two pre-existing smoke-script bugs surfaced once it could finally run.** `first John waiter
  ETA ~45 min` asserted the *undecayed* estimate — the seed pins the in-service head 15 minutes
  into a 45-minute service and `remainingMins` decays it, so the real value is ~30 and falling.
  It now asserts the band, not a literal, so it cannot rot again. And the range-checkout test
  seated its walk-in with `staffId: 'auto'`, which by that point picks a seat that is already
  serving; `queue_start` raised SEAT_BUSY and the 422 assertion then passed for the **wrong**
  reason (INVALID_STATE is also 422 — only asserting on the error *code* caught it). It now
  creates a dedicated idle seat.
- **Smoke scripts fixed while in there**: both posted `{ handle }` to `/auth/login`, which
  `loginSchema` (`.strict()`, requires `phone`) rejected as a 400 — every run failed on its first
  assertion. They now post the seeded phone. `README.md` carried the same stale credential.
- **The seed gained a fifth service**, `Hair Extensions` (₹2,000–₹6,000), as the range fixture.
  `smoke-rest.mjs` now expects 5 microsite services, not 4.

### The U.S. market repositioning (marketing site)

The public site has been rewritten from India-market copy to a U.S. launch, against a client copy
guide. **Shipped** in `bc0b482`:

- Homepage copy replaced wholesale — hero, proof bar, industry cards, feature section, online
  booking, walk-ins, client management, getting started, pricing, FAQ, closing CTA.
- Internal production notes removed from the public site; no `$XX` placeholder pricing anywhere.
  Pricing is Starter (free during the pilot) / Business (**"Coming soon"**) / Multi-location
  (contact us).
- "Walk-ins" reframed as an **optional** walk-in waitlist, because walk-ins don't fit every target
  industry.
- Med-spa and physical-therapy copy carries **no HIPAA, medical-record, insurance, or compliance
  claims** — those capabilities are not verified. Keep it that way.
- The unverified social-proof gallery was replaced with a `ProductTour` component until real pilot
  photography and testimonials exist.
- New routes: `/industries/[slug]` (9 industry pages), `/resources`, `/terms`, `/accessibility`;
  `/privacy` rewritten.
- 2026-09-30: industry pages moved to the root (`/barbershops`, …).
- 2026-10-01: **industry pages removed** — the cards open live US stores instead, and every old
  industry URL 308s to its store. See §1 and `architecture.md` §7.

### The customer booking page (microsite) copy + correctness pass

Same U.S.-market repositioning, now applied to the **public customer microsite** (`/{phone}`).
Full record: **`docs/customer-booking-page-copy-2026-09-06.md`** — read it before touching
microsite copy. The three things worth knowing here:

- **One vocabulary rule drives the whole page.** "Book an Appointment" = a scheduled visit,
  "Check in" = a walk-in. Never "Free" for *available*, never `$0` for *unpriced*.
  Service cards now open the **booking** flow (they say "Book"); the Team section and the hero
  own the walk-in flow.
- **A closed store no longer invites walk-ins.** `walkInsClosed` gates every walk-in control and
  swaps them to booking. The gate is `hours.length > 0 && !isOpen`, **not** `!isOpen` — a store
  that never configured hours reports `isOpen: false` forever, and gating on the raw flag would
  have switched check-in off for every one of them. UI-only; the API still accepts an
  out-of-hours join.
- **`openStatus` gained `nextOpenLabel`** ("Monday at 10:00 AM", business-timezone-resolved) so a
  closed page can say when to come back. Covered by `backend/tests/unit/open-status.test.ts`.

A second review pass caught what the first missed: `LiveStatusLine` was **hardcoded English**
saying "All 4 free" in the two most prominent slots on the page, the closed gate stopped at the
outside of the provider cards, and `joinAfterTrack` bypassed it entirely. Also removed: the dead
`DomainProfile.liveNote` / `.ctaSub` (ten stale strings), dead `trustCells` (which rendered an
empty About band on stores with reviews but no About copy), and salon-only vocabulary — "shop",
"chair", "token" — from strings every vertical sees. A dead-key audit over the microsite
dictionary now reports zero unreferenced keys.

### Legal pages

`/privacy`, `/terms`, `/accessibility` render from `frontend/src/i18n/en.json` through
`components/legal/LegalPage.tsx`. Company-specific facts are `{token}` placeholders resolved from
`t.legal`; **an unfilled token renders as a visible amber marker** so an unverified detail cannot
ship unnoticed.

All four values are now filled:

| Key | Value |
|---|---|
| `entity` | `INFRANET IT SOLUTIONS LLC` (was `TejoTime`, changed 2026-10-01 after the Twilio A2P rejection, see `docs/sms-opt-in-a2p.md`) |
| `address` | `4213 Lee Blvd, Lehigh Acres, FL 33971` |
| `supportPhone` | `+1 (239) 506-1324` |
| `governingState` | `the State of Florida` |

There are currently **zero** pending markers on any legal page.

The /privacy and /terms intros open with "TejoTime is operated by {entity}." The same sentence,
`t.brand.operatedBy`, also appears in the marketing footers (`app/page.tsx`, `MarketingChrome.tsx`)
and the store booking page footer (`MicrositeClient.tsx`). Twilio needs the website to name the
registered brand's legal entity.

> These are solid, product-accurate drafts, **not attorney-reviewed**. The liability, indemnity and
> governing-law sections in particular should get a lawyer's read before launch.

### Contact details unified across all four apps

`+1 (239) 506-1324` / `4213 Lee Blvd, Lehigh Acres, FL 33971` are now the single source of truth in
`{app,admin-panel,owner-web}/src/lib/support.ts` (`SUPPORT`) and in `frontend`'s `t.legal`. The
previous Indian support number is **gone from the entire monorepo**.

The address renders in the real contact blocks — owner-web support card, the app's support block,
admin login help, and all three legal pages — but deliberately **not** in the compact two-item
strips (app tab bar, login rows), where it would be noise.

---

## 2. Fixes landed alongside

- **`shell()` client/server crash.** `owner-web`-style `shell()` was exported from
  `MarketingChrome.tsx` (`"use client"`) and called by the server-rendered industry and resources
  pages, which **broke the production build**. Extracted to
  `frontend/src/components/landing/shell.ts` with no `"use client"`. `tsc --noEmit` does not catch
  this class of bug — only `npm run build` does.
- **Industry card copy truncation.** `globals.css` clamped `.tj-photo-body` to 2 lines below 680px.
  The new, longer client-approved copy truncated mid-sentence on every phone. Clamp removed.
- **Toast overlapping the closing CTA.** The toast was `position: sticky`, so at the end of the page
  it resolved to its flow position on top of the Start Free / Book a Demo buttons. Now `fixed`, with
  an iOS safe-area inset.
- **Anchor links landing under the sticky header.** Added `scroll-padding-top` (88px desktop, 80px
  mobile).
- **`/terms` horizontal overflow** at 320–360px from a non-wrapping pending-marker chip.

Verified with a scripted audit across **6 viewports × 6 pages**: no horizontal overflow, no clipped
text, no JS errors. Frontend, owner-web and admin-panel all typecheck; frontend builds and lints
clean.

---

## 3. Known gaps, roughly by severity

### Security / correctness

- **`verifyAdminOtp` mints a full 12h admin JWT against a hardcoded constant.** Flag-gated off
  (`OTP_ENABLED=false` everywhere, including production), but it is a complete auth bypass if the
  flag is ever turned on before real OTP verification is implemented.
- Admin tokens are signed with **`JWT_ACCESS_SECRET`, the same secret as owner tokens** — only the
  `typ` claim separates them. A separate secret would be safer.
- Refresh tokens are stored as `sha256(jti)` with **no per-device metadata used** —
  `auth_session.user_agent` / `.ip` exist but are never written, so there is no session list and no
  targeted revoke.
- **Public writes are not idempotent** — the `idempotency_key` table exists but no middleware uses
  it. A double-tapped "join queue" creates two entries.
- **`audit_log` exists but nothing writes to it.**
- `otp_verification`, `payment`, and the payments/SMS webhook handlers are scaffolding only.

### Infrastructure

- **`owner-web/` has no `Dockerfile` and no `railway.toml`** despite `DEPLOY.md` listing a
  `tejotime-owner` service at `business.tejotime.com`. The only app service without
  config-as-code.
- **`owner-web/` has no CI job.** Lint and build it by hand before merging.
- **Store-page renders probably share one `publicRead` budget.** The frontend server fetches the
  microsite from the API from its own IP, so every visitor's server render counts against the same
  60/min key. Pre-existing; the homepage now linking nine stores makes it likelier to bite, and the
  page would show its "failed to load" state. Unverified — check prod logs for 429s on
  `/public/businesses/by-phone`.
- CI does not run `check:theme`, `check:crop`, `check:axes` or `test:theme`, so the four theme
  mirrors can drift silently.
- Migrations are manual and unversioned in deploy — nothing enforces schema-before-image.
- Backend pinned to one replica (see `deployment.md` §4).

### Product

- **Staff `/owner` sockets join a seat room that nothing emits to**, so staff clients silently fall
  back to polling for live queue updates. Seat-scoped emitters are unimplemented.
- **Joining a queue outside business hours is still allowed by the API.** The microsite hides
  every walk-in control when the store is closed, but `POST /public/businesses/:slug/queue` does
  not check. A server-side rule needs a product call — shops that run late are a real case.
- **No cancellation / no-show policy field on `business`**, so the booking flow cannot state or
  link one. The copy review asked for it; it needs a column and an owner-portal editor first.
- **Appointments cannot be rescheduled, cancelled or exported to a calendar**, and booking slots
  are **today-only** — which is what constrains the booking copy on the microsite.
- Backend still defaults `DEFAULT_CURRENCY` to **`INR`** with prices in paise, and `business.timezone`
  defaults to `Asia/Kolkata`, while the marketing site is now U.S.-facing. **This needs resolving
  before a real U.S. launch** — it is the largest open inconsistency in the codebase.

### Documentation / structure

- `docs/00`–`docs/18` describe a stack that was never built (Prisma, Redis, BullMQ, Supabase).
  Accurate for the data model, error catalog and role matrix; actively misleading for the stack.
  `DEPLOY.md` and `docs/qa-report-*.md` are current.
- Six-plus utility modules duplicated across the web apps **by hand with no sync guard** —
  `countries.ts`, `phone.ts`, `format.ts`, `support.ts`, `frontend-url.ts`, `PhoneField`, `i18n`.
- i18n migration is partial; `owner-web` in particular still has many inline strings.
- Duplicate migration prefix `0016`. Use `0025+` going forward.

---

## 4. Testing reality

Thin, and worth being honest about:

- `backend/tests/unit/` — **10 vitest files, 105 tests**: pure functions (`queue-engine`,
  `eta-notify`, `ttl-cache`, `sms`, `service-pricing`, `open-status`, `chat-faq`) plus two
  router/seam tests over `supertest` with `fetch` stubbed (`public-chat`, `chatbot`).
- `frontend/src/theme/engine/__tests__/run.ts` — framework-free theme self-check.
- `app/src/lib/__tests__/responsive-check.ts` — framework-free self-check for the mobile app's
  breakpoint/grid arithmetic (`npm run test:responsive`).
- `backend/scripts/smoke-rest.mjs` / `smoke-socket.mjs` — end-to-end smoke against a running,
  seeded server.

**No route or integration tests, no DB tests, no frontend tests, no coverage gate.** The mobile
app has no test runner either — its only automated coverage is the pure-arithmetic responsive
self-check above.
The microsite copy pass is the sharpest example: its backend half is unit-tested, and every one of
its rendering changes — the `$0` rule, the closed-state gate, the per-store page title — is
verified by nothing but a manual look.
`supertest` covers three routers (webhooks, public chat, and the chatbot seam) and nothing else. Permission guards, tenant scoping, the plpgsql
functions and the BFF proxies are verified only by smoke scripts and manual QA
(`docs/qa-report-2026-07-10.md`).

Practical consequence: when you change a guard, a scope, or a `queue_*` function, **exercise it
manually or extend the smoke scripts** — nothing else will catch a regression.

---

## 5. Suggested next steps

1. Resolve the **currency/timezone mismatch** (`INR`/`Asia/Kolkata` defaults vs a U.S. launch).
2. Add `owner-web` **`Dockerfile` + `railway.toml` + a CI job** — it is deployed but unconfigured.
3. Wire the four guard scripts into CI so theme mirrors cannot drift.
4. Get the legal pages **attorney-reviewed** before launch.
5. Implement real admin OTP, or remove `verifyAdminOtp` entirely rather than leaving a
   flag-gated bypass in the tree.
