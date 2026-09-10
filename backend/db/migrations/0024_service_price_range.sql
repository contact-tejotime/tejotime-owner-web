-- =====================================================================
-- TejoTime — 0024_service_price_range: two pricing modes per service.
--
-- Numbered 0024, not 0023: `0023_eta_2_sms.sql` is already recorded in schema_migrations on the
-- deployed databases (it added queue_entry.notified_eta_2_at / notified_two_away_at) even though
-- the file is in no branch of this repo. `schema_migrations` keys on filename, so a second 0023
-- would still apply — but ordering here is filename sort, and the repo already carries one
-- duplicate-number scar (0016). Not adding a second.
--
--   fixed  — one amount. `price_paise` is it; `price_max_paise` is null.
--   range  — a band. `price_paise` is the MINIMUM, `price_max_paise` the maximum, and the
--            person checking the customer out types the real figure.
--   unset  — nobody has priced this service yet. See the backfill note below.
--
-- WHY A THIRD STATE. Until now "not priced yet" was encoded as `price_paise = 0`, and every
-- surface had to guess what a zero meant. The microsite guessed "Price varies"; the checkout
-- sheet guessed "₹0" and banked it. That magic zero is exactly what this migration removes, so
-- it cannot be re-derived here: an existing row with price_paise = 0 is NOT a fixed price of
-- zero and it is NOT a range (we have no bounds to invent for it). It is recorded as what it
-- actually is — unpriced — and the owner is asked to set it. `unset` can only ever arrive from
-- this backfill: the API refuses it on create and update, so no editor can choose it.
--
-- Text + check rather than a Postgres enum, matching 0015: an enum needs `alter type ... add
-- value`, which cannot run inside the transaction each migration is wrapped in.
-- =====================================================================

alter table service add column if not exists price_type text;
alter table service add column if not exists price_max_paise int;

-- Backfill BEFORE the not-null/check land, so re-running on a migrated database is a no-op.
update service
   set price_type = case when price_paise > 0 then 'fixed' else 'unset' end
 where price_type is null;

alter table service alter column price_type set default 'fixed';
alter table service alter column price_type set not null;

-- One shape per mode, enforced in the database rather than in four editors:
--   fixed → a positive amount, no ceiling.
--   range → a positive floor, a ceiling at or above it.
--   unset → no amounts at all (the zero is the legacy carrier, not a price).
alter table service drop constraint if exists ck_service_price_shape;
alter table service add constraint ck_service_price_shape check (
  (price_type = 'fixed' and price_paise > 0 and price_max_paise is null)
  or (price_type = 'range' and price_paise > 0 and price_max_paise is not null and price_max_paise >= price_paise)
  or (price_type = 'unset' and price_paise = 0 and price_max_paise is null)
);

-- ---------------------------------------------------------------------
-- queue_checkout: a range service may not fall through to the derived total.
--
-- 0020 made `p_amount_paise` an override so a customer who had extras was not banked at the
-- booked price. A range service is that same failure by construction — deriving would silently
-- bank the MINIMUM of a band the shop deliberately said it cannot pin down in advance. So the
-- amount stops being optional exactly there, and the refusal lives here rather than only in the
-- UI: the API is the boundary, and `visit.amount_paise` feeds every revenue KPI.
--
-- An `unset` service derives to 0 today and would keep doing so silently, which is the same
-- under-reporting with a different cause — it is refused on the same grounds.
-- ---------------------------------------------------------------------
create or replace function queue_checkout(
  p_business_id uuid,
  p_entry_id uuid,
  p_amount_paise bigint default null
)
returns jsonb language plpgsql as $$
declare
  v_seat uuid; v_status queue_status; v_customer uuid; v_service_id uuid;
  v_price_type text;
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

  if p_amount_paise is null then
    select price_type into v_price_type from service where id = v_service_id;
    if v_price_type in ('range', 'unset') then
      raise exception 'TEJO:AMOUNT_REQUIRED';
    end if;
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
