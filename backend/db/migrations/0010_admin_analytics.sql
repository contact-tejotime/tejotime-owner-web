-- =====================================================================
-- TejoTime — 0010_admin_analytics: read-only reporting functions for the
-- admin panel (platform dashboard, store directory metrics, store analytics).
-- All functions are STABLE sql — they only read, so no advisory locks are
-- needed (unlike the mutating queue functions in 0002).
-- The demo store (slug 'demo-store') is excluded from every platform-wide
-- result here so callers cannot forget to filter it.
-- =====================================================================

-- Per-store directory metrics: one row per real (non-demo) business.
-- Powers the enhanced /stores table and the platform totals.
create or replace function admin_store_metrics()
returns table (
  business_id uuid,
  customers_count bigint,
  visits_30d bigint,
  revenue_30d_paise bigint,
  last_activity_at timestamptz,
  plan text
) language sql stable as $$
  select
    b.id,
    (select count(*) from customer c where c.business_id = b.id),
    (select count(*) from visit v
      where v.business_id = b.id and v.completed_at >= now() - interval '30 days'),
    (select coalesce(sum(v.amount_paise), 0) from visit v
      where v.business_id = b.id and v.completed_at >= now() - interval '30 days'),
    greatest(
      (select max(v.completed_at) from visit v where v.business_id = b.id),
      (select max(a.created_at) from appointment a where a.business_id = b.id),
      (select max(q.joined_at) from queue_entry q where q.business_id = b.id)
    ),
    coalesce((select s.plan::text from subscription s where s.business_id = b.id), 'free')
  from business b
  where b.slug <> 'demo-store';
$$;

-- Daily visit count + revenue, bucketed by calendar day in the given timezone.
-- p_business_id null → platform-wide (demo store excluded).
-- Days with no visits are absent; the service layer zero-fills the series.
create or replace function admin_daily_revenue(
  p_business_id uuid,
  p_tz text,
  p_start timestamptz,
  p_end timestamptz
) returns table (day date, visits bigint, revenue_paise bigint)
language sql stable as $$
  select
    (v.completed_at at time zone p_tz)::date as day,
    count(*),
    coalesce(sum(v.amount_paise), 0)
  from visit v
  join business b on b.id = v.business_id
  where v.completed_at >= p_start
    and v.completed_at <= p_end
    and (p_business_id is null or v.business_id = p_business_id)
    and (p_business_id is not null or b.slug <> 'demo-store')
  group by 1
  order by 1;
$$;

-- All-time totals for one store. Visits/revenue come from the visit ledger,
-- not customer.total_spend_paise — the cached totals miss walk-ins that were
-- checked out without a CRM record (visit.customer_id is null).
create or replace function admin_business_totals(p_business_id uuid)
returns table (
  customers_count bigint,
  repeat_customers bigint,
  vip_count bigint,
  visits_count bigint,
  revenue_paise bigint
) language sql stable as $$
  select
    (select count(*) from customer c where c.business_id = p_business_id),
    (select count(*) from customer c where c.business_id = p_business_id and c.visits_count >= 2),
    (select count(*) from customer c where c.business_id = p_business_id and c.is_vip),
    (select count(*) from visit v where v.business_id = p_business_id),
    (select coalesce(sum(v.amount_paise), 0) from visit v where v.business_id = p_business_id);
$$;

-- Top services by revenue within a window.
create or replace function admin_top_services(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 5
) returns table (service_name text, visits bigint, revenue_paise bigint)
language sql stable as $$
  select
    coalesce(v.service_name, '(unknown)'),
    count(*),
    coalesce(sum(v.amount_paise), 0)
  from visit v
  where v.business_id = p_business_id
    and v.completed_at >= p_start
    and v.completed_at <= p_end
  group by 1
  order by 3 desc, 2 desc
  limit p_limit;
$$;

-- Top staff by revenue within a window. Visits with no staff are skipped.
create or replace function admin_top_staff(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_limit int default 5
) returns table (staff_id uuid, staff_name text, visits bigint, revenue_paise bigint)
language sql stable as $$
  select
    s.id,
    s.name,
    count(*),
    coalesce(sum(v.amount_paise), 0)
  from visit v
  join staff s on s.id = v.staff_id
  where v.business_id = p_business_id
    and v.completed_at >= p_start
    and v.completed_at <= p_end
  group by s.id, s.name
  order by 4 desc, 3 desc
  limit p_limit;
$$;

-- Walk-in vs online split. The visit table has no source column, so completed
-- queue entries stand in for visits (queue_checkout creates one visit per entry).
create or replace function admin_visit_sources(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns table (source text, cnt bigint)
language sql stable as $$
  select q.source::text, count(*)
  from queue_entry q
  where q.business_id = p_business_id
    and q.status = 'completed'
    and q.completed_at >= p_start
    and q.completed_at <= p_end
  group by 1;
$$;

-- Appointment counts by status × source over a scheduling window.
-- The service layer derives no-show / completion / online rates from these.
create or replace function admin_appointment_stats(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns table (status text, source text, cnt bigint)
language sql stable as $$
  select a.status::text, a.source::text, count(*)
  from appointment a
  where a.business_id = p_business_id
    and a.scheduled_start_at >= p_start
    and a.scheduled_start_at <= p_end
  group by 1, 2;
$$;
