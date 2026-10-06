-- =====================================================================
-- TejoTime — 0039_checkout_addons
--
-- The checkout sheet's add-on chips (Shave, Beard trim, Hair wash, …) became a TOGGLE: a chip is
-- highlighted while its add-on is on the visit, a tap on a highlighted chip takes it off again,
-- and a tap on a plain one asks the owner what they charged for it
-- (docs/checkout-add-ons.md, client bug report 2026-10-06).
--
--   * `queue_extend` inserted a `queue_entry_extra` row on EVERY call. Only `service_name` was
--     guarded against a repeat, so a second tap on "Beard trim" doubled its minutes and charged
--     it twice while the name still read "+ Beard trim" once. It now refuses a label that is
--     already on the visit (TEJO:ALREADY_ADDED → 409). That also protects the app builds already
--     in the field, which still add on every tap.
--   * `queue_remove_extra` is new: nothing could take an add-on back off, so a mis-tap could only
--     be corrected by hand-editing the final amount — and the ETA kept the extra minutes.
--
-- One add-on label per visit is the rule both functions enforce, and what the chips show.
-- Services attached at booking (`queue_attach_services`, 0025) are rows of the same table, so a
-- chip whose label matches one of them shows as on, and a tap removes it.
--
-- `queue_extend` keeps its exact signature (no overload trap — see 0016/0020); the price the owner
-- types arrives through the `p_price` it always had.
-- =====================================================================

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
  -- Case-insensitive, like the label lookup in the service layer and the chips' highlight.
  if exists (select 1 from queue_entry_extra
              where queue_entry_id = p_entry_id and lower(label) = lower(p_label)) then
    raise exception 'TEJO:ALREADY_ADDED';
  end if;
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

-- ---------------------------------------------------------------------
-- Take an add-on back off an in-service entry: the exact inverse of queue_extend.
--
-- Every row carrying the label goes (case-insensitive) — visits extended before this migration
-- can hold the same add-on twice, and the chip that removes it is one chip. Its minutes come off
-- `extra_minutes` (floored at 0) so the ETA shrinks with it, and its ` + Label` segment comes off
-- `service_name`. The FIRST segment is the booked service itself and is never removed, even when
-- an add-on happens to share its name.
-- ---------------------------------------------------------------------
create or replace function queue_remove_extra(
  p_business_id uuid, p_entry_id uuid, p_label text
) returns jsonb language plpgsql as $$
declare v_status queue_status; v_name text; v_minutes int; v_removed int;
begin
  perform pg_advisory_xact_lock(hashtext(p_business_id::text));
  select status, service_name into v_status, v_name
    from queue_entry where id = p_entry_id and business_id = p_business_id for update;
  if not found then raise exception 'TEJO:NOT_FOUND'; end if;
  if v_status <> 'in_service' then raise exception 'TEJO:INVALID_STATE'; end if;

  with gone as (
    delete from queue_entry_extra
     where queue_entry_id = p_entry_id and lower(label) = lower(p_label)
     returning minutes
  )
  select count(*), coalesce(sum(minutes), 0) into v_removed, v_minutes from gone;
  if v_removed = 0 then raise exception 'TEJO:NOT_FOUND'; end if;

  if v_name is not null then
    select string_agg(seg, ' + ' order by ord) into v_name
      from unnest(string_to_array(v_name, ' + ')) with ordinality as s(seg, ord)
     where ord = 1 or lower(trim(seg)) <> lower(trim(p_label));
  end if;

  update queue_entry set service_name = v_name,
                         extra_minutes = greatest(0, extra_minutes - v_minutes),
                         updated_at = now()
    where id = p_entry_id;
  return jsonb_build_object('id', p_entry_id, 'service_name', v_name, 'removed', v_removed);
end $$;
