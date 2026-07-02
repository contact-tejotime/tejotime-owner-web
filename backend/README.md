# TejoTime API (Backend)

Express + Supabase + Socket.IO + TypeScript. **No ORM** — data access goes through
`@supabase/supabase-js`, and the concurrency-sensitive queue operations are
PostgreSQL `plpgsql` functions called via `supabase.rpc()` (each runs in one
transaction under a per-business advisory lock). Implements the specification in
[`../docs`](../docs).

## Stack

| Concern | Choice |
|---|---|
| API | Express 4 + TypeScript (CommonJS, run with `tsx`) |
| Data access | `@supabase/supabase-js` (service role) + `plpgsql` RPCs for atomic queue ops |
| Realtime | Socket.IO 4 (`/owner`, `/customer` namespaces) — single instance |
| Auth | Custom JWT (owner handle + password via bcrypt), customer OTP scaffolded |
| Jobs | `node-cron` in-process (stale cleanup, OTP/session purge) |
| Migrations | plain `.sql` applied by a tiny `pg`-based CLI (dev only) |
| Validation | Zod · **Logging** pino · **Rate limit** express-rate-limit (in-memory) |

## Quick start

```bash
cd backend
npm install
cp .env.example .env      # fill in Supabase + secrets (already provided in .env for this project)
npm run migrate           # create tables + functions in Supabase
npm run seed              # load the "Sharp Cuts" demo tenant
npm run dev               # http://localhost:8080
```

**Demo owner login:** handle `sharpcuts` · password `password123`
**Public microsite payload:** `GET /api/v1/public/businesses/sharp-cuts`

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run the API + Socket.IO + cron (watch mode) |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run migrate` | Apply `db/migrations/*.sql` (idempotent) |
| `npm run seed` | Reset + seed the Sharp Cuts demo |
| `npm run typecheck` · `npm run lint` · `npm test` | Quality gates |
| `node scripts/smoke-rest.mjs` | End-to-end REST smoke test (server must be running) |
| `node scripts/smoke-socket.mjs` | Realtime (Socket.IO) smoke test |

## Layout

```
db/            migrations/*.sql (schema + plpgsql functions), migrate.ts, seed.ts
src/
  config/      env (zod-validated), logger, constants
  db/          supabase client, rpc helper
  domain/      enums, errors, money
  lib/         queue-engine (ported from app/src/lib/queue.ts), phone, time, format
  middleware/  authenticate, authorize, validate, rate-limit, error-handler, request-id
  modules/     auth business services staff queue appointments customers
               dashboard notifications subscription uploads public webhooks
  realtime/    io (namespaces/rooms), emitters
  jobs/        scheduler (node-cron)
  integrations/sms, email  (deferred provider seams)
  observability/health
tests/unit/    queue-engine golden tests
```

## Core API surface (`/api/v1`)

- **auth**: `POST /auth/login|refresh|logout`, `GET /auth/me`
- **queue**: `GET /queue?view=grouped|flat`, `POST /queue`, `POST /queue/:id/{start,checkout,no-show,reassign,extend,move}`, `DELETE /queue/:id`
- **appointments**: `GET/POST /appointments`, `POST /appointments/:id/{check-in,cancel,no-show}`
- **customers**: `GET /customers` (plan-gated), `GET/POST/PATCH /customers/:id`, `GET /customers/:id/visits`
- **business/services/staff**: profile + hours + amenities + QR, services & staff CRUD
- **dashboard**: `GET /dashboard/summary` · **subscription**: `GET /subscription`, `POST /subscription/upgrade`
- **uploads**: `POST /uploads/sign` (Supabase Storage) · **notifications**: `GET /notifications`, `POST /notifications/read`
- **public**: `GET /public/businesses/:slug[/availability|/staff|/slots]`, `POST .../queue`, `POST .../appointments`, `GET/DELETE /public/tickets/:id`
- **health**: `GET /healthz`, `GET /readyz`

Full request/response contracts: [`../docs/05-api-endpoints.md`](../docs/05-api-endpoints.md).
Socket.IO event catalog: [`../docs/08-realtime-socketio.md`](../docs/08-realtime-socketio.md).

## Feature flags / deferred integrations

These need external credentials and are **off by default** (`.env`):

| Flag | Effect when `false` |
|---|---|
| `SMS_ENABLED` | "2-away"/"your-turn"/reminder SMS not dispatched; notifications still persisted + pushed over Socket.IO |
| `EMAIL_ENABLED` | Email reminders not dispatched |
| `PAYMENTS_ENABLED` | `POST /subscription/upgrade` flips the plan directly (no charge); webhooks inert |
| `OTP_ENABLED` | Customer join/book do not require phone OTP |

Redis-based scaling (Socket.IO adapter, BullMQ, distributed rate-limit) is documented
in `../docs` and can be added without changing the API surface.

## Notes & assumptions

- `plpgsql` functions raise `TEJO:<CODE>` errors that the API maps to HTTP codes.
- Booking slots are generated from `business_hour` at `BOOKING_SLOT_MINUTES` intervals
  minus already-booked appointments (see `../docs/17` Q17).
- Add-on prices for "extend service" live in `src/config/constants.ts` (`../docs/17` Q8).
- Tenant isolation: every query is scoped by `business_id` from the JWT — never client input.
