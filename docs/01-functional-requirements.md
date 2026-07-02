# 01 — Functional Requirements

Each requirement is traced to the UI element that implies it. `FR-#` IDs are stable references. Priority: **P0** = required for MVP (directly wired in UI), **P1** = strongly implied, **P2** = inferred/nice-to-have.

---

## FR-A — Authentication & session (Owner)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-A1 | Owner signs in with **User ID + password**; empty either field → error "Enter your user ID and password". | P0 | `Login.tsx`, `store.signIn` |
| FR-A2 | On success the app shows the authenticated shell (5 tabs); on failure shows inline error. | P0 | `OwnerApp.tsx`, `store.tsx` |
| FR-A3 | Sessions persist across app restarts (token storage). | P1 | Standard app expectation (not in mock) |
| FR-A4 | Support password reset / account recovery. | P2 | Inferred; not in UI |
| FR-A5 | A 4-digit **OTP** input component exists in the design system → OTP-based verification (owner onboarding and/or customer). | P1 | `OTPInput.tsx` |

## FR-B — Dashboard

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-B1 | Show business identity header: name, area, "Open till 9 PM". | P0 | `Dashboard.tsx` header |
| FR-B2 | Show **4 KPI tiles**: Today's appointments, Active (waiting + in-service), Check-in count, Today's revenue. | P0 | `Dashboard.tsx` kpis |
| FR-B3 | KPIs show deltas (e.g. `+4`, `+12%`) vs a comparison period. | P1 | `sample.ts` `kpis[].delta` |
| FR-B4 | Quick actions: **Add walk-in**, **Show QR**. | P0 | `Dashboard.tsx` |
| FR-B5 | Show an **active-queue preview** (first 3 active entries) with "View all" → Queue tab. | P0 | `Dashboard.tsx` `queuePreview` |
| FR-B6 | Notifications bell opens alerts; empty state = "No new notifications". | P1 | `store.openAlerts` |

> KPI definitions (from code): *Today's appts* = `appointments.length + queue.length`; *Active* = entries with status `waiting`\|`in-service`; *Check in* = total queue length; *Revenue* = sum of completed service prices (mock shows static `₹18.4k`). Backend must compute these — see [07 — Business Logic](./07-business-logic.md#dashboard-kpis).

## FR-C — Live queue (multi-seat) — the core feature

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-C1 | Queue is organized into **one lane per staff/seat**. | P0 | `buildSeatGroups` |
| FR-C2 | Each seat lane shows: serving customer, sub-line ("Serving {first} · ~{N} min" or "Available · ready for walk-in"), waiting count badge or "Free". | P0 | `lib/queue.ts` |
| FR-C3 | Waiting entries display a running **ETA label**: "Next up" (0) or "~{cumulative} min". | P0 | `buildSeatGroups` |
| FR-C4 | Filter queue by seat via chips ("All" + per-staff), each with a live waiting count. | P0 | `Queue.tsx` chips |
| FR-C5 | **Add walk-in**: name (required), phone (optional, +91), service (required), seat (`Any seat`=auto or specific), position (`End of queue`\|`Next up`). | P0 | `AddWalkInSheet.tsx`, `store.addWalkin` |
| FR-C6 | "Any seat" auto-assigns to the **lightest-loaded** seat; sheet previews the chosen seat & per-seat load. | P0 | `soonestSeat`, `AddWalkInSheet.tsx` |
| FR-C7 | "Next up" inserts right after the in-service customer of that seat; "End" appends after the seat's last active entry. | P0 | `store.addWalkin` |
| FR-C8 | Open an entry's **detail panel** showing name, status, seat (color dot), service, source (Walk-in / Booked online), position "#{pos} in {seat}'s line". | P0 | `DetailPanel.tsx` |
| FR-C9 | **Start service**: waiting → in-service, wait→0. | P0 | `store.startService` |
| FR-C10 | **Complete & start next** (checkout): in-service → completed; **auto-promote** the next waiting entry in that seat to in-service; increment today's completed count. | P0 | `store.checkout` |
| FR-C11 | **Mark no-show**: entry → no-show. | P0 | `store.noShow` |
| FR-C12 | **Reassign** a waiting entry to another seat (appends to that seat's end, status stays waiting). | P0 | `store.reassign` |
| FR-C13 | **Extend service** with add-ons (Shave +10, Beard trim +15, Hair wash +10, Hair color +30): appends label to service name (dedup), adds extra minutes; **other waiting entries' waits increase** accordingly. | P0 | `DetailPanel.tsx` EXTRAS, `store.extendService` |
| FR-C14 | **Reorder within a seat** via long-press drag (waiting entries only, when >1). | P0 | `Queue.tsx` DraggableCard, `store.moveWithinSeat` |
| FR-C15 | Empty seat shows "Seat free · add a walk-in". | P1 | `Queue.tsx` |
| FR-C16 | All queue mutations broadcast in realtime to other owner devices and affected customer tickets. | P0 | Implied by "live" everywhere → [08](./08-realtime-socketio.md) |
| FR-C17 | Cancel/remove a queue entry (leave queue). | P1 | Customer "Leave queue"; owner parity assumed |

## FR-D — Appointments

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-D1 | List **today's upcoming appointments** sorted by time, each with time, customer, service, status. | P0 | `Appointments.tsx` |
| FR-D2 | **Add to queue** (check-in): converts an appointment into an online queue entry (auto seat), removes it from the appointment list, and switches to the Queue tab. | P0 | `store.checkInAppt` |
| FR-D3 | Create appointments from the owner app ("+" action). | P1 | `Appointments.tsx` header opens walk-in sheet today; real flow implied |
| FR-D4 | Appointments have statuses `upcoming`, `confirmed` (+ cancelled/no-show/completed). | P0 | `sample.ts`, `StatusBadge.tsx` |
| FR-D5 | Date navigation ("Thursday, 24 June" is static today). | P2 | `Appointments.tsx` |

## FR-E — Customers (CRM)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-E1 | List customers with name, phone, VIP badge, and metrics: **Visits, Last visit, Spend**. | P0 | `Customers.tsx`, `CustomerCard` |
| FR-E2 | **Search** by name or phone (case-insensitive, substring). | P0 | `Customers.tsx` filter |
| FR-E3 | **Plan gating**: free plan shows only the latest **2** customers; the rest are blurred/locked with an "Upgrade to Premium" CTA and count "{N} more clients locked". Premium shows all + total count ("312 total"). | P0 | `Customers.tsx` `FREE_LIMIT=2`, `store.plan` |
| FR-E4 | Mark/track **VIP** status. | P0 | `Customer.vip` |
| FR-E5 | Track derived metrics: visit count, total spend, last visit — updated as services complete. | P1 | `Customer` fields; [07](./07-business-logic.md) |
| FR-E6 | View/edit a customer profile & history. | P2 | Implied by CRM |

## FR-F — Settings & configuration

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-F1 | Settings menu rows: **Business profile, Working hours, Services & pricing, Staff & permissions, Booking QR code, Subscription**. | P0 | `Settings.tsx` ROWS |
| FR-F2 | Manage **services** (name, duration, price, color). | P0 | Implied; services drive queue/booking |
| FR-F3 | Manage **staff/seats** (name, role, color, permissions). | P0 | Implied; staff drive queue lanes |
| FR-F4 | Manage **working hours** (per-day open/close, closed days). | P0 | Microsite hours table |
| FR-F5 | Edit **business profile** (name, area, category, address, description, amenities, gallery, logo/hero). | P0 | Microsite content |
| FR-F6 | **Dark mode** preference (persisted per user/device). | P0 | `Settings.tsx` Switch |
| FR-F7 | Show/share/download the **booking QR code** → `tejotime.com/{slug}`. | P0 | `QRSheet.tsx` |

## FR-G — Subscription & billing

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-G1 | Two plans: **Free** (trial, limited CRM) and **Premium/Professional** (full). | P0 | `store.plan`, `Settings.tsx` "Subscription · Professional" |
| FR-G2 | **Upgrade** flow → sets plan to premium, unlocks full CRM, toast "Welcome to Premium". | P0 | `store.upgrade`, `Customers.tsx` |
| FR-G3 | Collect payment for subscription (creditCard icon on upgrade CTA). | P1 | `Customers.tsx` upgrade button |
| FR-G4 | Enforce plan limits server-side (never trust client gating). | P0 | Security requirement for FR-E3 |

## FR-H — Public booking microsite (Customer)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-H1 | Serve per-business public page by slug with: services (name/duration/price), team + live availability, rating/review count, reviews, FAQ, amenities, gallery, address, hours. | P0 | `sharp-cuts/page.tsx` |
| FR-H2 | Show **live wait time & queue count**, refreshed continuously. | P0 | `liveWait`, `liveCount`, 6s tick |
| FR-H3 | Show **per-barber live availability**: busy/free, count in queue, per-barber wait. | P0 | `BARBERS[]` cards |
| FR-H4 | **Join queue** flow: pick service → name + phone (both required) + optional preferred barber → confirm. | P0 | Join modal steps 1–2 |
| FR-H5 | **Book a time slot** flow: same as join but "choose a time" step; produces a booking (appointment). | P0 | `mode === "book"` |
| FR-H6 | On confirm, issue a **ticket**: token (e.g. `A-24`), people ahead, estimated wait, live progress bar. | P0 | step 3, `Ticket` |
| FR-H7 | Ticket updates live as the line advances; when it's the customer's turn, show "It's your turn!". | P0 | `tktTimer`, `justTurn` |
| FR-H8 | Notify the customer by SMS when **2 away** ("we'll text you when you're 2 away"). | P0 | copy in FAQ, hero, modal |
| FR-H9 | **Leave queue** cancels the ticket. | P0 | step 3 "Leave queue" |
| FR-H10 | Verify customer phone (OTP) before/at join. | P1 | `OTPInput.tsx`; anti-abuse for public endpoints |
| FR-H11 | List available booking slots for a chosen date/service/barber. | P1 | implied by "choose a time" |

## FR-I — Notifications & reminders

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-I1 | Send SMS reminders and "you're close" alerts to queued/booked customers. | P0 | microsite + marketing "Reminders" |
| FR-I2 | Send email + SMS appointment reminders to cut no-shows. | P1 | marketing `page.tsx` features |
| FR-I3 | In-app owner notification center (bell). | P1 | `store.openAlerts` |
| FR-I4 | Optional post-service review request. | P2 | reviews exist on microsite |

## FR-J — Marketing site

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-J1 | Static content listing four pillars; "Get started" CTA. | P0 | `frontend/src/app/page.tsx` |
| FR-J2 | Capture business signup/lead. | P2 | "Get started" (destination undefined) |

---

See [17 — Assumptions & Open Questions](./17-assumptions-open-questions.md) for every ambiguity behind these requirements.
