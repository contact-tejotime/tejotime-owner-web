# Staff commission

**Shipped:** 2026-10-02 · **Migrations:** `0034_staff_commission.sql`, `0035_staff_commission_instant.sql` · **Surfaces:** owner-web, the
app (iOS + Android), admin panel (optional percent on the store staff form; the visits report stays read-only) · **Backend:** `backend/src/modules/commission/`

Commission salons pay each stylist a percentage of the visits they complete. A store sets a rate
per stylist; Reports show what each stylist earned and what the salon keeps; every stylist sees
their own earnings. Booth rental (a stylist renting the chair and keeping their own takings) is a
different model and is not covered.

## The rule

**A rate starts at an instant, and every visit is paid at the latest rate whose start is at or
before checkout — for ever.** Saving 20% at 1pm does not pay the two visits from that morning.
Changing it to 30% at 4pm does not reprice the visits already paid at 20%.

| Detail | Behaviour |
|---|---|
| Rate unit | Basis points, an integer: `2000` = 20%, `3750` = 37.5% (0–10000; two decimals at most). Money stays integer paise. |
| Start | Today's date, or none, stores **`now()`**. A future day (≤ 1 year ahead) starts at midnight in the store's timezone. **Never a past day.** |
| Change | A new row at `now()`. Visits already checked out keep the previous rate, or none. |
| Remove | Only a rate that has not started yet. A started rate is history: 409 `COMMISSION_RATE_LOCKED`. |
| No rate yet | Visits before a stylist's first instant earn nothing and are shown as "no rate". 0% is a real, explicit rate. |
| No stylist | Visits on a store with no chairs (or a chair since deleted) earn nothing; the owner's report shows them as "with no stylist". |
| Rounding | Per visit, half away from zero (`round(amount × bp / 10000)`). A total is the sum of its rounded lines, so a stylist's visit list always adds up to the figure on the report. |
| "Today" | Computed **only on the server**, in `business.timezone`, and returned in every response. owner-web renders on a UTC server and the app never knows the store's timezone, so neither client ever works out "today" itself. |

## How it is built

**Nothing is stamped on a visit.** `staff_commission_rate.effective_at` is the instant a rate
starts, and the `visit_commission` view gives every visit the latest rate with
`effective_at <= completed_at`. Every report —
owner-web, the app, the admin panel — reads that one view, so there is one formula.
`queue_checkout` is untouched.

Why not copy the rate onto the visit at checkout? A later change must not rewrite visits already
completed, and checkout is the most critical plpgsql in the system. Read-time computation needs
neither. History stays frozen because the only writers of rates — the owner rate API, and the admin
store save — refuse any instant already passed (deliberately not a DB trigger: business and
staff deletes cascade through the table, and the rolled-back smoke script inserts past instants
on purpose). The admin store form can set the percent that starts **now**. It never schedules a
future day and never deletes a rate that has started. `set_by_user_id` is null on those rows,
because that column points at `app_user` and an admin is not one. Saving the store again with
the same percent does not add another row.

Known, documented behaviour:

- **Correcting a store's timezone** still re-buckets a visit's local day for other reports, but it
  does not reprice commission: the rate is an absolute instant, compared with `completed_at`.
- **Rename or reuse a staff row and its history comes along.** Rates and visits belong to the staff
  row. When a person leaves, remove them and add the new person as a new stylist. (The admin store
  form matches stylists by name, so renaming one there creates a new row.)
- **Tips** have no field yet: a tip typed into the checkout total earns commission. Add a separate
  tip field before relying on this in the US.
- A staff login that checks out **its own chair** may type the amount (range-priced or unpriced
  services, or an override) — the base of its own commission. The owner's per-visit list is how
  that is audited.

## Periods

Reports take `?range=today|week|month|custom&from=&to=` (`backend/src/lib/report-window.ts`), shared
by the dashboard and commission endpoints so revenue and commission always cover the same days.

| Range | Days |
|---|---|
| `today` | the store's today |
| `week` | **Monday** → today |
| `month` | the 1st → today |
| `custom` | `from` → `to` inclusive (both required, `from ≤ to`, at most 366 days) |

Windows are half-open in UTC (`startIso` ≤ `completed_at` < `endIso`, the first instant of the day
after `to`), built from store-local midnights, so a DST change cannot slip a day.

## Who sees what

A module, `commission` ("Commission & earnings"), in `backend/src/domain/permissions.ts` — decided
by the **role alone**, like `team`. It is not in `GRANTABLE_MODULES`, so it is never a row in the
Team grid and no `user_permission` override changes it:

| Role | Access | Means |
|---|---|---|
| owner, co_owner | `manage` | set rates; read the whole store |
| manager (legacy) | `view` | read the whole store |
| staff | `view`, always | read **only its own chair**; never rates |

`manage` means setting pay, and a staff login holding it could give itself a raise. Nothing can
give it one: no non-owner role defaults to `manage`, `effectiveAccess` applies overrides only to
grantable modules, and the rate routes also check the owner **role**. A staff login with no chair
linked sees nothing.

**History.** It shipped on 2026-10-02 as a grantable Hidden / View only row, hidden from staff by
default (capped by a `GRANT_CEILING`), and was made role-only the same day at the owner's request:
earnings are a stylist's own pay, so there is nothing to hide. Two leftovers are handled on
purpose, with no migration:

- `commission` rows already saved in `user_permission` (an explicit "Hidden", say) are ignored by
  `effectiveAccess`, so they can neither hide earnings nor raise them.
- App builds from that day still send `commission` in every permission save (the editor sends its
  complete map). `POST /users` and `PUT /users/:id/permissions` drop the key instead of failing the
  whole save with 400, and store nothing for it.

`PUT /users/:id/permissions` replaces only the modules in the payload, so an older app build that
predates a module cannot wipe a grant it does not know about.

Reports (`/stats`) open with `dashboard` **or** `commission` — so every staff login reaches it, even
one whose Dashboard the owner has hidden; each section draws only with its own permission. In a
staff login's visit list, customer names appear only if it has `customers` access.

## API

| Route | Guard | Notes |
|---|---|---|
| `GET /commission/summary?range&from&to` | `commission:view` | staff → own chair only (`scope: 'self'`: no `salonKeeps`, no `unassigned`, no upcoming rate) |
| `GET /commission/visits?staffId&range&from&to&limit` | `commission:view` | owner: `staffId` required; staff: own chair only (another → 403); limit 200 (max 500); `localDate`/`localTime` are store-local |
| `GET /commission/rates` | `commission:manage` | `{ today, data: [{ staffId, name, current, upcoming, history }] }` |
| `PUT /commission/rates/:staffId` | owner role + `commission:manage` | `{ rateBp, effectiveFrom? }` — today or omitted starts at `now()` (new row); a future day starts at store midnight and replaces that instant; past day → 409 `COMMISSION_RATE_LOCKED`; > 1 year → 400; removed/foreign chair → 404 |
| `DELETE /commission/rates/:staffId/:effectiveFrom` | owner role + `commission:manage` | `effectiveFrom` is the UTC instant (`from` on the rate). Only a future instant; a started rate → 409; no such rate → 404 |
| `GET /admin/businesses/:id/commission?from&to` | admin, `requireStoreAccess` | read-only report; employee outside the store → 404 |
| `POST` / `PUT /admin/businesses` staff `rateBp` | admin | optional, basis points. Null or omitted = no rate. A different percent inserts a row at `now()`. The same percent writes nothing. Null when a rate has already started → 400 (enter 0 to earn nothing from now on). A future rate the owner scheduled is left alone |

Also: `GET /admin/businesses/:id` staff rows carry `rateBp` (null when that stylist has no rate yet). `GET /admin/businesses/:id/visits` rows carry `rateBp` and `commission`, and its summary
`commission` and `salonKeeps`. `GET /dashboard/summary` and `/by-staff` accept the four ranges and
return `from`, `to`, `today`; `/by-staff` now keeps a stylist removed mid-period who has work in it
(`isActive: false`) — it used to drop them while their revenue still counted in the total.

Never put rates on `GET /staff`: staff logins can read it, and would see colleagues' rates.

## Screens

| | owner-web | app (iOS + Android) |
|---|---|---|
| Set rates | Settings → Commission rates (`/settings/commission`, `CommissionEditor`) | Settings → Commission rates (`settings/commission.tsx`, `CommissionEditSheet`) |
| Start | native `<input type="date">`. Today means "starts now"; a later day means midnight. | inline `TMonthGrid` + Today/Tomorrow chips (no second modal — iOS will not show one over a sheet). Same meaning. |
| Reports period | Today / This week / This month / Custom (GET form, two date boxes) | same four; Custom opens `DateRangeSheet` |
| Owner report | Commission + Salon keeps tiles; each stylist card shows commission, the rate today and the period rate by rate; tap → visits sheet | same |
| Stylist | "My earnings" card + visits sheet, for every staff login | same |
| Team logins | no commission row — it is not a permission | same |
| Admin panel | Store → Visits: Rate and Commission columns, totals, "Commission by stylist" (read-only) | — |

## Tests

| Command | Needs | Covers |
|---|---|---|
| `cd backend && npm test` | nothing | `report-window`, `commission-summary` (pure), `commission-permissions`, `commission-routes`, `dashboard-ranges`, `admin-commission` |
| `DATABASE_URL=<throwaway> node backend/scripts/smoke-commission-db.mjs` | a **migrated** throwaway DB (rolled back) | the 20%→30% example against the real view, incl. 16/10 00:30 IST (still 15/10 in UTC) → 30%, rounding, no-rate and no-stylist visits, replace/delete, constraints, index use, timezone re-bucketing, cascades |
| `node backend/scripts/smoke-commission.mjs` | running API + **seeded throwaway** DB | the HTTP flow: default today, checkout → commission, same-day replace, schedule + cancel, past day 409, staff login sees its own chair with no grant (no Team-grid row; an old app's `commission: none`/`manage` save is accepted and changes nothing) → never rates, ranges, removed chair kept |
| `npm run test:commission` (repo root) | nothing | the app's and owner-web's copies of `lib/commission.ts` agree; `lib/date-grid.ts` |

Never run the smoke scripts or a migration against the database in `backend/.env` — point
`DATABASE_URL` at a throwaway one.
