-- =====================================================================
-- TejoTime — 0042_visit_payment_method
--
-- "Paid by" at checkout (client request 2026-10-15, docs/card-payments-paypal.md). Checkout
-- recorded how much a visit cost but never how the customer paid, so a store could not tell its
-- card takings from its cash. The checkout sheet now asks, and the answer is kept on the visit:
--
--   * `visit.payment_method` — card | cash | venmo | zelle | cash_app | upi | other. NULL for every
--     visit written before this migration and for checkouts from app builds that predate the
--     question (they send no method; the API still accepts that).
--
-- Text plus a check, not an enum: adding a value to an enum later needs `alter type ... add value`,
-- which fights the one-transaction-per-file migration runner (see 0024).
--
-- `queue_checkout` gains a trailing `p_payment_method`. Adding a parameter with a DEFAULT creates a
-- SECOND overload and makes every three-argument call ambiguous (the trap behind 0016 and 0020), so
-- the old signature is dropped at the end — after the create, so no in-flight call is broken.
-- Re-runnable.
-- =====================================================================

alter table visit add column if not exists payment_method text;

alter table visit drop constraint if exists ck_visit_payment_method;
alter table visit add constraint ck_visit_payment_method
  check (payment_method is null
         or payment_method in ('card', 'cash', 'venmo', 'zelle', 'cash_app', 'upi', 'other'));

-- 0040's body; CHANGED: records how the customer paid.
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

  -- CHANGED (0042): payment_method.
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

-- Must come after the create: dropping first would break any in-flight call, and leaving it would
-- make every three-argument invocation ambiguous.
drop function if exists queue_checkout(uuid, uuid, bigint);
