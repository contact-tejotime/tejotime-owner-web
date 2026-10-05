-- =====================================================================
-- TejoTime — 0037_recurring_edit
--
-- Recurring appointments, Phase 2: reschedule one visit, change all future visits, and book a
-- Needs-attention date at another time. See docs/recurring-appointments.md.
--
-- appointment.rescheduled_at — set when one visit is moved by hand (customer, owner, or "Book
-- another time"). A moved visit is an EXCEPTION: a later "change all future visits" leaves it
-- where the customer put it (client decision, 2026-10-03), and the owner screens label it "Moved".
--
-- appointment_series.anchor_index — how many rule dates came before `anchor_date`. A change
-- re-anchors the rule on the date it starts from, and `end_count` must keep meaning the ORIGINAL
-- total ("6 visits · last on …"): rewriting it to the remaining count would break that label and
-- the 2..26 check. lib/recurrence.ts reads it as `startIndex`.
--
-- Idempotent: safe to re-run.
-- =====================================================================

alter table appointment
  add column if not exists rescheduled_at timestamptz;

alter table appointment_series
  add column if not exists anchor_index int not null default 0;
alter table appointment_series drop constraint if exists ck_appointment_series_anchor_index;
alter table appointment_series add constraint ck_appointment_series_anchor_index check (anchor_index >= 0);

-- Admin "Bookings" stats: a visit a "change all future visits" replaced (cancel_reason
-- 'superseded') was never cancelled by anyone — counting it would inflate the store's cancelled
-- figure with every change. Same signature, so a true replacement (no overload to drop).
create or replace function admin_appointment_stats(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns table (status text, source text, cnt bigint)
language sql stable as $$
  select a.status::text, a.source::text, count(*)
  from appointment a
  where a.business_id = p_business_id
    and a.scheduled_start_at >= p_start
    and a.scheduled_start_at <= p_end
    and a.cancel_reason is distinct from 'superseded'
  group by 1, 2;
$$;
