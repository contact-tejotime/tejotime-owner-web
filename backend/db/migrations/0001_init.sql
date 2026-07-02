-- =====================================================================
-- TejoTime — 0001_init: extensions, enums, tables, indexes
-- Mirrors docs/04-data-model.md. Money is integer paise. UUID PKs.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- enums ----------
do $$ begin
  create type plan_type as enum ('free','premium');
exception when duplicate_object then null; end $$;
do $$ begin
  create type subscription_status as enum ('trialing','active','past_due','canceled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type user_role as enum ('owner','manager','staff');
exception when duplicate_object then null; end $$;
do $$ begin
  create type queue_status as enum ('waiting','in_service','completed','no_show','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type queue_source as enum ('walk_in','online');
exception when duplicate_object then null; end $$;
do $$ begin
  create type appointment_status as enum ('pending','confirmed','checked_in','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;
do $$ begin
  create type appointment_source as enum ('online','owner');
exception when duplicate_object then null; end $$;
do $$ begin
  create type color_token as enum ('primary','secondary','amber500','green500');
exception when duplicate_object then null; end $$;
do $$ begin
  create type notification_channel as enum ('sms','email','push','in_app');
exception when duplicate_object then null; end $$;
do $$ begin
  create type notification_status as enum ('queued','sent','delivered','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type otp_purpose as enum ('join_queue','booking','customer_login','owner_login','phone_verify');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_status as enum ('created','authorized','captured','failed','refunded');
exception when duplicate_object then null; end $$;

-- ---------- business (tenant root) ----------
create table if not exists business (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  name              text not null,
  category          text,
  area              text,
  address           text,
  city              text,
  description       text,
  tagline           text,
  established_year  int,
  rating            numeric(2,1) default 0,
  review_count      int default 0,
  logo_url          text,
  hero_image_url    text,
  timezone          text not null default 'Asia/Kolkata',
  currency          char(3) not null default 'INR',
  token_prefix      text not null default 'A',
  payments          text[] default array['UPI','Card','Cash'],
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- business_hour ----------
create table if not exists business_hour (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  day_of_week  int not null check (day_of_week between 0 and 6),
  opens_at     time,
  closes_at    time,
  is_closed    boolean not null default false,
  unique (business_id, day_of_week)
);

-- ---------- amenity ----------
create table if not exists amenity (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  label        text not null,
  position     int not null default 0
);

-- ---------- gallery_image ----------
create table if not exists gallery_image (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  url          text not null,
  alt          text,
  position     int not null default 0
);

-- ---------- app_user (owner/staff logins; "user" is reserved) ----------
create table if not exists app_user (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references business(id) on delete cascade,
  handle         text unique not null,
  email          text,
  phone          text,
  password_hash  text not null,
  role           user_role not null default 'owner',
  name           text,
  dark_mode      boolean not null default false,
  last_login_at  timestamptz,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_app_user_business on app_user(business_id);

-- ---------- staff (seats / providers) ----------
create table if not exists staff (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references business(id) on delete cascade,
  user_id          uuid references app_user(id) on delete set null,
  name             text not null,
  role_label       text,
  color_token      color_token not null default 'secondary',
  accepts_walk_ins boolean not null default true,
  is_active        boolean not null default true,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_staff_business on staff(business_id);

-- ---------- service ----------
create table if not exists service (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references business(id) on delete cascade,
  name              text not null,
  duration_minutes  int not null,
  price_paise       int not null default 0,
  currency          char(3) not null default 'INR',
  color_token       color_token not null default 'secondary',
  is_active         boolean not null default true,
  position          int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_service_business on service(business_id);

-- ---------- customer ----------
create table if not exists customer (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references business(id) on delete cascade,
  name               text not null,
  phone              text not null,
  email              text,
  is_vip             boolean not null default false,
  visits_count       int not null default 0,
  total_spend_paise  bigint not null default 0,
  last_visit_at      timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, phone)
);
create index if not exists idx_customer_business_created on customer(business_id, created_at desc);
create index if not exists idx_customer_name_trgm on customer using gin (name gin_trgm_ops);
create index if not exists idx_customer_phone_trgm on customer using gin (phone gin_trgm_ops);

-- ---------- appointment ----------
create table if not exists appointment (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references business(id) on delete cascade,
  customer_id         uuid references customer(id) on delete set null,
  customer_name       text not null,
  customer_phone      text,
  service_id          uuid references service(id) on delete set null,
  service_name        text,
  staff_id            uuid references staff(id) on delete set null,
  scheduled_start_at  timestamptz not null,
  scheduled_end_at    timestamptz,
  status              appointment_status not null default 'pending',
  source              appointment_source not null default 'owner',
  queue_entry_id      uuid,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_appt_business_start on appointment(business_id, scheduled_start_at);
create index if not exists idx_appt_business_status on appointment(business_id, status);

-- ---------- queue_entry (live queue + public tickets) ----------
create table if not exists queue_entry (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references business(id) on delete cascade,
  customer_id           uuid references customer(id) on delete set null,
  customer_name         text not null,
  customer_phone        text,
  service_id            uuid references service(id) on delete set null,
  service_name          text,
  staff_id              uuid references staff(id) on delete set null,
  preferred_staff_id    uuid references staff(id) on delete set null,
  token                 text,
  token_day             date,
  status                queue_status not null default 'waiting',
  source                queue_source not null,
  position              int not null default 0,
  extra_minutes         int not null default 0,
  base_wait_minutes     int not null default 0,
  appointment_id        uuid references appointment(id) on delete set null,
  joined_at             timestamptz not null default now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  notified_two_away_at  timestamptz,
  notified_turn_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_queue_business_seat_status on queue_entry(business_id, staff_id, status, position);
create index if not exists idx_queue_business_status on queue_entry(business_id, status);
create unique index if not exists uq_one_in_service_per_seat
  on queue_entry(business_id, staff_id) where status = 'in_service';
create unique index if not exists uq_token_per_day
  on queue_entry(business_id, token, token_day) where token is not null;

alter table appointment
  drop constraint if exists fk_appt_queue_entry;
alter table appointment
  add constraint fk_appt_queue_entry
  foreign key (queue_entry_id) references queue_entry(id) on delete set null;

-- ---------- queue_entry_extra (service add-ons) ----------
create table if not exists queue_entry_extra (
  id              uuid primary key default gen_random_uuid(),
  queue_entry_id  uuid not null references queue_entry(id) on delete cascade,
  label           text not null,
  minutes         int not null default 0,
  price_paise     int not null default 0,
  created_at      timestamptz not null default now()
);

-- ---------- visit (completed-service ledger) ----------
create table if not exists visit (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references business(id) on delete cascade,
  customer_id     uuid references customer(id) on delete set null,
  queue_entry_id  uuid references queue_entry(id) on delete set null,
  staff_id        uuid references staff(id) on delete set null,
  service_name    text,
  amount_paise    bigint not null default 0,
  completed_at    timestamptz not null default now()
);
create index if not exists idx_visit_business_completed on visit(business_id, completed_at);
create index if not exists idx_visit_customer on visit(customer_id);

-- ---------- subscription ----------
create table if not exists subscription (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null unique references business(id) on delete cascade,
  plan                      plan_type not null default 'free',
  status                    subscription_status not null default 'trialing',
  trial_ends_at             timestamptz,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  provider                  text,
  provider_subscription_id  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------- payment ----------
create table if not exists payment (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references business(id) on delete cascade,
  subscription_id     uuid references subscription(id) on delete set null,
  amount_paise        bigint not null,
  currency            char(3) not null default 'INR',
  status              payment_status not null default 'created',
  provider            text,
  provider_payment_id text,
  created_at          timestamptz not null default now()
);

-- ---------- notification (outbound log) ----------
create table if not exists notification (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references business(id) on delete cascade,
  customer_id         uuid references customer(id) on delete set null,
  queue_entry_id      uuid references queue_entry(id) on delete set null,
  appointment_id      uuid references appointment(id) on delete set null,
  channel             notification_channel not null default 'in_app',
  template            text,
  to_address          text,
  body                text,
  status              notification_status not null default 'queued',
  provider_message_id text,
  error               text,
  read_at             timestamptz,
  scheduled_for       timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_notification_business on notification(business_id, created_at desc);

-- ---------- otp_verification ----------
create table if not exists otp_verification (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references business(id) on delete cascade,
  phone        text not null,
  code_hash    text not null,
  purpose      otp_purpose not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  attempts     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_otp_phone on otp_verification(phone, purpose);

-- ---------- auth_session (refresh tokens) ----------
create table if not exists auth_session (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id) on delete cascade,
  token_hash  text not null,
  user_agent  text,
  ip          text,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_auth_session_user on auth_session(user_id);

-- ---------- audit_log ----------
create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references business(id) on delete cascade,
  actor_user_id  uuid references app_user(id) on delete set null,
  actor_type     text,
  action         text not null,
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb,
  ip             text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_audit_business on audit_log(business_id, created_at desc);

-- ---------- token_counter (daily per-business ticket sequence) ----------
create table if not exists token_counter (
  business_id  uuid not null references business(id) on delete cascade,
  day_key      text not null,
  seq          int not null default 0,
  primary key (business_id, day_key)
);

-- ---------- idempotency_key ----------
create table if not exists idempotency_key (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid,
  key           text not null,
  method        text,
  path          text,
  response_json jsonb,
  created_at    timestamptz not null default now(),
  unique (key)
);
