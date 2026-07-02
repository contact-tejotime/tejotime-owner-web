# 08 — Realtime: Socket.IO Event Catalog

"Live" is a first-class product promise: the owner queue updates across devices, and each customer ticket shows live position/progress (`sharp-cuts/page.tsx` ticks; `Queue.tsx`/`DetailPanel.tsx` reflect live state). Socket.IO carries these pushes; REST polling of `/public/tickets/:id` and `/availability` is the fallback (NFR-A2).

## 1. Server setup

- Socket.IO 4 mounted on the same HTTP server as Express.
- **Redis adapter** (`@socket.io/redis-adapter`) so events fan out across all API instances (NFR-S3).
- Transports: WebSocket preferred, long-polling fallback.
- Emit events **after** the DB transaction commits (transactional outbox / post-commit hook).

## 2. Namespaces

| Namespace | Audience | Auth |
|---|---|---|
| `/owner` | Owner-app clients | JWT access token in `handshake.auth.token` |
| `/customer` | Microsite ticket viewers | customer token or signed ticket key in `handshake.auth` |

## 3. Rooms

| Room | Members | Purpose |
|---|---|---|
| `business:{businessId}` | all owner sockets of that tenant | queue/appointment/customer/dashboard updates |
| `business:{businessId}:seat:{staffId}` | owner sockets viewing a seat (optional) | fine-grained seat updates |
| `public:{businessId}` | all microsite viewers of that business | live availability (wait/count) |
| `ticket:{ticketId}` | the one customer holding that ticket | that ticket's live status |

Join rules: an authenticated `/owner` socket auto-joins `business:{bid}` (from its JWT). A `/customer` socket joins `public:{bid}` on connect and `ticket:{id}` after presenting a valid ticket credential. **Never** let a client join an arbitrary room without authorization.

## 4. Connection lifecycle

```
client → connect(namespace, auth)
server → verify token/signature → on fail: emit "error"+disconnect
server → socket.join(rooms)
server → emit "connected" { serverTime }
...events...
client → disconnect
```
Heartbeats via Socket.IO ping/pong. On reconnect, client re-fetches authoritative state via REST (`GET /queue`, `GET /public/tickets/:id`) then resumes listening (events are not a durable log).

---

## 5. Event catalog — `/owner` namespace

All payloads include `businessId`, `at` (ISO timestamp), and `actor` (`{ userId, role }` or `"system"`). Server → client unless noted.

| Event | When | Payload (shape) |
|---|---|---|
| `queue:snapshot` | on join / on request | `{ seats: SeatGroup[], summary }` — full current queue (same shape as `GET /queue?view=grouped`) |
| `queue:entry.created` | walk-in added / appt checked in (FR-C5, FR-D2) | `{ entry, seatId, position, source }` |
| `queue:entry.started` | start service (FR-C9) | `{ entryId, seatId }` |
| `queue:entry.completed` | checkout (FR-C10) | `{ entryId, seatId, promoted: {id,name}|null, visitId }` |
| `queue:entry.no_show` | no-show (FR-C11) | `{ entryId, seatId }` |
| `queue:entry.reassigned` | reassign (FR-C12) | `{ entryId, fromSeatId, toSeatId }` |
| `queue:entry.extended` | add-on (FR-C13) | `{ entryId, label, minutes, newServiceName, extraMinutes }` |
| `queue:entry.moved` | reorder (FR-C14) | `{ seatId, order: entryId[] }` |
| `queue:entry.removed` | cancel/leave (FR-C17) | `{ entryId, seatId }` |
| `queue:reordered` | any position/ETA recompute | `{ seatId, cards: Card[] }` (or full `seats`) |
| `appointment:created` | new booking (owner or online) | `{ appointment }` |
| `appointment:checked_in` | check-in (FR-D2) | `{ appointmentId, queueEntryId }` |
| `appointment:updated` | reschedule/cancel/no-show | `{ appointment }` |
| `customer:created` | new customer captured | `{ customer }` |
| `customer:updated` | VIP/edit | `{ customer }` |
| `dashboard:summary` | KPI change (debounced) | `{ kpis, deltas }` |
| `notification:new` | new owner alert | `{ notification, unreadCount }` |
| `subscription:updated` | plan change (FR-G2) | `{ plan, status }` |
| `error` | auth/permission failure | `{ code, message }` |

> Clients may either apply granular deltas or, on any `queue:*` event, refetch `queue:snapshot` (simpler; the mock rebuilds the whole view on each change via `buildSeatGroups`). Granular events reduce bandwidth; both are supported.

Optional **client → server** (if you prefer socket commands over REST; REST is the default in [05](./05-api-endpoints.md)):
`queue:request_snapshot`, `queue:start {entryId}`, `queue:checkout {entryId}`, etc. — each ACK-ed and authorized identically to the REST route. Recommendation: **mutations over REST** (idempotency, retries, caching), **updates over sockets**.

---

## 6. Event catalog — `/customer` namespace

### Room `public:{businessId}` (anonymous viewers)
| Event | When | Payload |
|---|---|---|
| `availability:updated` | live wait/count changes | `{ waitMinutes, queueCount, updatedAt }` (drives hero + team live badges; mock polls every 6s) |
| `staff:availability` | a barber's queue/wait changes | `{ staffId, busy, queueCount, waitLabel }` |

### Room `ticket:{ticketId}` (one customer)
| Event | When | Payload |
|---|---|---|
| `ticket:snapshot` | on join | `{ ticketId, token, ahead, waitMinutes, status, progressPct }` |
| `ticket:updated` | position/ETA change (line advanced) | `{ ahead, waitMinutes, progressPct, status }` |
| `ticket:two_away` | ahead ≤ 2 crossed | `{ ahead }` — mirrors the SMS trigger ([07 §14](./07-business-logic.md#14-2-away-notification-trigger)) |
| `ticket:ready` | it's their turn (`ahead==0` / promoted) | `{ token, seatName }` → UI "It's your turn!" |
| `ticket:cancelled` | owner no-show / customer leaves | `{ reason }` |
| `ticket:completed` | service completed | `{ visitId }` |

`progressPct` mirrors the mock: `round((1 - ahead/initialAhead) * 100)`, clamped 0–100 (100 when it's their turn).

---

## 7. Authorization & anti-abuse

- `/owner` sockets: JWT verified on handshake; room = the token's `business_id` only. Reject mismatched room joins.
- `/customer` ticket rooms: joining `ticket:{id}` requires the ticket credential (customer token phone-match or signed key). Otherwise a viewer could subscribe to strangers' tickets.
- Connection rate-limited per IP; max concurrent sockets per IP; drop unauthenticated sockets after a short grace period.
- Payloads to `/customer` are **PII-minimal** (no other customers' names/phones — only counts, the viewer's own token/status).

## 8. Delivery guarantees

Socket events are **best-effort, at-most-once**, not a source of truth. Correctness comes from REST reads on (re)connect. Critical customer notifications (2-away, ready) are **also** sent via SMS ([09](./09-background-jobs.md)) so delivery does not depend on an open socket.

## 9. Scaling notes

- Horizontal: Redis adapter broadcasts across instances; use sticky sessions or force WebSocket to keep a client on one node for connection stability.
- Backpressure: coalesce rapid `queue:*` recomputes (debounce `dashboard:summary`, `availability:updated`).
- Metrics: track connected sockets, rooms, emit rate, and adapter Redis health (NFR-O2).
