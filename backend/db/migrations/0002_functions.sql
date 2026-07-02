-- =====================================================================
-- TejoTime — 0002_functions: atomic queue operations (plpgsql)
-- Each mutating function takes a per-business advisory lock so concurrent
-- queue changes cannot corrupt ordering (docs/07 §17). Errors are raised as
-- 'TEJO:<CODE>' and mapped to HTTP codes by the Node service layer.
-- Positions are maintained ONLY among a seat's WAITING entries, contiguous 0..n-1.
-- =====================================================================

-- Renumber a seat's waiting list to contiguous 0..n-1 (stable by position, then arrival).
create or replace function _queue_renumber(p_business_id uuid, p_staff_id uuid)
returns void language plpgsql as $$
begin
  with ordered as (
    select id, (row_number() over (order by position asc, joined_at asc)) - 1 as rn
    from queue_entry
    where business_id = p_business_id and staff_id = p_staff_id and status = 'waiting'
  )
  update queue_entry q set position = o.rn
  from ordered o where q.id = o.id;
end $$;

-- Daily per-business ticket token, e.g. 'A-24'.
create or replace function next_token(p_business_id uuid)
returns text language plpgsql as $$
declare
  v_prefix text;
  v_tz text;
  v_day text;
  v_seq int;
begin
  select token_prefix, timezone into v_prefix, v_tz from business where id = p_business_id;
  v_day := to_char((now() at time zone coalesce(v_tz,'Asia/Kolkata'))::date, 'YYYYMMDD');
  insert into token_counter(business_id, day_key, seq) values (p_business_id, v_day, 1)
    on conflict (business_id, day_key)
    do update set seq = token_counter.seq + 1
    returning seq into v_seq;
  return coalesce(v_prefix, 'A') || '-' || v_seq::text;
end $$;

-- Add an entry to the queue (walk-in or online). Seat is pre-resolved by the
-- caller (soonest/preferred computed in TS). position: 'end' | 'next'.
create or replace function queue_add(
  p_business_id uuid,
  p_name text,
  p_phone text,
  p_service_id uuid,
  p_staff_id uuid,
  p_position text,
  p_source queue_source,
  p_preferred_staff_id uuid default null,
  p_appointment_id uuid default null,
  p_customer_id uuid default null
) returns jsonb language plpgsql as $$
declare
  v_id uuid;
  v_service_name text;
  v_token text;
  v_tz text;
  v_sentinel int;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select timezone into v_tz from business where id = p_business_id;
  select name into v_service_name from service
    where id = p_service_id and business_id = p_business_id;
  v_token := next_token(p_business_id);
  v_sentinel := case when p_position = 'next' then -1 else 1000000 end;

  insert into queue_entry(
    business_id, customer_id, customer_name, customer_phone, service_id, service_name,
    staff_id, preferred_staff_id, token, token_day, status, source, position,
    appointment_id, joined_at
  ) values (
    p_business_id, p_customer_id, p_name, p_phone, p_service_id, v_service_name,
    p_staff_id, p_preferred_staff_id, v_token,
    (now() at time zone coalesce(v_tz,'Asia/Kolkata'))::date,
    'waiting', p_source, v_sentinel, p_appointment_id, now()
  ) returning id into v_id;

  perform _queue_renumber(p_business_id, p_staff_id);
  return jsonb_build_object('id', v_id, 'token', v_token, 'staff_id', p_staff_id);
end $$;

-- Start service: waiting -> in_service.
create or replace function queue_start(p_business_id uuid, p_entry_id uuid)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_status queue_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status into v_seat, v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'waiting' then raise exception 'TEJO:INVALID_STATE'; end if;
  if exists (select 1 from queue_entry
             where business_id = p_business_id and staff_id = v_seat and status = 'in_service') then
    raise exception 'TEJO:SEAT_BUSY';
  end if;
  update queue_entry set status = 'in_service', started_at = now(), position = 0, updated_at = now()
    where id = p_entry_id;
  perform _queue_renumber(p_business_id, v_seat);
  return jsonb_build_object('id', p_entry_id, 'staff_id', v_seat);
end $$;

-- Complete & start next: create visit, update customer aggregates, auto-promote.
create or replace function queue_checkout(p_business_id uuid, p_entry_id uuid)
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

  v_amount := coalesce((select price_paise from service where id = v_service_id), 0)
    + coalesce((select sum(price_paise) from queue_entry_extra where queue_entry_id = p_entry_id), 0);

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
    'promoted', case when v_promoted_id is null then null
                     else jsonb_build_object('id', v_promoted_id, 'name', v_promoted_name) end
  );
end $$;

-- Mark no-show (no auto-promotion, per the app).
create or replace function queue_no_show(p_business_id uuid, p_entry_id uuid)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_status queue_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status into v_seat, v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status not in ('waiting','in_service') then raise exception 'TEJO:INVALID_STATE'; end if;
  update queue_entry set status = 'no_show', updated_at = now() where id = p_entry_id;
  perform _queue_renumber(p_business_id, v_seat);
  return jsonb_build_object('id', p_entry_id, 'staff_id', v_seat);
end $$;

-- Reassign a waiting entry to another seat (appended at that seat's end).
create or replace function queue_reassign(p_business_id uuid, p_entry_id uuid, p_staff_id uuid)
returns jsonb language plpgsql as $$
declare v_old uuid; v_status queue_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status into v_old, v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'waiting' then raise exception 'TEJO:INVALID_STATE'; end if;
  if not exists (select 1 from staff where id = p_staff_id and business_id = p_business_id) then
    raise exception 'TEJO:NOT_FOUND';
  end if;
  update queue_entry set staff_id = p_staff_id, status = 'waiting', position = 1000000, updated_at = now()
    where id = p_entry_id;
  perform _queue_renumber(p_business_id, v_old);
  perform _queue_renumber(p_business_id, p_staff_id);
  return jsonb_build_object('id', p_entry_id, 'from_staff_id', v_old, 'to_staff_id', p_staff_id);
end $$;

-- Extend an in-service entry with an add-on. Downstream waits grow automatically
-- via the ETA projection (no need to mutate other entries — see docs/17 Q7).
create or replace function queue_extend(
  p_business_id uuid, p_entry_id uuid, p_label text, p_minutes int, p_price int
) returns jsonb language plpgsql as $$
declare v_status queue_status; v_name text;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select status, service_name into v_status, v_name
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;
  if position(lower(p_label) in lower(coalesce(v_name,''))) = 0 then
    v_name := coalesce(v_name,'') || ' + ' || p_label;
  end if;
  update queue_entry set service_name = v_name,
                         extra_minutes = extra_minutes + p_minutes,
                         updated_at = now()
    where id = p_entry_id;
  insert into queue_entry_extra(queue_entry_id, label, minutes, price_paise)
    values (p_entry_id, p_label, p_minutes, coalesce(p_price,0));
  return jsonb_build_object('id', p_entry_id, 'service_name', v_name);
end $$;

-- Reorder a waiting entry within its seat to a target index.
create or replace function queue_move(p_business_id uuid, p_entry_id uuid, p_to_index int)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_ids uuid[]; v_len int; v_idx int; i int;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id into v_seat
    from queue_entry where id = p_entry_id and business_id = p_business_id and status = 'waiting';
  if v_seat is null then raise exception 'TEJO:INVALID_STATE'; end if;

  select array_agg(id order by position asc, joined_at asc) into v_ids
    from queue_entry where business_id = p_business_id and staff_id = v_seat and status = 'waiting';
  v_ids := array_remove(v_ids, p_entry_id);
  v_len := coalesce(array_length(v_ids, 1), 0);
  v_idx := greatest(0, least(p_to_index, v_len));
  v_ids := (v_ids)[1:v_idx] || array[p_entry_id] || (v_ids)[v_idx+1:];

  for i in 1 .. array_length(v_ids, 1) loop
    update queue_entry set position = i - 1, updated_at = now() where id = v_ids[i];
  end loop;
  return jsonb_build_object('staff_id', v_seat, 'order', to_jsonb(v_ids));
end $$;

-- Cancel/leave (waiting only).
create or replace function queue_leave(p_business_id uuid, p_entry_id uuid)
returns jsonb language plpgsql as $$
declare v_seat uuid; v_status queue_status;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select staff_id, status into v_seat, v_status
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status not in ('waiting') then raise exception 'TEJO:INVALID_STATE'; end if;
  update queue_entry set status = 'cancelled', updated_at = now() where id = p_entry_id;
  perform _queue_renumber(p_business_id, v_seat);
  return jsonb_build_object('id', p_entry_id, 'staff_id', v_seat);
end $$;

-- Check in an appointment -> online queue entry (seat pre-resolved in TS).
create or replace function appointment_check_in(
  p_business_id uuid, p_appointment_id uuid, p_staff_id uuid
) returns jsonb language plpgsql as $$
declare
  v_status appointment_status; v_name text; v_phone text;
  v_service_id uuid; v_customer uuid; v_new jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select status, customer_name, customer_phone, service_id, customer_id
    into v_status, v_name, v_phone, v_service_id, v_customer
    from appointment where id = p_appointment_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status not in ('pending','confirmed') then raise exception 'TEJO:ALREADY_CHECKED_IN'; end if;

  v_new := queue_add(p_business_id, v_name, v_phone, v_service_id, p_staff_id,
                     'end', 'online', p_staff_id, p_appointment_id, v_customer);

  update appointment set status = 'checked_in', queue_entry_id = (v_new->>'id')::uuid, updated_at = now()
    where id = p_appointment_id;

  return jsonb_build_object('appointment_id', p_appointment_id, 'entry', v_new);
end $$;
