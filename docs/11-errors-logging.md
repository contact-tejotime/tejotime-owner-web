# 11 — Error Handling & Logging

## 1. Error envelope

Every non-2xx API response uses one shape:

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",           // stable machine code (SCREAMING_SNAKE)
    "message": "Enter a customer name",    // human, safe to display (clients may localize by code)
    "requestId": "req_01H& ...",           // correlate with logs
    "details": [                            // optional, field-level (validation)
      { "field": "name", "rule": "required", "message": "Enter a customer name" }
    ]
  }
}
```

Rules:
- `code` is the contract; `message` may change/localize. Clients branch on `code`, display `message`.
- Never leak stack traces, SQL, internal ids, or which auth field failed.
- Validation errors return **all** offending fields at once (Zod aggregation) so forms show every error.

## 2. HTTP status mapping

| Status | When | Example `code` |
|---|---|---|
| 400 | Malformed/invalid input | `VALIDATION_ERROR`, `MALFORMED_JSON` |
| 401 | Missing/invalid/expired token | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED` |
| 402 | Plan limit hit (billing required) | `PLAN_LIMIT_REACHED`, `PAYMENT_REQUIRED` |
| 403 | Authenticated but not allowed | `FORBIDDEN`, `ROLE_NOT_PERMITTED` |
| 404 | Not found / cross-tenant id | `NOT_FOUND` (used instead of 403 for tenant isolation) |
| 409 | State conflict | `SEAT_BUSY`, `SEAT_HAS_ACTIVE_ENTRIES`, `CUSTOMER_EXISTS`, `ALREADY_CHECKED_IN`, `SLOT_TAKEN` |
| 410 | Gone (expired ticket/OTP) | `TICKET_EXPIRED`, `OTP_EXPIRED` |
| 422 | Semantically invalid business action | `INVALID_STATE_TRANSITION` |
| 429 | Rate limited | `RATE_LIMITED` (+ `Retry-After`) |
| 500 | Unexpected | `INTERNAL_ERROR` (generic message) |
| 503 | Dependency down / not ready | `SERVICE_UNAVAILABLE` |

## 3. Domain error codes (catalog)

| Code | Meaning | Origin |
|---|---|---|
| `VALIDATION_ERROR` | Input failed schema | all write endpoints |
| `INVALID_CREDENTIALS` | Login failed | `POST /auth/login` |
| `OTP_INVALID` / `OTP_EXPIRED` / `OTP_ATTEMPTS_EXCEEDED` | OTP flow | OTP endpoints |
| `SEAT_BUSY` | Seat already has an in-service entry | start service |
| `SEAT_HAS_ACTIVE_ENTRIES` | Can't deactivate a seat mid-queue | delete staff |
| `INVALID_STATE_TRANSITION` | e.g. checkout a waiting entry | queue ops |
| `ALREADY_CHECKED_IN` | Appointment already in queue | appt check-in |
| `CUSTOMER_EXISTS` | Duplicate phone for tenant | create customer |
| `SLOT_TAKEN` / `OUTSIDE_HOURS` | Booking conflict | public book |
| `PLAN_LIMIT_REACHED` | Free-plan CRM/feature cap | customers list/detail |
| `NOT_FOUND` | Missing or not owned | any `/:id` |
| `RATE_LIMITED` | Too many requests | rate-limit mw |
| `TENANT_INACTIVE` | Suspended business | any |
| `WEBHOOK_SIGNATURE_INVALID` | Bad provider signature | webhooks |

## 4. Error-handling implementation

- Central Express error middleware converts thrown `AppError` (with `code`, `httpStatus`, `message`, `details`) into the envelope; unknown errors → `500 INTERNAL_ERROR` (logged with stack, generic message to client).
- Async route handlers wrapped (`express-async-errors` or a wrapper) so rejections reach the middleware.
- Zod parse failures mapped to `VALIDATION_ERROR` with field `details`.
- Never `throw` provider/DB errors raw to the client; translate & log.

## 5. Logging

**Format:** structured JSON (pino). One log line per request + per significant event.

**Standard fields:** `timestamp`, `level`, `requestId`, `businessId`, `userId`/`actorType`, `method`, `path`, `status`, `latencyMs`, `ip`, `userAgent`, `msg`.

**Levels:**
- `error` — 5xx, unhandled, job DLQ, webhook signature failures.
- `warn` — 4xx of interest (repeated auth failures, rate limits, plan blocks), retries.
- `info` — request completion, domain events (queue mutations, bookings, subscription changes), job success.
- `debug` — verbose, off in prod.

**Correlation:** generate `requestId` at ingress (`X-Request-Id` honored if present), attach to logs, echo in the error envelope, and propagate to jobs/socket events for a full trace.

**Domain event log (audit):** queue mutations, billing changes, staff/permission changes, admin impersonation, data exports/erasure → `audit_log` table + info log ([04 §3.18](./04-data-model.md#318-audit_log)).

## 6. PII & secret hygiene in logs

- **Redact** phone, full names, OTP codes, tokens, passwords, card/payment data, `Authorization` headers. Log `customerId`/`phoneHash` instead of raw phone.
- Redaction enforced by a pino serializer/allow-list, not ad-hoc.
- No request bodies for auth/OTP/payment routes in logs.

## 7. Tracing & monitoring

- **OpenTelemetry** spans: HTTP → service → DB/Redis/provider calls; trace id == request id.
- **Error tracking:** Sentry (or equivalent) captures 5xx and unhandled with scrubbed context.
- **Uptime/synthetics:** probe `/healthz`, `/readyz`, and a public microsite fetch.
- **Alerting:** error-rate spike, p95 latency breach, DLQ growth, socket drop, SMS failure rate, DB connection saturation.

## 8. Client-facing behavior

- Mobile shows the mock's inline copy for known codes (e.g., login/walk-in validation messages). Map `code → localized string`; fall back to server `message`.
- On `401 TOKEN_EXPIRED`, the client silently refreshes and retries once.
- On `429`, honor `Retry-After`; back off.
- On `5xx`/network, allow safe retry of idempotent mutations (Idempotency-Key).
