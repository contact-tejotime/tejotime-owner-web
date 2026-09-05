# API reference

Express 4, TypeScript. Versioned prefix **`/api/v1`** (`config/constants.ts` `API_PREFIX`).
94 endpoints across 16 routers.

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
| `otp` | 5/hr |
| `login` | 10 per 5 min keyed on **(IP, phone)** |
| `loginIp` | 60 per 5 min — layered behind `login` so rotating the phone isn't a bypass |

The `(IP, phone)` key exists so colleagues on one shop Wi-Fi cannot lock each other out.

---

## 2. Authentication

Four JWT types (`modules/auth/token.service.ts`):

| Token | Secret | TTL | `typ` | Claims |
|---|---|---|---|---|
| Owner access | `JWT_ACCESS_SECRET` | 900s | `access` | `sub`, `bid`, `role`, `plan`, `sid`, `sup` |
| Owner refresh | `JWT_REFRESH_SECRET` | 30d | `refresh` | `sub`, `jti` — **rotating**, `jti` stored as sha256 in `auth_session` |
| Admin | `JWT_ACCESS_SECRET` | 12h | `admin` | `sub` (admin mobile) |
| Customer | `CUSTOMER_TOKEN_SECRET` | 30m | `customer` | `phone`, `bid` |

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

### `/auth` (5)

| Method | Path | Guards |
|---|---|---|
| POST | `/login` | `loginIp` + `login` |
| POST | `/refresh` | — (rotates the refresh token) |
| POST | `/logout` | — |
| GET | `/me` | returns the **resolved** permission map |
| POST | `/password` | `ownerWrite` |

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

A staff login's own seat **overrides** any `staffId` in the query, so the whole-shop view is not
one query string away. Walk-ins added by a staff login are forced onto that login's own chair
(`'auto'` would let the engine seat them in someone else's lane).

### `/appointments` (6)

| Method | Path | Guards |
|---|---|---|
| GET | `/` | `perm=appointments:view` |
| POST | `/` | `perm=appointments:manage` |
| GET | `/:id` | `perm=appointments:view`, `ownRow` |
| POST | `/:id/check-in` | `perm=appointments:manage`, `ownRow` |
| POST | `/:id/cancel` | `perm=appointments:manage`, `ownRow` |
| POST | `/:id/no-show` | `perm=appointments:manage`, `ownRow` |

### `/customers` (5)

`GET /` · `GET /:id` · `GET /:id/visits` (`perm=customers:view`) — `POST /` · `PATCH /:id`
(`perm=customers:manage`).

Free plan truncates the list server-side to `FREE_PLAN_CUSTOMER_LIMIT` and returns
`meta.lockedCount`.

### `/business` (6)

`GET /` · `GET /qr` (`perm=profile:view`) — `PATCH /` · `PUT /gallery` · `PUT /amenities`
(`perm=profile:manage`) — `PUT /hours` (`perm=hours:manage`).

### `/services` (4) and `/staff` (4)

`GET /` (`ownerRead`, no module permission) — `POST /` · `PATCH /:id` · `DELETE /:id`
(`perm=services:manage` / `perm=staff:manage`).

### `/users` (8) — team logins

`GET /modules` · `GET /` · `GET /:id` — `POST /` · `PATCH /:id` · `PUT /:id/permissions` ·
`POST /:id/password` · `DELETE /:id`.

Gated by the `team` module, which is **not grantable** — see `business-logic.md`.

### `/dashboard` (2), `/notifications` (2), `/subscription` (3), `/uploads` (1)

`GET /dashboard/summary` · `GET /dashboard/by-staff` (`perm=dashboard:view`).
`GET /notifications` · `POST /notifications/read` (`perm=notifications:view`).
`GET /subscription` (`perm=billing:view`) · `POST /upgrade` · `POST /cancel`
(`perm=billing:manage`).
`POST /uploads/sign` (`ownerWrite`).

### `/public` (12) — no auth

| Method | Path | Bucket |
|---|---|---|
| GET | `/businesses/:slug` | `publicRead` |
| GET | `/businesses/:slug/vcard` | `publicRead` |
| GET | `/businesses/by-phone/:phone` | `publicRead` |
| GET | `/businesses/:slug/availability` | `publicRead` |
| GET | `/businesses/:slug/staff` | `publicRead` |
| GET | `/businesses/:slug/slots` | `publicRead` |
| POST | `/businesses/:slug/queue` | `publicWrite` |
| POST | `/businesses/:slug/appointments` | `publicWrite` |
| POST | `/businesses/:slug/track` | `publicWrite` |
| POST | `/inquiries` | `inquiries` |
| GET | `/tickets/:ticketId` | `publicRead` |
| DELETE | `/tickets/:ticketId` | `publicWrite` |

Ticket reads/leaves authenticate with the HMAC `ticketKey`, not a session.

> Public writes are **not idempotent** — the `idempotency_key` table exists but no middleware
> uses it. A double-tapped "join queue" creates two entries.

### `/admin` (21) — separate admin JWT

Auth: `POST /auth/request-otp` · `POST /auth/verify-otp` · `POST /auth/login`.
Platform: `GET /me` · `GET /lookups` · `GET /analytics/overview` · `GET /inquiries` ·
`POST /uploads/sign`.
Admin management: `GET /admins` · `POST /admins` · `PATCH /admins/:id`.
Stores: `GET /businesses` · `GET /businesses/:id` · `POST /businesses` · `PUT /businesses/:id` ·
`POST /businesses/:id/owner/password` · `GET /businesses/:id/analytics` ·
`GET /businesses/:id/customers` · `GET /businesses/:id/customers/:customerId/visits` ·
`GET /businesses/:id/visits` · `GET /businesses/:id/appointments`.

The admin router **re-checks the `admins` row on every request**, so a demotion or deactivation
bites immediately rather than at token expiry.

Admin roles (`admins.role`, migration 0022): `owner` sees the whole platform; `employee` sees only
stores where `business.created_by_admin_id` matches. **Employee denial on a store is a 404, not a
403**, so the endpoint cannot be walked as an enumeration oracle.

> `POST /admin/auth/verify-otp` is a **stub that accepts a hardcoded constant**. It is hard-refused
> unless `OTP_ENABLED=true` (default false everywhere, including production). Do not enable it
> until real OTP verification exists — it is a complete auth bypass.

### `/webhooks` (4) and `/media` (1)

`GET /webhooks/whatsapp` (verify handshake) · `POST /webhooks/whatsapp` ·
`POST /webhooks/payments` · `POST /webhooks/sms`. The payments and SMS handlers are scaffolding.

`GET /media/*` — unversioned, unauthenticated, 302-redirects to a freshly signed S3 GET.

---

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
