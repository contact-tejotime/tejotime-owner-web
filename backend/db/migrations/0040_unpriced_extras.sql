-- =====================================================================
-- TejoTime — 0040_unpriced_extras
--
-- A service with NO price (`price_type = 'unset'`) must be priced by whoever checks the visit out
-- — the checkout sheet asks for it in its own row and keeps Complete disabled until it is filled
-- (client request 2026-10-06, docs/checkout-add-ons.md). That works for the visit's FIRST-picked
-- service, which `queue_entry.service_id` points at. It silently did not for the others:
--
--   A customer who picks "Hair wash" (₹100) then "Hair cut" (no price) gets Hair wash as the
--   primary service and Hair cut as a `queue_entry_extra` row at ₹0 (0025). Nothing marked that
--   row as unpriced, so the sheet asked for nothing and `queue_checkout` happily derived ₹100 for
--   a haircut-and-wash. Pick the same two the other way round and the haircut was asked for.
--
-- So an attached extra now remembers its catalog service's price type, and the two places that
-- decide "is an amount required?" read it:
--
--   * `queue_entry_extra.price_type` — the service's `price_type` at attach time. NULL for chip
--     add-ons (`queue_extend`: the owner typed their price) and for every row written before this
--     migration. No backfill: a visit already in the queue keeps the behaviour it started with.
--   * `queue_attach_services` resolves it from the `serviceId` each item now carries (looked up
--     inside the business — service names are not unique, so never by name).
--   * `appointment_check_in` passes `appointment_service.service_id` through as that `serviceId`.
--   * `queue_checkout` refuses to DERIVE an amount (TEJO:AMOUNT_REQUIRED) when any extra is
--     unpriced, exactly as it already did for an unpriced primary service — so an app build that
--     predates the sheet's required price, or a bare API call, cannot bank ₹0 for the haircut.
--
-- Only `unset` counts. A range-priced extra keeps its stored floor price (the client's call).
--
-- Every function keeps its exact signature, so each is a true replacement (no overload trap —
-- see 0016/0020). Bodies are 0025's and 0030's with only the marked changes.
-- =====================================================================

alter table queue_entry_extra add column if not exists price_type text;

-- 0025's body; CHANGED: stores the catalog service's price type for each attached item.
create or replace function queue_attach_services(
  p_business_id uuid, p_entry_id uuid, p_services jsonb
) returns jsonb language plpgsql as $$
declare
  v_name text; v_item jsonb; v_label text; v_minutes int; v_price int; v_added int := 0;
  v_price_type text;
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

    -- CHANGED (0040): by id, inside this business. A malformed or foreign id is just NULL.
    v_price_type := null;
    if coalesce(v_item->>'serviceId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select price_type into v_price_type
        from service where id = (v_item->>'serviceId')::uuid and business_id = p_business_id;
    end if;

    if position(lower(v_label) in lower(coalesce(v_name, ''))) = 0 then
      v_name := case when coalesce(v_name, '') = '' then v_label else v_name || ' + ' || v_label end;
      update queue_entry set extra_minutes = extra_minutes + v_minutes where id = p_entry_id;
      insert into queue_entry_extra(queue_entry_id, label, minutes, price_paise, price_type)
        values (p_entry_id, v_label, v_minutes, v_price, v_price_type);
      v_added := v_added + 1;
    end if;
  end loop;

  update queue_entry set service_name = v_name, updated_at = now() where id = p_entry_id;
  return jsonb_build_object('id', p_entry_id, 'service_name', v_name, 'added', v_added);
end $$;

-- 0025's body; CHANGED: each extra carries its booked service's id.
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
  select jsonb_agg(jsonb_build_object('name', name, 'minutes', minutes, 'price', price_paise,
                                      'serviceId', service_id)   -- CHANGED (0040)
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

-- 0030's body; CHANGED: an unpriced extra needs an explicit amount, like an unpriced primary.
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
    -- CHANGED (0040): a no-price service picked second is an extra stored at 0; deriving would
    -- bank it as free.
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
