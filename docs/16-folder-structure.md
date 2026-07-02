# 16 — Backend Folder Structure

Feature-oriented (modular monolith) layout for `backend/`, matching the repo's monorepo rule that each app owns its `package.json`/lockfile. Node 20 + Express + TypeScript + Prisma. Easy to split into services later; today it's one API + worker sharing code.

```
backend/
├── package.json                 # independent (per monorepo rule)
├── package-lock.json
├── tsconfig.json
├── .env.example                 # documents every var (see 14)
├── Dockerfile                   # multi-stage; API or worker via CMD
├── docker-compose.yml           # local: postgres, redis, minio, mailhog
├── openapi.yaml                 # generated from Zod (see 15)
├── README.md
│
├── prisma/
│   ├── schema.prisma            # data model (see 04)
│   ├── migrations/
│   └── seed.ts                  # seed from app/src/data/sample.ts (Sharp Cuts demo)
│
└── src/
    ├── server.ts                # Express + Socket.IO bootstrap (API process)
    ├── worker.ts                # BullMQ workers bootstrap (worker process)
    ├── app.ts                   # express app: middleware chain, route mount
    │
    ├── config/
    │   ├── env.ts               # Zod-validated env loader (fail fast)
    │   ├── constants.ts         # FREE_LIMIT, TWO_AWAY_THRESHOLD, add-on catalog, colors
    │   └── logger.ts            # pino instance + redaction
    │
    ├── db/
    │   ├── prisma.ts            # PrismaClient singleton
    │   └── repositories/        # tenant-scoped data access (every method takes businessId)
    │       ├── business.repo.ts
    │       ├── queue.repo.ts
    │       ├── appointment.repo.ts
    │       ├── customer.repo.ts
    │       ├── service.repo.ts
    │       ├── staff.repo.ts
    │       └── subscription.repo.ts
    │
    ├── middleware/
    │   ├── requestId.ts
    │   ├── authenticate.ts      # resolve principal (owner/customer/anon) from token
    │   ├── tenantContext.ts     # bind business_id from token (never from body)
    │   ├── authorize.ts         # role + capability guards (see 03)
    │   ├── planGuard.ts         # subscription limits (free CRM cap)
    │   ├── validate.ts          # Zod request validation
    │   ├── rateLimit.ts         # Redis limiter classes (see 12)
    │   ├── idempotency.ts       # Idempotency-Key handling
    │   └── errorHandler.ts      # error envelope (see 11)
    │
    ├── modules/                 # one folder per bounded context
    │   ├── auth/
    │   │   ├── auth.routes.ts
    │   │   ├── auth.controller.ts
    │   │   ├── auth.service.ts
    │   │   ├── otp.service.ts
    │   │   ├── token.service.ts
    │   │   └── auth.schemas.ts   # Zod DTOs (source of truth for OpenAPI)
    │   ├── business/            # profile, hours, amenities, gallery, QR
    │   ├── services/
    │   ├── staff/
    │   ├── queue/
    │   │   ├── queue.routes.ts
    │   │   ├── queue.controller.ts
    │   │   ├── queue.service.ts        # orchestrates commands (start/checkout/reassign…)
    │   │   ├── queue.engine.ts         # PURE logic ported from lib/queue.ts + store.tsx
    │   │   ├── eta.ts                   # estMins / seatLoad / soonestSeat / buildSeatGroups
    │   │   ├── token.service.ts         # daily token sequence (A-24)
    │   │   └── queue.schemas.ts
    │   ├── appointments/
    │   ├── customers/
    │   ├── dashboard/           # KPI aggregation
    │   ├── notifications/       # owner alert center
    │   ├── subscription/        # plans, upgrade, billing
    │   ├── uploads/             # presigned upload signing
    │   ├── public/              # microsite: business, availability, join, book, tickets
    │   └── webhooks/            # payments, sms DLR (signature-verified)
    │
    ├── realtime/
    │   ├── io.ts                # Socket.IO server + Redis adapter
    │   ├── namespaces.ts        # /owner, /customer
    │   ├── rooms.ts             # room naming + join authorization
    │   ├── emitters.ts          # typed emit helpers (queue:*, ticket:*, availability:*)
    │   └── events.ts            # event name + payload types (see 08)
    │
    ├── jobs/
    │   ├── queues.ts            # BullMQ queue definitions
    │   ├── scheduler.ts         # repeatable/cron registration (see 09)
    │   ├── outbox.ts            # transactional outbox dispatcher
    │   └── processors/
    │       ├── notify.two-away.ts
    │       ├── notify.your-turn.ts
    │       ├── appointments.remind.ts
    │       ├── appointments.no-show.ts
    │       ├── metrics.rollup.ts
    │       ├── tokens.rollover.ts
    │       ├── otp.purge.ts
    │       ├── privacy.retention.ts
    │       └── subscription.sync.ts
    │
    ├── integrations/
    │   ├── sms/                 # msg91 / twilio adapters (common interface)
    │   ├── email/               # ses / postmark
    │   ├── payments/            # razorpay / stripe
    │   └── storage/             # s3 / r2 / supabase
    │
    ├── domain/
    │   ├── enums.ts             # queue_status, source, plan… (see 04)
    │   ├── errors.ts            # AppError + code catalog (see 11)
    │   └── money.ts             # paise helpers, formatting boundaries
    │
    ├── lib/
    │   ├── phone.ts             # E.164 normalize/validate (+91)
    │   ├── initials.ts          # ported from app/src/lib/format.ts
    │   ├── time.ts              # tz-aware day boundaries, open-status
    │   └── hmac.ts              # signed ticket URLs
    │
    ├── openapi/
    │   └── generate.ts          # Zod → openapi.yaml
    │
    └── observability/
        ├── metrics.ts           # prometheus/otel
        ├── tracing.ts           # opentelemetry
        └── health.ts            # /healthz /readyz

tests/
├── unit/
│   └── queue.engine.test.ts     # golden tests vs the mock's behavior (highest priority)
├── integration/                 # supertest against ephemeral DB
└── e2e/                         # join → 2-away → your-turn → checkout flow
```

## Layering rules

1. **routes** → parse/authorize/validate only. **controller** → HTTP glue. **service** → business orchestration + transactions. **engine/domain** → pure logic (no I/O). **repository** → the only DB access, always tenant-scoped.
2. `queue.engine.ts`/`eta.ts` are **pure and unit-tested against the mock's outputs** — port `lib/queue.ts` (estMins, seatLoad, soonestSeat, buildSeatGroups) and the `store.tsx` command semantics verbatim ([07](./07-business-logic.md)).
3. **Zod schemas** in each module are the single source of truth → drive validation, TS types, and OpenAPI.
4. **Socket emits** happen in services **after commit** via `emitters.ts` (or the outbox), never in controllers.
5. **Repositories never run unscoped queries** — `businessId` is a required parameter everywhere (tenant isolation, NFR-SE4).
6. API and worker share `src/` but boot from different entrypoints (`server.ts` vs `worker.ts`).

## Seeding

`prisma/seed.ts` mirrors `app/src/data/sample.ts` and `frontend/src/app/sharp-cuts/page.tsx`: business "Sharp Cuts" (slug `sharp-cuts`), staff John/Lisa/Mike, the service list, sample customers, an initial queue and appointments — so the demo apps light up immediately against the real API.
