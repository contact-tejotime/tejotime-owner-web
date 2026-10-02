-- =====================================================================
-- TejoTime — 0035_staff_commission_instant
--
-- A rate starts at an instant, not at midnight. Saving 20% at 1pm must not pay the two visits
-- checked out that morning, and changing it to 30% at 4pm must not reprice the afternoon visits
-- already paid at 20%. See docs/staff-commission.md.
--
-- 0034 stored `effective_from date` and the view matched it to the visit's store-local day, so
-- the whole day was repriced. This replaces that column with `effective_at timestamptz` and
-- matches `effective_at <= visit.completed_at`.
--
-- Backfill: a row whose date is the store-local day of `created_at` was "saved today", so it
-- starts at `created_at` (the morning stays unrated). Any other date was a scheduled day and
-- starts at midnight in the store's timezone.
--
-- `rate_from` changes type, and `create or replace view` cannot do that — drop the view first.
-- Idempotent: safe to re-run.
-- =====================================================================

drop view if exists visit_commission;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'staff_commission_rate'
       and column_name = 'effective_from'
  ) then
    alter table staff_commission_rate drop constraint if exists uq_staff_commission_rate_day;
    alter table staff_commission_rate add column effective_at timestamptz;

    update staff_commission_rate cr
       set effective_at = case
             when cr.effective_from = (cr.created_at at time zone coalesce(b.timezone, 'Asia/Kolkata'))::date
               then cr.created_at
             else (cr.effective_from::timestamp at time zone coalesce(b.timezone, 'Asia/Kolkata'))
           end
      from business b
     where b.id = cr.business_id
       and cr.effective_at is null;

    -- A row with no business should be impossible (the FK), but do not leave the column null.
    update staff_commission_rate
       set effective_at = created_at
     where effective_at is null;

    alter table staff_commission_rate alter column effective_at set not null;
    alter table staff_commission_rate drop column effective_from;
    alter table staff_commission_rate
      add constraint uq_staff_commission_rate_at unique (staff_id, effective_at);
  end if;
end $$;

-- Every visit with the latest rate whose start is at or before checkout. A visit with no
-- stylist, or before its stylist's first rate, has a NULL rate and NULL commission.
create view visit_commission as
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
       r.effective_at                                 as rate_from,
       case when r.rate_bp is null then null
            else round(v.amount_paise * r.rate_bp / 10000.0)::bigint
       end                                            as commission_paise
  from visit v
  join business b on b.id = v.business_id
  left join lateral (
         select cr.rate_bp, cr.effective_at
           from staff_commission_rate cr
          where cr.staff_id = v.staff_id
            and cr.business_id = v.business_id
            and cr.effective_at <= v.completed_at
          order by cr.effective_at desc
          limit 1
       ) r on true;
