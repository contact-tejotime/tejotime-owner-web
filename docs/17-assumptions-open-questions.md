# 17 — Assumptions & Open Questions

> This spec was reverse-engineered from **static UI with no backend and no network calls** (confirmed: no `fetch`/`axios`/`socket`/env usage anywhere). Everything below is an inference the UI could not fully resolve. **Each item names the UI evidence, the assumption made, and the decision needed.** Please review and confirm before implementation — that's the point of listing them rather than guessing silently.

Legend — **Impact:** 🔴 blocks/changes data model or core flow · 🟡 affects an endpoint/behavior · 🟢 cosmetic/config.

---

## Authentication

| # | UI evidence | Ambiguity → Assumption | Impact | Decision needed |
|---|---|---|---|---|
| Q1 | `Login.tsx` uses **User ID + password**; `signIn` only checks non-empty | Real auth verifies credentials server-side; "User ID" = unique `handle`. | 🔴 | Confirm handle-based login vs email/phone. Password policy? |
| Q2 | `OTPInput.tsx` (4-digit) exists but is **not used in any screen** | Assumed OTP is for **customer** phone verification and optionally owner MFA/passwordless. | 🔴 | Who uses OTP — customers, owners, both? Is owner login password-only or OTP? |
| Q3 | No signup/onboarding screen in the app | Assumed businesses are provisioned via a separate onboarding (marketing "Get started"). | 🔴 | Where/how does a business register? Self-serve or sales-provisioned? |
| Q4 | Single login, no role picker | Assumed roles owner/manager/staff (from "Staff & permissions" row). | 🟡 | Confirm role set & whether staff log into the same app. |

## Roles

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q5 | Settings row "Staff & permissions" | Staff have logins with scoped permissions (own-seat actions). | 🟡 | Confirm the permission model in [03](./03-roles-and-permissions.md). Can staff see all seats or only theirs? |
| Q6 | No multi-location UI | Assumed **one location per business** (single queue). | 🔴 | Will a business ever have multiple branches/locations? Affects tenancy grain. |

## Queue engine & data

| # | UI evidence | Ambiguity → Assumption | Impact | Decision |
|---|---|---|---|---|
| Q7 | `store.extendService` bumps **every** `waiting` entry's `wait` by `mins` (all seats, not just the affected seat) | Assumed this is a mock simplification; real ETA should recompute per-seat. | 🔴 | Should extending one seat's service affect other seats' waits? (Almost certainly per-seat only.) |
| Q8 | Add-ons (Shave/Beard trim/Hair wash/Hair color) add **minutes** but no **price** (`DetailPanel.tsx` EXTRAS) | Assumed each add-on has a price that adds to the bill/revenue. | 🔴 | Are add-ons priced? Are they first-class services or a fixed catalog? |
| Q9 | Token `"A-24"` (`sharp-cuts` step 3) | Assumed `{prefix}-{daily sequence}`, reset daily, global per business. | 🟡 | Exact token scheme: single letter vs rotating (A/B/C), per-seat vs global, resets when? |
| Q10 | `checkout` auto-promotes next; `noShow` does **not** | Assumed no-show of the *in-service* customer should also promote next; no-show of a *waiting* customer just removes them. | 🟡 | Should marking the in-service person no-show auto-start the next? |
| Q11 | `startService` in mock has no "seat already busy" guard | Assumed one in-service per seat (invariant); starting a 2nd → `409`. | 🟡 | Can a seat serve two simultaneously? (Assumed no.) |
| Q12 | Phone optional in walk-in (`AddWalkInSheet`), required in public join | Assumed walk-in phone optional; a phone-less walk-in creates no CRM record (or an anonymous one). | 🟡 | Is phone required to track a customer? De-dup walk-ins into `customer`? |
| Q13 | Queue `time` strings ("10:30 AM", "Just now") | Assumed these are display-only; backend stores `joined_at` timestamps. | 🟢 | Confirm — no scheduled "10:30" semantics for walk-ins? |
| Q14 | `Customer.last` = "3d"/"Today"/"1w"; `spend` = "₹6.2k" (preformatted) | Assumed these are derived from `last_visit_at` and summed `visit` amounts; API returns raw values. | 🟡 | Confirm CRM metrics are computed from visits, not manually entered. |
| Q15 | Mock only increments an in-memory `completed` counter; no revenue ledger | Assumed a `visit` row is created on checkout to power revenue + CRM. | 🔴 | Confirm the completed-service/revenue model (see [04 §3.12](./04-data-model.md#312-visit-completed-service-ledger--powers-crm-metrics--revenue)). |

## Appointments & booking

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q16 | Appointments list is **today only**, static date "Thursday, 24 June"; appts have `time` strings + status `upcoming`/`confirmed` | Assumed appointments have real `scheduled_start_at` timestamps and multi-day support. | 🔴 | Full calendar/scheduling, or today-only? |
| Q17 | Microsite "Book a time slot" step says "choose a time next" but the mock **never shows a time picker** | Assumed a slot-selection step exists (needs availability/slots endpoint). | 🔴 | Define the slot model: fixed intervals? per-service duration? per-barber availability? capacity? |
| Q18 | `checkInAppt` auto-assigns soonest seat & appends to queue | Assumed check-in ignores the appointment's preferred barber for seat choice. | 🟡 | Should check-in honor the booked barber over "soonest seat"? |
| Q19 | Owner "Appointments" "+" button opens the **walk-in** sheet (not a booking form) | Assumed a real create-appointment form is intended. | 🟡 | Confirm owner-side appointment creation UX/fields. |

## Customers & plan gating

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q20 | `FREE_LIMIT = 2`; premium shows "312 total" | Assumed free plan = latest 2 customers; limit is a plan config, enforced server-side. | 🟡 | Confirm the real free-plan limit (2 seems demo-low). What exactly does premium unlock beyond list length? |
| Q21 | "latest N shown" | Assumed "latest" = most recently **created** customers (used `created_at`). | 🟢 | Latest by created or by last visit? |

## Subscription & billing

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q22 | `store.upgrade` flips to premium instantly with a toast; upgrade CTA shows a credit-card icon; Settings shows "Subscription · Professional" | Assumed real billing via a payment provider (Razorpay); plan names free / premium(=Professional). | 🔴 | Is there real paid billing at MVP, or is upgrade free/manual? Price? Trial length? Plan tiers/names? |
| Q23 | Service payments: microsite says "pay at the shop after your service" | Assumed **no in-app payment for services** — only subscription billing is online. | 🟡 | Confirm services are paid offline (no payment gateway for bookings). |

## Realtime

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q24 | Microsite refreshes live wait every **6s** via `setInterval`/random; ticket advances via a local timer | Assumed real live updates come via Socket.IO with REST polling fallback. | 🟡 | Confirm Socket.IO is the intended transport (user explicitly requested a Socket.IO catalog → yes). |
| Q25 | "We'll text you when you're **2 away**" | Assumed threshold = 2, configurable. | 🟢 | Confirm threshold and message channel(s) (SMS only? WhatsApp?). |

## Notifications & messaging

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q26 | Marketing lists "Reminders … SMS and email"; bell shows "No new notifications" | Assumed SMS + email reminders + in-app owner notification center. | 🟡 | Confirm channels (WhatsApp is huge in India — include?). DLT templates required. |
| Q27 | Reviews shown on microsite (★4.9, testimonials) | Assumed reviews are collected (post-visit request) and aggregate into `rating`. | 🟡 | Is review collection in scope, or are reviews imported/manual? |

## Business profile & content

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q28 | Microsite has hero photo, gallery, map, amenities, FAQ, hours, reviews — all **placeholders/hardcoded** | Assumed these are per-business, owner-editable, and stored/served by the backend. | 🟡 | Which of these are editable in the owner app vs platform-managed? (No owner UI exists for them yet.) |
| Q29 | Owner app services (Haircut/Hair Color/Hair Spa) **differ** from microsite services (adds Beard trim, Head massage, Kids haircut; different prices ₹250 vs ₹350) | Assumed a single canonical per-business service list; mock lists are just out of sync. | 🔴 | Confirm one source of truth for services shared by owner app + microsite. |
| Q30 | Slug from QR `tejotime.com/sharp-cuts` | Assumed slug is unique, immutable-ish, set at onboarding. | 🟡 | Slug rules: who sets it, can it change (QR regen), reserved words? |
| Q31 | Currency ₹ / +91 / Mumbai everywhere | Assumed India-only at launch; multi-currency deferred but modeled. | 🟢 | Confirm India-only for v1. |

## Dashboard & metrics

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q32 | Dashboard "Today's appts" = `appts.length + queue.length` (mock) | Assumed this is a mock quirk; real KPI = today's appointment count. | 🟡 | Define each KPI precisely (esp. "appts" and "check in"). |
| Q33 | Deltas "+4", "+12%", "+11" | Assumed deltas compare to a prior period. | 🟡 | Comparison window: vs yesterday? same weekday last week? start-of-day? |
| Q34 | Revenue static "₹18.4k" | Assumed = Σ today's completed `visit` amounts. | 🟡 | Confirm revenue = completed services only (not booked/pending)? Tips/taxes? |

## Infrastructure

| # | Consideration | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q35 | README says "Node/Express API"; env also exposes Supabase tooling | Defaulted to Node/Express + Postgres + Redis + Socket.IO. | 🔴 | Confirm stack: bespoke Node/Express **or** Supabase (Auth/DB/Storage/Realtime)? Changes several sections. |
| Q36 | No region stated | Assumed India region (ap-south-1) for latency + DPDP. | 🟢 | Confirm hosting region & data-residency needs. |
| Q37 | SMS provider unspecified | Assumed MSG91/Twilio; India requires **DLT-registered** templates. | 🟡 | Choose provider; templates must be pre-registered (TRAI). |

## Marketing site

| # | UI evidence | Assumption | Impact | Decision |
|---|---|---|---|---|
| Q38 | `page.tsx` "Get started" links to `#features` (no destination) | Assumed it should route to business signup/lead capture. | 🟡 | Define signup/lead flow & whether it needs an API. |

---

## Recommended pre-build decisions (the 🔴 blockers)

Resolve these **before** writing code — each changes the schema or a core flow:

1. **Q35** — stack: Node/Express vs Supabase.
2. **Q22/Q23** — is online billing in scope; price/trial; services paid offline.
3. **Q15/Q8** — the completed-service `visit`/revenue model and add-on pricing.
4. **Q17/Q16** — the booking/slot model (this is the biggest gap: the "book a time" flow has no working UI).
5. **Q29** — one canonical service list across surfaces.
6. **Q2/Q1** — auth model (password vs OTP; who verifies).
7. **Q6** — single vs multi-location tenancy.
8. **Q7** — ETA recompute scope (per-seat).

Everything else can proceed on the assumptions stated, with the noted config values (`FREE_PLAN_CUSTOMER_LIMIT`, `TWO_AWAY_THRESHOLD`, reminder offsets, token prefix) exposed as environment configuration ([14](./14-environment-variables.md)) so product can tune without a redeploy.
