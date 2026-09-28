-- =====================================================================
-- TejoTime — 0030_optional_seats
--
-- A store may now run with NO stylists (staff rows) and NO services, so the queue has to work
-- when an entry's `staff_id` is NULL. Until now that only happened by accident (a Hospital or
-- Restaurant, or a seat deleted out from under a ticket) and three functions quietly misbehaved:
--
--   * `_queue_renumber(biz, NULL)` compares `staff_id = NULL`, which is never true, so a
--     seatless entry kept its sentinel position (1000000, or -1 for "next") forever and
--     "walk-in next" / reordering had no effect.
--   * `queue_start` looked for another in_service row on the same seat with `staff_id = NULL`,
--     so the SEAT_BUSY guard was a silent no-op (and `uq_one_in_service_per_seat` treats NULLs
--     as distinct, so the index did not catch it either).
--   * `queue_move` refused any entry with a NULL seat as INVALID_STATE.
--
-- Decision: a seatless business is ONE shared lane, and several people can be in service in it
-- at once — there is no chair to be busy. So SEAT_BUSY is deliberately skipped for a NULL seat
-- rather than "fixed" into a one-at-a-time rule, and checkout does not auto-promote from it (the
-- owner starts the next entry themselves). Real seats behave exactly as before.
--
-- Also here: `queue_checkout` refuses to derive an amount for an entry that has NO service and
-- no add-ons. Deriving it produced 0 and banked a free visit into `visit.amount_paise` and the
-- customer's `total_spend_paise` — the same under-reporting 0020/0024 closed for range and
-- unpriced services. With services now optional that entry is the common case, not an edge.
--
-- No signature changes (so no overload trap — see 0016/0020): every function below is
-- `create or replace` over the identical argument list.
-- =====================================================================

create or replace function _queue_renumber(p_business_id uuid, p_staff_id uuid)
returns void language plpgsql as $$
begin
  with ordered as (
    select id, (row_number() over (order by position asc, joined_at asc)) - 1 as rn
    from queue_entry
    where business_id = p_business_id and staff_id is not distinct from p_staff_id and status = 'waiting'
  )
  update queue_entry q set position = o.rn
  from ordered o where q.id = o.id;
end $$;

create or replace function queue_start(p_business_id uuid, p_entry_id uuid)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_status queue_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status into v_seat, v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'waiting' then raise exception 'TEJO:INVALID_STATE'; end if;
  -- Only a real chair can be busy. A seatless lane serves several at once by design.
  if v_seat is not null and exists (select 1 from queue_entry
             where business_id = p_business_id and staff_id = v_seat and status = 'in_service') then
    raise exception 'TEJO:SEAT_BUSY';
  end if;
  update queue_entry set status = 'in_service', started_at = now(), position = 0, updated_at = now()
    where id = p_entry_id;
  perform _queue_renumber(p_business_id, v_seat);
  return jsonb_build_object('id', p_entry_id, 'staff_id', v_seat);
end $$;

create or replace function queue_move(p_business_id uuid, p_entry_id uuid, p_to_index int)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_ids uuid[]; v_len int; v_idx int; i int;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id into v_seat
    from queue_entry where id = p_entry_id and business_id = p_business_id and status = 'waiting';
  -- `found`, not `v_seat is null`: a NULL seat is a legitimate lane now.
  if not found then raise exception 'TEJO:INVALID_STATE'; end if;

  select array_agg(id order by position asc, joined_at asc) into v_ids
    from queue_entry
    where business_id = p_business_id and staff_id is not distinct from v_seat and status = 'waiting';
  v_ids := array_remove(v_ids, p_entry_id);
  v_len := coalesce(array_length(v_ids, 1), 0);
  v_idx := greatest(0, least(p_to_index, v_len));
  v_ids := (v_ids)[1:v_idx] || array[p_entry_id] || (v_ids)[v_idx+1:];

  for i in 1 .. array_length(v_ids, 1) loop
    update queue_entry set position = i - 1, updated_at = now() where id = v_ids[i];
  end loop;
  return jsonb_build_object('staff_id', v_seat, 'order', to_jsonb(v_ids));
end $$;

-- Body is 0024's, plus: (1) no-service/no-extras entries need an explicit amount, and
-- (2) auto-promotion only runs for a real seat.
create or replace function queue_checkout(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint default null
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
  end if;

  v_amount := coalesce(
    p_amount_paise,
    coalesce((select price_paise from service where id = v_service_id), 0) + v_extras
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
