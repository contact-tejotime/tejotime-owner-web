# TejoTime — project summary (for a diagram)

**Reviewed from the code on 2026-09-24.** Everything below was checked against the repository, not
from memory. Where something is built but switched off, it says so.

This document is written to be turned into **one visual diagram for a sales audience**. Suggested
diagram options are at the end.

---

## 1. What the product is, in one paragraph

TejoTime is booking-and-queue software for small service businesses — salons, barbershops, nail and
tattoo studios, spas, clinics, pet grooming. Each business gets a **public booking page** of its
own (its services, prices, photos, hours, team), where customers can **book a time** or **join the
live waiting list** from their phone. The owner and their staff run the day from a **mobile app**
(iOS and Android) or a **web portal**: a live queue per chair, appointments, a customer list with
visit and spend history, and daily reports. A separate **platform admin panel** is where TejoTime
staff set up new businesses and watch the whole network.

## 2. Who uses it

| Audience | What they use | What they get |
|---|---|---|
| **Customer** (the public) | The business's booking page on their phone. No app, no account. | Book a slot, join the live queue, get a ticket showing their position and wait, see when it's nearly their turn |
| **Business owner / co-owner** | Mobile app + web portal | Live queue, walk-ins, appointments, calendar, customers, reports, their booking page's look, team logins |
| **Staff member** (one chair) | Same mobile app / portal, restricted | Only their own chair's queue and bookings — they cannot see the whole shop's customer book |
| **TejoTime platform team** | Admin panel | Create and configure businesses, network analytics, billing view, sales inquiries, admin team |

Two platform admin levels: an **owner** admin sees the whole network; an **employee** admin sees
only the businesses they created.

## 3. The five pieces of software

| # | Piece | Who it serves | Runs at |
|---|---|---|---|
| 1 | **Customer booking site** + marketing site | Public / customers | `www.tejotime.com`, each business at its own URL |
| 2 | **Owner web portal** | Owners, staff | `business.tejotime.com` |
| 3 | **Owner mobile app** (one codebase, iOS + Android) | Owners, staff | App Store / Play Store |
| 4 | **Platform admin panel** | TejoTime team | `admin.tejotime.com` |
| 5 | **API + realtime server** | Everything above | `api.tejotime.com` |

Behind the API: one **PostgreSQL database** (26 tables, 28 migrations) and one **private file store**
for photos and logos. The API exposes **96 endpoints** across 16 areas (auth, business, services,
staff, team logins, queue, appointments, customers, reports, notifications, subscription, uploads,
public booking, webhooks, platform admin, health).

## 4. System map — boxes and arrows for the diagram

```
CUSTOMER (phone browser)
   └─► Booking site  ──────────────► API ──► PostgreSQL
                                      │  └─► File store (photos, logos, QR)
OWNER / STAFF (phone)
   └─► Mobile app (iOS, Android) ───► API
OWNER / STAFF (laptop)
   └─► Web portal ──────────────────► API
TEJOTIME TEAM
   └─► Admin panel ─────────────────► API

Live updates (websocket, both directions of interest):
   API ──► owner app + portal   : queue changed, someone joined, service started/finished
   API ──► customer's ticket    : position moved, nearly your turn, it's your turn
```

Two details worth drawing:
- The **web portal and admin panel never talk to the API from the browser.** The page server does
  it, so no access token is ever exposed in a browser. The mobile app and the public booking page
  call the API directly.
- **One live queue engine** produces the wait times for all three audiences, so the owner's board,
  the booking page and the customer's ticket can never disagree.

## 5. The four flows that matter (good candidates for a journey diagram)

**A. Customer books a time**
1. Opens the business's booking page (link, QR code, or its phone number as the address).
2. Picks services → sees a 14-day date strip → picks a day and time, optionally a specific person.
3. Confirms with name and phone. The booking appears instantly on the owner's app and portal.

**B. Customer joins the live queue (walk-in from their own phone)**
1. Opens the same page, taps join the waiting list.
2. Gets a ticket: position, people ahead, estimated wait.
3. The ticket updates itself live, and alerts them once when they're about 15 minutes away, and
   again when it's their turn.

**C. Owner runs the day**
1. Home shows three numbers: **waiting**, **in service**, and **what a walk-in would wait right
   now** (the number they quote at the door).
2. One tap adds a walk-in; an empty chair can be tapped to add straight to it.
3. Cards can be dragged to reorder a chair's queue or moved to another chair.
4. Start service → Checkout. Checkout records the visit and money taken, updates that customer's
   visit count, spend and last visit, and automatically pulls the next person into the chair.

**D. TejoTime sets up a new business**
1. Admin panel creates the business, its owner login, category and details.
2. Owner signs in, adds services, hours, team and photos, and their booking page is live.
3. They share the page link or print its QR code.

## 6. What each surface can do

**Customer booking page:** business profile (services with fixed or range prices, or "price on
request"; photos; amenities; hours; team; reviews; FAQs), online booking, live-queue join, ticket
tracking by phone number, save-contact card, a help chat that answers from the business's own
details, and cookie consent.

**Owner mobile app:** first-run tour; live queue board per chair with drag and drop; add walk-in;
appointments for today; month calendar; customer list with visits, spend and last visit; daily and
monthly reports, including per-staff revenue; booking QR code; settings for profile, hours, services,
staff, notifications, password, and team logins with per-screen permissions; the look of their
booking page (6 themes, light/dark, colour, corners, density); dark mode.

**Owner web portal:** the same product for a laptop — home queue, appointments, calendar, customers,
reports, settings, team, booking page look.

**Platform admin panel:** network dashboard and reports, business list and per-business detail
(settings, customers, visits, appointments, analytics), reset an owner's password, sales inquiries
from the marketing site, billing view, admin team management.

## 7. Money and plans — current honest state

- The database and the app model a **free plan and a premium plan** per business. On the free plan
  the customer list is trimmed to the most recent 2 customers (enforced on the server, not just
  hidden in the app).
- **No payment provider is connected yet.** The upgrade path is built behind a switch; with payments
  off, an upgrade simply flips the plan.
- The marketing site currently sells: **Starter — Free during the U.S. pilot**, **Business — coming
  soon**, **Multi-location — contact us**.
- **The mobile app deliberately contains no purchase or plan wording at all.** Apple rejected the
  first submission (guideline 2.1(b)) for referring to a subscription with nothing behind it, so
  every plan and upgrade screen was removed from the app. Selling stays on the web.
- ⚠️ **Mixed market signals to resolve before a sales deck:** the product's defaults are India
  (₹ rupees, Asia/Kolkata time, Indian phone formats) while the marketing copy sells a **U.S.
  pilot**. Pick one story for the diagram.

## 8. Integrations — what is live and what is not

| Capability | State |
|---|---|
| Photo / logo storage (private, signed links) | **Live** |
| Live updates (websocket) | **Live** |
| SMS and WhatsApp reminders (Twilio) | **Built, switched off** |
| Email | **Not built** (placeholder) |
| Card payments | **Not built** (placeholder) |
| Help chat on booking page and marketing site | **Built, switched off by default**; works with or without an AI key |
| Phone OTP login | **Not built** (placeholder, deliberately blocked) |

For a sales diagram, only the first two should be shown as capabilities today. Reminders are a
"ready to switch on" item.

## 9. Automatic background work

Four jobs run on the server: recompute queue wait alerts every minute; clear abandoned tickets every
15 minutes; two housekeeping purges. This is why a customer's ticket keeps counting down without
anyone touching the app.

## 10. Data the business owns

Businesses, their hours, services, photos, staff chairs, logins and permissions; customers; bookings;
live queue entries; a completed-visit ledger with the money taken; notifications; subscription and
payment records; consent logs; sales inquiries. Every query is scoped to one business, so businesses
can never see each other's data.

## 11. Scale and reliability, in plain terms

Runs on Railway with separate production and pre-production environments. Currently **one server
instance**, which is enough for the pilot but is the first thing to change for growth: live updates,
rate limiting and the scheduled jobs all live inside that single instance today. Database changes are
applied by hand before each release.

---

## 12. Suggested diagram (pick one)

1. **System map (recommended for a sales manager):** four user types on the left → the four apps →
   one API → database and file store, with the live-update arrows drawn back out to the owner and the
   customer. Label the capabilities, not the technology.
2. **Customer journey:** the booking page → book a slot *or* join the queue → live ticket → served →
   visit and spend saved to the customer's history.
3. **Owner's day:** morning (see the three numbers) → walk-ins and bookings arrive → drag to reorder
   → start → checkout → evening report.

**Please keep out of a customer-facing diagram:** SMS/WhatsApp reminders, email, card payments and
the help chat (all off or unbuilt), phone OTP login, and any pricing figure — the plans are "free
pilot / coming soon / contact us".

**Numbers that are safe to show:** 4 apps for 4 audiences, 1 shared API, 9 service industries named
on the site, 6 booking-page themes, 3 owner roles plus 2 platform admin levels, live updates in
seconds, one live queue engine feeding all three views.
