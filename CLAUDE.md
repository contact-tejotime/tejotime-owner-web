# CLAUDE.md — TejoTime

Multi-tenant **queue + booking + CRM platform** for small service businesses in India
(salons/barbershops, hospitals, restaurants). Each tenant ("business") gets a public booking
microsite, a live multi-seat queue, appointments, a customer CRM, and a free/premium plan.

Money is stored as **integer paise**. Default timezone `Asia/Kolkata`, currency `INR`.
All timestamps are stored in UTC (`timestamptz`).

## Documentation rule

The root-level `docs/` folder is the **single source of truth for all project documentation**.

- In **every session**, before working on any feature, bug fix, or code change, **check the
  relevant documentation inside `docs/`.**
- **After making changes, update the relevant docs** when necessary.
- All project documentation must be **created and maintained inside the root-level `docs/`
  folder**. Never create project documentation elsewhere unless explicitly instructed.

Existing files that live outside `docs/` by explicit instruction, and are therefore **not**
exceptions you may extend: this `CLAUDE.md`, `.claude/docs/*` (agent deep-dives, see below),
`DEPLOY.md`, `README.md`, and each app's `README`. Anything new goes in `docs/`.

> **Reconcile before you trust:** `docs/00`–`docs/18` were written *before* implementation and
> still describe a stack that was never adopted (Prisma, Redis, BullMQ, Supabase). Read them for
> intent, vocabulary, the data model, the error catalog and the role matrix — but when a doc and
> the code disagree about the stack, **the code is truth, and correcting the doc is part of the
> change.** `docs/qa-report-*.md` and `DEPLOY.md` are current.

## Deep-dive docs

This file is the summary. Fuller reference lives in `.claude/docs/` — read the relevant one before
non-trivial work in that area:

| Doc | Covers |
|---|---|
| [architecture.md](.claude/docs/architecture.md) | topology, request lifecycle, module layout, realtime, routing traps |
| [database.md](.claude/docs/database.md) | every table and column, enums, indexes, the `queue_*` plpgsql functions, migration history |
| [api.md](.claude/docs/api.md) | all 94 endpoints with their guards, error envelope, auth, upload flow |
| [business-logic.md](.claude/docs/business-logic.md) | queue engine algorithms, ETA alerts, checkout cascade, permissions, plan gating |
| [deployment.md](.claude/docs/deployment.md) | Railway runbook, migration procedure, env vars, CI gaps |
| [current-work.md](.claude/docs/current-work.md) | **living** — what shipped recently, known gaps, next steps |

---

## 1. Repository layout

Monorepo with **five independent apps**. There are **no npm workspaces and no hoisting** — each
app has its own `package.json`, `package-lock.json`, and `node_modules`.

> **Run `npm install` / `npm ci` inside the app folder, never at the repo root.**
> Each app is Docker-built with `COPY . .` from its *own* folder (Railway Root Directory = the
> app folder), so **anything an app imports must live under that app's folder**. This is why
> shared code is duplicated and kept in sync by scripts (see §11).

| Folder | Name | Stack | Dev port |
|---|---|---|---|
| `backend/` | `tejotime-api` | Express 4 + TypeScript + Postgres (no ORM) + Socket.IO + node-cron | 8080 |
| `frontend/` | `tejotime-web` | Next.js 16 / React 19 — marketing site + public customer microsite | 3000 |
| `admin-panel/` | `tejotime-admin` | Next.js 16 — **platform** admin (provisioning, analytics, billing) | 3001 |
| `owner-web/` | `tejotime-owner-web` | Next.js 16 — **business owner/staff** portal | 3002 |
| `app/` | `tejotime-mobile` | Expo 56 / React Native 0.85 / expo-router — owner mobile app | Expo |
| `docs/` | — | Written specification (see caveat below) | — |
| `scripts/` | — | Repo-root dev tooling: code-duplication sync + guards | — |

Root `package.json` holds only convenience scripts (`dev:backend`, `dev:owner`, `build:admin`,
`sync:theme`, `check:axes`, `android:reverse`, …). It installs nothing.

> ⚠️ **`docs/00`–`docs/18` are an aspirational spec written before implementation.** They
> propose Prisma, Redis, BullMQ, and a Supabase alternative — **none of which were adopted**.
> The real stack is plain `pg`, in-process `node-cron`, and in-memory rate limiting. Treat the
> docs as intent/vocabulary (data model, error catalog, role matrix are still accurate); treat
> the code as truth for the stack. `docs/qa-report-*.md` and `DEPLOY.md` are current.

---

## 2. Tech stack

**Backend** — Node ≥22, Express 4, TypeScript, `pg` (raw SQL, no ORM), Socket.IO 4, `zod`
(validation + env), `pino`/`pino-http` (logging), `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`,
`express-rate-limit`, `node-cron`, `@aws-sdk/client-s3` + `s3-request-presigner`, `dayjs`.
Dev: `tsx` (watch/run), `vitest`, `eslint`, `supertest` (router-level HTTP tests — see §12).

**Web apps** — Next.js 16.2.9, React 19.2.4, TypeScript 5, App Router, Server Components.
`frontend` also uses Tailwind v4 (`@tailwindcss/postcss`), `socket.io-client`, `qrcode.react`.
`admin-panel` uses `recharts`. All three use `libphonenumber-js`. `owner-web` and `admin-panel`
use **plain CSS custom properties + `globals.css`**, not Tailwind.

**Mobile** — Expo 56, expo-router (typed routes, React Compiler on), expo-secure-store (token
storage), react-native-reanimated 4, socket.io-client.

---

## 3. Architecture

```
                         ┌───────────────────────────────┐
 customer (anon) ───────►│ frontend  (Next 16, SSR)      │──► NEXT_PUBLIC_API_BASE_URL
                         │  /{phone} microsite           │    (browser → API directly)
                         └───────────────────────────────┘         │
                                                                   │  + socket.io /customer
 owner / staff ─────────►┌───────────────────────────────┐         ▼
                         │ owner-web (Next 16, BFF)      │   ┌──────────────────────┐
                         │  httpOnly cookies + /api/*    │──►│  backend (Express)   │
                         └───────────────────────────────┘   │  /api/v1 + Socket.IO │
 platform admin ────────►┌───────────────────────────────┐   │  + node-cron         │
                         │ admin-panel (Next 16, BFF)    │──►└──────────────────────┘
                         └───────────────────────────────┘        │        │
 owner (mobile) ────────►  app (Expo) — calls API directly        ▼        ▼
                                                            Postgres    S3 bucket
                                                            (plpgsql)   (private)
```

Two distinct client patterns — **do not mix them**:

- **`frontend` and `app`** call the API **directly** from the client with `NEXT_PUBLIC_*` /
  `EXPO_PUBLIC_*` base URLs. `frontend`'s customer surface is anonymous; `app` holds owner JWTs
  in `expo-secure-store`.
- **`owner-web` and `admin-panel` are BFFs.** The browser **never** touches the backend. Tokens
  live in **httpOnly cookies**; Server Components read via `lib/server-api.ts`, and mutations go
  through same-origin `/api/*` route handlers that attach `Authorization: Bearer` server-side.
  `BACKEND_API_BASE_URL` is deliberately **not** `NEXT_PUBLIC_*`.

### Backend module layout (`backend/src/`)

```
app.ts             express app: helmet → cors → json → requestId → pino-http → global limiter
server.ts          http server + initRealtime() + startScheduler() + SIGTERM/SIGINT shutdown
config/            env.ts (zod-validated, fail-fast), logger.ts (pino + redaction), constants.ts
db/                pool.ts (many/one/exec/transaction), rpc.ts (callRpc), ssl.ts
domain/            enums.ts, errors.ts (AppError + Errors factory), permissions.ts, money.ts
middleware/        authenticate, authorize, require-permission, validate, rate-limit,
                   request-id, error-handler
modules/<name>/    <name>.routes.ts + <name>.service.ts (+ .schemas.ts) — thin routes, fat services
realtime/          io.ts (namespaces + handshake auth), emitters.ts
jobs/scheduler.ts  in-process node-cron
lib/               queue-engine.ts (pure ETA/seat math), eta-notify.ts, time, phone, format, ttl-cache
integrations/      storage (S3), whatsapp (Twilio), sms, email  — provider "seams"
observability/     health.ts (/healthz liveness, /readyz db-readiness)
```

---

## 4. API architecture

- Versioned prefix **`/api/v1`** (`config/constants.ts` `API_PREFIX`). Unversioned and outside
  auth: `GET /healthz`, `GET /readyz`, and **`GET /media/*`** (image reads — these URLs are
  persisted in the DB, so the path must stay stable forever).
- Routers: `auth business services staff users queue appointments customers dashboard
  notifications subscription uploads public webhooks admin`.
- Every route composes the same chain: `authenticate → limiter → requirePermission → validate →
  asyncHandler`. Route handlers stay thin; logic lives in the service.
- Uniform error envelope:
  `{ error: { code, message, requestId, details? } }` — see `domain/errors.ts` and
  `middleware/error-handler.ts`.
- Public surface (`/public/*`, no auth): microsite by slug **and by phone**, vCard `.vcf`,
  availability, staff availability, bookable slots, join queue, book slot, track by phone,
  ticket read/leave, inquiry submission.
- Admin surface (`/admin/*`) is gated by a separate admin JWT and re-checks the `admins` row on
  **every** request, so a demotion/deactivation bites immediately.
- Webhooks: `/webhooks/whatsapp` (GET verify + POST), `/webhooks/payments`, `/webhooks/sms`.

### Realtime (Socket.IO)

Two namespaces, initialized in `realtime/io.ts`:

| Namespace | Auth | Rooms |
|---|---|---|
| `/owner` | access JWT in `handshake.auth.token` | `business:{id}` (owner/co_owner/manager only) or `business:{id}:seat:{staffId}` (staff) |
| `/customer` | anonymous; ticket access via HMAC `ticketKey` | `public:{businessId}`, `ticket:{ticketId}` |

Events: `queue:snapshot`, `queue:entry.started|completed`, `availability:updated`,
`staff:availability`, `ticket:updated`, `ticket:ready`, `ticket:eta_15`, `subscription:updated`.
**All emits happen after the DB commit.** A staff socket deliberately does **not** join the
business room (it would leak the whole shop's queue); seat-scoped emits are not implemented yet,
so staff clients fall back to polling.

---

## 5. Database

**PostgreSQL, raw SQL, no ORM.** `db/pool.ts` is the only runtime data-access entry point.
Migrations are plain `.sql` files in `backend/db/migrations/`, applied in filename order by
`db/migrate.ts` (`npm run migrate`), **each wrapped in its own transaction**, and written to be
**idempotent / re-runnable**. Seeds: `db/seed.ts` (Sharp Cuts demo tenant) and `db/seed-demo.ts`.

Core tables (`0001_init.sql`): `business` (tenant root), `business_hour`, `amenity`,
`gallery_image`, `app_user` (owner/staff logins), `staff` (seats/providers), `service`,
`customer`, `appointment`, `queue_entry`, `queue_entry_extra`, `visit` (completed-service
ledger), `subscription`, `payment`, `notification`, `otp_verification`, `auth_session`,
`audit_log`, `token_counter`, `idempotency_key`. Later: `master_data` (0005 lookup),
`admins` (0007), `inquiry` (0014), `user_permission` (0019).

Notable constraints and conventions:
- UUID PKs (`gen_random_uuid()`); `pgcrypto` + `pg_trgm` extensions.
- Money: `*_paise` integers. Enums mirror `domain/enums.ts` exactly.
- `uq_one_in_service_per_seat` — at most one `in_service` entry per (business, staff).
- `uq_token_per_day` — daily ticket token uniqueness per business.
- `uq_app_user_super_owner` — exactly one super owner per business.
- `uq_app_user_staff` — a chair backs at most one login.
- `business.phone_full` is a **generated column** (`country_code || phone_number`), uniquely
  indexed — it is the microsite's by-phone lookup key.
- Trigram GIN indexes on `customer.name` / `customer.phone` for search.

### Queue operations live in plpgsql

`0002_functions.sql` (amended by 0015/0016/0020) defines the **atomic** queue primitives:
`queue_add`, `queue_start`, `queue_checkout`, `queue_no_show`, `queue_reassign`, `queue_extend`,
`queue_move`, `queue_leave`, `appointment_check_in`, plus `next_token` and `_queue_renumber`.

- Each mutating function takes `pg_advisory_xact_lock(hashtext(business_id))` so concurrent
  queue changes cannot corrupt ordering.
- Positions are maintained **only among a seat's `waiting` entries**, contiguous `0..n-1`.
- Errors are raised as `TEJO:<CODE>` and mapped to HTTP by `error-handler.ts`
  (`NOT_FOUND`→404, `INVALID_STATE`→422, `SEAT_BUSY`→409, `ALREADY_CHECKED_IN`→409).
- Called from TS via `db/rpc.ts` `callRpc(fn, namedArgs)`, which uses **named** argument
  notation and `select * from fn(...)` (never `select fn(...)` — that would stringify
  `returns table` results).

> **Postgres overload trap:** adding a trailing parameter with a `DEFAULT` creates a *second*
> overload and makes existing calls ambiguous. `0016_fix_queue_add_overload.sql` and the
> `drop function` at the end of `0020_queue_checkout_amount.sql` exist for exactly this. If you
> add a parameter to a `queue_*` function, **drop the old signature in the same migration.**

---

## 6. Authentication & authorization

Four token types, all JWT (`modules/auth/token.service.ts`):

| Token | Secret | TTL | `typ` | Notes |
|---|---|---|---|---|
| Owner access | `JWT_ACCESS_SECRET` | 900s | `access` | claims: `sub`, `bid`, `role`, `plan`, `sid` (staff seat), `sup` (super owner) |
| Owner refresh | `JWT_REFRESH_SECRET` | 30d | `refresh` | **rotating**; `jti` hashed (sha256) into `auth_session` |
| Admin | `JWT_ACCESS_SECRET` | 12h | `admin` | same secret; the `typ` discriminator keeps `authenticate` from accepting it |
| Customer | `CUSTOMER_TOKEN_SECRET` | 30m | `customer` | |

Plus `TICKET_URL_HMAC_SECRET` → `ticketKey(ticketId)`, an unguessable HMAC used for anonymous
public ticket access and the `/customer` socket handshake.

Passwords: `bcrypt.hash(password + PASSWORD_PEPPER, 10)`.
**`PASSWORD_PEPPER` must match the value used when the DB was seeded** — changing it breaks
every owner and admin login.

### Tenant isolation

`business_id` **always** comes from the token, never from client input (`middleware/authenticate.ts`).
There is **no row-level security** — isolation is enforced in the service layer, so every query
must scope by `business_id` explicitly.

### Roles and permissions

Business roles (`user_role` enum): `owner` (super owner, one per business, created by the admin
panel at provisioning), `co_owner` (same powers, cannot touch the super owner), `staff`,
`manager` (legacy, no longer assigned).

`domain/permissions.ts` is the single source of truth:
- `MODULES` catalogue lives **in code, not the DB** — adding a screen is a deploy, not a migration.
- `GRANTABLE_MODULES` excludes `team` on purpose (granting login-creation would let a staff
  account grant itself everything else).
- `ROLE_DEFAULTS` + **sparse overrides** in `user_permission` (a row exists only where an owner
  deliberately changed something) → `effectiveAccess(role, overrides)`.
- Owner roles ignore overrides entirely, so a stale row can never lock out the account holder.

Enforcement (`middleware/require-permission.ts`):
- `requirePermission(module, 'view'|'manage')` — the boundary; UI hiding is cosmetic.
- `requireOwnRow('queue_entry'|'appointment')` — row-level: a staff login may only act on its
  own chair's rows.
- `scopeStaffId(principal)` — narrows reads; a staff login with **no chair linked sees nothing**
  rather than everything (fails safe).
- `requireSuperOwner` — the handful of actions co-owners must not reach.
- `/auth/me` returns the **resolved** permission map (same `effectiveAccess` the guards use), so
  the UI cannot drift from the API.

Platform admin roles (`admins.role`, migration 0022): `owner` (whole platform) and `employee`
(only stores where `business.created_by_admin_id` matches). Employee denial on a store is a
**404, not 403**, so the endpoint cannot be walked as an enumeration oracle.

Login nuances worth knowing:
- Owner login is **phone + password**, with an `accountType` ('owner'/'staff') guard rail
  checked only *after* the password verifies (so it can't leak which numbers are owners).
- `findLoginByPhone` tolerates a missing country code on either side, because two historical
  writers stored bare national numbers. A match must be **unique** or it is treated as no match.
- Refresh **rotates**: it re-reads role/seat/super-owner from the DB, so a permission change
  takes effect within one access-token lifetime.
- Admin OTP sign-in (`/admin/auth/verify-otp`) is a **stub that accepts a hardcoded constant**.
  It is hard-refused unless `OTP_ENABLED=true` (default false everywhere, including production).
  **Do not enable it** until real OTP verification is implemented — it is a full auth bypass.

### Web session cookies

`owner-web`: **two** httpOnly cookies, `tt_owner_at` (15m) + `tt_owner_rt` (30d).
`admin-panel`: **one** cookie (admin tokens never refresh).
`src/proxy.ts` (Next 16's renamed middleware, Edge runtime) gates on the **refresh** cookie and
performs token rotation there, because Server Components cannot write cookies. Its matcher
excludes static assets specifically so a page load refreshes **once** (the backend revokes the
old session on rotation, so a double refresh would break the other in-flight request).
`session-cookie.ts` is split out from `session.ts` so the Edge proxy never pulls in `node:crypto`.
Mutation routes additionally call `assertSameOrigin` (`Sec-Fetch-Site` / `Origin`) — `sameSite:
lax` alone is thin protection for a subdomain hosting destructive actions.

---

## 7. Important business logic

**`backend/src/lib/queue-engine.ts`** is the heart of the product — pure functions, ported from
the mobile app, that power the owner queue board, the microsite wait times, and customer tickets
from **one** implementation. Mirrored in `backend/tests/unit/queue-engine.test.ts`.

- `estMins` — service duration by exact-match then **longest-prefix** on `service_name` (which
  may carry add-ons, e.g. `"Haircut + Shave"`), falling back to `DEFAULT_SERVICE_MINUTES` (20),
  plus `extra_minutes`.
- `remainingMins` — a `waiting` item contributes its full estimate; an `in_service` item **decays
  with wall-clock** (`estimate − elapsed`, floored at 0). Only the in-service head decays.
- `seatLoad` / `soonestSeat` — "Any seat" auto-assignment picks the lightest load.
- `buildSeatGroups` — one group per seat with running ETA labels. Two important edge cases:
  a business with **zero staff** (Hospital/Restaurant) gets one flat `Waiting` group, and
  seatless active tickets (staff deleted → `ON DELETE SET NULL`) land in an `Any` group rather
  than vanishing from every lane while still inflating counts.
- `ticketPosition` — "ahead of you" + est. wait for the customer ticket.

**Checkout** (`queue_checkout`) writes a `visit` row, bumps `customer.visits_count` /
`total_spend_paise` / `last_visit_at`, and **auto-promotes** the next waiting entry on that seat.
`p_amount_paise` is an **override** (0020): pass null and the derived service + add-ons total is
used. `no_show` deliberately does **not** auto-promote.

**ETA-15 alert** (`lib/eta-notify.ts` + `queue.service.ts` `processTicketBroadcasts`) — one-shot
per ticket, for **online live-queue joins only** (not walk-ins, not checked-in appointments),
when `0 < waitMinutes <= ETA_NOTIFY_MINUTES`. Idempotency via a **conditional claim** on
`notified_eta_15_at` (only one concurrent caller wins). `notified_turn_at` does the same for
"it's your turn". A walk-in bumping the ETA back up never re-sends.

**Plan gating** — free plan truncates the customer list to `FREE_PLAN_CUSTOMER_LIMIT` (2) and
returns `meta.lockedCount`. The **server** truncates; client blur is cosmetic only. Reads use
`getLivePlan()` (a DB lookup) rather than the token's `plan` claim, so an upgrade applies
immediately without waiting for a refresh.

**Category behaviour** (`config/constants.ts`) — `OPTIONAL_SERVICES_STAFF_CATEGORIES`
(Hospital, Restaurant) allow zero services/staff; `VISITOR_TYPE_CATEGORIES` (Hospital) require
identifying the visitor as `mr` | `patient` (display-only, never part of wait-time math).

**Theme engine** (`frontend/src/theme/engine/`) — pure TS (no React/DOM/node), generates the
per-store microsite theme from `business.theme` jsonb: 6 presets × light/dark, OKLCH colour
ramps, WCAG contrast checks, radius/shadow/density/animation/hero/typography axes. Owners edit
it in the Appearance panel with a live `?preview=1` iframe of the microsite (gated by
`NEXT_PUBLIC_ADMIN_ORIGIN` / `NEXT_PUBLIC_OWNER_ORIGIN`).

---

## 8. External services

| Concern | Provider | State |
|---|---|---|
| Object storage | **Railway Buckets** (S3-compatible) via AWS SDK v3 | **Live** |
| WhatsApp / alerts | **Twilio SMS** as a temporary stand-in behind `WHATSAPP_ENABLED` | Wired, flag-gated |
| SMS | MSG91/Twilio | **Deferred no-op** (`SMS_ENABLED=false`) |
| Email | SES/Postmark | **Deferred no-op** (`EMAIL_ENABLED=false`) |
| Payments | Razorpay/Stripe | **Deferred** — `upgrade()` flips the plan directly when `PAYMENTS_ENABLED=false` |
| OTP | — | **Deferred stub** (`OTP_ENABLED=false`) |

Every integration is a **seam**: an interface plus a flag-gated implementation that logs and
returns `{ id: null }` when disabled. Wire a provider behind the existing interface rather than
calling it from a service.

**Image storage flow** — the bucket is **private** (Railway has no public-object mode):
1. Client asks `POST /uploads/sign` (or `/admin/uploads/sign`) for a short-lived signed **PUT**.
2. Client PUTs the bytes straight to the bucket (max 5 MB; jpeg/png/webp only).
3. The **stable** URL persisted in the DB is `{APP_BASE_URL}/media/{fileKey}`.
4. `GET /media/*` 302-redirects to a freshly signed GET, so bytes stream from the bucket (free
   egress) and the stored URL never expires.

> `APP_BASE_URL` is baked into every stored `/media/...` URL. **Changing the API domain later
> means rewriting those stored URLs.**

---

## 9. Deployment

**Railway**, one project, two environments (`production`, `preprod`), each with its own Postgres
plugin and Bucket. Full runbook: [DEPLOY.md](DEPLOY.md).

| Service | Folder | Production | Preprod |
|---|---|---|---|
| `tejotime-api` | `backend/` | `api.tejotime.com` | `api-preprod.tejotime.com` |
| `tejotime-web` | `frontend/` | `www.tejotime.com` | `preprod.tejotime.com` |
| `tejotime-admin` | `admin-panel/` | `admin.tejotime.com` | `admin-preprod.tejotime.com` |
| `tejotime-owner` | `owner-web/` | `business.tejotime.com` | `business-preprod.tejotime.com` |

- Branch `main` → production, `preprod` → preprod, via **Railway GitHub auto-deploy** (not
  GitHub Actions). Only Root Directory + env vars are set in the dashboard; the rest is
  config-as-code in each app's `railway.toml` (`builder = "DOCKERFILE"`).
- Multi-stage Dockerfiles; the Next apps use `output: "standalone"`.
- **`numReplicas` must stay 1 for the backend.** The Socket.IO adapter, the `express-rate-limit`
  store, and the `node-cron` scheduler are all **in-process** — a second replica would split
  realtime rooms and run every cron sweep twice.
- Healthcheck is `/healthz` (**liveness only, never touches the DB**) so a first deploy can't
  deadlock waiting on an unmigrated schema. `/readyz` is the DB check.
- **Migrations are manual and must run BEFORE promoting a new image** — nothing runs them
  automatically. A backend ahead of its schema fails *writes*, not just reads.
  `cd backend && DATABASE_URL="<public-proxy-url>" npm run migrate`
- **Never run `npm run seed` against a database with real data** — it deletes and recreates the
  `sharp-cuts` tenant.
- `NEXT_PUBLIC_*` are **baked in at build time** — after changing one you must **redeploy**, not
  restart. They are declared as `ARG`s in the Dockerfiles because Railway does not pass service
  variables into `docker build`.
- The Expo app is **not** deployed here; it is built with EAS (`app/eas.json`,
  `npm run build:preprod` / `build:prod`) and points at the live API.

**CI** — `.github/workflows/ci.yml`, **pull requests only, no deploys**. `dorny/paths-filter`
gates four jobs: `frontend`/`admin` run `npm ci && lint && build`, `mobile` runs `tsc --noEmit`,
`backend` runs `npm ci && npm test --if-present`.

---

## 10. Configuration & environment variables

`backend/src/config/env.ts` validates the whole environment with **zod at boot and exits(1) on
failure** — this is the authoritative catalog, not the docs. Committed crib sheets:
`{backend,frontend,admin-panel,owner-web,app}/.env.{example,local.example,preprod.example,prod.example}`.
Real `.env*` files are gitignored; **secrets live only in the Railway dashboard**.

Required (no default): `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_BUCKET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_TOKEN_SECRET`,
`TICKET_URL_HMAC_SECRET` (secrets are `min(16)`).

Tunables: `JWT_ACCESS_TTL` 900, `JWT_REFRESH_TTL` 2592000, `JWT_ADMIN_TTL` 43200,
`FREE_PLAN_CUSTOMER_LIMIT` 2, `ETA_NOTIFY_MINUTES` 15, `TICKET_ABANDON_HOURS` 4,
`BOOKING_SLOT_MINUTES` 30, `DATABASE_POOL_MAX` 10, `S3_UPLOAD_URL_TTL` 600,
`S3_DOWNLOAD_URL_TTL` 3600, `CORS_ALLOWED_ORIGINS` (comma-separated; empty ⇒ allow all).

Feature flags (all default **false**): `OTP_ENABLED`, `PAYMENTS_ENABLED`, `SMS_ENABLED`,
`EMAIL_ENABLED`, `WHATSAPP_ENABLED`.

Client vars: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_ASSET_PREFIX`,
`NEXT_PUBLIC_ADMIN_ORIGIN`, `NEXT_PUBLIC_OWNER_ORIGIN`, `NEXT_PUBLIC_FRONTEND_URL` (frontend/
admin/owner) and `EXPO_PUBLIC_API_BASE_URL` / `_SOCKET_URL` / `_WEB_URL` (mobile).
`BACKEND_API_BASE_URL` (owner-web, admin-panel) is **server-side only, never `NEXT_PUBLIC_`**.
Keep `PUBLIC_WEB_URL`, `NEXT_PUBLIC_FRONTEND_URL`, and `EXPO_PUBLIC_WEB_URL` on the same origin —
they generate QR/booking links.

---

## 11. Cross-app code duplication (read before editing shared-looking code)

Because each app is built from its own folder, three modules are **deliberately duplicated** and
kept honest by generator scripts. **Never hand-edit a mirror.**

| Module | Source of truth | Mirrors | Commands |
|---|---|---|---|
| Theme engine | `frontend/src/theme/engine/` | `admin-panel`, `owner-web`, `app` | `npm run sync:theme` / `check:theme` |
| Image cropper | `admin-panel/src/components/image-crop/` | `owner-web` | `npm run sync:crop` / `check:crop` |

Plus `npm run check:axes` — every editable theme axis must appear in **every** file that
hand-lists them (including each Appearance panel's `key()` dirty-check; an axis missing there is
silently **unsaveable**, with no error).
And `npm run test:theme` — the framework-free theme engine self-check (parity, contrast, ramps,
CSS tokens, input repair), run via the `tsx` the backend already depends on.

> These three checks are **not wired into CI**. Run them manually after touching the theme
> engine, the cropper, or a theme axis.

Also duplicated by hand, with **no** generator: `lib/countries.ts`, `lib/phone.ts`,
`lib/format.ts`, `lib/support.ts`, `lib/frontend-url.ts`, `PhoneField`, and the `i18n` module
across the web apps.

---

## 12. Testing & the mandatory E2E policy

### 12.1 What exists today

- `backend/tests/unit/` — **5 vitest files (~565 lines)**, run with `npm test` in `backend/`
  (`vitest run`; there is **no `vitest.config.*`** — it runs on defaults).
  Four cover **pure functions** (`queue-engine`, `eta-notify`, `ttl-cache`, `whatsapp`).
  The fifth, `whatsapp-webhook.test.ts`, is different and is **the pattern to copy**: it mounts a
  real router into a throwaway `express()` app and drives it with **`supertest`**, using
  `vi.resetModules()` + a stubbed `process.env` so the zod env validator boots. It needs **no
  database and no running server**.
- `frontend/src/theme/engine/__tests__/run.ts` — framework-free theme self-check
  (`npm run test:theme` from the root).
- `backend/scripts/smoke-rest.mjs` and `smoke-socket.mjs` — plain-Node scripts that hit a
  **running server + seeded database** over real HTTP and real Socket.IO. These are the only
  true end-to-end coverage in the repo.
- `docs/qa-report-2026-07-10.md` — a manual QA record.

**There is no E2E framework.** No Playwright, Cypress, Detox, Maestro, Puppeteer, WebdriverIO,
or Selenium appears in any of the six `package.json` files. No browser is ever launched, so
**none of the four UI apps has any automated test at all** — `frontend`, `admin-panel`,
`owner-web`, and `app` have zero test files and zero test dependencies. CI runs `lint`+`build`
for the web apps and `tsc --noEmit` for mobile; only `backend` runs a test command.

> ⚠️ **The smoke scripts are currently stale and fail immediately.** Both post
> `{ handle: 'sharpcuts', password: 'password123' }` to `/auth/login`, but `loginSchema`
> (`backend/src/modules/auth/auth.schemas.ts`) is `.strict()` and requires **`phone`**. The
> unknown `handle` key plus the missing `phone` produce a **400 VALIDATION_ERROR**, so the first
> assertion fails and every later one cascades. The seed prints the real credential:
> **phone `919399385943` / password `password123`**. The root `README.md` repeats the same stale
> `sharpcuts` credential. Fix the login payload before trusting either script.

### 12.2 Mandatory policy

E2E testing is **mandatory**, not optional. The following rules apply to all work in this repo:

1. **Every new feature requires appropriate E2E tests.** A feature is not complete until an E2E
   test exercises it through a real end-to-end flow.
2. **Every bug fix must include a regression E2E test** whenever the bug is reachable through an
   end-to-end flow. Write the test so it **fails against the unfixed code first**, then fix.
   If the bug is genuinely not E2E-testable (a pure-function edge case, a build-time concern),
   add a unit test instead and **say explicitly why** an E2E test was not appropriate.
3. **Tests must actually be executed.** Writing a test is not running it.
4. **Never claim tests pass unless they were run.** Report the real command, the real output, and
   the real pass/fail counts. If tests could not be run — no database, no running server, missing
   env — **say so plainly and say which tests were therefore not verified.** A test that was not
   executed is an unverified test, and reporting it as passing is a factual error.
5. **Reuse the existing framework and conventions.** Backend tests are **vitest + supertest**;
   the end-to-end layer is the **plain-Node scripts in `backend/scripts/`**. Extend those.
6. **Do not introduce unnecessary testing infrastructure.** Do not add Playwright, Cypress, Jest,
   a second runner, a container harness, or a fixture library without an explicit request. The
   constraint that makes this repo work — each app builds from its own folder, so nothing at the
   repo root is in a build context (§1) — applies to test tooling too.

### 12.3 E2E strategy

Two tiers, because they have very different costs:

**Tier 1 — API/socket E2E (`backend/scripts/*.mjs`). This is the default tier; put most tests here.**
It already exercises the genuinely risky parts of this system — the plpgsql queue functions,
advisory locking, auto-promotion, permission guards, tenant scoping, plan gating, and realtime
broadcasts — against a real database over real HTTP. It needs no browser and no new dependency.
Extend the existing `ok()` / `call()` helpers rather than replacing them; keep each script
`process.exit(fail ? 1 : 0)` so it is CI-usable.

**Tier 2 — browser E2E.** Genuinely absent, and the honest gap. It matters most for the two BFF
apps, whose whole security model (httpOnly cookies, Edge-proxy token rotation, `assertSameOrigin`)
is invisible to an API-level test. **Do not add a browser runner speculatively** — propose it,
get agreement, and add exactly one (Playwright is the natural fit for three Next apps), scoped to
`owner-web` first.

**Coverage gaps, roughly in priority order:**

| Area | Risk | Tier |
|---|---|---|
| Permission guards: staff login confined to its own chair (`requireOwnRow`, `scopeStaffId`) | **Critical** — the guard comments say this is what stops a staff login reading the whole customer book | 1 |
| Cross-tenant isolation: business A's token must never read business B | **Critical** — no RLS; enforced only in the service layer | 1 |
| Admin employee scoping (`created_by_admin_id`, 404-not-403 denial) | **Critical** | 1 |
| Auth lifecycle: refresh rotation, old-token revocation, deactivated user | High | 1 |
| Owner-web/admin-panel BFF: cookie gating, proxy refresh, CSRF rejection | High | 2 |
| Booking/appointment flow, slots, check-in | High | 1 |
| ETA-15 one-shot alert + `notified_*` idempotent claim | Medium | 1 |
| Theme/appearance save → microsite render | Medium | 2 |
| Image upload sign → PUT → `/media/*` redirect | Medium | 1 |
| Mobile app flows | Medium | — (out of scope; no Detox) |

**Conventions for new E2E tests:** name what the flow proves, not the endpoint; assert on
observable behaviour (tokens, positions, promoted names, emitted events), not response shape
alone; and always include the **negative** case next to the positive one — the existing scripts
already do this well (`wrong password → 401`, `owner socket rejects bad token`).

### 12.4 Environment, auth, fixtures, cleanup

- **Environment.** Tier 1 needs a running API on `localhost:8080` and a migrated, seeded
  Postgres. There is **no separate test database and no test-specific config** — the scripts hard-
  code `http://localhost:8080/api/v1`. Point `DATABASE_URL` at a throwaway database; **never run
  the seed against real data** (§9).
- **Auth.** `POST /auth/login` with the seeded owner's **phone + password**, then pass the
  returned `accessToken` as `Authorization: Bearer`. Sockets authenticate differently: `/owner`
  takes the same JWT in `handshake.auth.token`; `/customer` takes `{ businessId, ticketId,
  ticketKey }`, and the join response hands back exactly that under `socket`.
- **Fixtures.** `backend/db/seed.ts` is the **only** fixture factory — there are no per-test
  factories. It builds the `sharp-cuts` tenant: 1 owner, 3 staff (John/Lisa/Mike), 4 services,
  4 customers, 5 queue entries, 4 appointments, and pins `token_counter` so tokens continue at
  `A-6`. Tests depend on those exact names, so **changing the seed breaks the smoke scripts.**
- **Cleanup.** There is **none**. The seed is idempotent only at tenant granularity — it
  `delete from business where slug = 'sharp-cuts'` and rebuilds, relying on `on delete cascade`.
  The smoke scripts leave every row they create behind and **mutate shared state** (they upgrade
  the tenant to premium and never downgrade), so **runs are not independent** — re-run the seed
  between runs. Prefer per-test unique data (phone numbers, names) over cleanup logic.

---

## 13. Error handling

- Throw `AppError` via the `Errors` factory (`domain/errors.ts`): `validation` 400,
  `unauthenticated`/`invalidCredentials`/`tokenExpired` 401, `planLimit` **402**, `forbidden` 403,
  `notFound` 404, `conflict` 409, `gone` 410, `invalidState` 422, `rateLimited` 429,
  `internal` 500.
- `middleware/error-handler.ts` is the single serializer. It also translates **`ZodError`** →
  400 with per-field `details`, and **`TEJO:<CODE>`** plpgsql errors → their HTTP mapping.
- In production, 500 messages are replaced with a generic `"Internal error"`; the real message is
  logged, never returned.
- Wrap async handlers in `asyncHandler` (`http/async-handler.ts`) so rejections reach the handler.
- `notFoundHandler` returns the same envelope for unmatched routes.
- BFF side: `unreachable(e)` → uniform **502** when the API itself is down; `assertSameOrigin` →
  403; cached reads in `server-api.ts` return `null` on failure so a page **degrades rather than
  crashes**, and rethrow `UNAUTHORIZED` on 401 so callers redirect to `/login`.
- `pool.on('error')` has a listener: without one, an error on an *idle* PG client kills the
  process.

---

## 14. Logging & rate limiting

`config/logger.ts` — `pino`, level from `LOG_LEVEL`, `pino-http` attaches a `requestId` (from
`middleware/request-id.ts`) to every line, and the same id is returned in every error envelope.

**PII is redacted globally**: `authorization`/`cookie` headers, and `*.password`,
`*.passwordHash`, `*.password_hash`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.code`,
`*.otp`, `*.phone`, `*.customerPhone`, `*.customer_phone` → `[redacted]`. Keep new fields
consistent with these names so they are covered automatically. `pino-pretty` is dev-only and
guarded with `require.resolve` so a production runtime without it degrades to JSON, not a crash.

`middleware/rate-limit.ts` — **in-memory** (single instance only), all returning the standard
error envelope: `global` 600/min, `ownerRead` 300/min and `ownerWrite` 120/min (keyed per user),
`publicRead` 60/min, `publicWrite` 20/hr, `inquiries` 8/hr, `otp` 5/hr, and a layered login pair —
`login` 10 per 5min keyed on **(IP, phone)** so colleagues on one Wi-Fi don't lock each other
out, behind `loginIp` 60 per 5min so rotating the phone number isn't a bypass.

---

## 15. Local development

```bash
# 1. API — must be running first
cd backend && npm install && npm run migrate && npm run seed && npm run dev   # :8080

# 2. Customer microsite / marketing
cd frontend && npm install && npm run dev                                     # :3000

# 3. Platform admin panel
cd admin-panel && npm install && npm run dev                                  # :3001

# 4. Owner portal
cd owner-web && npm install && npm run dev                                    # :3002

# 5. Owner mobile app
cd app && npm install && npm start        # npm run android does `adb reverse` first
```

Demo owner login: `sharpcuts` / `password123`. Demo tenant slug: `sharp-cuts`.
Android emulator reaches the host via `adb reverse` (`npm run android:reverse` at the root);
a physical device needs the machine's LAN IP in `EXPO_PUBLIC_*`.

---

## 16. Conventions

- **Comments explain *why*, not *what*.** This codebase's comments are unusually load-bearing —
  migrations and guards document the failure that motivated them. Match that style; when you fix
  a subtle bug, record the reasoning where the next reader will hit it.
- Thin routes, fat services. Business rules go in `*.service.ts`, never in a route handler.
- Validate every request part with zod via `validate({ body, query, params })`.
- Never take `business_id` from client input.
- Money in paise, everywhere, all the way to the client DTO (`{ amount, currency }`).
- Backend uses **single quotes**; the Next web apps use **double quotes** (per-app ESLint).
- `owner-web`/`admin-panel` DTO interfaces in `lib/server-api.ts` are **hand-mirrored** from the
  backend DTOs with **no compiler between them** — `call<T>` casts parsed JSON straight to `T`,
  so a drifted interface type-checks perfectly and renders `undefined` at runtime. This has
  already shipped a bug. **Change both sides together.**
- **Every feature ships with an E2E test; every E2E-testable bug fix ships with a regression
  test. Run them, and never report a test as passing unless it was executed.** See §12.
- User-facing strings belong in `src/i18n/en.json` (`t.group.key`, `format()`, `plural()`).
  Migration from inline strings is **in progress** — move strings as you touch a file.

---

## 17. Known technical debt

**Deployment / infra**
- `owner-web/` has **no `Dockerfile` and no `railway.toml`**, though `DEPLOY.md` lists a
  `tejotime-owner` service at `business.tejotime.com`. It is the only app service without
  config-as-code, and it has **no CI job** either.
- Backend is **pinned to a single replica** — Socket.IO adapter, rate-limit store, and cron are
  all in-process. Horizontal scaling needs a Redis Socket.IO adapter, a Redis rate-limit store,
  and moving cron to a dedicated worker (the Dockerfile comment sketches this).
- Migrations are **manual and unversioned in deploy** — nothing enforces schema-before-image.
- CI does not run `check:theme`, `check:crop`, `check:axes`, or `test:theme`, so the four theme
  mirrors can silently drift. The `backend` CI job still carries a "skip until backend is
  initialized" guard from before the backend existed.

**Testing / E2E**
- **The smoke scripts are broken.** `smoke-rest.mjs` and `smoke-socket.mjs` both log in with
  `handle`, but `loginSchema` is `.strict()` and requires `phone` — every run 400s on the first
  call. The root `README.md` documents the same stale `sharpcuts` credential. Fixing these is
  the single highest-value testing task in the repo.
- **No E2E framework and no browser test of any kind.** All four UI apps have zero automated
  tests; the BFF security model (httpOnly cookies, Edge proxy token rotation, `assertSameOrigin`)
  is entirely unverified.
- The smoke scripts are **not wired into CI**, need a running server plus a seeded DB, have **no
  cleanup**, and **mutate shared state** (they upgrade the tenant to premium and never revert),
  so consecutive runs are not independent.
- No test database separation — the base URL is hardcoded to `localhost:8080` and the only
  fixture factory is the tenant-wide `db/seed.ts`.

**Correctness / security**
- `verifyAdminOtp` mints a full 12h admin JWT against a **hardcoded constant**. Flag-gated off,
  but it is a complete auth bypass if `OTP_ENABLED` is ever turned on before it is implemented.
- Admin tokens are signed with `JWT_ACCESS_SECRET` — the same secret as owner tokens. Only the
  `typ` claim separates them; a separate secret would be safer.
- Owner refresh tokens are stored as `sha256(jti)` with **no per-device metadata used** —
  `auth_session.user_agent`/`ip` columns exist but are never written, so there is no session list
  or targeted revoke.
- No `idempotency_key` middleware despite the table existing — public writes (join queue, book
  slot) are not idempotent.
- `audit_log` exists but nothing writes to it.
- `otp_verification`, `payment`, and the payments/SMS webhook handlers are scaffolding only.
- Staff `/owner` sockets join a seat room that **nothing emits to** — staff clients silently fall
  back to polling for live queue updates.

**Structure**
- Six-plus utility modules duplicated across the web apps by hand with **no sync guard** (only
  theme and image-crop have one).
- `docs/00`–`18` describe a stack that was never built (Prisma/Redis/BullMQ) — actively
  misleading if read as documentation of the current system.
- i18n migration is partial; most strings are still inline.
- `frontend` uses Tailwind v4 while `admin-panel`/`owner-web` use hand-written CSS variables —
  three web apps, two styling systems.
- Duplicate migration number `0016` (`0016_business_theme_color.sql` and
  `0016_fix_queue_add_overload.sql`) — ordering relies on filename sort.
