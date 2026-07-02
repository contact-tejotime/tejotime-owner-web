# 00 — Overview & System Context

## 1. Product summary

TejoTime is a **multi-tenant queue + booking + CRM platform** for small service businesses. The demonstrated vertical is salons/barbershops, but the marketing copy positions it generically as *"the digital OS for small business"* (`frontend/src/app/page.tsx`). The backend must therefore be **vertical-agnostic and multi-tenant** from day one.

Each tenant ("business") gets:
- A public booking microsite at `tejotime.com/{slug}` (the QR sheet in `app/src/components/feedback/QRSheet.tsx` shows `tejotime.com/sharp-cuts`).
- A live, multi-seat queue.
- Online appointment booking.
- A customer database with visit/spend history.
- SMS/email reminders.
- A free/premium subscription.

## 2. The three surfaces

### 2.1 Owner app (Expo / React Native) — `app/`
The operational cockpit. Authenticated. Five tabs (`app/src/components/BottomNav.tsx`):
1. **Dashboard** (`Home`) — KPIs, quick actions (Add walk-in, Show QR), active-queue preview.
2. **Queue** — multi-seat live queue with per-seat lanes, drag-to-reorder, walk-in add, filtering by staff.
3. **Appointments** (`Appts`) — today's booked slots; "Add to queue" check-in.
4. **Customers** (`Clients`) — searchable CRM, plan-gated list length.
5. **Settings** — business profile, hours, services, staff, QR, subscription, dark mode.

Global overlays: Add-walk-in sheet, QR sheet, customer detail panel, toast notifications.

### 2.2 Marketing site (Next.js) — `frontend/src/app/page.tsx`
Static funnel listing four product pillars: **Online booking, Live queue, Reminders, Customer management**. No API needed beyond a possible lead/signup capture (see [17 — Open Questions](./17-assumptions-open-questions.md)).

### 2.3 Public booking microsite (Next.js) — `frontend/src/app/sharp-cuts/page.tsx`
Per-business landing page (route = business slug). Anonymous customers can:
- See **live wait time & queue count** (auto-refreshing every 6s in the mock).
- Browse services (with price & duration), team, live per-barber availability, reviews, FAQ, hours, amenities, gallery.
- **Join the live queue** or **book a time slot** via a 3-step modal: pick service → enter name/phone + optional barber → receive a **ticket** (`token`, `ahead`, `wait`) that **updates live** and shows a progress bar.
- Get texted *"when you're 2 away"*; **leave the queue**.

## 3. Domain glossary

| Term | Meaning | Evidence |
|---|---|---|
| **Business / Tenant** | A single shop account | `business = { name, area, category }` in `sample.ts` |
| **Owner / User** | Person who logs into the owner app | `Login.tsx` (User ID + password) |
| **Staff / Seat / Barber** | A service provider = a queue lane | `staff[]` in `sample.ts`; "barbers" on microsite |
| **Service** | Bookable service w/ duration & price | `services[]`, `SERVICES[]` |
| **Queue entry** | A person in the live queue | `QueueEntry` in `sample.ts` |
| **Ticket / Token** | Customer's public queue receipt | `Ticket = { token, ahead, wait }`, `"A-24"` |
| **Appointment** | A booked future slot | `AppointmentEntry` in `sample.ts` |
| **Customer** | CRM record | `Customer` in `sample.ts` |
| **Source (`src`)** | How an entry entered: `walk-in` \| `online` | `QueueSource` |
| **Plan** | `free` \| `premium` (a.k.a. "Professional") | `store.tsx`, `Settings.tsx` |
| **Seat load** | Sum of active service minutes on a seat | `lib/queue.ts` |

## 4. Status vocabulary

From `app/src/components/ui/StatusBadge.tsx` (`StatusKind`) and `store.tsx`:

- **Queue entry statuses:** `waiting`, `in-service` (a.k.a. `serving`), `completed`, `no-show`, `cancelled`.
- **Appointment statuses:** `upcoming`, `confirmed` (+ `cancelled`, `no-show`, `completed`, `checked-in` inferred).

Canonicalize on the backend (see [04 — Data Model](./04-data-model.md#enumerations)).

## 5. Localization & money

- **Currency:** INR throughout (`₹350`, `₹1,200`, `₹18.4k`). Store money as **integer minor units (paise)**; format client-side.
- **Locale/region:** India — phone prefix `+91` (`AddWalkInSheet.tsx`), addresses in Mumbai (Bandra/Andheri), payment methods "UPI · Card · Cash".
- **Timezone:** default `Asia/Kolkata`; store all timestamps in UTC.

## 6. Tech-stack decision

The repo README declares the intended backend explicitly:

> `backend/` | Node/Express API | Not initialized yet

The user's requirements also mandate **Socket.IO**. Accordingly this spec targets:

| Concern | Choice | Why |
|---|---|---|
| API | Node.js 20 + Express 4 + TypeScript | Matches README; team intent |
| ORM/DB | Prisma + PostgreSQL 16 | Relational domain (tenants, queues, bookings), strong constraints |
| Realtime | Socket.IO 4 + `@socket.io/redis-adapter` | Required; live queue is the core UX |
| Cache/jobs | Redis 7 + BullMQ | Reminders, "2-away" notifier, rollups, rate limiting |
| Storage | S3-compatible + presigned uploads | Logos, gallery, avatars, QR PNGs |
| SMS | MSG91 (IN) or Twilio | Core promise: text customers |
| Email | SES / Postmark | Appointment reminders |
| Payments | Razorpay (IN) or Stripe | Premium subscription upgrade |
| Auth | JWT (owner) + phone-OTP (customer) | `Login.tsx` + `OTPInput.tsx` |

> **Alternative noted:** the environment also exposes Supabase MCP tooling. A Supabase (Postgres + Auth + Storage + Realtime) implementation is viable and would collapse several boxes above. This spec is written stack-neutral at the data/API layer so either path works; where it matters, both are noted. See [17 — Open Questions](./17-assumptions-open-questions.md#infrastructure).

## 7. Scope boundaries (from the UI, not assumed)

**In scope (observed in UI):** multi-tenant business profiles, multi-seat live queue with reordering/reassignment/service-extension, walk-in intake, online queue-join & slot booking, appointments + check-in, customer CRM with search & plan gating, SMS/email reminders, subscription upgrade, QR/booking link, dark mode preference.

**Not yet observed (flag before building):** in-app payment collection for services (UI says *"pay at the shop"*), staff self-login & scheduling, multi-location per tenant, analytics dashboards beyond four KPIs, promotions/loyalty. See [17](./17-assumptions-open-questions.md).
