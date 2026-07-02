# 03 — User Roles & Permissions

## 1. Actors

| Actor | Authenticated? | Surface | Evidence |
|---|---|---|---|
| **Owner** | Yes (User ID + password) | Owner app | `Login.tsx` — full control of one business |
| **Manager** | Yes | Owner app | Inferred from "Staff & permissions" settings row |
| **Staff / Barber** | Yes (assumed) | Owner app (limited) | `staff[]`; "Staff & permissions" implies staff logins |
| **Customer** | Lightweight (phone + OTP) | Public microsite | Join/book flows; `OTPInput.tsx` |
| **Anonymous visitor** | No | Microsite / marketing | Reads public business data |
| **Platform admin** | Yes (internal) | Internal tooling | Inferred (multi-tenant SaaS ops) |
| **System / service** | Machine | Jobs, webhooks | Background jobs, provider callbacks |

> ⚠️ The mock has **one** login (owner) and no role UI. Manager/Staff roles are inferred from the "Staff & permissions" settings row. Confirm the role set in [17](./17-assumptions-open-questions.md#roles).

## 2. Role definitions

- **Owner** — the business account holder. Full CRUD on their business: settings, services, staff, queue, appointments, customers, subscription/billing. Can invite/manage staff.
- **Manager** — operational admin without billing/ownership transfer. Manages queue, appointments, customers, services, staff scheduling.
- **Staff (Barber)** — operates their own seat's queue; can start/complete/no-show/extend for entries assigned to them; sees customers per plan; **cannot** change billing, business profile, or other staff.
- **Customer** — acts only on their **own** ticket/appointment (view status, leave queue, rebook). Scoped by phone/ticket ownership, never by `business_id` token.
- **Platform admin** — cross-tenant support/ops. Impersonation must be audited.
- **System** — background jobs & webhook handlers acting on behalf of the platform.

## 3. Permission matrix (owner-app scope)

Legend: ✅ full · 🟡 limited/own-seat · ➖ none · 💲 plan-gated

| Capability | Owner | Manager | Staff | Customer |
|---|:--:|:--:|:--:|:--:|
| Sign in to owner app | ✅ | ✅ | ✅ | ➖ |
| View dashboard/KPIs | ✅ | ✅ | 🟡 (own metrics) | ➖ |
| View full queue (all seats) | ✅ | ✅ | ✅ (read) | ➖ |
| Add walk-in | ✅ | ✅ | ✅ | ➖ |
| Start / complete / no-show entry | ✅ | ✅ | 🟡 own seat | ➖ |
| Reassign entry to another seat | ✅ | ✅ | 🟡 (to self) | ➖ |
| Extend service (add-ons) | ✅ | ✅ | 🟡 own seat | ➖ |
| Reorder within a seat | ✅ | ✅ | 🟡 own seat | ➖ |
| View appointments | ✅ | ✅ | 🟡 own | ➖ |
| Create appointment | ✅ | ✅ | 🟡 | ➖ |
| Check in appointment → queue | ✅ | ✅ | ✅ | ➖ |
| View customers | ✅💲 | ✅💲 | 🟡💲 | ➖ |
| Edit customer / VIP | ✅ | ✅ | ➖ | ➖ |
| Manage services & pricing | ✅ | ✅ | ➖ | ➖ |
| Manage staff & permissions | ✅ | 🟡 | ➖ | ➖ |
| Edit business profile / hours | ✅ | ✅ | ➖ | ➖ |
| View/share QR & booking link | ✅ | ✅ | ✅ | ➖ |
| Manage subscription / billing | ✅ | ➖ | ➖ | ➖ |
| Toggle own dark-mode pref | ✅ | ✅ | ✅ | ➖ |

## 4. Public / customer permissions (microsite scope)

| Capability | Customer (OTP) | Anonymous |
|---|:--:|:--:|
| View business public profile | ✅ | ✅ |
| View live wait / availability | ✅ | ✅ |
| Request/verify OTP | ✅ | ✅ (to become verified) |
| Join queue | ✅ | 🟡 (may require OTP — see FR-H10) |
| Book a time slot | ✅ | 🟡 |
| View **own** ticket status | ✅ (own token) | ➖ |
| Leave **own** queue ticket | ✅ (own token) | ➖ |

## 5. Plan-based capability gating (orthogonal to role)

From `Customers.tsx` (`FREE_LIMIT = 2`) and `store.plan`:

| Capability | Free | Premium (Professional) |
|---|---|---|
| Customer list visibility | Latest **2** only; rest locked | **All** customers + total count |
| Customer history/spend detail | Locked beyond limit | Full |
| (Other premium perks) | — | TBD — see [17](./17-assumptions-open-questions.md#subscription--billing) |

**Enforcement rule (NFR-SE10):** the server truncates/locks results based on the tenant's subscription; the client blur is cosmetic only. A free-plan request for customer #3 must return a `402`/gated response or omit the record — never the full row.

## 6. Authorization enforcement points

1. **Authentication middleware** resolves the principal (owner/staff user, customer, or anonymous) and their `business_id`/role from the token.
2. **Tenant guard** injects `business_id` into every data-access call; cross-tenant access is impossible by construction.
3. **Role guard** (route-level) checks the capability matrix above.
4. **Ownership guard** (customer) verifies the ticket/appointment belongs to the requesting phone/token.
5. **Plan guard** applies subscription limits to list/detail responses.

See [06 — Authentication & Authorization](./06-auth.md) for token mechanics.
