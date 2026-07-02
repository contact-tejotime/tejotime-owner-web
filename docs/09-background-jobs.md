# 09 — Background Jobs

Runtime: **BullMQ on Redis**, executed by dedicated worker processes (separate from the API — NFR-S4). Every job is idempotent, retried with backoff, and dead-lettered on exhaustion (NFR-A4). Scheduled jobs use BullMQ repeatable jobs (cron).

## 1. Queue-driven / event jobs

| Job | Trigger | Action | Idempotency |
|---|---|---|---|
| `notify.two_away` | queue mutation makes a ticket `ahead ≤ 2` ([07 §14](./07-business-logic.md#14-2-away-notification-trigger)) | Send SMS "You're 2 away at {business}" | Guard on `queue_entry.notified_two_away_at`; once per ticket |
| `notify.your_turn` | `queue:entry.completed` promotes a ticket / `ahead==0` | Send SMS "It's your turn — head in" | Guard on a `notified_turn_at` stamp |
| `notify.queue_joined` | `POST /public/.../queue` success | Send SMS/receipt with token & live link | Keyed by ticket id |
| `queue.recompute_eta` | any queue mutation | Recompute positions/ETAs, emit `queue:reordered` + `availability:updated` | Naturally idempotent (pure projection) |
| `visit.materialize` | `checkout` | Create `visit`, update customer aggregates, bump daily revenue metric | Keyed by `queue_entry_id` (unique visit) |
| `sms.dispatch` | any notification enqueue | Call SMS provider, persist `provider_message_id`, update `notification.status` | Keyed by `notification.id` |
| `email.dispatch` | any email notification | Send via email provider | Keyed by `notification.id` |
| `webhook.replay` | failed inbound webhook | Reprocess payment/SMS DLR | Keyed by provider event id |

> The "2-away"/"your-turn" SMS **and** the Socket.IO push are complementary: sockets for open sessions, SMS as the durable channel (customer stepped away — the whole product pitch).

## 2. Scheduled / cron jobs

| Job | Schedule (Asia/Kolkata) | Action |
|---|---|---|
| `appointments.remind` | every 15 min | For appointments starting in the reminder window (e.g. T-2h, T-30m), send SMS+email reminders (FR-I2, marketing "Reminders … cut no-shows"). Guard per (appointment, window). |
| `appointments.auto_no_show` | every 10 min | Flag confirmed appointments past `scheduled_start_at + grace` and not checked in as `no_show` (**confirm policy** — [17](./17-assumptions-open-questions.md#business-logic--data)) |
| `tokens.rollover` | 00:00 daily per tz | Reset daily token sequence counters ([07 §13](./07-business-logic.md#13-token-generation)) |
| `metrics.rollup` | 00:05 daily + hourly | Materialize `daily_metric` (appointments, walk-ins, completed, revenue, no-shows) for fast KPIs (NFR-P5) |
| `queue.stale_cleanup` | hourly | Auto-close/expire abandoned `waiting` tickets older than N hours or past closing; emit `ticket:cancelled` |
| `otp.purge` | every 30 min | Delete expired/consumed `otp_verification` rows |
| `sessions.purge` | daily | Remove expired/revoked `auth_session` rows |
| `privacy.retention` | daily | Purge/anonymize stale walk-in PII per retention config (NFR-PR4); execute honored erasure requests |
| `subscription.sync` | hourly | Reconcile subscription status with payment provider; flag `trial_ends_at` expiries; downgrade lapsed premium → free |
| `reviews.request` | 2h after `visit` (delayed job) | (P2) Ask completed customers for a review (reviews power microsite rating) |
| `notifications.retry_sweep` | every 5 min | Requeue `failed` notifications within retry budget |

## 3. Reliability patterns

- **Retries:** exponential backoff (e.g., 5 attempts: 30s, 2m, 10m, 1h, 6h). After exhaustion → dead-letter queue + alert.
- **Transactional outbox:** queue-mutation transactions write an `outbox` row; a dispatcher relays to BullMQ/sockets so DB commit and side-effects can't diverge.
- **Idempotency keys:** every job carries a natural key; workers no-op on duplicates.
- **Rate/window guards:** SMS jobs respect provider throughput and DND/quiet-hours (India TRAI); reminders debounced per customer.
- **Time zones:** all scheduling in the business's timezone; store UTC, schedule per-tenant.

## 4. Observability (NFR-O2)

- Metrics per queue: depth, processing rate, failure rate, latency, DLQ size.
- SMS/email delivery-rate metric (from provider DLR webhooks feeding `notification.status`).
- Alert on: DLQ growth, reminder lag, "2-away" SMS failure spikes, subscription-sync drift.

## 5. Worker topology

- `worker-notifications` — SMS/email dispatch, two-away/your-turn/reminders.
- `worker-queue` — ETA recompute, visit materialization, stale cleanup.
- `worker-scheduler` — cron/rollups/purges/subscription sync.
- Each horizontally scalable; concurrency tuned per queue; graceful shutdown drains in-flight jobs.
