# TejoTime — Backend Specification

> Reverse-engineered from the frontend (Next.js) and mobile app (Expo / React Native) codebases.
> This is an **implementation-ready specification**, not backend code. No backend currently exists in the repo — the apps run entirely on local React state and seed data (`app/src/data/sample.ts`, `frontend/src/app/sharp-cuts/page.tsx`). Every requirement below is inferred from UI behavior; **all inferences are flagged as assumptions where the UI is ambiguous**.

## What is TejoTime?

TejoTime is a multi-tenant SaaS — *"the digital OS for small business"* (see `frontend/src/app/page.tsx`). It gives small service businesses (the reference tenant is a salon/barber, "Sharp Cuts") four capabilities: **online booking, a live queue, reminders, and customer management**.

There are three client surfaces, all backed by the same API:

| Surface | Stack | Audience | Source |
|---|---|---|---|
| **Owner app** | Expo 56 / React Native 0.85 | Business owner & staff | `app/` |
| **Marketing site** | Next.js 16 / React 19 | Prospective businesses | `frontend/src/app/page.tsx` |
| **Public booking microsite** | Next.js 16 | End customers | `frontend/src/app/sharp-cuts/page.tsx` (route `/{business-slug}`) |

## How to read these docs

| # | Document | Covers |
|---|---|---|
| 00 | [Overview & Context](./00-overview.md) | System context, surfaces, glossary, tech-stack decision |
| 01 | [Functional Requirements](./01-functional-requirements.md) | Feature-by-feature behavior, traced to the UI |
| 02 | [Non-Functional Requirements](./02-non-functional-requirements.md) | Performance, scale, security, availability, compliance |
| 03 | [Roles & Permissions](./03-roles-and-permissions.md) | Actors, RBAC matrix, plan gating |
| 04 | [Data Model](./04-data-model.md) | Database schema, ER diagram, relationships, constraints |
| 05 | [API Endpoints](./05-api-endpoints.md) | REST catalog, request/response models, validation rules |
| 06 | [Authentication & Authorization](./06-auth.md) | Owner auth, customer OTP, tenancy isolation, tokens |
| 07 | [Business Logic](./07-business-logic.md) | Queue engine, ETA math, seat assignment, tokens |
| 08 | [Realtime — Socket.IO](./08-realtime-socketio.md) | Namespaces, rooms, full event catalog, payloads |
| 09 | [Background Jobs](./09-background-jobs.md) | Reminders, "2 away" notifier, rollups, cleanup |
| 10 | [File Storage](./10-file-storage.md) | Media, avatars, QR codes, upload flow |
| 11 | [Error Handling & Logging](./11-errors-logging.md) | Error envelope, codes, structured logging, tracing |
| 12 | [Rate Limiting](./12-rate-limiting.md) | Limits per surface & endpoint class |
| 13 | [Deployment Architecture](./13-deployment.md) | Topology, infra, scaling, environments |
| 14 | [Environment Variables](./14-environment-variables.md) | Full config reference |
| 15 | [OpenAPI Outline](./15-openapi-outline.md) | Skeleton spec + component schemas |
| 16 | [Backend Folder Structure](./16-folder-structure.md) | Proposed Node/Express layout |
| 17 | [Assumptions & Open Questions](./17-assumptions-open-questions.md) | **Every ambiguity, grouped, awaiting product sign-off** |

## Recommended stack (see [00-overview](./00-overview.md#tech-stack-decision) for rationale)

- **Runtime/API:** Node.js 20 LTS + Express 4 + TypeScript (the repo README already declares `backend/` as "Node/Express API")
- **Database:** PostgreSQL 16 + Prisma ORM
- **Realtime:** Socket.IO 4 with the Redis adapter
- **Cache / queues / pub-sub:** Redis 7 (BullMQ for background jobs)
- **Object storage:** S3-compatible (AWS S3 / Cloudflare R2 / Supabase Storage)
- **SMS:** India-first provider (MSG91 / Twilio) — the product promises *"we'll text you when you're 2 away"*
- **Email:** transactional provider (SES / Postmark / SendGrid)
- **Payments (subscription billing):** Razorpay (INR-first) or Stripe

> ⚠️ **Before implementation begins, read [17 — Assumptions & Open Questions](./17-assumptions-open-questions.md) and confirm with product.** Several core behaviors (OTP vs password auth, booking-slot model, token scheme, payment collection) are inferred from static UI and must be validated.
