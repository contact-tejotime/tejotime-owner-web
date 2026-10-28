-- =====================================================================
-- TejoTime — 0045_customer_followup
--
-- "Due to come back" (client request 2026-10-28, docs/customer-due-list.md). The owner's Customers
-- screen lists regulars who are due for their next visit, so the salon can phone them and book a
-- time on the call. Who is due is worked out when the list is read, from `visit` alone — nothing
-- is stored or scheduled for that. What has to be stored is what the call achieved, so the same
-- person is not offered again tomorrow:
--
--   * `customer_followup` — ONE row per customer, the current state, not a history:
--       no_answer       hidden until `snooze_until` (tomorrow, set by the API);
--       call_later      hidden until `snooze_until` (the day the owner picked);
--       not_interested  hidden until the owner undoes it (the row is deleted).
--     `about_last_visit` is the customer's last visit day when the outcome was logged. A snooze
--     only holds while that is still their latest visit: someone who came in by themselves starts
--     a fresh cycle. Booking the customer deletes the row.
--     Days are STORE-LOCAL calendar dates, like every date the rules compare.
--
--   * `idx_visit_business_customer_completed` — the list reads each store's recent visits per
--     customer, newest first; the existing visit indexes are on business+time and customer alone.
--
-- Text plus checks, not enums (see 0042). An event log of calls can come later if reports need it.
-- Re-runnable.
-- =====================================================================

create table if not exists customer_followup (
  customer_id        uuid primary key references customer(id) on delete cascade,
  business_id        uuid not null references business(id) on delete cascade,
  outcome            text not null,
  snooze_until       date,
  about_last_visit   date not null,
  updated_by_user_id uuid references app_user(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table customer_followup drop constraint if exists ck_customer_followup_outcome;
alter table customer_followup add constraint ck_customer_followup_outcome
  check (outcome in ('no_answer', 'call_later', 'not_interested'));

-- A snooze always has its day; "not interested" never has one.
alter table customer_followup drop constraint if exists ck_customer_followup_shape;
alter table customer_followup add constraint ck_customer_followup_shape
  check ((outcome = 'not_interested' and snooze_until is null)
         or (outcome in ('no_answer', 'call_later') and snooze_until is not null));

create index if not exists idx_customer_followup_business on customer_followup (business_id);

create index if not exists idx_visit_business_customer_completed
  on visit (business_id, customer_id, completed_at desc)
  where customer_id is not null;
