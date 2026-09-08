-- =====================================================================
-- TejoTime — 0025_multi_service_selection: more than one service per visit.
--
-- A customer books a haircut AND a hair spa. Until now the microsite and the walk-in sheet let
-- them pick exactly one, so the second service was invisible: the wait-time engine sized the
-- visit at 30 minutes instead of 90, and checkout suggested ₹350 instead of ₹1150.
--
-- NO new shape for the queue. The product already models "one visit, several services" — it is
-- what `queue_extend` produces when a customer in the chair asks for a shave:
--
--   queue_entry.service_id     the FIRST service (keeps the FK and every existing query working)
--   queue_entry.service_name   the combined label, "Haircut + Hair Spa"
--   queue_entry.extra_minutes  the sum of the OTHER services' durations  → estMins() adds it
--   queue_entry_extra          one row per other service               → billingFor() sums it
--
-- So multi-select reuses the mechanism that already feeds both the wait-time maths and the
-- checkout total, rather than introducing a second way to say the same thing.
--
-- Appointments DO need somewhere to itemise, because a booking is made now and checked in
-- later: without the list, check-in could not rebuild the queue entry's extras and the price
-- would collapse back to the primary service. Hence `appointment_service`.
-- =====================================================================

create table if not exists appointment_service (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references appointment(id) on delete cascade,
  -- Nullable + on delete set null, matching appointment.service_id: deleting a service from the
  -- menu must not delete the history of the visits that used it. `name`/`minutes`/`price_paise`
  -- are denormalised for exactly that reason — they are what the customer actually agreed to.
  service_id      uuid references service(id) on delete set null,
  name            text not null,
  minutes         int not null default 0,
  price_paise     int not null default 0,
  -- 0 is the primary service (the one mirrored onto appointment.service_id).
  position        int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_appointment_service_appt on appointment_service(appointment_id, position);

-- ---------------------------------------------------------------------
-- Attach extra services to an entry that already exists.
--
-- `queue_extend` cannot be reused for this: it refuses anything that is not already `in_service`,
-- because it exists for the customer in the chair who asks for one more thing. Services chosen
-- at booking time land on an entry that is still `waiting`, which is a different moment with the
-- same effect on the row, so it gets its own function rather than a loosened guard on that one.
--
-- Idempotent on the label, like queue_extend: re-attaching a name already present in
-- service_name appends nothing, so a retried request cannot produce "Haircut + Spa + Spa".
-- ---------------------------------------------------------------------
create or replace function queue_attach_services(
  p_business_id uuid, p_entry_id uuid, p_services jsonb
) returns jsonb language plpgsql as $$
declare
  v_name text; v_item jsonb; v_label text; v_minutes int; v_price int; v_added int := 0;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select service_name into v_name
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_services, '[]'::jsonb))
  loop
    v_label   := v_item->>'name';
    v_minutes := coalesce((v_item->>'minutes')::int, 0);
    v_price   := coalesce((v_item->>'price')::int, 0);
    continue when v_label is null or length(trim(v_label)) = 0;

    if position(lower(v_label) in lower(coalesce(v_name, ''))) = 0 then
      v_name := case when coalesce(v_name, '') = '' then v_label else v_name || ' + ' || v_label end;
      update queue_entry set extra_minutes = extra_minutes + v_minutes where id = p_entry_id;
      insert into queue_entry_extra(queue_entry_id, label, minutes, price_paise)
        values (p_entry_id, v_label, v_minutes, v_price);
      v_added := v_added + 1;
    end if;
  end loop;

  update queue_entry set service_name = v_name, updated_at = now() where id = p_entry_id;
  return jsonb_build_object('id', p_entry_id, 'service_name', v_name, 'added', v_added);
end $$;

-- ---------------------------------------------------------------------
-- Check-in now carries the whole booking into the queue, not just its first service.
--
-- Same signature, so this is a true replacement — no overload to drop (see 0016/0020).
-- ---------------------------------------------------------------------
create or replace function appointment_check_in(
  p_business_id uuid, p_appointment_id uuid, p_staff_id uuid
) returns jsonb language plpgsql as $$
declare
  v_status appointment_status; v_name text; v_phone text;
  v_service_id uuid; v_customer uuid; v_new jsonb; v_extras jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select status, customer_name, customer_phone, service_id, customer_id
    into v_status, v_name, v_phone, v_service_id, v_customer
    from appointment where id = p_appointment_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status not in ('pending','confirmed') then raise exception 'TEJO:ALREADY_CHECKED_IN'; end if;

  v_new := queue_add(p_business_id, v_name, v_phone, v_service_id, p_staff_id,
                     'end', 'online', p_staff_id, p_appointment_id, v_customer);

  -- Everything after the primary service, in the order it was booked. Without this the entry
  -- would be sized and priced as if only the first service had been chosen.
  select jsonb_agg(jsonb_build_object('name', name, 'minutes', minutes, 'price', price_paise)
                   order by position)
    into v_extras
    from appointment_service
   where appointment_id = p_appointment_id and position > 0;

  if v_extras is not null then
    perform queue_attach_services(p_business_id, (v_new->>'id')::uuid, v_extras);
  end if;

  update appointment set status = 'checked_in', queue_entry_id = (v_new->>'id')::uuid, updated_at = now()
    where id = p_appointment_id;

  return jsonb_build_object('appointment_id', p_appointment_id, 'entry', v_new);
end $$;
