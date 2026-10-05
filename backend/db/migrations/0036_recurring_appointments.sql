-- =====================================================================
-- TejoTime — 0036_recurring_appointments
--
-- A customer books once and the visit repeats — every 2 weeks, every 18 days, … — until an end
-- they chose. See docs/recurring-appointments.md.
--
-- THE RULE IS STORED, NOT THE FUTURE. `appointment_series` holds the repeat rule; every actual
-- visit is an ordinary `appointment` row linked by `series_id`. So the calendar, check-in, the
-- 15-minute reminder, slot capacity and customer self-service keep working per visit, unchanged.
-- Only the visits inside the job's horizon exist (recurringSweep books about three weeks ahead).
--
-- WHY THE HORIZON KEEPS THE SLOT SAFE: public booking offers today … today+13
-- (BOOKING_WINDOW_DAYS). The job books a series date once it is within today+20, so the visit
-- exists 7 days before any other customer can see that date. See lib/recurrence.ts.
--
-- (series_id, series_version, occurrence_date) is unique. A skipped visit keeps its row, so the
-- job can never re-create a date the customer skipped, even on a double run; a later "change all
-- future visits" bumps `version`, so the same date can be booked again under the new rule.
--
-- No enum changes on purpose: a series visit is recognised by series_id, not by a new
-- appointment_source value — `alter type … add value` cannot be used in the transaction that adds
-- it, and every migration here runs inside one.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- Per-store switch: "Let customers book repeating appointments". On by default; the owner can
-- turn it off. Enforced by the API, not just hidden on the booking page.
alter table business
  add column if not exists recurring_enabled boolean not null default true;

create table if not exists appointment_series (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references business(id) on delete cascade,
  customer_id        uuid references customer(id) on delete set null,
  customer_name      text not null,
  customer_phone     text not null,
  -- Null = any stylist. `staff_locked` remembers that one WAS chosen, so a deleted stylist (on
  -- delete set null) is flagged to the owner instead of being silently read as "any".
  staff_id           uuid references staff(id) on delete set null,
  staff_locked       boolean not null default false,
  visitor_type       text check (visitor_type in ('mr', 'patient')),
  -- Store-local wall clock, never a UTC instant: 10:00 AM stays 10:00 AM across daylight saving
  -- (US stores have it; India does not).
  start_time         time not null,
  -- Store-local date of the first visit under the current rule (version).
  anchor_date        date not null,
  interval_days      int not null check (interval_days between 7 and 90),
  end_type           text not null check (end_type in ('never', 'count', 'until')),
  -- Number of rule dates, the first visit included. A skipped date still uses one up.
  end_count          int check (end_count between 2 and 26),
  end_date           date,
  status             text not null default 'active'
                       check (status in ('active', 'paused', 'ended', 'cancelled')),
  pause_reason       text check (pause_reason in ('owner', 'stylist_unavailable', 'no_shows')),
  version            int not null default 1,
  -- The last rule date already handled (booked, skipped or flagged). The job's next candidate is
  -- the first rule date after it.
  generated_through  date not null,
  sms_opt_in         boolean not null default false,
  review_sms_opt_in  boolean not null default false,
  source             appointment_source not null default 'online',
  -- The customer's manage link (…/{store}/v#token). Random and stored rather than an HMAC over
  -- the id, because an HMAC link would also have to carry the 36-character id, and the
  -- confirmation SMS that delivers it is length-bound.
  manage_token       text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paused_at          timestamptz,
  cancelled_at       timestamptz,
  ended_at           timestamptz,
  constraint ck_appointment_series_end check (
       (end_type = 'never' and end_count is null and end_date is null)
    or (end_type = 'count' and end_count is not null and end_date is null)
    or (end_type = 'until' and end_date is not null and end_count is null)
  )
);

create unique index if not exists uq_appointment_series_token on appointment_series(manage_token);
create index if not exists idx_appointment_series_business on appointment_series(business_id, status);
-- One open series per phone number per store. Without OTP anyone can type any number, so this is
-- what stops a script from parking a dozen "Never" series on the best Saturday slots.
create unique index if not exists uq_appointment_series_open_phone
  on appointment_series(business_id, customer_phone)
  where status in ('active', 'paused');

-- The services a series repeats. Only ids are kept as the source of truth: names, durations and
-- prices are copied from `service` when EACH visit is created (the way a normal booking copies
-- them), so a price change reaches the visits booked after it. `name` is kept so a deleted service
-- can still be named in the owner's Needs attention list.
create table if not exists appointment_series_service (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid not null references appointment_series(id) on delete cascade,
  service_id  uuid references service(id) on delete set null,
  name        text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_appointment_series_service on appointment_series_service(series_id, position);

alter table appointment
  add column if not exists series_id uuid references appointment_series(id) on delete set null;
alter table appointment
  add column if not exists series_version int;
-- The rule date. It does NOT change when one visit is rescheduled, so the job still knows that
-- date was handled.
alter table appointment
  add column if not exists occurrence_date date;
-- Lets reports tell a customer's skip from a cancellation.
alter table appointment
  add column if not exists cancel_reason text;
alter table appointment drop constraint if exists ck_appointment_cancel_reason;
alter table appointment add constraint ck_appointment_cancel_reason
  check (cancel_reason is null or cancel_reason in ('skipped', 'cancelled', 'superseded'));

create unique index if not exists uq_appointment_series_occurrence
  on appointment(series_id, series_version, occurrence_date)
  where series_id is not null;

-- The owner's Needs attention list: series dates the job could not book. No SMS goes out for
-- these (docs/recurring-appointments.md §4), so this list is how the owner knows to phone.
create table if not exists appointment_series_issue (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references business(id) on delete cascade,
  series_id           uuid not null references appointment_series(id) on delete cascade,
  series_version      int not null,
  occurrence_date     date not null,
  -- The time the series wanted, so the owner sees "Sat 24 Oct, 10:00 AM".
  scheduled_start_at  timestamptz not null,
  reason              text not null
                        check (reason in ('outside_hours', 'stylist_unavailable', 'slot_taken', 'service_missing')),
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  resolution          text check (resolution in ('handled', 'booked')),
  resolved_by_user_id uuid references app_user(id) on delete set null,
  constraint uq_appointment_series_issue unique (series_id, series_version, occurrence_date)
);
create index if not exists idx_appointment_series_issue_open
  on appointment_series_issue(business_id)
  where resolved_at is null;
