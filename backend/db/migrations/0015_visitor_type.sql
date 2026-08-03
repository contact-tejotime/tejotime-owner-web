-- =====================================================================
-- TejoTime — 0015_visitor_type: MR / Patient identification for Hospital
-- category businesses. Nullable everywhere else; purely a display field,
-- not part of the wait-time engine.
-- =====================================================================

alter table queue_entry add column if not exists visitor_type text check (visitor_type in ('mr', 'patient'));
alter table appointment add column if not exists visitor_type text check (visitor_type in ('mr', 'patient'));

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
  p_customer_id uuid default null,
  p_visitor_type text default null
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
    appointment_id, joined_at, visitor_type
  ) values (
    p_business_id, p_customer_id, p_name, p_phone, p_service_id, v_service_name,
    p_staff_id, p_preferred_staff_id, v_token,
    (now() at time zone coalesce(v_tz,'Asia/Kolkata'))::date,
    'waiting', p_source, v_sentinel, p_appointment_id, now(), p_visitor_type
  ) returning id into v_id;

  perform _queue_renumber(p_business_id, p_staff_id);
  return jsonb_build_object('id', v_id, 'token', v_token, 'staff_id', p_staff_id);
end $$;
