# Staff commission

**Shipped:** 2026-10-02 · **Migrations:** `0034_staff_commission.sql`, `0035_staff_commission_instant.sql` · **Surfaces:** owner-web, the
app (iOS + Android), admin panel (optional percent on the store staff form; the visits report stays read-only) · **Backend:** `backend/src/modules/commission/`

Commission salons pay each stylist a percentage of the visits they complete. A store sets a rate
per stylist; Reports show what each stylist earned and what the salon keeps; a stylist can be shown
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

A new module, `commission` ("Commission & earnings"), in `backend/src/domain/permissions.ts`:

| Role | Access | Means |
|---|---|---|
| owner, co_owner | `manage` | set rates; read the whole store |
| manager (legacy) | `view` | read the whole store |
| staff | `none` by default; the owner may grant `view` | read **only its own chair**; never rates |

`GRANT_CEILING = { commission: 'view' }` caps every role that is not an owner: `manage` means
setting pay, and a staff login holding it could give itself a raise (the same reason `team` is not
grantable). It is enforced four times — the Team grid offers only Hidden / View only; the
permission editor refuses `manage` (400); `effectiveAccess` clamps any stored `manage` to `view`;
and the rate routes also check the owner **role**. A staff login with no chair linked sees nothing.

`PUT /users/:id/permissions` now replaces only the modules in the payload, so an older app build
that predates `commission` cannot wipe a grant it does not know about.

Reports (`/stats`) open with `dashboard` **or** `commission`; each section draws only with its own
permission. In a staff login's visit list, customer names appear only if it has `customers` access.

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
| Stylist | "My earnings" card + visits sheet, when the owner has granted it | same |
| Admin panel | Create / Edit store, each staff row: optional commission %. Blank = no rate. Store → Visits stays read-only (Rate and Commission columns, totals, "Commission by stylist") | — |

## Tests

| Command | Needs | Covers |
|---|---|---|
| `cd backend && npm test` | nothing | `report-window`, `commission-summary` (pure, including the admin skip / insert / refuse decision), `commission-permissions`, `commission-routes`, `dashboard-ranges`, `admin-commission`, `optional-store-data` (staff `rateBp` accepted, above 100% rejected) |
| `SMOKE_ADMIN_MOBILE=... SMOKE_ADMIN_PASSWORD=... node backend/scripts/smoke-admin-staff-commission.mjs` | running API + migrated DB + an admin login. Skips (exit 0) when the login is unset | create at 20% → read back → same percent → 30% → clearing a started rate is 400 and the 30% remains → a new stylist with no rate. Deactivates the throwaway store |
| `DATABASE_URL=<throwaway> node backend/scripts/smoke-commission-db.mjs` | a **migrated** throwaway DB (rolled back) | midnight boundaries in IST, the 1pm/4pm split (morning unrated, 20% not repriced by 30%), rounding, no-rate and no-stylist visits, constraints, index use, timezone does not reprice, cascades |
| `node backend/scripts/smoke-commission.mjs` | running API + **seeded throwaway** DB | the HTTP flow: checkout before a rate earns nothing, a later checkout earns the new rate, changing the rate does not reprice, schedule + cancel, past day 409, staff login hidden → shown own chair only → never rates, ranges, removed chair kept |
| `npm run test:commission` (repo root) | nothing | the app's and owner-web's copies of `lib/commission.ts` agree; `lib/date-grid.ts` |

Never run the smoke scripts or a migration against the database in `backend/.env` — point
`DATABASE_URL` at a throwaway one.
