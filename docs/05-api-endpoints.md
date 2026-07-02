# 05 — API Endpoints, Request/Response Models & Validation

Base URL: `https://api.tejotime.com/api/v1`. JSON only. All owner endpoints require `Authorization: Bearer <accessToken>` and are implicitly scoped to the token's `business_id`. Public endpoints are unauthenticated (some require an OTP-verification token).

Conventions:
- **Timestamps** ISO-8601 UTC. **Money** `{ "amount": 45000, "currency": "INR" }` (paise).
- **Errors** follow the envelope in [11 — Error Handling](./11-errors-logging.md#error-envelope).
- **Pagination** cursor-based: `?limit=&cursor=` → `{ data, nextCursor }`.
- **Idempotency**: mutation POSTs accept `Idempotency-Key` header (NFR-A3).
- Validation column notes the rules; all string inputs trimmed; unknown fields rejected (Zod `.strict()`).

---

## A. Auth (owner) — `/auth`

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Owner/staff sign-in (FR-A1) |
| POST | `/auth/refresh` | Rotate access token |
| POST | `/auth/logout` | Revoke refresh token |
| GET | `/auth/me` | Current principal + business summary |
| POST | `/auth/password/forgot` | Start reset (P2) |
| POST | `/auth/password/reset` | Complete reset (P2) |
| POST | `/auth/otp/request` | Request OTP (owner onboarding / MFA) |
| POST | `/auth/otp/verify` | Verify OTP |

**POST /auth/login**
```jsonc
// Request
{ "handle": "sharpcuts", "password": "••••••••" }
// Response 200
{
  "accessToken": "jwt...", "refreshToken": "jwt...", "expiresIn": 900,
  "user": { "id": "u_..", "name": "Owner", "role": "owner", "darkMode": false },
  "business": { "id": "b_..", "name": "Sharp Cuts", "slug": "sharp-cuts", "plan": "free" }
}
```
Validation: `handle` 3–40 chars `[a-z0-9._-]`; `password` 1–128. Empty either → `400 VALIDATION_ERROR` with message "Enter your user ID and password" (mirrors `store.signIn`). Bad creds → `401 INVALID_CREDENTIALS` (generic; don't reveal which field).

---

## B. Business & settings — `/business`

| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | `/business` | Get current business profile + hours + amenities | any |
| PATCH | `/business` | Update profile (name, area, category, address, description, hero/logo) | owner/manager |
| GET | `/business/hours` / PUT `/business/hours` | Read / replace working hours | owner/manager |
| GET | `/business/qr` | Booking link + QR PNG URL (`tejotime.com/{slug}`) | any staff |
| GET | `/business/amenities` · POST · DELETE `/business/amenities/:id` | Manage amenities | owner/manager |
| GET/POST/DELETE | `/business/gallery` | Manage gallery images | owner/manager |

**GET /business/qr → 200**
```json
{ "slug": "sharp-cuts", "bookingUrl": "https://tejotime.com/sharp-cuts", "qrPngUrl": "https://cdn.tejotime.com/qr/b_..png" }
```

**PATCH /business** validation: `name` 1–120; `slug` immutable via this route (separate flow, uniqueness check); `establishedYear` 1900–current; URLs must be owned upload URLs (see [10](./10-file-storage.md)).

---

## C. Services — `/services`

| Method | Path | Purpose |
|---|---|---|
| GET | `/services?active=true` | List services (queue/booking source) |
| POST | `/services` | Create |
| PATCH | `/services/:id` | Update |
| DELETE | `/services/:id` | Soft-delete (deactivate) |
| PATCH | `/services/reorder` | Reorder (`[{id, position}]`) |

**Service model**
```json
{ "id": "s_..", "name": "Haircut & Beard", "durationMinutes": 45,
  "price": { "amount": 45000, "currency": "INR" }, "colorToken": "primary",
  "isActive": true, "position": 1 }
```
Validation: `name` 1–80 unique per business (active); `durationMinutes` 1–600; `price.amount` int ≥ 0; `colorToken ∈ {primary,secondary,amber500,green500}`.

---

## D. Staff — `/staff`

| Method | Path | Purpose |
|---|---|---|
| GET | `/staff?active=true` | List seats |
| POST | `/staff` | Create seat (optionally invite as user) |
| PATCH | `/staff/:id` | Update (name, role, color, accepts_walk_ins, active) |
| DELETE | `/staff/:id` | Deactivate (must have no active queue entries) |
| PATCH | `/staff/reorder` | Reorder |

**Staff model**
```json
{ "id": "st_..", "name": "John", "roleLabel": "Master barber",
  "colorToken": "primary", "acceptsWalkIns": true, "isActive": true, "userId": null }
```
Validation: `name` 1–60; deleting a seat with active entries → `409 SEAT_HAS_ACTIVE_ENTRIES`.

---

## E. Queue — `/queue`  (core)

| Method | Path | Purpose | FR |
|---|---|---|---|
| GET | `/queue?view=grouped\|flat&staffId=&status=` | Live queue, grouped by seat (default) or flat | FR-C1–C4 |
| POST | `/queue` | Add walk-in | FR-C5 |
| GET | `/queue/:id` | Entry detail | FR-C8 |
| POST | `/queue/:id/start` | Start service | FR-C9 |
| POST | `/queue/:id/checkout` | Complete & auto-promote next | FR-C10 |
| POST | `/queue/:id/no-show` | Mark no-show | FR-C11 |
| POST | `/queue/:id/reassign` | Move to another seat | FR-C12 |
| POST | `/queue/:id/extend` | Add service add-on | FR-C13 |
| POST | `/queue/:id/move` | Reorder within seat | FR-C14 |
| DELETE | `/queue/:id` | Cancel/remove | FR-C17 |

**GET /queue?view=grouped → 200** (mirrors `buildSeatGroups`)
```jsonc
{
  "seats": [{
    "id": "st_john", "name": "John", "colorToken": "primary",
    "serving": true, "servingName": "Aisha Khan",
    "subLine": "Serving Aisha · ~30 min",
    "waitBadge": "2 waiting", "waitingCount": 2, "clearMinutes": 60, "empty": false,
    "cards": [
      { "id": "q_1", "name": "Aisha Khan", "service": "Haircut & Beard",
        "status": "in_service", "position": 1, "source": "walk_in",
        "rightText": "In service", "etaMinutes": 0, "initials": "AK" },
      { "id": "q_2", "name": "Rahul Mehta", "service": "Hair Color",
        "status": "waiting", "position": 2, "source": "online",
        "rightText": "~30 min", "etaMinutes": 30, "initials": "RM" }
    ]
  }],
  "summary": { "seatCount": 3, "activeCount": 5, "waitingCount": 3 }
}
```

**POST /queue** (add walk-in) — request
```jsonc
{
  "name": "Priya Shah",                 // required, 1–80
  "phone": "+919820000000",             // optional, E.164 (+91 default)
  "serviceId": "s_haircut",             // required (or "serviceName" for ad-hoc)
  "staffId": "auto",                    // "auto" (lightest seat) | staff id
  "position": "end"                     // "end" | "next"
}
```
Response `201` returns the created entry + the recomputed seat group. Validation errors mirror the app: missing `name` → message "Enter a customer name"; missing service → "Pick a service" (`store.addWalkin`). `staffId` must be an active seat of this business or `"auto"`.

**POST /queue/:id/reassign** → `{ "staffId": "st_lisa" }`. Entry must be `waiting`; appends to target seat's end (per `store.reassign`).

**POST /queue/:id/extend** → `{ "label": "Beard trim", "minutes": 15 }` *or* `{ "extraServiceId": "s_beard" }`. Appends label to `service_name` (dedup, per `store.extendService`), adds minutes, recomputes downstream waits, records a `queue_entry_extra`. Entry must be `in_service`.

**POST /queue/:id/move** → `{ "toIndex": 0 }`. Reorders within the entry's seat (waiting only). Clamped to `[0, waitingCount-1]` (per `store.moveWithinSeat`).

**POST /queue/:id/checkout** → creates a `visit`, marks `completed`, auto-promotes next waiting entry in that seat to `in_service`, returns `{ entry, promoted: { id, name } | null, seat }` (per `store.checkout` toast "…now in service").

All queue mutations emit Socket.IO events ([08](./08-realtime-socketio.md)) and are transactional/serialized per business (NFR-C1).

---

## F. Appointments — `/appointments`

| Method | Path | Purpose | FR |
|---|---|---|---|
| GET | `/appointments?date=YYYY-MM-DD&status=` | List (default today) | FR-D1 |
| POST | `/appointments` | Create | FR-D3 |
| GET | `/appointments/:id` | Detail | |
| PATCH | `/appointments/:id` | Reschedule/update | |
| POST | `/appointments/:id/check-in` | Convert to queue entry (online source, auto seat) | FR-D2 |
| POST | `/appointments/:id/cancel` | Cancel | FR-D4 |
| POST | `/appointments/:id/no-show` | Mark no-show | FR-D4 |

**Appointment model**
```json
{ "id": "a_11", "customerName": "Neha Gupta", "customerPhone": "+91...",
  "serviceId": "s_kt", "serviceName": "Keratin Treatment",
  "staffId": null, "scheduledStartAt": "2026-07-02T07:00:00Z",
  "scheduledEndAt": "2026-07-02T08:30:00Z", "status": "confirmed", "source": "owner" }
```
**check-in** → `201` returns the new queue entry (per `store.checkInAppt`: appends to queue, source `online`, auto seat, appointment removed from active list). Validation: appointment must be `confirmed`/`pending` and not already checked in.

---

## G. Customers — `/customers`

| Method | Path | Purpose | FR |
|---|---|---|---|
| GET | `/customers?search=&limit=&cursor=` | List/search (**plan-gated**) | FR-E1–E3 |
| GET | `/customers/:id` | Profile (plan-gated) | FR-E6 |
| POST | `/customers` | Create | |
| PATCH | `/customers/:id` | Update (name, VIP, notes) | FR-E4 |
| GET | `/customers/:id/visits` | Visit history | FR-E5 |

**GET /customers → 200** (free plan)
```jsonc
{
  "data": [ { "id":"c_..","name":"Rahul Mehta","phone":"+91 98201 12345",
              "isVip":true,"visitsCount":14,"lastVisitLabel":"3d",
              "lastVisitAt":"2026-06-29T..","totalSpend":{"amount":620000,"currency":"INR"} } ],
  "plan": "free",
  "meta": { "shown": 2, "total": 4, "lockedCount": 2, "limit": 2 },  // drives "N more clients locked"
  "nextCursor": null
}
```
Server enforces `FREE_LIMIT` (=2, configurable) — free plan returns only the latest N by `created_at` and reports `lockedCount`; it does **not** return locked rows' details (NFR-SE10). Premium returns all + `total` ("312 total"). Search matches name/phone substring, case-insensitive (FR-E2). Validation: `search` ≤ 80 chars; `phone` on create unique per business → `409 CUSTOMER_EXISTS`.

---

## H. Dashboard — `/dashboard`

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/summary` | KPI tiles (FR-B2) |

**GET /dashboard/summary → 200**
```json
{
  "date": "2026-07-02",
  "kpis": {
    "todaysAppointments": 24, "activeNow": 8, "checkInCount": 8,
    "completed": 11, "revenue": { "amount": 1840000, "currency": "INR" }
  },
  "deltas": { "todaysAppointments": "+4", "revenue": "+12%", "completed": "+11" }
}
```
Computation in [07](./07-business-logic.md#dashboard-kpis).

---

## I. Notifications (owner center) — `/notifications`

| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications?unread=true` | List owner alerts (FR-B6 / FR-I3) |
| POST | `/notifications/read` | Mark read (`{ ids: [] }` or all) |

Empty → `{ "data": [], "unreadCount": 0 }` (client shows "No new notifications").

---

## J. Subscription & billing — `/subscription`

| Method | Path | Purpose | FR |
|---|---|---|---|
| GET | `/subscription` | Current plan/status/limits | FR-G1 |
| POST | `/subscription/upgrade` | Start upgrade → payment intent | FR-G2/G3 |
| POST | `/subscription/checkout` | Confirm payment / activate | FR-G3 |
| POST | `/subscription/cancel` | Cancel/downgrade | |

**POST /subscription/upgrade → 200**
```json
{ "plan": "premium", "provider": "razorpay",
  "checkout": { "orderId": "order_..", "amount": {"amount":49900,"currency":"INR"}, "keyId": "rzp_.." } }
```
On payment success (client callback + webhook), plan flips to `premium`, CRM unlocks (per `store.upgrade`). If billing is out of MVP scope, `/subscription/upgrade` may directly activate — see [17](./17-assumptions-open-questions.md#subscription--billing).

---

## K. Public — customer microsite — `/public`  (no owner auth)

| Method | Path | Purpose | FR |
|---|---|---|---|
| GET | `/public/businesses/:slug` | Full microsite payload | FR-H1 |
| GET | `/public/businesses/:slug/availability` | Live wait & count (poll fallback) | FR-H2 |
| GET | `/public/businesses/:slug/staff` | Per-barber live availability | FR-H3 |
| GET | `/public/businesses/:slug/slots?date=&serviceId=&staffId=` | Bookable slots | FR-H11 |
| POST | `/public/businesses/:slug/otp/request` | Send OTP to phone | FR-H10 |
| POST | `/public/businesses/:slug/otp/verify` | Verify → short-lived customer token | FR-H10 |
| POST | `/public/businesses/:slug/queue` | Join live queue → ticket | FR-H4/H6 |
| POST | `/public/businesses/:slug/appointments` | Book a slot | FR-H5 |
| GET | `/public/tickets/:ticketId` | Live ticket status | FR-H7 |
| DELETE | `/public/tickets/:ticketId` | Leave queue | FR-H9 |

**GET /public/businesses/:slug → 200** (drives `sharp-cuts/page.tsx`)
```jsonc
{
  "id":"b_..","slug":"sharp-cuts","name":"Sharp Cuts",
  "tagline":"Bandra's neighbourhood barber",
  "rating":4.9,"reviewCount":212,"establishedYear":2014,
  "address":"Shop 4, Linking Road, Bandra West, Mumbai",
  "openStatus":{"isOpen":true,"closesAt":"20:00","label":"Open now · till 8 PM"},
  "hours":[{"day":"Mon–Fri","label":"10 AM – 8 PM"},{"day":"Sunday","label":"Closed","closed":true}],
  "amenities":["Air conditioned","UPI · Card · Cash","Parking","Free wifi","Kids friendly","Wheelchair access"],
  "gallery":["https://cdn../1.jpg"],
  "services":[{"id":"cut","name":"Haircut","durationMinutes":30,"price":{"amount":25000,"currency":"INR"}}],
  "staff":[{"id":"john","name":"John","roleLabel":"Master barber","busy":true,"queueCount":3,"waitLabel":"~45m"}],
  "reviews":[{"stars":5,"text":"Best fade...","authorName":"Aman R."}],
  "faqs":[{"q":"Do I need an appointment?","a":"No — walk in..."}],
  "live":{"waitMinutes":35,"queueCount":6},
  "payments":["UPI","Card","Cash"]
}
```

**GET /public/businesses/:slug/availability → 200**
```json
{ "waitMinutes": 35, "queueCount": 6, "updatedAt": "2026-07-02T09:00:00Z" }
```

**POST /public/businesses/:slug/queue** (join) — request
```jsonc
{
  "serviceId": "cut",                 // required
  "name": "Aman",                     // required, 1–80
  "phone": "+919820000000",           // required, E.164
  "preferredStaffId": "any",          // "any" | staff id (optional)
  "otpToken": "jwt.."                 // required if OTP gating enabled (FR-H10)
}
```
Response `201` (ticket — mirrors `Ticket`/step-3):
```json
{ "ticketId": "q_..", "token": "A-24", "ahead": 3, "waitMinutes": 20,
  "status": "waiting", "staffName": "John", "serviceName": "Haircut",
  "socket": { "namespace": "/customer", "room": "ticket:q_.." } }
```
**POST /public/businesses/:slug/appointments** (book) — same body plus `"slotStart": "2026-07-03T05:30:00Z"`; returns the appointment + confirmation. Validation: slot must be free & within hours.

**GET /public/tickets/:ticketId → 200**
```json
{ "ticketId":"q_..","token":"A-24","ahead":2,"waitMinutes":13,
  "status":"waiting","isYourTurn":false,"progressPct":33 }
```
When `ahead` reaches 0 → `status:"in_service"`, `isYourTurn:true` ("It's your turn!"). Ownership: requires the OTP/customer token or a signed ticket URL; a bare `ticketId` must not leak PII across customers.

**Rate limits** on all `/public/*` POST endpoints — see [12](./12-rate-limiting.md).

---

## L. Webhooks — `/webhooks` (machine, signature-verified)

| Method | Path | From |
|---|---|---|
| POST | `/webhooks/payments` | Razorpay/Stripe — payment/subscription events |
| POST | `/webhooks/sms` | SMS provider — delivery receipts (DLR) |

---

## M. Health — unversioned

`GET /healthz` (liveness), `GET /readyz` (DB/Redis reachable). Return `200`/`503`.

---

## Cross-cutting validation rules

| Field | Rule |
|---|---|
| Phone | Normalize to E.164; default region `+91`; reject non-numeric after prefix (mock uses `phone-pad`, `+91` prefix, "98xxx xxxxx"). |
| Name | Trim; 1–80 chars; collapse internal whitespace (initials derived from first two tokens per `format.initials`). |
| Money in | Integer paise ≥ 0; reject floats. |
| Enum inputs | Must match the enums in [04](./04-data-model.md#enumerations); reject others. |
| IDs | Validate ownership (belongs to token's business) before mutating; else `404` (not `403`, to avoid tenant enumeration). |
| Dates | ISO-8601; `date` query params `YYYY-MM-DD` interpreted in business timezone. |
| Strings | `.strict()` — reject unknown keys; escape on output. |
