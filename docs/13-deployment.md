# 13 — Deployment Architecture

## 1. Topology

```
                         ┌──────────── Cloudflare (CDN + WAF + DDoS + rate-limit edge) ───────────┐
                         │                                                                        │
  Marketing site  ──────►│  Next.js (frontend/) — static/SSR on Vercel or container              │
  Public microsite ─────►│  /{slug} pages (ISR/SSR) → calls API                                   │
                         │                                                                        │
  Owner app (Expo) ─────►│                                                                        │
        (native)         │                                                                        │
                         ▼                                                                        │
                 ┌──────────────── API Gateway / Load Balancer (TLS) ────────────────┐            │
                 │                                                                    │            │
        ┌────────▼────────┐   ┌──────────────────┐   ┌───────────────────────────┐   │            │
        │ API + Socket.IO │…N │ API + Socket.IO  │   │  Worker processes (BullMQ) │…M │            │
        │ (Express/Node)  │   │ (Express/Node)   │   │  notifications/queue/cron  │   │            │
        └───┬───────┬─────┘   └───┬──────────────┘   └───────────┬───────────────┘   │            │
            │       │             │                              │                   │            │
            │       └──── Redis (cache · rate-limit · Socket.IO adapter · BullMQ) ───┘            │
            │                                                                                     │
     ┌──────▼───────┐   ┌──────────────┐   ┌────────────────┐   ┌───────────────┐                 │
     │ PostgreSQL   │   │ Object store │   │ SMS provider   │   │ Payment prov. │  ◄──────────────┘
     │ (+PgBouncer) │   │ (S3/R2)+CDN  │   │ (MSG91/Twilio) │   │ (Razorpay)    │   webhooks
     └──────────────┘   └──────────────┘   └────────────────┘   └───────────────┘
```

## 2. Components

| Component | Choice | Scaling |
|---|---|---|
| API + realtime | Node/Express + Socket.IO in containers | Horizontal (N replicas) behind LB; WebSocket-capable LB with sticky sessions or WS-only transport |
| Workers | Same image, `CMD=worker`, BullMQ | Horizontal (M replicas), per-queue concurrency |
| DB | Managed PostgreSQL 16 (RDS/Cloud SQL/Supabase) + **PgBouncer** | Vertical + read replicas; connection pooling mandatory |
| Cache/queue/pubsub | Managed Redis 7 (cluster or HA pair) | Used by rate-limiter, Socket.IO adapter, BullMQ, availability cache |
| Object storage | S3 / R2 / Supabase Storage + CDN | Managed |
| Web (marketing + microsite) | Next.js on Vercel or container; microsite `/{slug}` uses ISR/SSR + CDN | Edge-cached |
| Edge | Cloudflare (WAF, DDoS, bot mgmt, global rate limit) | Managed |

## 3. Runtime & packaging

- **Docker** image (multi-stage: build TS → slim runtime). Same image runs API (`node dist/server.js`) or worker (`node dist/worker.js`) via env/command.
- Orchestration: Kubernetes, ECS/Fargate, or a PaaS (Render/Railway/Fly.io) for early stage.
- Zero-downtime rolling deploys; graceful shutdown (drain HTTP, close sockets with reconnect hint, finish in-flight jobs).
- DB migrations (Prisma) run as a **pre-deploy job/gate**, backward-compatible (expand/contract) to allow rolling deploys.

## 4. Environments

| Env | Purpose | Data |
|---|---|---|
| `local` | Dev (docker-compose: postgres, redis, minio, mailhog) | seed from `sample.ts` |
| `staging` | Pre-prod, integration, load tests | anonymized/synthetic |
| `production` | Live | real, backed up |

Config strictly via env vars ([14](./14-environment-variables.md)); no per-env code branches beyond feature flags.

## 5. Networking & security

- All ingress via TLS (LB-terminated); internal traffic in a private VPC/subnet.
- DB/Redis not publicly exposed; access via security groups + secrets.
- Secrets in a manager (AWS Secrets Manager / SSM / Doppler / Vault), injected at runtime.
- WAF rules: block common exploits; edge rate-limits ([12](./12-rate-limiting.md)); allow-list payment/SMS webhook source IPs.
- Least-privilege IAM for storage buckets.

## 6. Data management

- Automated PostgreSQL backups + **PITR**; periodic restore drills.
- Redis is treated as ephemeral (cache/queue) — durable state lives in Postgres/outbox; BullMQ persistence acceptable but jobs must be reconstructable.
- Blue/green or canary for risky releases; migration rollback plan (contract phase after verification).

## 7. Realtime scaling specifics

- Socket.IO Redis adapter → any instance can emit to any room.
- LB must support WebSocket upgrade; enable sticky sessions (or `transports: ['websocket']`) so a client stays pinned for connection stability.
- Autoscale API on CPU **and** connection count (sockets are long-lived).

## 8. CI/CD

- Pipeline: lint → typecheck → unit/integration tests (queue engine!) → build image → run migrations against ephemeral DB → deploy staging → smoke tests → promote to prod.
- Contract/OpenAPI check ([15](./15-openapi-outline.md)) in CI to keep clients in sync.
- The repo already ships CI under `.github/workflows/` for the apps; add a `backend` pipeline.

## 9. Cost & regional notes

- Host in an **India region** (ap-south-1 Mumbai) — primary market, lowest latency, data-residency friendliness (DPDP).
- SMS is a real per-message cost — the reminder/2-away features drive spend; monitor and cap (see [12](./12-rate-limiting.md)).
