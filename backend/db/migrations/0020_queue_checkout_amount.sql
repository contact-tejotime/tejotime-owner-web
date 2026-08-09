-- =====================================================================
-- TejoTime — 0020_queue_checkout_amount
--
-- Let the person checking a customer out set the FINAL amount.
--
-- Until now the price was derived: the booked service's price plus any add-ons recorded via
-- queue_extend. That is right for the common case and wrong for the one owners actually hit —
-- someone books a beard trim, then also has a haircut and a head massage. The shop charges the
-- real total; the ledger recorded the booked one, and `visit.amount_paise` (which feeds
-- customer.total_spend_paise and every revenue KPI) quietly under-reported the day's takings.
--
-- `p_amount_paise` is an OVERRIDE, not a replacement: pass null (or omit it) and the derived
-- total is used exactly as before, so every existing caller keeps its behaviour.
--
-- NOTE the drop at the bottom. Adding a trailing parameter does not replace a function in
-- Postgres — it creates a second overload — and with a DEFAULT on the new parameter a two-arg
-- call becomes ambiguous between them ("function queue_checkout(...) is not unique"). That is
-- precisely the failure 0016_fix_queue_add_overload had to clean up after 0015, so the stale
-- signature goes in the same migration that creates the new one.
-- =====================================================================

create or replace function queue_checkout(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint default null
)
returns jsonb language plpgsql as $$
declare
  v_seat uuid; v_status queue_status; v_customer uuid; v_service_id uuid;
  v_amount bigint; v_promoted_id uuid; v_promoted_name text; v_visit_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status, customer_id, service_id
    into v_seat, v_status, v_customer, v_service_id
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;

  -- The override wins when supplied; otherwise fall back to service + add-ons as before.
  -- A negative total is always a mistake, so it is refused rather than banked.
  if p_amount_paise is not null and p_amount_paise < 0 then
    raise exception 'TEJO:INVALID_STATE';
  end if;

  v_amount := coalesce(
    p_amount_paise,
    coalesce((select price_paise from service where id = v_service_id), 0)
      + coalesce((select sum(price_paise) from queue_entry_extra where queue_entry_id = p_entry_id), 0)
  );

  update queue_entry set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_entry_id;

  insert into visit(business_id, customer_id, queue_entry_id, staff_id, service_name, amount_paise, completed_at)
    select business_id, customer_id, id, staff_id, service_name, v_amount, now()
    from queue_entry where id = p_entry_id
    returning id into v_visit_id;

  if v_customer is not null then
    update customer set visits_count = visits_count + 1,
                        total_spend_paise = total_spend_paise + v_amount,
                        last_visit_at = now(), updated_at = now()
      where id = v_customer;
  end if;

  if not exists (select 1 from queue_entry
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

-- Must come after the create: dropping first would break any in-flight call, and leaving it
-- would make every two-argument invocation ambiguous. See the note above.
drop function if exists queue_checkout(uuid, uuid);
