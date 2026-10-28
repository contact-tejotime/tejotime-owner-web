import { exec, many, one } from '../../db/pool';
import { Errors } from '../../domain/errors';
import {
  compareDue,
  dueTiming,
  followupHides,
  rhythmOf,
  type DueStatus,
  type FollowupOutcome,
  type FollowupState,
} from '../../lib/due-back';
import { addDays, occurrenceStart, storeToday } from '../../lib/recurrence';
import { emitToOwners } from '../../realtime/emitters';
import type { FollowupInput } from './due.schemas';

/**
 * "Due to come back" — the owner's call list (docs/customer-due-list.md). Who is due is computed
 * here on every read, from `visit` alone, with the pure rules in lib/due-back.ts; the only stored
 * state is what a call achieved (`customer_followup`, 0045). Every function takes `now`, so the
 * smoke script can walk a store's calendar without waiting for it.
 */

/** "Call back on …" may be at most this far ahead (store-local days). */
export const CALL_BACK_MAX_DAYS = 60;
/** Rows returned; the counts always cover everyone. A salon never gets near this. */
const MAX_ROWS = 300;
const MAX_HIDDEN = 100;
/**
 * Visits read: the 180-day cutoff plus slack for the store's timezone. The exact cutoff is applied
 * by `dueTiming` on store-local days.
 */
const LOOKBACK_DAYS = 182;

export interface FollowupDTO {
  outcome: FollowupOutcome;
  snoozeUntil: string | null;
  aboutLastVisit: string;
  updatedAt: string;
}

export interface DueCustomerDTO {
  customerId: string;
  name: string;
  phone: string;
  isVip: boolean;
  visitsCount: number;
  status: DueStatus;
  usualDays: number;
  bandMin: number;
  bandMax: number;
  lastVisitDate: string;
  daysSinceLast: number;
  expectedDate: string;
  lastServiceName: string | null;
  lastStaff: { id: string; name: string; active: boolean } | null;
  /** The last visit's services that are still on the menu, in order — the booking sheet's pre-fill. */
  serviceIds: string[];
  /** False when part of the last visit could not be matched to a current service: check the chips. */
  servicesResolved: boolean;
  followup: FollowupDTO | null;
  /** Why a row in `hidden` is hidden. */
  hiddenReason?: 'not_interested' | 'snoozed';
}

export interface DueListDTO {
  today: string;
  /** The days "Call back on …" accepts. From the server, never the device clock. */
  callBackRange: { min: string; max: string };
  counts: { overdue: number; dueSoon: number; lapsed: number; hidden: number };
  data: DueCustomerDTO[];
  hidden: DueCustomerDTO[];
}

/** Digits only, so '+91 98…' and '9198…' compare equal (stored numbers have both forms). */
const DIGITS = (col: string) => `regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g')`;

async function storeZone(businessId: string): Promise<string> {
  const b = await one<{ timezone: string }>('select timezone from business where id = $1', [businessId]);
  if (!b) throw Errors.notFound('Business not found');
  return b.timezone;
}

function followupDTO(f: any): FollowupDTO | null {
  if (!f?.outcome) return null;
  return {
    outcome: f.outcome,
    snoozeUntil: f.snooze_until ?? null,
    aboutLastVisit: f.about_last_visit,
    updatedAt: new Date(f.followup_updated_at ?? f.updated_at).toISOString(),
  };
}

/**
 * Which of the last visit's services can be booked again. A visit stores its services as text: the
 * queue entry keeps the FIRST service's id and the rest as extra labels (a checked-in booking
 * replays its services as extras named after the service). Labels that are not a current service —
 * an add-on chip, a renamed or removed service — leave the pre-fill incomplete, which the sheet says.
 */
async function prefillServices(
  businessId: string,
  entryIds: string[],
): Promise<Map<string, { ids: string[]; resolved: boolean }>> {
  const out = new Map<string, { ids: string[]; resolved: boolean }>();
  if (entryIds.length === 0) return out;
  const [entries, extras, services] = await Promise.all([
    many<{ id: string; service_id: string | null }>(
      'select id, service_id from queue_entry where business_id = $1 and id = any($2::uuid[])',
      [businessId, entryIds],
    ),
    many<{ queue_entry_id: string; label: string }>(
      `select e.queue_entry_id, e.label
         from queue_entry_extra e
         join queue_entry q on q.id = e.queue_entry_id
        where q.business_id = $1 and e.queue_entry_id = any($2::uuid[])
        order by e.created_at, e.id`,
      [businessId, entryIds],
    ),
    many<{ id: string; name: string }>('select id, name from service where business_id = $1 and is_active = true', [
      businessId,
    ]),
  ]);
  const activeIds = new Set(services.map((s) => s.id));
  const byName = new Map(services.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const labels = new Map<string, string[]>();
  for (const e of extras) labels.set(e.queue_entry_id, [...(labels.get(e.queue_entry_id) ?? []), e.label]);

  for (const e of entries) {
    const ids: string[] = [];
    let resolved = true;
    if (e.service_id) {
      if (activeIds.has(e.service_id)) ids.push(e.service_id);
      else resolved = false;
    }
    for (const label of labels.get(e.id) ?? []) {
      const id = byName.get(label.trim().toLowerCase());
      if (id) {
        if (!ids.includes(id)) ids.push(id);
      } else {
        resolved = false;
      }
    }
    out.set(e.id, { ids, resolved });
  }
  return out;
}

/**
 * The call list. `seat` is `scopeStaffId(principal)`: null for the owner roles (the whole store); a
 * staff login sees only customers whose LAST visit was in its chair (the all-zero uuid of a staff
 * login with no chair matches nobody).
 */
export async function listDue(businessId: string, seat: string | null, now: Date = new Date()): Promise<DueListDTO> {
  const tz = await storeZone(businessId);
  const today = storeToday(now, tz);
  // "Already booked" counts from the store's midnight: someone late for this morning's booking is
  // not a customer to phone about their next visit.
  const dayStart = occurrenceStart(today, '00:00', tz).toISOString();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const rows = await many(
    `with visit_days as (
       select distinct v.customer_id, (v.completed_at at time zone b.timezone)::date as d
         from visit v
         join business b on b.id = v.business_id
        where v.business_id = $1 and v.customer_id is not null and v.completed_at >= $2
     ),
     ranked as (
       select customer_id, d, row_number() over (partition by customer_id order by d desc) as rn
         from visit_days
     ),
     days as (
       select customer_id, array_agg(d::text order by d) as days
         from ranked
        where rn <= 6
        group by customer_id
       having count(*) >= 3
     ),
     last_visit as (
       select distinct on (v.customer_id) v.customer_id, v.staff_id, v.service_name, v.queue_entry_id
         from visit v
        where v.business_id = $1 and v.customer_id in (select customer_id from days)
        order by v.customer_id, v.completed_at desc, v.id desc
     )
     select c.id, c.name, c.phone, c.is_vip, c.visits_count, d.days,
            lv.staff_id, s.name as staff_name, s.is_active as staff_active,
            lv.service_name, lv.queue_entry_id,
            f.outcome, f.snooze_until::text as snooze_until, f.about_last_visit::text as about_last_visit,
            f.updated_at as followup_updated_at
       from days d
       join customer c on c.id = d.customer_id and c.business_id = $1
       join last_visit lv on lv.customer_id = d.customer_id
       left join staff s on s.id = lv.staff_id
       left join customer_followup f on f.customer_id = c.id and f.business_id = $1
      where nullif(btrim(c.phone), '') is not null
        and ($3::uuid is null or lv.staff_id = $3::uuid)
        and not exists (
              select 1 from appointment a
               where a.business_id = $1
                 and a.status in ('pending', 'confirmed')
                 and a.cancel_reason is distinct from 'superseded'
                 and a.scheduled_start_at >= $4
                 and (a.customer_id = c.id or ${DIGITS('a.customer_phone')} = ${DIGITS('c.phone')}))
        and not exists (
              select 1 from appointment_series sr
               where sr.business_id = $1
                 and sr.status in ('active', 'paused')
                 and (sr.customer_id = c.id or ${DIGITS('sr.customer_phone')} = ${DIGITS('c.phone')}))
        and not exists (
              select 1 from queue_entry q
               where q.business_id = $1
                 and q.token_day = $5::date
                 and q.status in ('waiting', 'in_service')
                 and (q.customer_id = c.id or ${DIGITS('q.customer_phone')} = ${DIGITS('c.phone')}))`,
    [businessId, since, seat, dayStart, today],
  );

  type Built = DueCustomerDTO & { _entryId: string | null };
  const visible: Built[] = [];
  const hidden: Built[] = [];
  for (const r of rows) {
    const rhythm = rhythmOf(r.days as string[]);
    if (!rhythm) continue;
    const timing = dueTiming(rhythm, today);
    if (!timing) continue;
    const followup = followupDTO(r);
    const state: FollowupState | null = followup
      ? { outcome: followup.outcome, snoozeUntil: followup.snoozeUntil, aboutLastVisit: followup.aboutLastVisit }
      : null;
    const hiddenReason = followupHides(state, rhythm.lastVisit, today);
    const row: Built = {
      customerId: r.id,
      name: r.name,
      phone: r.phone,
      isVip: !!r.is_vip,
      visitsCount: Number(r.visits_count ?? 0),
      status: timing.status,
      usualDays: rhythm.usualDays,
      bandMin: rhythm.bandMin,
      bandMax: rhythm.bandMax,
      lastVisitDate: rhythm.lastVisit,
      daysSinceLast: timing.daysSinceLast,
      expectedDate: timing.expectedDate,
      lastServiceName: r.service_name ?? null,
      lastStaff: r.staff_id ? { id: r.staff_id, name: r.staff_name, active: !!r.staff_active } : null,
      serviceIds: [],
      servicesResolved: true,
      followup,
      _entryId: r.queue_entry_id ?? null,
    };
    if (hiddenReason) hidden.push({ ...row, hiddenReason });
    else visible.push(row);
  }

  const order = (a: Built, b: Built) =>
    compareDue(
      { ...a, lastVisit: a.lastVisitDate },
      { ...b, lastVisit: b.lastVisitDate },
    );
  visible.sort(order);
  hidden.sort(order);
  const data = visible.slice(0, MAX_ROWS);
  const hiddenOut = hidden.slice(0, MAX_HIDDEN);

  const entryIds = [...data, ...hiddenOut].map((r) => r._entryId).filter((x): x is string => !!x);
  const prefill = await prefillServices(businessId, entryIds);
  const finish = ({ _entryId, ...row }: Built): DueCustomerDTO => {
    const p = _entryId ? prefill.get(_entryId) : undefined;
    // A visit with no queue entry behind it (none today, but the column is nullable) has nothing to
    // pre-fill from; a service name on it then means the owner must pick.
    if (p) return { ...row, serviceIds: p.ids, servicesResolved: p.resolved };
    return { ...row, serviceIds: [], servicesResolved: !row.lastServiceName };
  };

  return {
    today,
    callBackRange: { min: addDays(today, 1), max: addDays(today, CALL_BACK_MAX_DAYS) },
    counts: {
      overdue: visible.filter((r) => r.status === 'overdue').length,
      dueSoon: visible.filter((r) => r.status === 'due_soon').length,
      lapsed: visible.filter((r) => r.status === 'lapsed').length,
      hidden: hidden.length,
    },
    data: data.map(finish),
    hidden: hiddenOut.map(finish),
  };
}

/**
 * The customer a follow-up is about, with their latest visit. A staff login may only touch
 * customers whose last visit was in its chair — anything else is a 404, as for another chair's
 * booking, so the endpoint can't be walked to learn who else the store serves.
 */
async function loadForFollowup(businessId: string, customerId: string, seat: string | null) {
  const row = await one<{ id: string; timezone: string; last_day: string | null; last_staff: string | null }>(
    `select c.id, b.timezone,
            lv.last_day, lv.staff_id as last_staff
       from customer c
       join business b on b.id = c.business_id
       left join lateral (
              select (v.completed_at at time zone b.timezone)::date::text as last_day, v.staff_id
                from visit v
               where v.business_id = c.business_id and v.customer_id = c.id
               order by v.completed_at desc, v.id desc
               limit 1) lv on true
      where c.id = $1 and c.business_id = $2`,
    [customerId, businessId],
  );
  if (!row) throw Errors.notFound('Customer not found');
  if (seat !== null && row.last_staff !== seat) throw Errors.notFound('Customer not found');
  return row;
}

/** Log what a call achieved. Upserts the customer's one follow-up row. */
export async function setFollowup(
  businessId: string,
  customerId: string,
  input: FollowupInput,
  userId: string | null,
  seat: string | null,
  now: Date = new Date(),
): Promise<FollowupDTO> {
  const c = await loadForFollowup(businessId, customerId, seat);
  if (!c.last_day) throw Errors.invalidState('This customer has no visits yet');
  const today = storeToday(now, c.timezone);

  let snoozeUntil: string | null = null;
  if (input.outcome === 'no_answer') {
    snoozeUntil = addDays(today, 1);
  } else if (input.outcome === 'call_later') {
    const min = addDays(today, 1);
    const max = addDays(today, CALL_BACK_MAX_DAYS);
    if (input.callBackOn < min || input.callBackOn > max) {
      throw Errors.validation('Pick a day from tomorrow up to 60 days ahead', [
        { field: 'callBackOn', message: `Must be between ${min} and ${max}` },
      ]);
    }
    snoozeUntil = input.callBackOn;
  }

  const row = await one(
    `insert into customer_followup
       (customer_id, business_id, outcome, snooze_until, about_last_visit, updated_by_user_id, updated_at)
     values ($1, $2, $3, $4::date, $5::date, $6, now())
     on conflict (customer_id) do update
       set outcome = excluded.outcome,
           snooze_until = excluded.snooze_until,
           about_last_visit = excluded.about_last_visit,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
     returning outcome, snooze_until::text as snooze_until, about_last_visit::text as about_last_visit, updated_at`,
    [customerId, businessId, input.outcome, snoozeUntil, c.last_day, userId],
  );
  emitToOwners(businessId, 'customer:followup', { customerId });
  return followupDTO(row)!;
}

/** Undo: the customer is back on the list (if still due). Idempotent. */
export async function clearFollowup(businessId: string, customerId: string, seat: string | null): Promise<void> {
  await loadForFollowup(businessId, customerId, seat);
  await exec('delete from customer_followup where customer_id = $1 and business_id = $2', [customerId, businessId]);
  emitToOwners(businessId, 'customer:followup', { customerId });
}
