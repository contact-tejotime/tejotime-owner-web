# Architecture

Deep reference for system topology and code organisation. `CLAUDE.md` §1–§4 is the summary; this
is the detail behind it.

> **Authority:** the code is truth. `docs/00`–`docs/18` at the repo root are an *aspirational spec*
> written before implementation (they propose Prisma, Redis, BullMQ) — useful for vocabulary and
> the data model, misleading for the stack.

---

## 1. The five surfaces and who talks to whom

```
                          ┌──────────────────────────────┐
  anonymous customer ────►│ frontend  (Next 16, SSR)      │
                          │  /{phone} microsite           │
                          │  marketing + legal pages      │
                          └──────────────┬────────────────┘
                                         │ NEXT_PUBLIC_API_BASE_URL
                                         │ (browser → API directly)
                                         │ + socket.io  /customer
                                         ▼
  owner / staff ─────────►┌──────────────────────────────┐   ┌────────────────────────┐
                          │ owner-web (Next 16)  **BFF** │──►│ backend (Express 4)    │
                          │  httpOnly cookies + /api/*   │   │  /api/v1               │
                          └──────────────────────────────┘   │  Socket.IO  /owner     │
                                                             │  node-cron scheduler   │
  platform admin ────────►┌──────────────────────────────┐   └───────┬────────┬───────┘
                          │ admin-panel (Next 16) **BFF**│──►        │        │
                          └──────────────────────────────┘           ▼        ▼
                                                              PostgreSQL   S3 bucket
  owner (mobile) ────────►  app (Expo) — calls API directly   (plpgsql)    (private)
                            tokens in expo-secure-store
```

### Two client patterns — never mix them

| | `frontend`, `app` | `owner-web`, `admin-panel` |
|---|---|---|
| Who calls the API | the browser / device | the Next.js server only |
| Base URL var | `NEXT_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_API_BASE_URL` | `BACKEND_API_BASE_URL` (**never** `NEXT_PUBLIC_`) |
| Token storage | none (anonymous) / `expo-secure-store` | httpOnly cookies |
| Reads | client fetch or RSC fetch | Server Components via `lib/server-api.ts` |
| Writes | direct to API | same-origin `/api/*` route handler → API |

The BFF exists so the browser never holds a JWT. If you add an owner or admin feature, the data
path is: Server Component reads via `server-api.ts`; mutations POST to a local route handler that
attaches `Authorization: Bearer` server-side.

**`frontend` is the exception** and calls the public API directly, because microsite data is
anonymous and there is no token to protect.

---

## 2. Request lifecycle (backend)

`src/app.ts` composes the chain once, in this order:

```
helmet → cors → express.json({limit:'1mb'}) → requestId → pino-http → limiters.global
  → /             healthRouter      (unversioned, no auth)
  → /media/*      mediaRouter       (unversioned, no auth — URLs are persisted in the DB)
  → /api/v1/*     16 module routers
  → notFoundHandler → errorHandler
```

Per route, inside a module router:

```
authenticate → limiters.<bucket> → requirePermission(module, level)
  → validate({ body, query, params })    (zod)
  → [requireOwnRow(...)]                 (row-level, staff logins)
  → asyncHandler(handler)                (so rejections reach errorHandler)
```

Handlers stay thin — they unwrap `req.principal` and delegate. All business rules live in
`<name>.service.ts`.

### Why `/healthz` and `/media/*` sit outside the version prefix

- `/healthz` is **liveness only and never touches the database**, so a first deploy against an
  unmigrated schema cannot deadlock on its own healthcheck. `/readyz` is the DB probe.
- `/media/*` URLs are written into the database as `{APP_BASE_URL}/media/{fileKey}`. Version or
  auth on that path would invalidate every stored image URL.

---

## 3. Backend module layout

```
backend/src/
  app.ts            middleware chain + router mounting (above)
  server.ts         http server, initRealtime(), startScheduler(), SIGTERM/SIGINT shutdown
  config/
    env.ts          zod-validated environment, fail-fast exit(1) — the authoritative var catalog
    logger.ts       pino + global PII redaction
    constants.ts    API_PREFIX, DEFAULT_SERVICE_MINUTES, category behaviour sets
  db/
    pool.ts         the ONLY runtime data-access entry point: many/one/exec/transaction
    rpc.ts          callRpc(fn, namedArgs) — named-arg plpgsql invocation
    ssl.ts
  domain/
    enums.ts        mirrors the Postgres enum types exactly
    errors.ts       AppError + Errors factory (the whole HTTP error catalog)
    permissions.ts  MODULES, ROLE_DEFAULTS, effectiveAccess — single source of truth
    money.ts
  middleware/       authenticate, authorize, require-permission, validate, rate-limit,
                    request-id, error-handler
  modules/<name>/   <name>.routes.ts + <name>.service.ts (+ .schemas.ts)
  realtime/         io.ts (namespaces + handshake auth), emitters.ts
  jobs/scheduler.ts in-process node-cron
  lib/              queue-engine.ts (pure), eta-notify.ts, time, phone, format, ttl-cache
  integrations/     storage (S3), whatsapp (Twilio), sms, email — provider seams
  observability/    health.ts
```

**Module convention:** thin routes, fat services. A module is `routes` + `service`, plus
`schemas` when it takes input. Nothing outside `db/pool.ts` opens a connection.

**Integration seams:** every external provider is an interface plus a flag-gated implementation
that logs and returns `{ id: null }` when disabled. Wire a real provider *behind* the existing
interface — never call a vendor SDK from a service.

---

## 4. Realtime

Two Socket.IO namespaces, initialised in `realtime/io.ts`:

| Namespace | Auth | Rooms |
|---|---|---|
| `/owner` | access JWT in `handshake.auth.token` | `business:{id}` for owner/co_owner/manager; `business:{id}:seat:{staffId}` for staff |
| `/customer` | anonymous; ticket access via HMAC `ticketKey` | `public:{businessId}`, `ticket:{ticketId}` |

Events: `queue:snapshot`, `queue:entry.started`, `queue:entry.completed`, `availability:updated`,
`staff:availability`, `ticket:updated`, `ticket:ready`, `ticket:eta_15`, `subscription:updated`.

**All emits happen after the DB commit** — never inside the transaction.

A staff socket deliberately does *not* join the business room; that would leak the whole shop's
queue to a single chair. Seat-scoped emits are **not implemented**, so staff clients currently
fall back to polling. See `current-work.md`.

---

## 5. Why the backend is pinned to one replica

The Socket.IO adapter, the `express-rate-limit` store, and the `node-cron` scheduler are all
**in-process**. A second replica would split realtime rooms across instances, halve the effective
rate limits, and run every cron sweep twice. `numReplicas` must stay `1` until there is a Redis
Socket.IO adapter, a Redis rate-limit store, and cron moved to a dedicated worker.

---

## 6. Cross-app code duplication

Each app is Docker-built with `COPY . .` from **its own folder** (Railway Root Directory = the app
folder). A package at the repo root is therefore not in any build context: **anything an app
imports must physically live under that app's folder.**

Three modules are duplicated on purpose, with generator scripts that keep the copies byte-identical:

| Module | Source of truth | Mirrors | Guard |
|---|---|---|---|
| Theme engine | `frontend/src/theme/engine/` | `admin-panel`, `owner-web`, `app` | `npm run sync:theme` / `check:theme` |
| Image cropper | `admin-panel/src/components/image-crop/` | `owner-web` | `npm run sync:crop` / `check:crop` |

**Never hand-edit a mirror** — mirrored `index.ts` files carry a generated-file banner. Edit the
source and re-run the sync.

Also duplicated **by hand with no guard**: `lib/countries.ts`, `lib/phone.ts`, `lib/format.ts`,
`lib/support.ts`, `lib/frontend-url.ts`, `PhoneField`, and the whole `i18n` module. Changing one
means changing all of them manually.

`npm run check:axes` covers a related trap: three separate files hand-list the editable theme
axes, one of them being each Appearance panel's `key()` dirty-check. An axis missing from that
list is silently **unsaveable**, with no error anywhere.

> None of `check:theme`, `check:crop`, `check:axes`, `test:theme` run in CI. Run them by hand.

---

## 7. Frontend routing traps

**`frontend/src/app/[phone]/` is a root-level dynamic segment** and matches every single-segment
path. It self-guards with `/^\d{7,15}$/` and 404s on anything else. The microsite is keyed by the
business's full international phone number (digits only, no `+`), resolved to a slug used for all
follow-on queue/booking calls.

Consequence: a new top-level marketing route must exist as a real folder — `privacy/`, `terms/`,
`accessibility/`, `resources/`, `industries/` — or `[phone]` swallows it.

**Server/client boundary:** a plain function exported from a `"use client"` module cannot be called
by a Server Component; Next fails at prerender ("Attempted to call X() from the server but X is on
the client"). This has already broken the industry and resources page builds once, via `shell()`
exported from `MarketingChrome.tsx`. Shared style helpers live in their own non-client module
(`frontend/src/components/landing/shell.ts`).

`npx tsc --noEmit` does **not** catch this. Run `npm run build` when touching anything imported
across that boundary.

---

## 8. Styling and strings

- `frontend` uses **Tailwind v4** (`@tailwindcss/postcss`). `owner-web` and `admin-panel` use
  **hand-written CSS custom properties** in `globals.css`. Three web apps, two styling systems.
- Every app has `src/i18n/{en.json,index.ts}` exporting `t` (the plain parsed JSON), `format()`
  and `plural()`. `t` is a plain object with no provider, so it works identically in Server and
  Client Components, and a typo fails the build.
- User-facing strings belong in `en.json`. The migration away from inline strings is **partial** —
  move strings as you touch a file.
- Legal copy for `/privacy`, `/terms`, `/accessibility` lives entirely in
  `frontend/src/i18n/en.json` under `legal`/`privacy`/`terms`/`accessibility` and renders through
  `components/legal/LegalPage.tsx`. Company facts are `{token}` placeholders resolved from
  `t.legal`; an unfilled token renders as a visible amber marker rather than disappearing.
