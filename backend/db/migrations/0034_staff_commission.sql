-- =====================================================================
-- TejoTime — 0034_staff_commission
--
-- Commission salons pay a stylist a percentage of every visit they complete. This adds the
-- rate, and the one place the money is worked out. See docs/staff-commission.md.
--
-- RATES ARE DATED, BY STORE-LOCAL DAY. A stylist's rate for a visit is the latest row whose
-- `effective_from` is on or before the visit's calendar day in `business.timezone`:
--
--     20% from 2026-10-02, 30% from 2026-10-16
--     → every visit 02/10 … 15/10 is paid at 20%, and ALL of 16/10 onwards at 30%
--       (including a 16/10 visit checked out before the owner saved the change).
--
-- Nothing is stamped onto `visit`, and `queue_checkout` is untouched: commission is computed
-- when it is read, through the `visit_commission` view below, so every report, the owner's
-- breakdown, a stylist's own earnings and the admin ledger share ONE formula. Stamping at
-- checkout could not honour "the whole of 16/10" without rewriting rows already written.
--
-- History stays frozen because the only writer (modules/commission) refuses any row dated
-- before the store's today — the API, not a trigger: business/staff deletes cascade through
-- this table, and the rolled-back smoke script inserts past-dated fixtures on purpose.
--
-- `rate_bp` is basis points (2000 = 20%, 3750 = 37.5%), an integer for the same reason money is
-- integer paise. Commission is rounded PER VISIT (half away from zero), and a total is the sum of
-- its rounded lines, so a stylist's visit list always adds up to the figure on the report.
--
-- Known: correcting a store's timezone re-buckets visits near midnight into a different day,
-- exactly as it does for every other report — which can move one across a rate change.
--
-- FIRST VIEW IN THIS SCHEMA. `create or replace view` may only APPEND columns, and Postgres
-- refuses to retype or drop any column the view reads (visit.*, business.timezone,
-- staff_commission_rate.*) — a later migration that needs to must drop and recreate the view.
-- Idempotent: safe to re-run.
-- =====================================================================

create table if not exists staff_commission_rate (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references business(id) on delete cascade,
  staff_id        uuid not null references staff(id) on delete cascade,
  rate_bp         int  not null check (rate_bp between 0 and 10000),
  -- A calendar day in the store's timezone, not an instant: "from 16 Oct" means the whole day.
  effective_from  date not null,
  set_by_user_id  uuid references app_user(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One rate per stylist per day; saving again on the same day replaces it. Also the index the
  -- "latest rate on or before day D" lookup walks backwards.
  constraint uq_staff_commission_rate_day unique (staff_id, effective_from)
);

create index if not exists idx_staff_commission_rate_business on staff_commission_rate(business_id);

-- Every visit with the rate that applied on its store-local day. A visit with no stylist, or
-- before its stylist's first rate, has a NULL rate and NULL commission (it earns nothing). Callers
-- filter on business_id + a completed_at range — that reaches idx_visit_business_completed;
-- filtering on local_date cannot use an index.
create or replace view visit_commission as
select v.id                                           as visit_id,
       v.business_id,
       v.customer_id,
       v.queue_entry_id,
       v.staff_id,
       v.service_name,
       v.amount_paise,
       v.completed_at,
       (v.completed_at at time zone b.timezone)       as local_at,
       (v.completed_at at time zone b.timezone)::date as local_date,
       r.rate_bp,
       r.effective_from                               as rate_from,
       case when r.rate_bp is null then null
            else round(v.amount_paise * r.rate_bp / 10000.0)::bigint
       end                                            as commission_paise
  from visit v
  join business b on b.id = v.business_id
  left join lateral (
         select cr.rate_bp, cr.effective_from
           from staff_commission_rate cr
          where cr.staff_id = v.staff_id
            -- Defence in depth: a row can never apply across tenants, even if mis-scoped.
            and cr.business_id = v.business_id
            and cr.effective_from <= (v.completed_at at time zone b.timezone)::date
          order by cr.effective_from desc
          limit 1
       ) r on true;
