# 07 — Business Logic

This is the highest-risk area — the queue engine drives what both owners and customers see. The rules below are **transcribed from** `app/src/lib/queue.ts` and `app/src/state/store.tsx`. Implement them server-side as the single source of truth; clients render whatever the API/socket sends.

---

## 1. Core concepts

- The queue is a flat, ordered list of `queue_entry` rows per business. It is **projected into per-seat lanes** by filtering on `staff_id` and *active* status.
- **Active** = `status ∈ {waiting, in_service}` (`isActive` in `queue.ts`).
- Each seat has at most one `in_service` entry; the rest are `waiting` in `position` order.

## 2. ETA / duration math (`estMins`)

```
estMins(entry):
  svc = service matching entry.service_name exactly
  if none: pick the longest service name that is a PREFIX of entry.service_name   // handles "Haircut + Beard"
  base = svc.duration_minutes  (fallback 20 if unknown/unparseable)
  return base + entry.extra_minutes
```
- The prefix match exists because add-ons mutate the service name to `"Haircut + Shave"` while the base service is still `"Haircut"`.
- Fallback duration when no service resolves: **20 minutes**.

## 3. Seat load & auto-assignment

```
seatLoad(staffId)   = Σ estMins(e) for active entries e on that seat
soonestSeat()       = the staff id with the minimum seatLoad
                      (ties → earliest in staff display order; first staff if all empty)
```
Used when `staffId = "auto"` ("Any seat" in the walk-in sheet) and when checking in an appointment. The walk-in sheet also previews each seat's `w waiting · ~{load}m` and the auto target's name.

## 4. Per-seat ETA labels (`buildSeatGroups`)

For each seat, in order:
1. Sum the in-service entries' `estMins` into a running `cum`.
2. In-service cards get `rightText = "In service"`, `etaMinutes = 0`.
3. Each waiting card, in position order:
   - label = `cum <= 0 ? "Next up" : "~{cum} min"`; `etaMinutes = cum`.
   - then `cum += estMins(card)`.
4. Seat meta:
   - `clearMinutes` = Σ estMins over all active entries.
   - `subLine` = serving ? `"Serving {firstName} · ~{clearMinutes} min"` : `"Available · ready for walk-in"`.
   - `waitBadge` = waitingCount>0 ? `"{n} waiting"` : `"Free"`; `free = waitingCount===0`; `empty = active===0`.

The customer-facing "ahead of you" and "est. wait" derive from the same cumulative model: `ahead` = number of active entries before this one in its seat; `waitMinutes` = `cum` at that position.

## 5. Add walk-in (`store.addWalkin`)

```
validate: name required  → else error "Enter a customer name"
          service required → else error "Pick a service"
staffId = (input == "auto") ? soonestSeat() : input
create entry { status: waiting, source: walk_in, extra: 0, joined_at: now, token: nextToken() }
insert by position:
  if position == "next":
     idx = first index in the queue where staff_id==seat AND status==waiting
     if none → append at end of list
     insert BEFORE that first-waiting (i.e., right after the in-service customer)
  else ("end"):
     find LAST index where staff_id==seat AND status ∈ {waiting,in_service}
     insert right after it
toast: (position=="next" ? "Added as next" : "Added to queue") + " · {seatName}"
```
Backend also: upsert `customer` by phone (if provided) and set snapshots.

## 6. Start service (`store.startService`)
```
entry.status: waiting → in_service ; entry.wait/eta → 0 ; started_at = now
toast "Service started"
```
Guard: the seat must not already have an in-service entry (invariant §04.5.1). If it does → `409 SEAT_BUSY` (or auto-queue — confirm in [17]).

## 7. Checkout — "Complete & start next" (`store.checkout`)
```
done = entry; seat = done.staff_id
done.status → completed ; completed_at = now
create visit { amount = service price + Σ add-on prices }         // backend addition
update customer aggregates (visits_count++, total_spend +=, last_visit_at=now)
increment today's completed KPI
AUTO-PROMOTE:
  if seat has no in_service entry now:
     next = first waiting entry on seat (by position)
     if next: next.status → in_service ; started_at = now
              promotedName = next.firstName
toast: promotedName ? "{promotedName} now in service · {seatName}" : "Checked out"
```
This is the key cascade: completing a customer pulls the next person up automatically and must notify that customer's ticket ("It's your turn!").

## 8. No-show (`store.noShow`)
```
entry.status → no_show ; removed from active lanes
toast "Marked no-show"
```
Does **not** auto-promote (only checkout does, in the mock). Confirm whether no-show of the in-service person should promote next — [17](./17-assumptions-open-questions.md#business-logic--data).

## 9. Reassign to another seat (`store.reassign`)
```
guard: entry currently waiting
remove entry from list
find LAST index where staff_id==targetSeat AND status ∈ {waiting,in_service}
insert right after it, with status=waiting, staff_id=targetSeat
toast "Moved to {seatName}"; keep detail panel open on the moved entry
```

## 10. Extend service with add-ons (`store.extendService`)
```
for the target in_service entry:
   if service_name does NOT already contain label (case-insensitive):
       service_name = "{service_name} + {label}"
   entry.extra_minutes += mins
   record queue_entry_extra { label, minutes, price? }
for OTHER entries that are 'waiting' (any seat, in the mock):
   entry.base_wait_minutes += mins           // downstream waits grow
recompute all seat ETAs
toast "+{mins} min · {label} added"
```
Add-on catalog (from `DetailPanel.tsx`): Shave +10, Beard trim +15, Hair wash +10, Hair color +30. **Add-on pricing is not in the mock** — backend must attach prices (likely a service/price per add-on) so revenue and the customer bill are correct. See [17](./17-assumptions-open-questions.md#business-logic--data).

> ⚠️ Note the mock bumps *every* waiting entry's `wait` by `mins`, not just the same seat's. Verify intended scope (same-seat vs global) before shipping — [17](./17-assumptions-open-questions.md#business-logic--data).

## 11. Reorder within a seat (`store.moveWithinSeat`)
```
slots = indices of waiting entries on this seat, in order
order = current ids minus the dragged id
toIndex clamped to [0, order.length]
insert dragged id at toIndex
write back ids into the same slot indices (positions of non-dragged entries preserved)
```
Only reorders `waiting` entries; in-service stays pinned first. Server recomputes `position` and ETAs, then broadcasts.

## 12. Check in appointment (`store.checkInAppt`)
```
staffId = soonestSeat()
create queue_entry { source: online, status: waiting, staff_id: staffId,
                     service = appt.service, name = appt.name, joined_at: now,
                     appointment_id = appt.id, token: nextToken() }
append to end of queue
appointment: remove from active list (status → checked_in), link queue_entry_id
switch owner UI to Queue tab
toast "{name} added to queue"
```

## 13. Token generation

Customer tickets show tokens like `"A-24"`.
- Format: `{business.token_prefix}-{sequence}` (prefix default "A").
- **Sequence** resets daily per business; monotonic increment on each queue-join (walk-in + online). Gap-tolerant (no reuse within the day).
- Uniqueness: `UNIQUE(business_id, token, date(joined_at))` (§04.3.3).
- Implementation: Redis `INCR queue:{businessId}:{yyyymmdd}:seq` (atomic), or a Postgres sequence per business/day. Confirm the exact scheme (single running letter vs rotating A/B/C, per-seat vs global) in [17](./17-assumptions-open-questions.md#business-logic--data).

## 14. "2 away" notification trigger

Product promise (FAQ/hero/modal): *"We'll text you when you're two away."*
- After every queue mutation, for each active online/walk-in ticket with a phone, compute `ahead` (active entries before it on its seat).
- When `ahead` transitions to **≤ 2** and `notified_two_away_at` is null → enqueue an SMS job and stamp `notified_two_away_at` (idempotent, once per ticket). See [09](./09-background-jobs.md).

## 15. Dashboard KPIs

From `Dashboard.tsx` (recompute server-side, per business, in business timezone/day):

| KPI | Definition |
|---|---|
| Today's appointments | count of appointments scheduled today + current queue length (mock: `appts.length + queue.length`) — **confirm** whether it should be appts-only |
| Active now | active entries (`waiting` + `in_service`) |
| Check-in count | total current queue length |
| Completed | count of entries completed today |
| Today's revenue | Σ `visit.amount_paise` for visits completed today |
| Deltas | vs prior comparable period (`+4`, `+12%`) — comparison window **TBD** ([17](./17-assumptions-open-questions.md#dashboard--metrics)) |

## 16. Customer-list plan gating (`Customers.tsx`)
```
FREE_LIMIT = 2 (configurable)
matched = customers filtered by search (name/phone substring, case-insensitive)
free plan:  return latest FREE_LIMIT by created_at; lockedCount = max(0, total - FREE_LIMIT)
premium:    return all; expose total count
```
Enforced server-side (NFR-SE10). `FREE_LIMIT` should be a subscription/plan config value, not a hardcoded constant.

## 17. Concurrency & correctness

Multiple actors mutate one queue simultaneously (two owner devices, auto-promotion, a customer leaving, the "2-away" job). Requirements:
- Serialize mutating commands **per business** (advisory lock `pg_advisory_xact_lock(hash(business_id))`, or a per-business in-memory command queue / actor).
- Recompute `position` + ETAs inside the same transaction.
- Emit socket events **after** commit (transactional outbox recommended for reliability).
- All mutation endpoints idempotent via `Idempotency-Key`.

## 18. Open-status computation

Microsite shows "Open now · till 8 PM" / "Open till 9 PM". Derive from `business_hour` for the current day in the business timezone: `isOpen`, `closesAt`, human label. Sunday closed → "Closed today".
