# Deployment

Railway, one project, two environments. **[`DEPLOY.md`](../../DEPLOY.md) at the repo root is the
authoritative runbook** — this document is the operational summary plus the traps that have
actually bitten.

---

## 1. Services

| Service | Folder | Production | Preprod |
|---|---|---|---|
| `tejotime-api` | `backend/` | `api.tejotime.com` | `api-preprod.tejotime.com` |
| `tejotime-web` | `frontend/` | `www.tejotime.com` | `preprod.tejotime.com` |
| `tejotime-admin` | `admin-panel/` | `admin.tejotime.com` | `admin-preprod.tejotime.com` |
| `tejotime-owner` | `owner-web/` | `business.tejotime.com` | `business-preprod.tejotime.com` |

Each environment has its **own** Postgres plugin and its **own** Bucket.

The Expo app is **not** deployed here — it is built with EAS (`app/eas.json`,
`npm run build:preprod` / `build:prod`) and points at the live API.

### Release flow

Branch `main` → production, `preprod` → preprod, via **Railway GitHub auto-deploy**. GitHub
Actions runs CI on pull requests only and never deploys. Only Root Directory and env vars are set
in the dashboard; everything else is config-as-code in each app's `railway.toml`
(`builder = "DOCKERFILE"`). Multi-stage Dockerfiles; the Next apps use `output: "standalone"`.

> **`owner-web/` has no `Dockerfile` and no `railway.toml`** even though `DEPLOY.md` lists a
> `tejotime-owner` service. It is the only app service without config-as-code, and it has no CI
> job either. Verified: `backend`, `frontend`, `admin-panel` each have both files; `owner-web` has
> neither.

---

## 2. Migrations — the most dangerous step

**Migrations are manual and must run BEFORE the new image is promoted.** Nothing runs them
automatically, and nothing enforces schema-before-image ordering.

```bash
cd backend
DATABASE_URL="<railway public proxy url>" npm run migrate
```

`db/migrate.ts` applies `db/migrations/*.sql` in filename order, each in its own transaction,
recording them in `schema_migrations`. It is idempotent — already-applied files are skipped.

Two failure modes:

- **Backend ahead of schema** — fails *writes*, not just reads, and often not on the first
  request. Always migrate first.
- **`npm run seed` against real data** — it **deletes and recreates** the `sharp-cuts` tenant.
  Never run it against production or any database with real tenants.

Deploy-order note from `docs/18`: migrations `0016_business_theme_color.sql` and
`0017_business_theme.sql` had to be applied before the backend image went live, because the admin
started sending `theme` on every save.

---

## 3. Health checks

| Path | Purpose |
|---|---|
| `/healthz` | **liveness only — never touches the database** |
| `/readyz` | database readiness |

Railway's healthcheck is `/healthz` (`healthcheckTimeout = 60`) specifically so a first deploy
against an unmigrated schema cannot deadlock waiting on its own health probe.

---

## 4. The single-replica constraint

`backend/railway.toml` pins `numReplicas = 1`. **Do not raise it.**

The Socket.IO adapter, the `express-rate-limit` store, and the `node-cron` scheduler are all
in-process. A second replica would:

- split realtime rooms across instances (owners stop seeing live queue updates),
- halve the effective rate limits,
- run **every cron sweep twice**.

Horizontal scaling requires a Redis Socket.IO adapter, a Redis rate-limit store, and moving cron to
a dedicated worker. The backend `Dockerfile` comment sketches this.

---

## 5. Environment variables

`backend/src/config/env.ts` validates the whole environment with **zod at boot and `exit(1)` on
failure**. It — not the docs — is the authoritative catalog.

Committed crib sheets (real `.env*` files are gitignored; **secrets live only in the Railway
dashboard**):

```
{backend,frontend,admin-panel,owner-web,app}/.env.{example,local.example,preprod.example,prod.example}
```

**Required, no default:** `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`CUSTOMER_TOKEN_SECRET`, `TICKET_URL_HMAC_SECRET`. Secrets are `min(16)`.

**Tunables:** `JWT_ACCESS_TTL` 900 · `JWT_REFRESH_TTL` 2592000 · `JWT_ADMIN_TTL` 43200 ·
`FREE_PLAN_CUSTOMER_LIMIT` 2 · `ETA_NOTIFY_MINUTES` 15 · `TICKET_ABANDON_HOURS` 4 ·
`BOOKING_SLOT_MINUTES` 30 · `DATABASE_POOL_MAX` 10 · `S3_UPLOAD_URL_TTL` 600 ·
`S3_DOWNLOAD_URL_TTL` 3600 · `CORS_ALLOWED_ORIGINS` (comma-separated; **empty ⇒ allow all**).

**Feature flags, all default `false`:** `OTP_ENABLED`, `PAYMENTS_ENABLED`, `SMS_ENABLED`,
`EMAIL_ENABLED`, `WHATSAPP_ENABLED`.

### Client vars and the build-time trap

`NEXT_PUBLIC_*` are **baked in at build time**. After changing one you must **redeploy, not
restart**. They are declared as `ARG`s in the Dockerfiles because Railway does not pass service
variables into `docker build`.

`BACKEND_API_BASE_URL` (owner-web, admin-panel) is **server-side only — never `NEXT_PUBLIC_`**.
Making it public would defeat the entire BFF design.

Keep `PUBLIC_WEB_URL`, `NEXT_PUBLIC_FRONTEND_URL` and `EXPO_PUBLIC_WEB_URL` on the **same origin** —
they generate QR and booking links that end up printed on physical signage.

`APP_BASE_URL` is baked into every stored `/media/...` URL in the database. **Changing the API
domain later means rewriting those stored URLs.**

---

## 6. Preprod data isolation (required)

Store enable/disable writes `business.is_active`. If preprod and production share one database — or
preprod admin points at the production API — toggling a store on preprod changes production.

1. Each Railway environment must have its **own** Postgres plugin. Compare the production and
   preprod backend `DATABASE_URL` hosts; they must differ.
2. Preprod admin `BACKEND_API_BASE_URL` must be `https://api-preprod.tejotime.com/api/v1` —
   never `api.tejotime.com`.
3. After splitting databases, re-enable any production store accidentally disabled while they were
   shared.

---

## 7. CI

`.github/workflows/ci.yml`, **pull requests only, no deploys**. `dorny/paths-filter` gates four
jobs:

| Job | Runs |
|---|---|
| `frontend` | `npm ci && npm run lint && npm run build` |
| `admin` | `npm ci && npm run lint && npm run build` |
| `mobile` | `npm ci && npx tsc --noEmit` |
| `backend` | `npm ci && npm test --if-present` |

Gaps to know about:

- **No `owner-web` job.** Verify it by hand: `cd owner-web && npm run lint && npm run build`.
- CI does **not** run `check:theme`, `check:crop`, `check:axes`, or `test:theme`, so the four theme
  mirrors can silently drift.
- The `backend` job still carries a "skip until backend is initialized" guard from before the
  backend existed.

---

## 8. Local development

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
cd app && npm install && npm start
```

Demo owner login `sharpcuts` / `password123`; demo tenant slug `sharp-cuts`.

**Never `npm install` at the repo root** — there are no workspaces, and each app keeps its own
lockfile and `node_modules`.

Android emulator reaches the host via `adb reverse` (`npm run android:reverse` from the root, or
`npm run android` in `app/` which does it first). A physical device needs the machine's LAN IP in
`EXPO_PUBLIC_*`.

Smoke tests against a running, seeded server: `backend/scripts/smoke-rest.mjs` and
`smoke-socket.mjs`.
