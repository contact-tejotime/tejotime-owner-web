# API reference

Express 4, TypeScript. Versioned prefix **`/api/v1`** (`config/constants.ts` `API_PREFIX`).
100 endpoints across 16 routers.

Unversioned and outside auth: `GET /healthz`, `GET /readyz`, `GET /media/*`.

---

## 1. Conventions

Every authenticated route composes the same chain:

```
authenticate → limiters.<bucket> → requirePermission(module, level)
  → validate({ body, query, params })
  → [requireOwnRow('queue_entry'|'appointment')]
  → asyncHandler(handler)
```

- **`business_id` is never accepted from the client** — it comes from the token.
- Every request part is validated with zod via `validate(...)`.
- Money crosses the wire as `{ amount, currency }` with `amount` in **paise**.

### Error envelope

One shape for every failure (`domain/errors.ts` + `middleware/error-handler.ts`):

```json
{ "error": { "code": "NOT_FOUND", "message": "...", "requestId": "...", "details": {} } }
```

| Factory | Status |
|---|---|
| `validation` | 400 |
| `unauthenticated` / `invalidCredentials` / `tokenExpired` | 401 |
| `planLimit` | **402** |
| `forbidden` | 403 |
| `notFound` | 404 |
| `conflict` | 409 |
| `gone` | 410 |
| `invalidState` | 422 |
| `rateLimited` | 429 |
| `internal` | 500 |

The handler also translates **`ZodError`** → 400 with per-field `details`, and **`TEJO:<CODE>`**
plpgsql errors → their mapping (`NOT_FOUND`→404, `INVALID_STATE`→422, `SEAT_BUSY`→409,
`ALREADY_CHECKED_IN`→409).

In production, 500 messages are replaced with a generic `"Internal error"`; the real message is
logged with the same `requestId` returned to the caller.

### Rate limit buckets

In-memory, single-instance only (`middleware/rate-limit.ts`):

| Bucket | Limit |
|---|---|
| `global` | 600/min |
| `ownerRead` | 300/min (per user) |
| `ownerWrite` | 120/min (per user) |
| `publicRead` | 60/min |
| `publicWrite` | 20/hr |
| `inquiries` | 8/hr |
| `publicChat` | 20/hr — microsite help chat; own bucket because free text may fan out to a metered LLM free tier |
| `otp` | 5/hr |
| `login` | 10 per 5 min keyed on **(IP, phone)** |
| `loginIp` | 60 per 5 min — layered behind `login` so rotating the phone isn't a bypass |

The `(IP, phone)` key exists so colleagues on one shop Wi-Fi cannot lock each other out.

---

## 2. Authentication

Five JWT types (`modules/auth/token.service.ts`):

| Token | Secret | TTL | `typ` | Claims |
|---|---|---|---|---|
| Owner access | `JWT_ACCESS_SECRET` | 900s | `access` | `sub`, `bid`, `role`, `plan`, `sid`, `sup` |
| Owner refresh | `JWT_REFRESH_SECRET` | 30d | `refresh` | `sub`, `jti` — **rotating**, `jti` stored as sha256 in `auth_session` |
| Admin | `JWT_ACCESS_SECRET` | 12h | `admin` | `sub` (admin mobile) |
| Customer | `CUSTOMER_TOKEN_SECRET` | 30m | `customer` | `phone`, `bid` |
| Socket ticket | `JWT_ACCESS_SECRET` | 60s | `socket` | `sub`, `bid`, `role`, `sid`: opens the `/owner` socket only (owner-web) |

Admin tokens share the owner secret; only the `typ` discriminator stops `authenticate` from
accepting one. Plus `TICKET_URL_HMAC_SECRET` → `ticketKey(ticketId)`, an unguessable HMAC used for
anonymous public ticket access and the `/customer` socket handshake.

Passwords: `bcrypt.hash(password + PASSWORD_PEPPER, 10)`. **`PASSWORD_PEPPER` must match the value
used when the DB was seeded** — changing it breaks every owner and admin login.

Login nuances:
- Owner login is **phone + password**. The `accountType` (`owner`/`staff`) guard rail is checked
  only *after* the password verifies, so it cannot leak which numbers are owners.
- `findLoginByPhone` tolerates a missing country code on either side (two historical writers stored
  bare national numbers). A match must be **unique** or it is treated as no match.
- Refresh **rotates** and re-reads role / seat / super-owner from the DB, so a permission change
  takes effect within one access-token lifetime.

---

## 3. Endpoint catalogue

Legend: `perm=module:level` is `requirePermission`; `ownRow` is row-level scoping for staff logins.

### `/auth` (6)

| Method | Path | Guards |
|---|---|---|
| POST | `/login` | `loginIp` + `login` |
| POST | `/refresh` | — (rotates the refresh token) |
| POST | `/logout` | — |
| GET | `/me` | returns the **resolved** permission map |
| POST | `/password` | `ownerWrite` |
| POST | `/socket-ticket` | `ownerRead`; returns `{ ticket, expiresIn: 60 }`, built from the caller token only |

`/auth/me` returns the same `effectiveAccess` the route guards use, so the UI cannot drift from
the API.

### `/queue` (10)

| Method | Path | Guards |
|---|---|---|
| GET | `/` | `perm=queue:view` |
| POST | `/` | `perm=queue:manage` |
| GET | `/:id` | `perm=queue:view`, `ownRow` |
| POST | `/:id/start` | `perm=queue:manage`, `ownRow` |
| POST | `/:id/checkout` | `perm=queue:manage`, `ownRow` |
| POST | `/:id/no-show` | `perm=queue:manage`, `ownRow` |
| POST | `/:id/reassign` | `perm=queue:manage`, `ownRow` |
| POST | `/:id/extend` | `perm=queue:manage`, `ownRow` |
| POST | `/:id/move` | `perm=queue:manage`, `ownRow` |
| DELETE | `/:id` | `perm=queue:manage`, `ownRow` |

`GET /:id` returns the checkout sheet's billing: `serviceAmount`, `servicePriceType`,
`serviceMaxAmount`, `extrasAmount`, `extras[]`, `amountRequired`, and `suggestedAmount` — which
is **null** whenever `amountRequired` is true (a range-priced or unpriced service). `POST
/:id/checkout` then requires `amountPaise` for those and answers **422 `AMOUNT_REQUIRED`**
without it; a fixed-price service still checks out on an empty body. See `business-logic.md`.

A staff login's own seat **overrides** any `staffId` in the query, so the whole-shop view is not
one query string away. Walk-ins added by a staff login are forced onto that login's own chair
(`'auto'` would let the engine seat them in someone else's lane).

### `/appointments` (20)

| Method | Path | Guards |
|---|---|---|
| GET | `/` | `perm=appointments:view` |
| POST | `/` | `perm=appointments:manage` |
| GET | `/series` | `perm=appointments:view`; `?status=open\|active\|paused\|ended\|cancelled\|all` (default open); staff → own chair |
| GET | `/series/issues` | `perm=appointments:view`; Needs attention; staff → own chair |
| POST | `/series/issues/:issueId/resolve` | `perm=appointments:manage` |
| GET | `/series/:id` | `perm=appointments:view`, `ownRow(appointment_series)` → `{ series, visits, issues, laterDates }` |
| POST | `/series/:id/pause` · `/resume` · `/cancel` | `perm=appointments:manage`, `ownRow`; resume takes `{ staffId?: uuid \| 'any' }` |
| GET | `/:id` | `perm=appointments:view`, `ownRow` |
| POST | `/:id/check-in` | `perm=appointments:manage`, `ownRow` — puts the customer on the **booked** stylist when still active, else the soonest seat |
| POST | `/:id/cancel` | `perm=appointments:manage`, `ownRow` |
| POST | `/:id/skip` | `perm=appointments:manage`, `ownRow` — series visits only (one-off → 400) |
| GET | `/:id/slots?date&staffId` | `perm=appointments:manage`, `ownRow` — times to move this booking to (today…today+60) |
| POST | `/:id/reschedule` | `perm=appointments:manage`, `ownRow` — `{slotStart, staffId?}`; any booking; a staff login may not move it to another chair (403) |
| GET | `/series/:id/slots?date&staffId&fromDate?` | `perm=appointments:manage`, `ownRow(appointment_series)` |
| POST | `/series/:id/preview-change` · PATCH `/series/:id` | `perm=appointments:manage`, `ownRow` — `{fromDate, slotStart?, staffId?, resolutions?}`; 409 `CHANGE_CONFLICTS` names dates needing a choice |
| POST | `/series/issues/:issueId/book` | `perm=appointments:manage` — Book another time; seat-scoped in the service |
| POST | `/:id/no-show` | `perm=appointments:manage`, `ownRow`; 2 in a row pause the visit's series |

The `/series…` routes are registered **before** `/:id` — `:id`'s UUID check would 400 on the word
"series". The appointment DTO carries `seriesId`, `occurrenceDate`, `cancelReason`. Recurring
appointments: [docs/recurring-appointments.md](../../docs/recurring-appointments.md).

### `/customers` (5)

`GET /` · `GET /:id` · `GET /:id/visits` (`perm=customers:view`) — `POST /` · `PATCH /:id`
(`perm=customers:manage`).

Free plan truncates the list server-side to `FREE_PLAN_CUSTOMER_LIMIT` and returns
`meta.lockedCount`.

### `/business` (6)

`GET /` · `GET /qr` (`perm=profile:view`) — `PATCH /` · `PUT /gallery` · `PUT /amenities`
(`perm=profile:manage`) — `PUT /hours` (`perm=hours:manage`). `PATCH /` accepts
`recurringEnabled` (owner/co-owner only, like the other public-face fields).

### `/services` (4) and `/staff` (4)

`GET /` (`ownerRead`, no module permission) — `POST /` · `PATCH /:id` · `DELETE /:id`
(`perm=services:manage` / `perm=staff:manage`).

**Service pricing** crosses as a triple, all paise: `priceType` (`'fixed' | 'range' | 'unset'`),
`priceAmount` (the fixed price, or the range floor, `>= 1`; **optional and ignored for `unset`**,
which is stored as `0`) and `priceMaxAmount` (the ceiling — required for a range, refused on a
fixed price). The three move **together**: a `PATCH` that sends one without `priceType` (and, for
a priced mode, `priceAmount`) is a 400, so a service switched back from a range cannot keep a
ceiling the check constraint would reject. `unset` means "no price" — the microsite shows none.

The DTO mirrors that with `price` (fixed amount, or range minimum), `priceType` and `priceMax`
(null unless a range). See `database.md` and `business-logic.md`.

Pictures, stylists and services are optional everywhere: `POST /admin/businesses` and
`PUT /admin/businesses/:id` default `services` and `staff` to `[]`, a service's `priceRupees` may be
omitted for `unset`, and `POST /queue` (walk-in) needs no service for any category. See
[docs/optional-store-data.md](../../docs/optional-store-data.md).

### `/users` (8) — team logins

`GET /modules` · `GET /` · `GET /:id` — `POST /` · `PATCH /:id` · `PUT /:id/permissions` ·
`POST /:id/password` · `DELETE /:id`.

Gated by the `team` module, which is **not grantable** — see `business-logic.md`.

### `/dashboard` (2), `/notifications` (2), `/subscription` (3), `/uploads` (1)

`GET /dashboard/summary` · `GET /dashboard/by-staff` (`perm=dashboard:view`). Both take
`?range=today|week|month|custom&from=&to=` (`lib/report-window.ts`: store-local days, weeks start
Monday, custom ≤ 366 days, half-open windows) and return `from`, `to`, `today`. `/by-staff` keeps a
stylist removed mid-period who has work in it (`isActive: false`).
`GET /notifications` · `POST /notifications/read` (`perm=notifications:view`).
`GET /subscription` (`perm=billing:view`) · `POST /upgrade` · `POST /cancel`
(`perm=billing:manage`).
`POST /uploads/sign` (`ownerWrite`).

### `/commission` (5) — staff commission

Every visit at the latest rate whose start instant is at or before checkout — see
[docs/staff-commission.md](../../docs/staff-commission.md).

| Method | Path | Guards |
|---|---|---|
| GET | `/summary` | `perm=commission:view` (every role; not grantable); a staff login gets only its own chair (`scope: 'self'`) |
| GET | `/visits` | `perm=commission:view`; owner must pass `staffId`; staff: own chair only (other → 403) |
| GET | `/rates` | `perm=commission:manage` |
| PUT | `/rates/:staffId` | owner **role** + `perm=commission:manage`; `{ rateBp, effectiveFrom? }` (`effectiveFrom` is a store-local day); today or omitted starts at `now()` as a new row; a future day starts at store midnight and replaces that instant; past day → 409 `COMMISSION_RATE_LOCKED` |
| DELETE | `/rates/:staffId/:effectiveFrom` | owner role + `perm=commission:manage`; `effectiveFrom` is the UTC instant; only a future instant; a started rate → 409 |

### `/public` (18) — no auth

| Method | Path | Bucket |
|---|---|---|
| GET | `/businesses/:slug` | `publicRead` — microsite DTO. Since 2026-10-05: `+city` (the page shows it when `area` is blank), `+galleryHeading` (null = default for the store type), `−statValue/statLabel` |
| GET | `/businesses/:slug/vcard` | `publicRead` — locality is the city |
| GET | `/businesses/by-phone/:phone` | `publicRead` |
| GET | `/businesses/by-phone/:phone/review-link` | `publicRead` — `{url}` or 404; `no-store`. Read by the review-SMS short link `www.tejotime.com/<phone>/r` |
| GET | `/businesses/:slug/availability` | `publicRead` |
| GET | `/businesses/:slug/staff` | `publicRead` |
| GET | `/businesses/:slug/slots` | `publicRead` |
| POST | `/businesses/:slug/queue` | `publicWrite` |
| POST | `/businesses/:slug/appointments` | `publicWrite` — re-checks the slot under a per-store lock; not offered by `/slots` → **409 `SLOT_UNAVAILABLE`**; stylist not active at this store → 400 |

Join and book accept optional `smsOptIn` (boolean, default `false`). Missing/false never
dispatches Twilio; see [docs/sms-opt-in-a2p.md](../../docs/sms-opt-in-a2p.md).
| POST | `/businesses/:slug/track` | `publicWrite` — position only: no `socket.ticketKey`, no `customerName` |
| POST | `/businesses/:slug/appointments/lookup` | `publicWrite` — `{phone}` must start with `+` (else 400); upcoming bookings **with** `appointmentKey` (only where `canChange`) + `series[{seriesId, manageToken, status}]` (active/paused) — client decision 2026-10-05 |
| GET | `/appointments/:appointmentId` | `publicRead` — needs header `X-Appointment-Key`; wrong/missing key → 404 |
| GET | `/appointments/:appointmentId/slots` | `publicRead` — `X-Appointment-Key`; `?date&staffId`; `lastDay` = today+20 |
| POST | `/appointments/:appointmentId/reschedule` | `publicWrite` — body `{key, slotStart, staffId?}`; beyond today+20 / taken → 409 `SLOT_UNAVAILABLE`; started/checked-in → 422 |
| POST | `/appointments/:appointmentId/cancel` | `publicWrite` — body `{key}`; past/checked-in/cancelled → 422 |
| POST | `/businesses/:key/chat` | `publicChat` |
| POST | `/chat` | `publicChat` |
| GET | `/chat/status` | `publicRead` |
| POST | `/inquiries` | `inquiries` |
| GET | `/tickets/:ticketId` | `publicRead` |
| DELETE | `/tickets/:ticketId` | `publicWrite` — needs header `X-Ticket-Key`; missing/wrong → 404 |
| POST | `/businesses/:slug/series-preview` | `publicRead` (read-only) — `{serviceIds, preferredStaffId, slotStart, repeat}` → the first 6 dates, each `ok\|later\|closed\|taken\|outside_hours` |
| GET | `/series` | `publicRead` — header `X-Series-Token`; missing/wrong → 404 |
| POST | `/series/visits/:appointmentId/skip` | `publicWrite` — header `X-Series-Token` |
| POST | `/series/cancel` | `publicWrite` — header `X-Series-Token`; already cancelled → 422 |
| GET | `/series/slots?date&staffId&appointmentId?\|fromDate?` | `publicRead` — token; customer range today…today+20 |
| POST | `/series/visits/:appointmentId/reschedule` | `publicWrite` — token; only the token's series |
| POST | `/series/preview-change` | `publicRead` — token |
| POST | `/series/change` | `publicWrite` — token; 409 `CHANGE_CONFLICTS` |

**Recurring appointments.** `POST /businesses/:slug/appointments` takes an optional
`repeat: { everyDays 7–90, end: {type:'never'} | {type:'count', count 2–26} | {type:'until', date} }`
and then also answers `series: { seriesId, manageToken, everyDays, startTime, visits[], skipped[] }`.
409 `SERIES_EXISTS` (one open series per phone per store — checked before anything is written),
409 `RECURRING_DISABLED` (store switch off), 400 for a rule `lib/recurrence.ts` `ruleProblem`
refuses. The microsite payload has `recurringEnabled`; lookups carry `repeats`. The manage token is
the customer's link (`/{phone}/v#token`) — 16 random url-safe chars, header-only, never in a URL a
server sees. See [docs/recurring-appointments.md](../../docs/recurring-appointments.md).

Leaving a ticket and the `/customer` ticket room authenticate with the HMAC `ticketKey` (returned
only by the join that created the ticket — never by `/track` or a duplicate join); reading a ticket
by id (`GET /tickets/:id`) stays open (position only, no personal data).

`/slots` and booking share one rule, `lib/booking-slots.ts` `computeSlots`: overlap-aware capacity
(active stylists; a named stylist can't overlap itself; stylist-less bookings use a unit), store
hours, future only, within `BOOKING_WINDOW_DAYS` (14). `preferredStaffId` is `'any'` or a UUID
(malformed → 400). See [docs/customer-chatbot-booking.md](../../docs/customer-chatbot-booking.md).

Booking returns `appointmentKey`, which is `ticketKey("appt:" + id)`. It is the only thing that
reads, moves or cancels an appointment publicly.
- **Since 2026-10-05** the phone lookup returns the key as well (client decision), so the phone
  number alone manages a booking from any device.
- **Fences:** only a `+<cc>` number is accepted, keys are given only for bookings that can still
  change, and no customer details come back.
- See [docs/customer-my-appointments.md](../../docs/customer-my-appointments.md).

`/chat` is the **marketing landing page's** bot (no business context — it answers about the
product from a fixed fact sheet), and `/chat/status` just reports the flag so that statically
rendered page can decide whether to show the launcher.

`/businesses/:key/chat` takes a slug **or** the digits-only phone, answers `404 CHATBOT_DISABLED`
while `CHATBOT_ENABLED=false`, and never mutates — it answers from FAQs/page facts (or a free
Gemini/Groq model behind `CHATBOT_PROVIDER`) and only *suggests* the page's buttons. See
[docs/customer-chatbot-v1.md](../../docs/customer-chatbot-v1.md).

> Public writes are **not idempotent** — the `idempotency_key` table exists but no middleware
> uses it. A double-tapped "join queue" creates two entries.

### `/admin` (26) — separate admin JWT

Auth: `POST /auth/request-otp` · `POST /auth/verify-otp` · `POST /auth/login`.
Platform: `GET /me` · `GET /lookups` · `GET /analytics/overview` · `GET /inquiries` ·
`POST /uploads/sign` · `POST /store-import` (read a web page and propose store-form values;
read-only, SSRF-guarded, 10/hour/admin, 503 unless `AUTOFILL_ENABLED` — see
[docs/store-autofill-from-link.md](../../docs/store-autofill-from-link.md)).
Create-store drafts (private to the calling admin, owner or employee; another admin's draft is a
**404**): `GET /store-drafts` (`{ data: [...] }`, no form blobs) · `GET /store-drafts/:id` ·
`POST /store-drafts` (201; 409 `DRAFT_LIMIT` past 50) · `PUT /store-drafts/:id` (autosave) ·
`DELETE /store-drafts/:id` (204, idempotent). The body is `{ data }`, deliberately **not** validated
against the store schema (a draft is incomplete by definition), capped at 256 KB, and the owner
password is stripped server-side — see [docs/admin-store-drafts.md](../../docs/admin-store-drafts.md).
Admin management: `GET /admins` · `POST /admins` · `PATCH /admins/:id`.
Stores: `GET /businesses` · `GET /businesses/:id` · `POST /businesses` · `PUT /businesses/:id` ·
`POST /businesses/:id/owner/password` · `GET /businesses/:id/analytics` ·
`GET /businesses/:id/customers` · `GET /businesses/:id/customers/:customerId/visits` ·
`GET /businesses/:id/visits` (rows carry `rateBp` + `commission`) ·
`GET /businesses/:id/commission` (read-only commission by stylist) ·
staff on `POST` / `PUT /businesses` may carry optional `rateBp` (basis points; null = no rate; a change starts at `now()`; clearing a started rate is 400) ·
`GET /businesses/:id/appointments`.

**A store's phone number is write-once.** It is the microsite address (`/{phone_full}`) and is
baked into every printed QR code, so `PUT /businesses/:id` with a number different from the stored
one is **409 `PHONE_LOCKED`** (a legacy store with no number may still set one). The admin form
disables the field in edit mode; owner-web and the app already showed it read-only.

**The nine homepage demo stores can't be disabled** (`backend/src/domain/demo-stores.ts`):
`PUT /businesses/:id` with `isActive: false` for one is **409 `DEMO_STORE_ALWAYS_ON`**, checked
before the body is validated. `GET /businesses` rows and `GET /businesses/:id` carry `isDemo` and
`demoIndustry` (the homepage card, e.g. "Hair salons", shown instead of the shared category);
`/analytics/overview` and `GET /admins` (`storesCount`) leave those stores out.
See [docs/demo-stores.md](../../docs/demo-stores.md).

The admin router **re-checks the `admins` row on every request**, so a demotion or deactivation
bites immediately rather than at token expiry.

Admin roles (`admins.role`, migration 0022): `owner` sees the whole platform; `employee` sees only
stores where `business.created_by_admin_id` matches. **Employee denial on a store is a 404, not a
403**, so the endpoint cannot be walked as an enumeration oracle.

> `POST /admin/auth/verify-otp` is a **stub that accepts a hardcoded constant**. It is hard-refused
> unless `OTP_ENABLED=true` (default false everywhere, including production). Do not enable it
> until real OTP verification exists — it is a complete auth bypass.

### `/webhooks` (2) and `/media` (1)

`POST /webhooks/payments` · `POST /webhooks/sms`. Both handlers are scaffolding.

`GET /media/*` — unversioned, unauthenticated, 302-redirects to a freshly signed S3 GET.

---

> **Store setup review (2026-10-05, [docs/store-setup-review-2026-10-05.md](../../docs/store-setup-review-2026-10-05.md)).**
> - **Admin create/update** (`/admin/businesses`):
>   - `area` is optional;
>   - new `galleryHeading` (≤40 characters; `''` clears it; written only when sent);
>   - `tagline` is still required.
> - **Owner `PATCH /business`:** `galleryHeading` is an owner-only field (a staff login gets 403),
>   and a blank `tagline` is ignored.
> - **Both:** `statValue` / `statLabel` are still **accepted and ignored** (strict schemas; old app
>   builds send them) and are no longer returned.

## 4. Image upload flow

The bucket is **private** (Railway Buckets has no public-object mode):

1. Client asks `POST /uploads/sign` (or `/admin/uploads/sign`) for a short-lived signed **PUT**.
   Max 5 MB; `jpeg`/`png`/`webp` only.
2. Client PUTs the bytes **straight to the bucket** — they never transit the API.
3. The **stable** URL persisted in the database is `{APP_BASE_URL}/media/{fileKey}`.
4. `GET /media/*` 302-redirects to a freshly signed GET, so bytes stream from the bucket (free
   egress) and the stored URL never expires.

> `APP_BASE_URL` is baked into every stored `/media/...` URL. **Changing the API domain later means
> rewriting those stored URLs.**

---

## 5. Consuming the API from the web apps

`owner-web` and `admin-panel` mirror the backend DTOs **by hand** in `lib/server-api.ts`, and
`call<T>` casts parsed JSON straight to `T`. There is **no compiler between the two sides**, so a
drifted interface type-checks perfectly and renders `undefined` at runtime. This has already
shipped a bug. **Change both sides in the same commit.**

BFF error behaviour: `unreachable(e)` returns a uniform **502** when the API is down; cached reads
in `server-api.ts` return `null` on failure so a page degrades rather than crashes, and rethrow
`UNAUTHORIZED` on 401 so callers redirect to `/login`.
