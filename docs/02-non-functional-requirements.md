# 02 — Non-Functional Requirements

## 1. Performance & latency

| ID | Requirement | Target |
|---|---|---|
| NFR-P1 | REST read endpoints (queue, customers, dashboard) p95 latency | ≤ 200 ms server-side |
| NFR-P2 | Queue mutation → realtime fan-out to connected clients | ≤ 500 ms end-to-end |
| NFR-P3 | Public microsite data endpoint (`/public/businesses/:slug`) — cacheable | ≤ 150 ms (CDN/edge cached) |
| NFR-P4 | Live availability poll fallback | Cheap; served from Redis, not a full recompute |
| NFR-P5 | Dashboard KPI computation | Pre-aggregated or ≤ 300 ms; never a full table scan per request |

The mock refreshes live wait every **6 s** on the microsite (`sharp-cuts/page.tsx`) — treat that as the acceptable staleness ceiling for the polling fallback; Socket.IO push should be near-instant.

## 2. Scalability

| ID | Requirement |
|---|---|
| NFR-S1 | **Multi-tenant**: a single deployment serves many businesses; all data partitioned by `business_id`. |
| NFR-S2 | API is **stateless/horizontally scalable** behind a load balancer. |
| NFR-S3 | Socket.IO scales across instances via the **Redis adapter** (no sticky-session dependency for correctness; use sticky or WebSocket-only transport for connection stability). |
| NFR-S4 | Background jobs run on separate worker processes (BullMQ) and scale independently. |
| NFR-S5 | Design for peak concurrency during business hours; a busy salon = dozens of live tickets, hundreds of customers subscribed to ticket updates. |
| NFR-S6 | Database uses connection pooling (PgBouncer) — serverless/many instances must not exhaust Postgres connections. |

## 3. Availability & reliability

| ID | Requirement |
|---|---|
| NFR-A1 | Target **99.9%** uptime for the API and realtime layer during business hours. |
| NFR-A2 | Graceful degradation: if Socket.IO is unavailable, clients fall back to REST polling of ticket/availability endpoints. |
| NFR-A3 | Idempotency on mutation endpoints via `Idempotency-Key` header (esp. join-queue, book, checkout) to survive retries on flaky mobile networks. |
| NFR-A4 | At-least-once delivery for SMS/email jobs with retry + dead-letter queue. |
| NFR-A5 | Database automated backups (PITR) with tested restore. |

## 4. Consistency

| ID | Requirement |
|---|---|
| NFR-C1 | Queue ordering and seat promotion must be **serializable per business** — concurrent mutations (two owner devices, an auto-promotion job, a customer leaving) must not corrupt positions. Use per-business row locks or a serialized command queue. |
| NFR-C2 | Position/ETA are **derived** and recomputed transactionally on every mutation; never allow drift between what the owner and the customer see. |
| NFR-C3 | Token issuance is unique per business per day and gap-tolerant (no reuse within a day). |

## 5. Security

| ID | Requirement |
|---|---|
| NFR-SE1 | Transport: TLS 1.2+ everywhere; HSTS on web. |
| NFR-SE2 | Passwords hashed with **argon2id** (or bcrypt cost ≥ 12). |
| NFR-SE3 | JWT access tokens short-lived (15 min) + rotating refresh tokens; refresh tokens revocable and stored hashed. |
| NFR-SE4 | **Strict tenant isolation** — every query scoped by `business_id` derived from the token, never from client input. |
| NFR-SE5 | Public endpoints protected by OTP + rate limiting + CAPTCHA fallback to prevent queue-spam/enumeration. |
| NFR-SE6 | PII (customer name/phone) encrypted at rest (disk/column-level for phone); access audited. |
| NFR-SE7 | Input validation + output encoding on all endpoints (see [05](./05-api-endpoints.md)); parameterized queries only (ORM). |
| NFR-SE8 | Secrets from env/secret manager, never committed (see [14](./14-environment-variables.md)). |
| NFR-SE9 | Webhook endpoints (payments, SMS DLR) verify provider signatures. |
| NFR-SE10 | Plan-gating (free CRM limit) enforced server-side (client gating is cosmetic only). |

## 6. Privacy & compliance

| ID | Requirement |
|---|---|
| NFR-PR1 | Comply with **India DPDP Act 2023** (primary market is India). Lawful basis + consent for SMS marketing. |
| NFR-PR2 | Customer consent capture on the microsite (Terms & Privacy links present on both surfaces). |
| NFR-PR3 | Data subject rights: export & delete customer data on request. |
| NFR-PR4 | Configurable data retention (e.g., purge stale walk-in PII after N days). |
| NFR-PR5 | SMS compliance: honor DND/opt-out; use registered DLT templates (India TRAI requirement) for transactional SMS. |

## 7. Observability

| ID | Requirement |
|---|---|
| NFR-O1 | Structured JSON logs with correlation IDs (see [11](./11-errors-logging.md)). |
| NFR-O2 | Metrics: request rate/latency/error rate, socket connection count, job queue depth, SMS delivery rate. |
| NFR-O3 | Distributed tracing (OpenTelemetry) across API → DB → jobs. |
| NFR-O4 | Error tracking (Sentry or equivalent). |
| NFR-O5 | Health/readiness endpoints (`/healthz`, `/readyz`) for orchestration. |

## 8. Maintainability & quality

| ID | Requirement |
|---|---|
| NFR-M1 | TypeScript strict mode; shared DTO/validation schemas (Zod) as the single source of truth for request/response shapes. |
| NFR-M2 | Versioned API (`/api/v1`). |
| NFR-M3 | DB migrations version-controlled (Prisma Migrate). |
| NFR-M4 | ≥ 80% coverage on business-logic modules (queue engine especially — it's the risk center). |
| NFR-M5 | OpenAPI spec kept in sync (generate from Zod or hand-maintain per [15](./15-openapi-outline.md)). |

## 9. Accessibility & UX contract

| ID | Requirement |
|---|---|
| NFR-UX1 | API returns machine-readable error codes + human messages so clients can localize/AB-test copy (mock uses copy like "Enter a customer name"). |
| NFR-UX2 | Timestamps returned in ISO-8601 UTC; clients format to `Asia/Kolkata`. |
| NFR-UX3 | Money returned as `{ amount: <int paise>, currency: "INR" }`; never pre-formatted strings. |

## 10. Internationalization

| ID | Requirement |
|---|---|
| NFR-I18N1 | Per-business `currency` and `timezone` (defaults INR / Asia/Kolkata) to allow expansion. |
| NFR-I18N2 | Phone numbers stored in E.164 (`+91...`); validate per country. |
