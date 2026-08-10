# 14 — Environment Variables

All configuration is injected via environment (12-factor). Never commit secrets. Validate on boot (fail fast if a required var is missing/invalid — Zod env schema).

## Per-env example files

Each app ships committed crib sheets (placeholders only). Copy `.env.local.example` → `.env.local` for laptop work. Use `.env.preprod.example` / `.env.prod.example` as the checklist when setting Railway variables for that environment. Next/Expo do **not** auto-load `.env.prod` / `.env.preprod` — Railway dashboard (or EAS profiles) is the runtime source for deployed builds.

| App | Files |
|---|---|
| Backend | `backend/.env.example` (full catalog), `.env.local.example`, `.env.preprod.example`, `.env.prod.example` |
| Frontend | `frontend/.env.local.example`, `.env.preprod.example`, `.env.prod.example` |
| Admin | `admin-panel/.env.local.example`, `.env.preprod.example`, `.env.prod.example` |
| Expo owner | `app/.env.local.example`, `.env.preprod.example`, `.env.prod.example` |

**Preprod vs production:** preprod must use a **separate** Postgres (`DATABASE_URL` host ≠ production). Preprod admin must call `api-preprod`, not `api.tejotime.com`. See [DEPLOY.md](../DEPLOY.md) § Isolate preprod data.

## 1. Backend (`backend/.env`)

### Core
| Var | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `development`\|`staging`\|`production` |
| `PORT` | `8080` | API/socket HTTP port |
| `APP_BASE_URL` | `https://api.tejotime.com` | canonical API URL |
| `PUBLIC_WEB_URL` | `https://www.tejotime.com` | customer web host; must match owner `EXPO_PUBLIC_WEB_URL` and admin `NEXT_PUBLIC_FRONTEND_URL`. QR encodes `{PUBLIC_WEB_URL}/{phone}/card` (book-or-save chooser); microsite is `{PUBLIC_WEB_URL}/{phone}` |
| `LOG_LEVEL` | `info` | pino level |
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | fallback tenant tz |
| `DEFAULT_CURRENCY` | `INR` | fallback tenant currency |

### Database
| Var | Example |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/tejotime?schema=public` |
| `DATABASE_POOL_URL` | `postgresql://...@pgbouncer:6432/tejotime` (pooled) |
| `DATABASE_MAX_CONNECTIONS` | `10` |

### Redis
| Var | Example |
|---|---|
| `REDIS_URL` | `rediss://:pass@host:6379` |
| `REDIS_TLS` | `true` |
| (optional split) `BULLMQ_REDIS_URL`, `SOCKET_REDIS_URL`, `RATELIMIT_REDIS_URL` | isolate workloads |

### Auth / security
| Var | Example | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_PRIVATE_KEY` | — | HS256 secret or RS256 key |
| `JWT_ACCESS_PUBLIC_KEY` | — | RS256 verify key |
| `JWT_ACCESS_TTL` | `900` | seconds (15 min) |
| `JWT_REFRESH_SECRET` | — | |
| `JWT_REFRESH_TTL` | `2592000` | 30 days |
| `JWT_KEY_ID` | `k1` | rotation `kid` |
| `PASSWORD_PEPPER` | — | peppers owner **and** admin password hashing (bcrypt). Admin login password is stored in the DB (`admins.password_hash`), not an env var. |
| `OTP_PEPPER` | — | OTP hashing |
| `OTP_TTL_SECONDS` | `300` | |
| `OTP_LENGTH` | `4` | matches `OTPInput` (default 4) |
| `OTP_MAX_ATTEMPTS` | `5` | |
| `TICKET_URL_HMAC_SECRET` | — | signed public ticket URLs |
| `CORS_ALLOWED_ORIGINS` | `https://tejotime.com,https://*.tejotime.com` | web origins |

### Plan / feature config
| Var | Example | Notes |
|---|---|---|
| `FREE_PLAN_CUSTOMER_LIMIT` | `2` | `FREE_LIMIT` in `Customers.tsx` (configurable) |
| `PREMIUM_PRICE_PAISE` | `49900` | subscription price (₹499) — **confirm** |
| `TRIAL_DAYS` | `14` | free-trial length — **confirm** |
| `TWO_AWAY_THRESHOLD` | `2` | "text when N away" |
| `TICKET_ABANDON_HOURS` | `4` | stale-ticket cleanup |
| `APPT_REMINDER_OFFSETS` | `120,30` | minutes before start |
| `APPT_NO_SHOW_GRACE_MIN` | `15` | auto no-show grace |

### Object storage
| Var | Example |
|---|---|
| `S3_ENDPOINT` | `https://t3.storageapi.dev` (Railway Buckets) |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `tejotime-media` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — |
| `S3_FORCE_PATH_STYLE` | `false` — `true` only for buckets that require path-style URLs |
| `S3_UPLOAD_URL_TTL` / `S3_DOWNLOAD_URL_TTL` | `600` / `3600` (seconds) |
| `UPLOAD_MAX_BYTES` | `5242880` |

The bucket is private, so there is no CDN/public base URL: stored image URLs point at
`{APP_BASE_URL}/media/{key}`, which redirects to a signed GET. See [10 — File Storage](./10-file-storage.md).

### SMS
| Var | Example | Notes |
|---|---|---|
| `SMS_PROVIDER` | `msg91` \| `twilio` | India-first |
| `MSG91_AUTH_KEY` / `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | — | |
| `SMS_SENDER_ID` | `TEJOTM` | DLT-registered sender |
| `SMS_DLT_TEMPLATE_TWO_AWAY` / `_YOUR_TURN` / `_REMINDER` / `_OTP` | — | TRAI template ids |
| `SMS_WEBHOOK_SECRET` | — | verify DLR callbacks |

### Email
| Var | Example |
|---|---|
| `EMAIL_PROVIDER` | `ses` \| `postmark` \| `sendgrid` |
| `EMAIL_FROM` | `no-reply@tejotime.com` |
| `SES_REGION` / `POSTMARK_TOKEN` / `SENDGRID_API_KEY` | — |

### Payments
| Var | Example |
|---|---|
| `PAYMENT_PROVIDER` | `razorpay` \| `stripe` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | — |
| `RAZORPAY_WEBHOOK_SECRET` | — |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | — |

### Observability
| Var | Example |
|---|---|
| `SENTRY_DSN` | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — |
| `METRICS_ENABLED` | `true` |

### Rate limiting (overridable)
| Var | Example |
|---|---|
| `RL_OTP_PER_HOUR` | `5` |
| `RL_PUBLIC_JOIN_PER_HOUR` | `10` |
| `RL_LOGIN_PER_5MIN` | `10` |
| `CAPTCHA_PROVIDER` / `CAPTCHA_SECRET` | `turnstile` / — |

## 2. Frontend — Next.js (`frontend/.env.local`)

| Var | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.tejotime.com/api/v1` | REST base |
| `NEXT_PUBLIC_SOCKET_URL` | `https://api.tejotime.com` | Socket.IO origin |
| `NEXT_PUBLIC_SITE_URL` | `https://www.tejotime.com` | canonical web URL |
| `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | — | public microsite anti-abuse |
| `NEXT_PUBLIC_ADMIN_ORIGIN` | `https://admin.tejotime.com` | origin allowed to postMessage theme configs into `?preview=1` from the admin panel. Must also be declared as a build ARG (it is, in `frontend/Dockerfile`). |
| `NEXT_PUBLIC_OWNER_ORIGIN` | `https://business.tejotime.com` | origin allowed to postMessage theme configs into `?preview=1` from owner-web Settings → Profile Appearance. Preprod: `https://business-preprod.tejotime.com`. Local next-dev also allows `localhost:3002` / `127.0.0.1:3002`. Must be a build ARG in `frontend/Dockerfile`. |

## 2b. Admin — Next.js (`admin-panel/`)

| Var | Example | Notes |
|---|---|---|
| `BACKEND_API_BASE_URL` | `https://api.tejotime.com/api/v1` | server-side API |
| `NEXT_PUBLIC_FRONTEND_URL` | `https://www.tejotime.com` | customer host for store links, booking QR, and Appearance live preview. Keep identical to API `PUBLIC_WEB_URL` in prod. Unset in local `next dev` → Appearance preview defaults to `http://localhost:3000` so postMessage can reach a local frontend (prod rejects `localhost:3001`) |

## 2c. Owner portal — Next.js (`owner-web/`)

| Var | Example | Notes |
|---|---|---|
| `BACKEND_API_BASE_URL` | `https://api.tejotime.com/api/v1` | server-side API (browser never sees this; calls go through `/api/*` proxies) |
| `NEXT_PUBLIC_FRONTEND_URL` | `https://www.tejotime.com` | customer host for Appearance live preview. Same alignment as admin. Unset in local `next dev` → defaults to `http://localhost:3000` |

## 3. Mobile — Expo (`app/`)

| Var | Example | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `https://api.tejotime.com/api/v1` | REST base |
| `EXPO_PUBLIC_SOCKET_URL` | `https://api.tejotime.com` | Socket.IO |
| `EXPO_PUBLIC_WEB_URL` | `https://www.tejotime.com` | customer host; owner Booking QR encodes `{EXPO_PUBLIC_WEB_URL}/{phone}/card`. Keep identical to API `PUBLIC_WEB_URL` |
| `EXPO_PUBLIC_ENV` | `production` | |

Set via `app.json` → `extra` / EAS build profiles.

## 4. Handling rules

- **Required-on-boot:** `DATABASE_URL`, `REDIS_URL`, JWT secrets, `PUBLIC_WEB_URL`, storage creds, SMS creds (in prod). Validate & exit non-zero if absent.
- **QR host alignment:** `PUBLIC_WEB_URL` (API), `EXPO_PUBLIC_WEB_URL` (owner app), and `NEXT_PUBLIC_FRONTEND_URL` (admin + owner-web) must be the same customer origin (`https://www.tejotime.com` in prod; `https://preprod.tejotime.com` in preprod). Mismatched hosts produce QRs that open the wrong site or 404.
- **Secrets** (`*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PEPPER`, `DATABASE_URL`) come from the secret manager / Railway dashboard, not committed `.env` files.
- Keep committed `*.example` files documenting every var with safe placeholders; never commit real `.env.local` / `.env.preprod` / `.env.prod`.
- **Data isolation:** preprod and production backends must not share `DATABASE_URL`. Store `is_active` is global to that database.
