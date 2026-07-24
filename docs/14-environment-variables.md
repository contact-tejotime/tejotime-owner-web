# 14 — Environment Variables

All configuration is injected via environment (12-factor). Never commit secrets. Provide a committed `.env.example` with non-secret defaults + placeholders. Validate on boot (fail fast if a required var is missing/invalid — Zod env schema).

## 1. Backend (`backend/.env`)

### Core
| Var | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `development`\|`staging`\|`production` |
| `PORT` | `8080` | API/socket HTTP port |
| `APP_BASE_URL` | `https://api.tejotime.com` | canonical API URL |
| `PUBLIC_WEB_URL` | `https://tejotime.com` | for booking links / QR (`tejotime.com/{slug}`) |
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
| `STORAGE_PROVIDER` | `s3` \| `r2` \| `supabase` |
| `S3_ENDPOINT` | `https://s3.ap-south-1.amazonaws.com` |
| `S3_REGION` | `ap-south-1` |
| `S3_BUCKET` | `tejotime-media` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — |
| `CDN_BASE_URL` | `https://cdn.tejotime.com` |
| `UPLOAD_MAX_BYTES` | `5242880` |

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
| `NEXT_PUBLIC_SITE_URL` | `https://tejotime.com` | canonical web URL |
| `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | — | public microsite anti-abuse |

> The current Next.js app has **no** env usage yet (confirmed by grep). These are introduced when the microsite is wired to the API.

## 3. Mobile — Expo (`app/`)

| Var | Example | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `https://api.tejotime.com/api/v1` | REST base |
| `EXPO_PUBLIC_SOCKET_URL` | `https://api.tejotime.com` | Socket.IO |
| `EXPO_PUBLIC_ENV` | `production` | |

Set via `app.json` → `extra` / EAS build profiles. The app currently ships no network config (all local state).

## 4. Handling rules

- **Required-on-boot:** `DATABASE_URL`, `REDIS_URL`, JWT secrets, `PUBLIC_WEB_URL`, storage creds, SMS creds (in prod). Validate & exit non-zero if absent.
- **Secrets** (`*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PEPPER`, `DATABASE_URL`) come from the secret manager, not `.env` files in prod.
- Keep a committed `backend/.env.example` documenting every var with safe placeholders.
