-- =====================================================================
-- TejoTime — 0046_checkout_tips
--
-- Tips at checkout (client request 2026-10-29, docs/checkout-tips.md). The checkout sheet gets a
-- separate Tip: a 10% / 15% quick pick or a typed amount, shown only while the store's owner has
-- switched Tips on.
--
-- THE RULE: A TIP IS NOT PART OF THE BILL. `visit.amount_paise` stays the service bill only — it
-- is what revenue, `visit_commission`, `customer.total_spend_paise` and the admin analytics read —
-- so a tip can never earn commission or inflate revenue. The tip lives beside it:
--
--   * `business.tip_enabled`   — the owner's switch (default off: every checkout stays as it was).
--   * `visit.tip_paise`        — what the customer tipped; it goes 100% to the visit's chair.
--   * `card_payment.tip_paise` — the tip inside a card charge. The reader charges bill + tip; the
--                                visit banks (charged - tip) as the bill and the tip as the tip.
--
-- A refunded card visit takes its tip out with the rest of the charge (reports filter on
-- `refunded_at`, exactly as they do for revenue). Customer spend only ever held the bill, so the
-- refund function is untouched.
--
-- `queue_checkout` and `card_payment_start` each gain a trailing parameter. A parameter with a
-- DEFAULT creates a SECOND overload and makes existing calls ambiguous (the trap behind 0016, 0020
-- and 0042), so the old signature of each is dropped at the end, after the create.
-- `card_payment_complete` keeps its signature. Re-runnable.
-- =====================================================================

alter table business add column if not exists tip_enabled boolean not null default false;

alter table visit add column if not exists tip_paise bigint not null default 0;
alter table visit drop constraint if exists ck_visit_tip_nonneg;
alter table visit add constraint ck_visit_tip_nonneg check (tip_paise >= 0);

alter table card_payment add column if not exists tip_paise bigint not null default 0;
alter table card_payment drop constraint if exists ck_card_payment_tip_nonneg;
alter table card_payment add constraint ck_card_payment_tip_nonneg check (tip_paise >= 0);

-- 0043's body; CHANGED: records the tip. The customer's spend still adds the bill only.
create or replace function queue_checkout(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint default null,
  p_payment_method text default null,
  p_tip_paise bigint default null
)
returns jsonb language plpgsql as $$
declare
  v_seat uuid; v_status queue_status; v_customer uuid; v_service_id uuid;
  v_price_type text; v_extras bigint;
  v_amount bigint; v_promoted_id uuid; v_promoted_name text; v_visit_id uuid;
  v_tip bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status, customer_id, service_id
    into v_seat, v_status, v_customer, v_service_id
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;

  if exists (select 1 from card_payment
              where queue_entry_id = p_entry_id and status = 'pending'
                and created_at > now() - interval '15 minutes') then
    raise exception 'TEJO:CARD_PAYMENT_IN_PROGRESS';
  end if;

  if p_amount_paise is not null and p_amount_paise < 0 then
    raise exception 'TEJO:INVALID_STATE';
  end if;
  -- CHANGED (0046)
  if p_tip_paise is not null and p_tip_paise < 0 then
    raise exception 'TEJO:INVALID_STATE';
  end if;
  v_tip := coalesce(p_tip_paise, 0);

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

  -- CHANGED (0046): tip_paise.
  insert into visit(business_id, customer_id, queue_entry_id, staff_id, service_name, amount_paise,
                    payment_method, tip_paise, completed_at)
    select business_id, customer_id, id, staff_id, service_name, v_amount, p_payment_method, v_tip, now()
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
    'amount_paise', v_amount, 'tip_paise', v_tip,
    'promoted', case when v_promoted_id is null then null
                     else jsonb_build_object('id', v_promoted_id, 'name', v_promoted_name) end
  );
end $$;

-- After the create, so no in-flight call breaks; left in place, every four-argument call is ambiguous.
drop function if exists queue_checkout(uuid, uuid, bigint, text);

-- ---------------------------------------------------------------------
-- 0043's body; CHANGED: the charge carries the tip. `p_amount_paise` is the WHOLE charge (bill +
-- tip, what the reader is asked for); `p_tip_paise` is the part of it that is the tip.
-- ---------------------------------------------------------------------
create or replace function card_payment_start(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint,
  p_user_id uuid,
  p_tip_paise bigint default 0
) returns jsonb language plpgsql as $$
declare
  v_enabled boolean; v_currency text; v_status queue_status; v_id uuid; v_tip bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select card_payments_enabled, currency into v_enabled, v_currency from business where id = p_business_id;
  if not coalesce(v_enabled, false) then raise exception 'TEJO:CARD_PAYMENTS_OFF'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'TEJO:INVALID_STATE'; end if;
  -- CHANGED (0046): a tip is part of the charge, never more than it.
  v_tip := coalesce(p_tip_paise, 0);
  if v_tip < 0 or v_tip > p_amount_paise then raise exception 'TEJO:INVALID_STATE'; end if;

  select status into v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;

  select id into v_id from card_payment where queue_entry_id = p_entry_id and status = 'pending';
  if v_id is not null then
    update card_payment set amount_paise = p_amount_paise, tip_paise = v_tip, created_at = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'amount_paise', p_amount_paise, 'tip_paise', v_tip,
                              'currency', v_currency, 'resumed', true);
  end if;

  insert into card_payment(business_id, queue_entry_id, amount_paise, tip_paise, currency, created_by)
    values (p_business_id, p_entry_id, p_amount_paise, v_tip, coalesce(v_currency, 'INR'), p_user_id)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount_paise', p_amount_paise, 'tip_paise', v_tip,
                            'currency', v_currency, 'resumed', false);
end $$;

drop function if exists card_payment_start(uuid, uuid, bigint, uuid);

-- ---------------------------------------------------------------------
-- 0043's body; CHANGED: the visit banks (charged - tip) as its bill and the tip as its tip. If the
-- reader charged less than the tip, the tip is cut to what was charged — the money is recorded
-- either way, and the amount mismatch already flags the payment for review.
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
  v_charged bigint; v_review boolean; v_tip bigint;
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
  v_tip := least(v_row.tip_paise, v_charged);

  -- Paid FIRST, so queue_checkout's pending guard does not stop the very charge it waits for.
  update card_payment
     set status = 'paid', paid_at = now(), failure_reason = null,
         provider_payment_id = p_provider_payment_id, card_brand = p_card_brand,
         card_last4 = p_card_last4, entry_mode = p_entry_mode, charged_amount_paise = v_charged
   where id = p_payment_id;

  select status into v_entry_status
    from queue_entry where id = v_row.queue_entry_id and business_id = p_business_id for update;

  if v_entry_status = 'in_service' then
    -- The visit banks what the card was actually charged: the bill, and the tip on its own.
    v_checkout := queue_checkout(p_business_id, v_row.queue_entry_id, v_charged - v_tip, 'card', v_tip);
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
-- Commission: 0043's view with `tip_paise` APPENDED (a view may only gain columns at the end).
-- `commission_paise` is still a percentage of `amount_paise` — the bill — so a tip never earns
-- commission; the tip is reported next to it. Readers that sum tips filter on `refunded_at`.
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
       v.refunded_at,
       v.tip_paise
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
