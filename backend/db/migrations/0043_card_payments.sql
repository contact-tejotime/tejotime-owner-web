-- =====================================================================
-- TejoTime — 0043_card_payments
--
-- Card payments on a PayPal POS Card Reader, taken from the TejoTime app by the store's MAIN owner
-- (client decisions 2026-10-15, docs/card-payments-paypal.md). PayPal's reader can only be driven
-- by its native SDK on the phone, so the phone charges the card and this schema records it.
--
--   * `business.card_payments_enabled` — the main owner turned card charging on for the store.
--     While on, nobody else may record a visit as paid by card (they leave the customer for the
--     owner), so a card visit is always one the owner actually charged or chose to record.
--   * `business.paypal_org_ref` — the PayPal account the owner signed in with when turning it on.
--     The app refuses to charge from a phone signed in to a different account.
--   * `card_payment` — one row per charge attempt. Its `id` is the reference handed to PayPal, so
--     a lost response can be looked up on the reader side and finished here.
--   * `visit.refunded_at` / `refunded_by` — a refunded card visit. It stays in every list and still
--     counts as a completed visit, but its money leaves revenue, the stylist's commission and the
--     customer's total spend, on the visit's own day (client decisions 2026-10-15).
--
-- The rule behind `card_payment_complete`: ONCE MONEY HAS MOVED, NEVER REFUSE TO RECORD IT. A card
-- approved on the reader is always written `paid`. If its visit can no longer be completed — the
-- 4-hour stale sweep cancelled it, someone marked a no-show, the reader charged a different amount
-- — the payment is flagged `needs_review` for the owner instead of being rolled back.
--
-- `queue_checkout` and `queue_no_show` keep their exact signatures (0042 / 0002), so each is a true
-- replacement — no overload trap. Every other function here is new. Re-runnable.
-- =====================================================================

alter table business
  add column if not exists card_payments_enabled boolean not null default false,
  add column if not exists paypal_org_ref text;

alter table visit
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by uuid references app_user(id) on delete set null;

create table if not exists card_payment (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references business(id) on delete cascade,
  queue_entry_id       uuid references queue_entry(id) on delete set null,
  visit_id             uuid references visit(id) on delete set null,
  -- What TejoTime asked the reader to charge (the checkout box), and what the reader reports it
  -- charged. They only differ if something went wrong; the visit banks the charged figure.
  amount_paise         bigint not null,
  charged_amount_paise bigint,
  currency             char(3) not null,
  status               text not null default 'pending',
  needs_review         boolean not null default false,
  provider             text not null default 'paypal_pos',
  provider_payment_id  text,
  -- Brand and last four digits only. Never the masked card number.
  card_brand           text,
  card_last4           text,
  entry_mode           text,
  failure_reason       text,
  created_by           uuid references app_user(id) on delete set null,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz,
  refunded_at          timestamptz,
  refunded_by          uuid references app_user(id) on delete set null,
  refund_reference     text
);

alter table card_payment drop constraint if exists ck_card_payment_status;
alter table card_payment add constraint ck_card_payment_status
  check (status in ('pending', 'paid', 'failed', 'refunded'));

-- One charge in flight per visit. A retried "start" gets the same row back instead of a second
-- reference the reader could charge twice. A second PAID row for one visit is allowed: it is a
-- real double charge, and refusing to record it would hide money the owner has to refund.
create unique index if not exists uq_card_payment_pending
  on card_payment(queue_entry_id) where status = 'pending';
create index if not exists idx_card_payment_business_created
  on card_payment(business_id, created_at desc);

-- ---------------------------------------------------------------------
-- The pending guard. While the owner's phone is charging a visit, nothing else may finish it: a
-- cash checkout from another phone would complete the visit and leave the card charge with no
-- visit to land on. Only a RECENT attempt blocks (15 minutes, longer than any reader round trip):
-- an attempt abandoned by a crashed phone must not lock the chair for the rest of the day. If it
-- turns out to have been charged after all, card_payment_complete records it as needs_review.
-- ---------------------------------------------------------------------

-- 0042's body; CHANGED: the pending guard.
create or replace function queue_checkout(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint default null,
  p_payment_method text default null
)
returns jsonb language plpgsql as $$
declare
  v_seat uuid; v_status queue_status; v_customer uuid; v_service_id uuid;
  v_price_type text; v_extras bigint;
  v_amount bigint; v_promoted_id uuid; v_promoted_name text; v_visit_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status, customer_id, service_id
    into v_seat, v_status, v_customer, v_service_id
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;

  -- CHANGED (0043)
  if exists (select 1 from card_payment
              where queue_entry_id = p_entry_id and status = 'pending'
                and created_at > now() - interval '15 minutes') then
    raise exception 'TEJO:CARD_PAYMENT_IN_PROGRESS';
  end if;

  if p_amount_paise is not null and p_amount_paise < 0 then
    raise exception 'TEJO:INVALID_STATE';
  end if;

  v_extras := coalesce((select sum(price_paise) from queue_entry_extra where queue_entry_id = p_entry_id), 0);

  if p_amount_paise is null then
    select price_type into v_price_type from service where id = v_service_id;
    if v_price_type in ('range', 'unset') then
      raise exception 'TEJO:AMOUNT_REQUIRED';
    end if;
    -- No service to price it from and no add-ons: there is nothing to derive.
    if v_price_type is null and v_extras = 0 then
      raise exception 'TEJO:AMOUNT_REQUIRED';
    end if;
    -- A no-price service picked second is an extra stored at 0; deriving would bank it as free.
    if exists (select 1 from queue_entry_extra
                where queue_entry_id = p_entry_id and price_type = 'unset') then
      raise exception 'TEJO:AMOUNT_REQUIRED';
    end if;
  end if;

  v_amount := coalesce(
    p_amount_paise,
    coalesce((select price_paise from service where id = v_service_id), 0) + v_extras
  );

  update queue_entry set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_entry_id;

  insert into visit(business_id, customer_id, queue_entry_id, staff_id, service_name, amount_paise,
                    payment_method, completed_at)
    select business_id, customer_id, id, staff_id, service_name, v_amount, p_payment_method, now()
    from queue_entry where id = p_entry_id
    returning id into v_visit_id;

  if v_customer is not null then
    update customer set visits_count = visits_count + 1,
                        total_spend_paise = total_spend_paise + v_amount,
                        last_visit_at = now(), updated_at = now()
      where id = v_customer;
  end if;

  if v_seat is not null and not exists (select 1 from queue_entry
                 where business_id = p_business_id and staff_id = v_seat and status = 'in_service') then
    select id, customer_name into v_promoted_id, v_promoted_name
      from queue_entry
      where business_id = p_business_id and staff_id = v_seat and status = 'waiting'
      order by position asc, joined_at asc limit 1;
    if v_promoted_id is not null then
      update queue_entry set status = 'in_service', started_at = now(), position = 0, updated_at = now()
        where id = v_promoted_id;
    end if;
  end if;

  perform _queue_renumber(p_business_id, v_seat);

  return jsonb_build_object(
    'id', p_entry_id, 'staff_id', v_seat, 'visit_id', v_visit_id,
    'amount_paise', v_amount,
    'promoted', case when v_promoted_id is null then null
                     else jsonb_build_object('id', v_promoted_id, 'name', v_promoted_name) end
  );
end $$;

-- 0002's body; CHANGED: the pending guard.
create or replace function queue_no_show(p_business_id uuid, p_entry_id uuid)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_status queue_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status into v_seat, v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status not in ('waiting','in_service') then raise exception 'TEJO:INVALID_STATE'; end if;
  -- CHANGED (0043)
  if exists (select 1 from card_payment
              where queue_entry_id = p_entry_id and status = 'pending'
                and created_at > now() - interval '15 minutes') then
    raise exception 'TEJO:CARD_PAYMENT_IN_PROGRESS';
  end if;
  update queue_entry set status = 'no_show', updated_at = now() where id = p_entry_id;
  perform _queue_renumber(p_business_id, v_seat);
  return jsonb_build_object('id', p_entry_id, 'staff_id', v_seat);
end $$;

-- ---------------------------------------------------------------------
-- Start a card charge: returns the reference (the row id) the phone hands to the reader. A visit
-- that already has an attempt in flight gets that same row back — the retry of a lost response —
-- with the amount brought up to date (the phone checks the reader for that reference before it
-- charges again, so a reference that was charged is finished, never charged twice).
-- ---------------------------------------------------------------------
create or replace function card_payment_start(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint,
  p_user_id uuid
) returns jsonb language plpgsql as $$
declare
  v_enabled boolean; v_currency text; v_status queue_status; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select card_payments_enabled, currency into v_enabled, v_currency from business where id = p_business_id;
  if not coalesce(v_enabled, false) then raise exception 'TEJO:CARD_PAYMENTS_OFF'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'TEJO:INVALID_STATE'; end if;

  select status into v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;

  select id into v_id from card_payment where queue_entry_id = p_entry_id and status = 'pending';
  if v_id is not null then
    update card_payment set amount_paise = p_amount_paise, created_at = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'amount_paise', p_amount_paise, 'currency', v_currency, 'resumed', true);
  end if;

  insert into card_payment(business_id, queue_entry_id, amount_paise, currency, created_by)
    values (p_business_id, p_entry_id, p_amount_paise, coalesce(v_currency, 'INR'), p_user_id)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount_paise', p_amount_paise, 'currency', v_currency, 'resumed', false);
end $$;

-- ---------------------------------------------------------------------
-- The reader approved the card: record it, and complete the visit with it. One transaction, so a
-- card is never recorded paid without its visit (or the reverse). Idempotent: a repeat — the phone
-- retrying after a lost response — returns what the first call wrote and changes nothing.
-- ---------------------------------------------------------------------
create or replace function card_payment_complete(
  p_business_id uuid,
  p_payment_id uuid,
  p_provider_payment_id text,
  p_card_brand text,
  p_card_last4 text,
  p_entry_mode text,
  p_charged_amount_paise bigint
) returns jsonb language plpgsql as $$
declare
  v_row card_payment%rowtype; v_entry_status queue_status; v_checkout jsonb;
  v_charged bigint; v_review boolean;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select * into v_row from card_payment where id = p_payment_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;

  if v_row.status in ('paid', 'refunded') then
    return jsonb_build_object('payment_id', v_row.id, 'visit_id', v_row.visit_id, 'already', true,
                              'needs_review', v_row.needs_review, 'checkout', null);
  end if;

  -- A `failed` row is recorded too: the owner gave up on it, then the reader turned out to have
  -- charged it after all. Money moved, so it is written.
  v_charged := coalesce(p_charged_amount_paise, v_row.amount_paise);
  v_review := v_charged <> v_row.amount_paise or v_row.status = 'failed';

  -- Paid FIRST, so queue_checkout's pending guard does not stop the very charge it waits for.
  update card_payment
     set status = 'paid', paid_at = now(), failure_reason = null,
         provider_payment_id = p_provider_payment_id, card_brand = p_card_brand,
         card_last4 = p_card_last4, entry_mode = p_entry_mode, charged_amount_paise = v_charged
   where id = p_payment_id;

  select status into v_entry_status
    from queue_entry where id = v_row.queue_entry_id and business_id = p_business_id for update;

  if v_entry_status = 'in_service' then
    -- The visit banks what the card was actually charged.
    v_checkout := queue_checkout(p_business_id, v_row.queue_entry_id, v_charged, 'card');
    update card_payment set visit_id = (v_checkout->>'visit_id')::uuid, needs_review = v_review
     where id = p_payment_id;
  else
    -- The visit was finished or cancelled while the card was being charged. Keep the money on
    -- record and put it in front of the owner, who decides to refund or keep it.
    v_review := true;
    update card_payment set needs_review = true where id = p_payment_id;
  end if;

  return jsonb_build_object('payment_id', p_payment_id, 'visit_id', v_checkout->>'visit_id',
                            'already', false, 'needs_review', v_review, 'checkout', v_checkout);
end $$;

-- ---------------------------------------------------------------------
-- The card was refunded (always the whole amount, back to the card — client decision 2026-10-15).
-- The visit stays, flagged refunded: it leaves revenue and commission (visit_commission below) and
-- the customer's total spend; it still counts as a completed visit. Idempotent.
-- ---------------------------------------------------------------------
create or replace function card_payment_refund(
  p_business_id uuid,
  p_payment_id uuid,
  p_user_id uuid,
  p_refund_reference text
) returns jsonb language plpgsql as $$
declare
  v_row card_payment%rowtype; v_customer uuid; v_amount bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select * into v_row from card_payment where id = p_payment_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_row.status = 'refunded' then
    return jsonb_build_object('payment_id', v_row.id, 'visit_id', v_row.visit_id, 'already', true);
  end if;
  if v_row.status <> 'paid' then raise exception 'TEJO:INVALID_STATE'; end if;

  update card_payment
     set status = 'refunded', refunded_at = now(), refunded_by = p_user_id, refund_reference = p_refund_reference
   where id = p_payment_id;

  if v_row.visit_id is not null then
    update visit set refunded_at = now(), refunded_by = p_user_id
     where id = v_row.visit_id and refunded_at is null
     returning customer_id, amount_paise into v_customer, v_amount;
    if v_customer is not null then
      update customer
         set total_spend_paise = greatest(0, total_spend_paise - v_amount), updated_at = now()
       where id = v_customer;
    end if;
  end if;

  return jsonb_build_object('payment_id', p_payment_id, 'visit_id', v_row.visit_id, 'already', false);
end $$;

-- ---------------------------------------------------------------------
-- Commission: a refunded visit keeps its row (it is still a completed visit) but earns nothing.
-- 0035's view with `commission_paise` zeroed for a refund and `refunded_at` APPENDED — a view may
-- only gain columns at the end; readers that sum `amount_paise` as revenue filter on it.
-- ---------------------------------------------------------------------
drop view if exists visit_commission;
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
            when v.refunded_at is not null then 0
            else round(v.amount_paise * r.rate_bp / 10000.0)::bigint
       end                                            as commission_paise,
       v.refunded_at
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

-- ---------------------------------------------------------------------
-- Admin reporting (0010): refunded money leaves every revenue sum; visit counts are unchanged.
-- Identical signatures and return columns, so each is a true replacement.
-- ---------------------------------------------------------------------
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
    (select coalesce(sum(v.amount_paise) filter (where v.refunded_at is null), 0) from visit v
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
    coalesce(sum(v.amount_paise) filter (where v.refunded_at is null), 0)
  from visit v
  join business b on b.id = v.business_id
  where v.completed_at >= p_start
    and v.completed_at <= p_end
    and (p_business_id is null or v.business_id = p_business_id)
    and (p_business_id is not null or b.slug <> 'demo-store')
  group by 1
  order by 1;
$$;

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
    (select coalesce(sum(v.amount_paise), 0) from visit v
      where v.business_id = p_business_id and v.refunded_at is null);
$$;

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
    coalesce(sum(v.amount_paise) filter (where v.refunded_at is null), 0)
  from visit v
  where v.business_id = p_business_id
    and v.completed_at >= p_start
    and v.completed_at <= p_end
  group by 1
  order by 3 desc, 2 desc
  limit p_limit;
$$;

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
    coalesce(sum(v.amount_paise) filter (where v.refunded_at is null), 0)
  from visit v
  join staff s on s.id = v.staff_id
  where v.business_id = p_business_id
    and v.completed_at >= p_start
    and v.completed_at <= p_end
  group by s.id, s.name
  order by 4 desc, 3 desc
  limit p_limit;
$$;
