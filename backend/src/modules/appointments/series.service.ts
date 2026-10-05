import { randomBytes } from 'node:crypto';
import { BOOKING_WINDOW_DAYS } from '../../config/constants';
import { logger } from '../../config/logger';
import { many, one, transaction } from '../../db/pool';
import { AppError, Errors } from '../../domain/errors';
import * as rec from '../../lib/recurrence';
import { emitToOwners } from '../../realtime/emitters';
import { sendBookingConfirmation } from '../notifications/sms-dispatch';
import { apptDTO } from './appointment.dto';
import {
  assertSeat,
  customerWindowDays,
  durationOf,
  isFree,
  moveAppointment,
  ownerWindowDays,
  resolveStaffChoice,
  slotsFor,
  slotTaken,
} from './reschedule.service';
import {
  insertAppointmentServices,
  slotInputFor,
  visitMinutes,
  type Query,
  type VisitService,
} from './booking.repo';

/**
 * Recurring appointments. See docs/recurring-appointments.md.
 *
 * A series stores the RULE; each real visit is an ordinary `appointment` row with `series_id`.
 * `generateSeriesVisits` is the one place visits are created — at booking (for the dates already
 * inside the horizon) and by `recurringSweep` (every hour, for the dates the horizon has reached
 * since). Both run under the store's `appt:` advisory lock, the same lock public booking takes,
 * so a series date and a customer's booking can never both claim one time.
 *
 * SMS (decided with the client): only the three registered texts. A visit the job creates gets
 * the ordinary booking confirmation; nothing is texted for a skip, cancel, pause or a date the
 * job could not book — those reach the owner's Needs attention list instead.
 */

const pool: Query = (sql, params) => many(sql, params ?? []);

/** Every column of a series, with `date`/`time` read as text — see `pgDate` for why. */
const SERIES_COLS = `s.id, s.business_id, s.customer_id, s.customer_name, s.customer_phone, s.staff_id,
  s.staff_locked, s.visitor_type, left(s.start_time::text, 5) as start_time,
  s.anchor_date::text as anchor_date, s.anchor_index, s.interval_days, s.end_type, s.end_count,
  s.end_date::text as end_date, s.status, s.pause_reason, s.version,
  s.generated_through::text as generated_through, s.sms_opt_in, s.review_sms_opt_in, s.source,
  s.manage_token, s.created_at, s.updated_at, s.paused_at, s.cancelled_at, s.ended_at`;

/** The services, combined as the owner screens show them; renames are picked up live. */
const SERIES_SERVICE_NAME = `(select string_agg(coalesce(sv.name, ss.name), ' + ' order by ss.position)
     from appointment_series_service ss left join service sv on sv.id = ss.service_id
    where ss.series_id = s.id)`;

export interface SeriesRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  staff_id: string | null;
  staff_locked: boolean;
  visitor_type: string | null;
  start_time: string;
  anchor_date: string;
  /** Rule dates before `anchor_date` (0037) — moves on with every "change all future visits". */
  anchor_index: number;
  interval_days: number;
  end_type: 'never' | 'count' | 'until';
  end_count: number | null;
  end_date: string | null;
  status: 'active' | 'paused' | 'ended' | 'cancelled';
  pause_reason: string | null;
  version: number;
  generated_through: string;
  sms_opt_in: boolean;
  review_sms_opt_in: boolean;
  source: string;
  manage_token: string;
  created_at: string;
  updated_at: string;
}

export type IssueReason = 'outside_hours' | 'stylist_unavailable' | 'slot_taken' | 'service_missing';

/** Why a date was not booked. `closed` / `past` are silent; the rest reach the customer or owner. */
export type SkipReason = 'closed' | 'past' | 'taken' | 'outside_hours' | 'stylist_unavailable' | 'service_missing';

export interface GenerationResult {
  created: any[];
  /** Booking mode: told to the customer on the confirmation screen. Job mode: closed/past only. */
  skipped: { date: string; reason: SkipReason }[];
  /** Job mode: written to the owner's Needs attention list. */
  flagged: { date: string; reason: IssueReason }[];
  paused: boolean;
  ended: boolean;
}

export function ruleOf(
  s: Pick<SeriesRow, 'anchor_date' | 'interval_days' | 'end_type' | 'end_count' | 'end_date'> & { anchor_index?: number | null },
): rec.SeriesRule {
  return rec.ruleFromColumns(s);
}

/** 16 url-safe characters (96 random bits) — the customer's manage-link credential. */
function newManageToken(): string {
  return randomBytes(12).toString('base64url');
}

async function seriesById(q: Query, id: string, businessId?: string, forUpdate = false): Promise<SeriesRow | null> {
  const rows = await q(
    `select ${SERIES_COLS} from appointment_series s
      where s.id = $1 ${businessId ? 'and s.business_id = $2' : ''}
      ${forUpdate ? 'for update' : ''}`,
    businessId ? [id, businessId] : [id],
  );
  return (rows[0] as SeriesRow) ?? null;
}

/**
 * The series' services as a visit would use them today. A service deleted from the menu
 * (`service_id` set null) is reported in `missing`: the job will not quietly book a shorter,
 * cheaper visit than the one the customer agreed to.
 */
async function loadSeriesServices(q: Query, seriesId: string, businessId: string) {
  const rows = await q(
    `select ss.name as series_name, sv.id, sv.name, sv.duration_minutes, sv.price_paise
       from appointment_series_service ss
       left join service sv on sv.id = ss.service_id and sv.business_id = $2
      where ss.series_id = $1
      order by ss.position`,
    [seriesId, businessId],
  );
  const services: VisitService[] = rows
    .filter((r) => r.id)
    .map((r) => ({ id: r.id, name: r.name, duration_minutes: r.duration_minutes, price_paise: r.price_paise }));
  const missing: string[] = rows.filter((r) => !r.id).map((r) => r.series_name);
  return { services, missing };
}

/** One open (active or paused) series per phone per store — the unique index backs this up. */
export async function assertNoOpenSeries(q: Query, businessId: string, phone: string): Promise<void> {
  const [row] = await q(
    `select 1 from appointment_series
      where business_id = $1 and customer_phone = $2 and status in ('active', 'paused')
      limit 1`,
    [businessId, phone],
  );
  if (row) {
    throw Errors.conflict(
      'SERIES_EXISTS',
      'You already have a repeating booking here. Tap My Appointments to manage it, or call the store.',
    );
  }
}

/**
 * Write one visit of a series. `opts` cover the Phase-2 cases: a visit placed at a time other than
 * the rule's (`rescheduled` — a "Book another time", or a change's per-date choice), on another
 * stylist, under an older rule version (a Needs-attention date), or a date skipped during a change
 * (written as a skipped row, so that date counts as handled and is never booked again).
 */
async function insertSeriesVisit(
  q: Query,
  s: SeriesRow,
  date: string,
  startAt: Date,
  durationMin: number,
  services: VisitService[],
  opts: { version?: number; staffId?: string | null; rescheduled?: boolean; skipped?: boolean; now?: Date } = {},
): Promise<any | null> {
  const end = new Date(startAt.getTime() + durationMin * 60_000);
  const stamp = (opts.now ?? new Date()).toISOString();
  const [row] = await q(
    `insert into appointment
       (business_id, customer_id, customer_name, customer_phone, service_id, service_name, staff_id,
        scheduled_start_at, scheduled_end_at, status, source, visitor_type, sms_opt_in,
        review_sms_opt_in, series_id, series_version, occurrence_date, rescheduled_at, cancel_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $17, $10, $11, $12, $13, $14, $15, $16::date, $18, $19)
     on conflict (series_id, series_version, occurrence_date) where series_id is not null do nothing
     returning *`,
    [
      s.business_id,
      s.customer_id,
      s.customer_name,
      s.customer_phone,
      services[0]?.id ?? null,
      services.length ? services.map((sv) => sv.name).join(' + ') : null,
      opts.staffId !== undefined ? opts.staffId : s.staff_id,
      startAt.toISOString(),
      end.toISOString(),
      s.source,
      s.visitor_type,
      s.sms_opt_in,
      s.review_sms_opt_in,
      s.id,
      opts.version ?? s.version,
      date,
      opts.skipped ? 'cancelled' : 'confirmed',
      opts.rescheduled ? stamp : null,
      opts.skipped ? 'skipped' : null,
    ],
  );
  // No row: a concurrent run already booked this date (the unique index refused the second).
  if (!row) return null;
  await insertAppointmentServices(q, row.id, services);
  return row;
}

async function flagIssue(q: Query, s: SeriesRow, date: string, startIso: string, reason: IssueReason): Promise<void> {
  await q(
    `insert into appointment_series_issue
       (business_id, series_id, series_version, occurrence_date, scheduled_start_at, reason)
     values ($1, $2, $3, $4::date, $5, $6)
     on conflict (series_id, series_version, occurrence_date) do nothing`,
    [s.business_id, s.id, s.version, date, startIso, reason],
  );
}

/** Rule dates of this series that already have a visit row (any version) that no change replaced. */
async function handledDates(q: Query, seriesId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await q(
    `select distinct occurrence_date::text as d from appointment
      where series_id = $1 and occurrence_date between $2::date and $3::date
        and cancel_reason is distinct from 'superseded'`,
    [seriesId, from, to],
  );
  return new Set(rows.map((r) => r.d));
}

/** 409 naming the dates that still need another time (or a skip) before a change can go ahead. */
function changeConflicts(dates: string[]): AppError {
  return new AppError(
    409,
    'CHANGE_CONFLICTS',
    'The new time is not free on some dates. Pick another time for them, or skip them.',
    dates.map((d) => ({ field: 'resolutions', rule: d, message: 'Pick another time or skip this date' })),
  );
}

/**
 * Book every rule date after `generated_through` up to the horizon (today+20), and move the
 * cursor past them. Must run under the store's `appt:` lock (callers hold it).
 *
 *  - booking mode: the customer is on the page, so a date that cannot be booked is SKIPPED and
 *    reported back to them — no owner flag.
 *  - job mode: such a date goes to the owner's Needs attention list (no SMS is sent). A stylist
 *    who has gone pauses the whole series, because every later date would fail the same way.
 *
 * A closed weekday or a date already in the past is always skipped silently: the customer saw
 * closed days in the preview, and a past date can no longer be booked by anyone.
 *
 *  - change mode ("change all future visits"): every date was checked before anything was written,
 *    so a date that will not book now means the diary moved under us — refuse the whole change.
 *
 * A date that already has a visit row of THIS series — any version, any state except one a change
 * replaced (skipped, cancelled, checked in, or moved by hand) — is already handled and is never
 * booked again. That is what keeps a skip and a customer's own move across a change of the rule.
 */
export async function generateSeriesVisits(
  q: Query,
  b: any,
  s: SeriesRow,
  now: Date,
  mode: 'booking' | 'job' | 'change',
): Promise<GenerationResult> {
  const result: GenerationResult = { created: [], skipped: [], flagged: [], paused: false, ended: false };
  if (s.status !== 'active') return result;

  const tz = b.timezone;
  const rule = ruleOf(s);
  const today = rec.storeToday(now, tz);
  const dates = rec.datesBetween(rule, s.generated_through, rec.horizonDate(today, BOOKING_WINDOW_DAYS));
  let through = s.generated_through;

  if (dates.length) {
    const { services, missing } = await loadSeriesServices(q, s.id, s.business_id);
    const duration = visitMinutes(services);
    const windowDays = rec.seriesWindowDays(BOOKING_WINDOW_DAYS);
    const handled = await handledDates(q, s.id, dates[0], dates[dates.length - 1]);

    for (const date of dates) {
      if (handled.has(date)) {
        through = date;
        continue;
      }
      const startAt = rec.occurrenceStart(date, s.start_time, tz);
      const startIso = startAt.toISOString();

      let verdict: rec.DateVerdict | 'service_missing';
      if (startAt.getTime() <= now.getTime()) verdict = 'past';
      else if (missing.length) verdict = 'service_missing';
      else {
        const slot = await slotInputFor(q, b, date, duration, s.staff_id, { now, windowDays });
        verdict = rec.judgeDate(slot, startIso, { staffLocked: s.staff_locked });
      }

      if (verdict === 'ok') {
        const row = await insertSeriesVisit(q, s, date, startAt, duration, services);
        if (row) result.created.push(row);
      } else if (verdict === 'past' || verdict === 'closed' || mode === 'booking') {
        result.skipped.push({ date, reason: verdict });
      } else if (mode === 'change') {
        throw changeConflicts([date]);
      } else {
        const reason: IssueReason = verdict === 'taken' ? 'slot_taken' : verdict;
        await flagIssue(q, s, date, startIso, reason);
        result.flagged.push({ date, reason });
        if (reason === 'stylist_unavailable') {
          await q(
            `update appointment_series
                set status = 'paused', pause_reason = 'stylist_unavailable', paused_at = now(),
                    generated_through = $2::date, updated_at = now()
              where id = $1`,
            [s.id, date],
          );
          result.paused = true;
          return result;
        }
      }
      through = date;
    }
  }

  // Ended = no rule date left after the cursor AND that last date is behind us. Not merely "the
  // last visit is booked": a short series ("weekly × 3") books every visit at once, and marking it
  // ended then hid it from Regulars, made it un-pausable, and let the same phone open a second
  // series while its visits were still ahead (smoke-recurring.mjs, 2026-10-03). The hourly job
  // re-checks, so it flips to ended the day after the last visit.
  result.ended = !rec.hasDatesAfter(rule, through) && through < today;
  if (through !== s.generated_through || result.ended) {
    await q(
      `update appointment_series
          set generated_through = $2::date,
              status = case when $3::boolean then 'ended' else status end,
              ended_at = case when $3::boolean then now() else ended_at end,
              updated_at = now()
        where id = $1`,
      [s.id, through, result.ended],
    );
  }
  return result;
}

export interface StartSeriesInput {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  visitorType: string | null;
  /** Store-local 'HH:mm' of the first visit. */
  startTime: string;
  rule: rec.SeriesRule;
  smsOptIn: boolean;
  reviewSmsOptIn: boolean;
  source: 'online' | 'owner';
  services: VisitService[];
}

/**
 * Turn a just-booked first visit into a series and book the dates already inside the horizon.
 * Runs inside the booking's transaction, under its lock, so either the whole series is created or
 * none of it is.
 */
export async function startSeriesForBooking(
  q: Query,
  b: any,
  firstAppointmentId: string,
  input: StartSeriesInput,
  now: Date,
): Promise<{ series: SeriesRow; gen: GenerationResult }> {
  const { rule } = input;
  const [created] = await q(
    `insert into appointment_series
       (business_id, customer_id, customer_name, customer_phone, staff_id, staff_locked, visitor_type,
        start_time, anchor_date, interval_days, end_type, end_count, end_date, generated_through,
        sms_opt_in, review_sms_opt_in, source, manage_token)
     values ($1, $2, $3, $4, $5, $6, $7, $8::time, $9::date, $10, $11, $12, $13::date, $9::date,
             $14, $15, $16, $17)
     returning id`,
    [
      b.id,
      input.customerId,
      input.customerName,
      input.customerPhone,
      input.staffId,
      !!input.staffId,
      input.visitorType,
      input.startTime,
      rule.anchorDate,
      rule.everyDays,
      rule.end.type,
      rule.end.type === 'count' ? rule.end.count : null,
      rule.end.type === 'until' ? rule.end.date : null,
      input.smsOptIn,
      input.reviewSmsOptIn,
      input.source,
      newManageToken(),
    ],
  );
  const id = created.id as string;

  if (input.services.length) {
    const values = input.services.map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`).join(', ');
    await q(
      `insert into appointment_series_service (series_id, service_id, name, position) values ${values}`,
      [id, ...input.services.flatMap((sv, i) => [sv.id, sv.name, i])],
    );
  }

  // The first visit is the series' rule date 0, so the job knows it is already handled.
  await q(
    `update appointment set series_id = $2, series_version = 1, occurrence_date = $3::date
      where id = $1 and business_id = $4`,
    [firstAppointmentId, id, rule.anchorDate, b.id],
  );

  const series = (await seriesById(q, id))!;
  const gen = await generateSeriesVisits(q, b, series, now, 'booking');
  return { series: (await seriesById(q, id))!, gen };
}

/**
 * After the transaction commits: tell open owner screens, and — for visits the JOB created —
 * send the ordinary booking confirmation. At booking time only the first visit is texted (by
 * bookSlot); texting every visit the customer just saw on screen would be noise.
 */
export async function afterGeneration(
  businessId: string,
  seriesId: string,
  gen: GenerationResult,
  opts: { confirm: boolean },
): Promise<void> {
  for (const row of gen.created) {
    emitToOwners(businessId, 'appointment:created', { appointment: apptDTO(row) });
    if (opts.confirm && row.sms_opt_in) {
      await sendBookingConfirmation(businessId, row.id).catch((err) =>
        logger.warn({ err, appointmentId: row.id }, 'series confirmation SMS failed'),
      );
    }
  }
  if (gen.created.length || gen.flagged.length || gen.paused || gen.ended) {
    emitToOwners(businessId, 'series:updated', { seriesId });
  }
}

/**
 * The hourly job. Books every active series up to today+20, one series per transaction (so one
 * bad series cannot hold up the rest), each under the store's `appt:` lock.
 *
 * Idempotent: the cursor and the unique (series, version, date) index mean a second run — or two
 * overlapping ones — books nothing twice. `now` is a parameter so tests can drive it through time.
 */
export async function recurringSweep(
  now: Date = new Date(),
  opts: { businessId?: string } = {},
): Promise<{ series: number; created: number; flagged: number }> {
  const targets = await many<{ id: string; business_id: string }>(
    `select s.id, s.business_id
       from appointment_series s
       join business b on b.id = s.business_id
      where s.status = 'active' and b.is_active = true
        ${opts.businessId ? 'and s.business_id = $1' : ''}
      order by s.business_id, s.created_at`,
    opts.businessId ? [opts.businessId] : [],
  );

  const totals = { series: targets.length, created: 0, flagged: 0 };
  for (const t of targets) {
    try {
      const gen = await transaction(async (client) => {
        const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${t.business_id}`]);
        const [b] = await q('select * from business where id = $1', [t.business_id]);
        const s = await seriesById(q, t.id, t.business_id, true);
        if (!b || !s) return null;
        return generateSeriesVisits(q, b, s, now, 'job');
      });
      if (!gen) continue;
      totals.created += gen.created.length;
      totals.flagged += gen.flagged.length;
      await afterGeneration(t.business_id, t.id, gen, { confirm: true });
    } catch (err) {
      logger.error({ err, seriesId: t.id, businessId: t.business_id }, 'recurringSweep failed for a series');
    }
  }
  if (totals.created || totals.flagged) logger.info(totals, 'Recurring sweep booked visits');
  return totals;
}

// ---------------------------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------------------------

export function seriesDTO(s: any) {
  const rule = ruleOf(s);
  return {
    id: s.id,
    customerId: s.customer_id,
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    staffId: s.staff_id,
    staffName: s.staff_name ?? null,
    // True when a stylist was chosen. With `staffId` null it means that stylist has gone.
    staffLocked: !!s.staff_locked,
    serviceName: s.service_name ?? null,
    visitorType: s.visitor_type ?? null,
    startTime: s.start_time,
    anchorDate: s.anchor_date,
    everyDays: s.interval_days,
    end: rule.end,
    lastDate: rec.lastDate(rule),
    totalVisits: rec.totalVisits(rule),
    status: s.status,
    pauseReason: s.pause_reason ?? null,
    source: s.source,
    nextVisitAt: s.next_visit_at ?? null,
    openIssues: Number(s.open_issues ?? 0),
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

function issueDTO(i: any) {
  return {
    id: i.id,
    seriesId: i.series_id,
    customerName: i.customer_name,
    customerPhone: i.customer_phone,
    staffId: i.staff_id ?? null,
    staffName: i.staff_name ?? null,
    serviceName: i.service_name ?? null,
    occurrenceDate: i.occurrence_date,
    scheduledStartAt: i.scheduled_start_at,
    reason: i.reason,
    createdAt: i.created_at,
  };
}

const OWNER_SERIES_SELECT = `select ${SERIES_COLS}, st.name as staff_name, ${SERIES_SERVICE_NAME} as service_name,
       (select min(a.scheduled_start_at) from appointment a
         where a.series_id = s.id and a.status in ('pending', 'confirmed') and a.scheduled_start_at > now()
       ) as next_visit_at,
       (select count(*)::int from appointment_series_issue i
         where i.series_id = s.id and i.resolved_at is null
       ) as open_issues,
       bz.timezone as store_timezone
  from appointment_series s
  join business bz on bz.id = s.business_id
  left join staff st on st.id = s.staff_id`;

/**
 * The owner's Regulars list. `open` (the default) is active + paused — the series that still
 * shape the calendar. `staffId` narrows a staff login to its own chair (scopeStaffId).
 */
export async function listSeries(
  businessId: string,
  opts: { status?: 'open' | 'active' | 'paused' | 'ended' | 'cancelled' | 'all'; staffId?: string | null } = {},
) {
  const where = ['s.business_id = $1'];
  const params: unknown[] = [businessId];
  const status = opts.status ?? 'open';
  if (status === 'open') where.push(`s.status in ('active', 'paused')`);
  else if (status !== 'all') {
    params.push(status);
    where.push(`s.status = $${params.length}`);
  }
  if (opts.staffId) {
    params.push(opts.staffId);
    where.push(`s.staff_id = $${params.length}`);
  }
  const rows = await many(
    `${OWNER_SERIES_SELECT} where ${where.join(' and ')}
      order by (s.status = 'active') desc, lower(s.customer_name), s.created_at`,
    params,
  );
  return { data: rows.map(seriesDTO) };
}

export async function getSeries(businessId: string, id: string, now: Date = new Date()) {
  const s = await one(`${OWNER_SERIES_SELECT} where s.id = $1 and s.business_id = $2`, [id, businessId]);
  if (!s) throw Errors.notFound('Series not found');
  // Most recent 30, oldest first — enough for "last few visits + what's coming". Visits a change
  // replaced are left out: they were never cancelled by anyone, and would fill the list with
  // phantom cancellations.
  const visits = (
    await many(
      `select * from appointment where series_id = $1 and business_id = $2
          and cancel_reason is distinct from 'superseded'
        order by scheduled_start_at desc limit 30`,
      [id, businessId],
    )
  ).reverse();
  const issues = await many(
    `select i.id, i.series_id, i.occurrence_date::text as occurrence_date, i.scheduled_start_at, i.reason,
            i.created_at, s.customer_name, s.customer_phone, s.staff_id, st.name as staff_name,
            ${SERIES_SERVICE_NAME} as service_name
       from appointment_series_issue i
       join appointment_series s on s.id = i.series_id
       left join staff st on st.id = s.staff_id
      where i.series_id = $1 and i.business_id = $2 and i.resolved_at is null
      order by i.scheduled_start_at`,
    [id, businessId],
  );
  return {
    series: seriesDTO(s),
    visits: visits.map(apptDTO),
    issues: issues.map(issueDTO),
    // Rule dates not booked yet: the job books each one about three weeks ahead.
    laterDates: s.status === 'active' ? rec.nextDates(ruleOf(s), s.generated_through, 3) : [],
    // The dates "Change all future visits" may start from (see changeFromDates).
    changeFromDates: changeFromDates(s, now, s.store_timezone),
    today: rec.storeToday(now, s.store_timezone),
    now: now.toISOString(),
  };
}

/**
 * The rule dates a "change all future visits" may start from: from today up to the first date the
 * job has not booked yet. Starting further out would leave the dates in between never booked by
 * either rule. Empty unless the series is active.
 */
function changeFromDates(s: any, now: Date, tz: string): string[] {
  if (s.status !== 'active') return [];
  const rule = ruleOf(s);
  const today = rec.storeToday(now, tz);
  const upTo = rec.firstDateAfter(rule, s.generated_through) ?? s.generated_through;
  return rec.datesBetween(rule, rec.addDays(today, -1), upTo);
}

/** Explain why a conditional update matched nothing: unknown (404) or wrong state (422). */
async function stateError(businessId: string, id: string, message: string): Promise<never> {
  const exists = await one('select 1 from appointment_series where id = $1 and business_id = $2', [id, businessId]);
  if (!exists) throw Errors.notFound('Series not found');
  throw Errors.invalidState(message);
}

export async function pauseSeries(businessId: string, id: string) {
  const row = await one(
    `update appointment_series
        set status = 'paused', pause_reason = 'owner', paused_at = now(), updated_at = now()
      where id = $1 and business_id = $2 and status = 'active'
      returning id`,
    [id, businessId],
  );
  if (!row) await stateError(businessId, id, 'Only an active series can be paused');
  emitToOwners(businessId, 'series:updated', { seriesId: id });
  return getSeries(businessId, id);
}

/**
 * Resume a paused series, optionally on another stylist (`'any'` for no preference). A series
 * paused because its stylist left cannot resume onto that same stylist — it would flag and pause
 * again on the very next date — so the owner must pick someone.
 *
 * Visits already inside the horizon are booked straight away (job mode: a clash is flagged, and
 * the customer gets the ordinary confirmation for each new visit).
 */
export async function resumeSeries(
  businessId: string,
  id: string,
  staffChoice: string | undefined,
  now: Date = new Date(),
) {
  const gen = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const s = await seriesById(q, id, businessId, true);
    if (!s) throw Errors.notFound('Series not found');
    if (s.status !== 'paused') throw Errors.invalidState('Only a paused series can be resumed');

    let staffId = s.staff_id;
    let staffLocked = s.staff_locked;
    if (staffChoice !== undefined) {
      if (staffChoice === 'any') {
        staffId = null;
        staffLocked = false;
      } else {
        const [st] = await q('select id from staff where id = $1 and business_id = $2 and is_active = true', [
          staffChoice,
          businessId,
        ]);
        if (!st) throw Errors.validation('Pick a team member from this store', [{ field: 'staffId', message: 'Unknown team member' }]);
        staffId = staffChoice;
        staffLocked = true;
      }
    } else if (staffLocked) {
      const [st] = staffId
        ? await q('select id from staff where id = $1 and business_id = $2 and is_active = true', [staffId, businessId])
        : [];
      if (!st) {
        throw Errors.validation('This stylist is no longer available. Pick someone else to resume.', [
          { field: 'staffId', message: 'Pick a team member' },
        ]);
      }
    }

    await q(
      `update appointment_series
          set status = 'active', pause_reason = null, paused_at = null, staff_id = $2,
              staff_locked = $3, updated_at = now()
        where id = $1`,
      [id, staffId, staffLocked],
    );
    const [b] = await q('select * from business where id = $1', [businessId]);
    const fresh = (await seriesById(q, id, businessId))!;
    return generateSeriesVisits(q, b, fresh, now, 'job');
  });
  await afterGeneration(businessId, id, gen, { confirm: true });
  emitToOwners(businessId, 'series:updated', { seriesId: id });
  return getSeries(businessId, id);
}

/**
 * Cancel a series and every visit still ahead of it. Shared by the owner and the customer's
 * manage link. Open Needs attention items for it are closed — there is nothing left to fix.
 */
async function cancelSeriesRow(businessId: string, id: string): Promise<any[] | null> {
  return transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const [row] = await q(
      `update appointment_series
          set status = 'cancelled', cancelled_at = now(), pause_reason = null, updated_at = now()
        where id = $1 and business_id = $2 and status in ('active', 'paused', 'ended')
        returning id`,
      [id, businessId],
    );
    if (!row) return null;
    const visits = await q(
      `update appointment
          set status = 'cancelled', cancel_reason = 'cancelled', updated_at = now()
        where series_id = $1 and business_id = $2
          and status in ('pending', 'confirmed') and scheduled_start_at > now()
        returning *`,
      [id, businessId],
    );
    await q(
      `update appointment_series_issue set resolved_at = now(), resolution = 'handled'
        where series_id = $1 and resolved_at is null`,
      [id],
    );
    return visits;
  });
}

function emitCancelled(businessId: string, seriesId: string, visits: any[]) {
  for (const v of visits) emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(v) });
  emitToOwners(businessId, 'series:updated', { seriesId });
}

export async function cancelSeries(businessId: string, id: string) {
  const visits = await cancelSeriesRow(businessId, id);
  if (!visits) return stateError(businessId, id, 'This series is already cancelled');
  emitCancelled(businessId, id, visits);
  return getSeries(businessId, id);
}

/**
 * Skip one visit of a series: it is cancelled and marked `skipped`, and the rest of the series is
 * untouched. Its row stays, so the job can never book that date again.
 */
async function skipVisitRow(businessId: string, appointmentId: string, seriesId?: string) {
  const row = await one(
    `update appointment set status = 'cancelled', cancel_reason = 'skipped', updated_at = now()
      where id = $1 and business_id = $2 and series_id is not null
        ${seriesId ? 'and series_id = $3' : ''}
        and status in ('pending', 'confirmed') and scheduled_start_at > now()
      returning *`,
    seriesId ? [appointmentId, businessId, seriesId] : [appointmentId, businessId],
  );
  if (row) return row;
  const a = await one('select series_id, status from appointment where id = $1 and business_id = $2', [appointmentId, businessId]);
  if (!a || (seriesId && a.series_id !== seriesId)) throw Errors.notFound('Appointment not found');
  if (!a.series_id) throw Errors.validation('Only a repeating visit can be skipped');
  throw Errors.invalidState(a.status === 'cancelled' ? 'This visit is already skipped' : "This visit can't be skipped any more");
}

export async function skipVisit(businessId: string, appointmentId: string) {
  const row = await skipVisitRow(businessId, appointmentId);
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(row) });
  return apptDTO(row);
}

/** Needs attention: series dates the job could not book. Past ones drop off after two days. */
export async function listIssues(businessId: string, staffId?: string | null) {
  const params: unknown[] = [businessId];
  let scope = '';
  if (staffId) {
    params.push(staffId);
    scope = `and s.staff_id = $${params.length}`;
  }
  const rows = await many(
    `select i.id, i.series_id, i.occurrence_date::text as occurrence_date, i.scheduled_start_at, i.reason,
            i.created_at, s.customer_name, s.customer_phone, s.staff_id, st.name as staff_name,
            ${SERIES_SERVICE_NAME} as service_name
       from appointment_series_issue i
       join appointment_series s on s.id = i.series_id
       left join staff st on st.id = s.staff_id
      where i.business_id = $1 and i.resolved_at is null
        and i.scheduled_start_at > now() - interval '2 days'
        ${scope}
      order by i.scheduled_start_at`,
    params,
  );
  return { data: rows.map(issueDTO) };
}

export async function resolveIssue(businessId: string, issueId: string, userId: string, staffId?: string | null) {
  const params: unknown[] = [issueId, businessId, userId];
  let scope = '';
  if (staffId) {
    params.push(staffId);
    scope = `and exists (select 1 from appointment_series s where s.id = i.series_id and s.staff_id = $${params.length})`;
  }
  const row = await one(
    `update appointment_series_issue i
        set resolved_at = now(), resolution = 'handled', resolved_by_user_id = $3
      where i.id = $1 and i.business_id = $2 and i.resolved_at is null ${scope}
      returning i.series_id`,
    params,
  );
  if (!row) throw Errors.notFound('Not found');
  emitToOwners(businessId, 'series:updated', { seriesId: row.series_id });
  return { ok: true };
}

/**
 * After an owner marks a series visit as a no-show: two missed visits in a row pause the series,
 * so an abandoned "Never" series stops holding a prime slot. Only owner-marked no-shows count —
 * counting "never checked in" would pause real regulars whose owner simply didn't check them in.
 */
export async function noteNoShow(businessId: string, appointment: { series_id?: string | null }): Promise<void> {
  if (!appointment.series_id) return;
  const last = await many<{ status: string }>(
    `select status from appointment
      where series_id = $1 and business_id = $2 and scheduled_start_at <= now() and status <> 'cancelled'
      order by scheduled_start_at desc
      limit 2`,
    [appointment.series_id, businessId],
  );
  if (last.length < 2 || !last.every((a) => a.status === 'no_show')) return;
  const paused = await one(
    `update appointment_series
        set status = 'paused', pause_reason = 'no_shows', paused_at = now(), updated_at = now()
      where id = $1 and business_id = $2 and status = 'active'
      returning id`,
    [appointment.series_id, businessId],
  );
  if (paused) emitToOwners(businessId, 'series:updated', { seriesId: appointment.series_id });
}

// ---------------------------------------------------------------------------------------------
// Customer side — keyed by the manage token (the link on the booking screen and in the SMS)
// ---------------------------------------------------------------------------------------------

/** A missing and a wrong token are the same 404, so a guessed token cannot be confirmed. */
async function seriesForToken(token: string | undefined) {
  if (!token) throw Errors.notFound('Booking not found');
  const s = await one(
    `select ${SERIES_COLS}, st.name as staff_name, ${SERIES_SERVICE_NAME} as service_name,
            b.name as business_name, b.slug as business_slug, b.phone_full as business_phone, b.timezone
       from appointment_series s
       left join staff st on st.id = s.staff_id
       join business b on b.id = s.business_id
      where s.manage_token = $1`,
    [token],
  );
  if (!s) throw Errors.notFound('Booking not found');
  return s;
}

function publicSeries(s: any, visits: any[], staff: { id: string; name: string }[], now: Date = new Date()) {
  const rule = ruleOf(s);
  const today = rec.storeToday(now, s.timezone);
  const future = (v: any) => new Date(v.scheduled_start_at).getTime() > now.getTime();
  const open = (v: any) => v.status === 'pending' || v.status === 'confirmed';
  return {
    seriesId: s.id,
    status: s.status,
    pauseReason: s.pause_reason ?? null,
    everyDays: s.interval_days,
    startTime: s.start_time,
    end: rule.end,
    lastDate: rec.lastDate(rule),
    totalVisits: rec.totalVisits(rule),
    staffId: s.staff_id ?? null,
    // A stylist WAS chosen; with staffId null it means they have left (the customer must pick).
    staffLocked: !!s.staff_locked,
    staffName: s.staff_name ?? null,
    serviceName: s.service_name ?? null,
    store: { name: s.business_name, slug: s.business_slug, phoneFull: s.business_phone ?? null, timezone: s.timezone },
    // Who the customer may move to — this store's active stylists.
    staff,
    // The range a customer may move a visit into (store-local days): today … today+20.
    today,
    lastDay: rec.addDays(today, customerWindowDays() - 1),
    changeFromDates: changeFromDates(s, now, s.timezone),
    visits: visits.map((v) => ({
      appointmentId: v.id,
      scheduledStartAt: v.scheduled_start_at,
      status: v.status,
      cancelReason: v.cancel_reason ?? null,
      staffId: v.staff_id ?? null,
      canSkip: open(v) && future(v),
      canReschedule: open(v) && future(v),
      // Moved by hand — it keeps this time through a later "change all future visits".
      moved: !!v.rescheduled_at,
    })),
    laterDates: s.status === 'active' ? rec.nextDates(rule, s.generated_through, 3) : [],
  };
}

async function upcomingVisits(seriesId: string, businessId: string) {
  return many(
    `select id, scheduled_start_at, status, cancel_reason, staff_id, rescheduled_at from appointment
      where series_id = $1 and business_id = $2 and scheduled_start_at > now()
        and status in ('pending', 'confirmed', 'cancelled')
        and cancel_reason is distinct from 'superseded'
      order by scheduled_start_at
      limit 10`,
    [seriesId, businessId],
  );
}

async function activeStaff(businessId: string) {
  return many<{ id: string; name: string }>(
    'select id, name from staff where business_id = $1 and is_active = true order by position, name',
    [businessId],
  );
}

export async function getSeriesByToken(token: string | undefined) {
  const s = await seriesForToken(token);
  const [visits, staff] = await Promise.all([upcomingVisits(s.id, s.business_id), activeStaff(s.business_id)]);
  return publicSeries(s, visits, staff);
}

export async function skipVisitByToken(token: string | undefined, appointmentId: string) {
  const s = await seriesForToken(token);
  const row = await skipVisitRow(s.business_id, appointmentId, s.id);
  emitToOwners(s.business_id, 'appointment:updated', { appointment: apptDTO(row) });
  return getSeriesByToken(token);
}

export async function cancelSeriesByToken(token: string | undefined) {
  const s = await seriesForToken(token);
  const visits = await cancelSeriesRow(s.business_id, s.id);
  if (!visits) throw Errors.invalidState('This repeating booking is already cancelled');
  emitCancelled(s.business_id, s.id, visits);
  return getSeriesByToken(token);
}

// ---------------------------------------------------------------------------------------------
// Preview — what the customer sees before confirming
// ---------------------------------------------------------------------------------------------

export type PreviewStatus = 'ok' | 'later' | 'closed' | 'taken' | 'outside_hours';

/**
 * The first few visits a rule would make, each judged the way the booking will judge it. Dates
 * inside the horizon get the full check (they are booked the moment the customer confirms); later
 * ones only say whether the store is open that weekday — they are booked about three weeks ahead.
 */
export async function previewSeriesDates(
  b: any,
  args: { rule: rec.SeriesRule; startTime: string; staffId: string | null; durationMin: number; now?: Date },
) {
  const now = args.now ?? new Date();
  const tz = b.timezone;
  const horizon = rec.horizonDate(rec.storeToday(now, tz), BOOKING_WINDOW_DAYS);
  const windowDays = rec.seriesWindowDays(BOOKING_WINDOW_DAYS);
  const dates = [args.rule.anchorDate, ...rec.nextDates(args.rule, args.rule.anchorDate, rec.PREVIEW_DATES - 1)];
  const hours = await many<{ day_of_week: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }>(
    'select day_of_week, is_closed, opens_at, closes_at from business_hour where business_id = $1',
    [b.id],
  );

  const out: { date: string; startAt: string; status: PreviewStatus }[] = [];
  for (const date of dates) {
    const startAt = rec.occurrenceStart(date, args.startTime, tz).toISOString();
    let status: PreviewStatus;
    if (date <= horizon) {
      const slot = await slotInputFor(pool, b, date, args.durationMin, args.staffId, { now, windowDays });
      const v = rec.judgeDate(slot, startAt, { staffLocked: !!args.staffId });
      status = v === 'ok' ? 'ok' : v === 'closed' ? 'closed' : v === 'taken' || v === 'stylist_unavailable' ? 'taken' : 'outside_hours';
    } else {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const h = hours.find((x) => x.day_of_week === weekday);
      status = !h || h.is_closed || !h.opens_at || !h.closes_at ? 'closed' : 'later';
    }
    out.push({ date, startAt, status });
  }
  return {
    dates: out,
    everyDays: args.rule.everyDays,
    totalVisits: rec.totalVisits(args.rule),
    lastDate: rec.lastDate(args.rule),
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 2 — move one visit, change all future visits, book a Needs-attention date
// (docs/recurring-appointments.md). No SMS for any of these: the client allows only the three
// registered texts. Every write runs under the store's `appt:` lock, then the series row
// `for update`, then the appointment — the same order everywhere, so none of them can deadlock.
// ---------------------------------------------------------------------------------------------

/** "Pick another time or skip it" — what the person chose for a date the new time does not fit. */
export type ChangeResolution = { date: string; slotStart: string } | { date: string; skip: true };

export interface ChangeInput {
  /** The rule date the change starts from (one of `changeFromDates`). */
  fromDate: string;
  /** A slot on `fromDate` — its store-local time becomes the series' new time. Absent: keep the time. */
  slotStart?: string;
  /** A stylist id, or 'any'. Absent: keep the stylist. */
  staffId?: string;
  resolutions?: ChangeResolution[];
}

export type ChangeDateStatus = 'ok' | 'taken' | 'kept' | 'skipped' | 'closed' | 'later';

interface ChangePlan {
  rule: rec.SeriesRule;
  startTime: string;
  staffId: string | null;
  staffLocked: boolean;
  services: VisitService[];
  duration: number;
  /** Booked visits on or after `fromDate` the change will replace (not ones moved by hand). */
  replace: any[];
  dates: { date: string; startAt: string; status: ChangeDateStatus }[];
  /** Dates the new time does not fit — each needs a resolution. */
  conflicts: string[];
}

async function replaceSet(q: Query, s: SeriesRow, fromDate: string, now: Date): Promise<any[]> {
  return q(
    `select * from appointment
      where series_id = $1 and business_id = $2 and status in ('pending', 'confirmed')
        and occurrence_date >= $3::date and rescheduled_at is null and scheduled_start_at > $4
      order by scheduled_start_at`,
    [s.id, s.business_id, fromDate, now.toISOString()],
  );
}

/** Weekdays the store is shut, for judging dates past the horizon (the job books those later). */
async function closedWeekdays(q: Query, businessId: string): Promise<Set<number>> {
  const hours = await q('select day_of_week, is_closed, opens_at, closes_at from business_hour where business_id = $1', [
    businessId,
  ]);
  const closed = new Set<number>();
  for (let d = 0; d <= 6; d += 1) {
    const h = hours.find((x) => x.day_of_week === d);
    if (!h || h.is_closed || !h.opens_at || !h.closes_at) closed.add(d);
  }
  return closed;
}

/** A `date` column read through `select *` (a JS Date at server-local midnight) or `::text`. */
function pgDateText(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Everything "change all future visits" would do, worked out without writing: the new rule, the
 * visits it replaces, and each date's fate. Shared by the preview and the change itself, so what
 * the person saw is what is applied.
 *
 * The interval never changes (client spec: "new time or new stylist"), and the change starts on
 * one of the old rule's dates — so from `fromDate` on, the new rule has exactly the old dates.
 */
async function planChange(q: Query, b: any, s: SeriesRow, input: ChangeInput, now: Date): Promise<ChangePlan> {
  if (s.status !== 'active') throw Errors.invalidState('Only an active repeating booking can be changed');
  const tz = b.timezone;
  const today = rec.storeToday(now, tz);
  const oldRule = ruleOf(s);
  const k = rec.occurrenceIndex(oldRule, input.fromDate);
  if (k === null || input.fromDate < today) {
    throw Errors.validation('Pick one of the upcoming repeating dates', [{ field: 'fromDate', message: 'Not a repeating date' }]);
  }
  // Starting past the first not-yet-booked date would leave the dates in between booked by neither rule.
  const nextUnbooked = rec.firstDateAfter(oldRule, s.generated_through);
  if (nextUnbooked !== null && input.fromDate > nextUnbooked) {
    throw Errors.validation('Start the change from a visit that is already booked, or the next one', [
      { field: 'fromDate', message: 'Too far ahead' },
    ]);
  }

  let startTime = s.start_time;
  if (input.slotStart) {
    if (rec.storeDate(input.slotStart, tz) !== input.fromDate) {
      throw Errors.validation('Pick the new time on the first changed date', [{ field: 'slotStart', message: 'Wrong date' }]);
    }
    startTime = rec.storeTime(input.slotStart, tz);
  }

  let staffId: string | null;
  let staffLocked: boolean;
  if (input.staffId === undefined) {
    staffId = s.staff_id;
    staffLocked = s.staff_locked;
    const [st] = staffId
      ? await q('select id from staff where id = $1 and business_id = $2 and is_active = true', [staffId, s.business_id])
      : [];
    if (staffLocked && !st) {
      throw Errors.validation('This stylist is no longer available — pick someone else', [
        { field: 'staffId', message: 'Pick a team member' },
      ]);
    }
  } else {
    staffId = await resolveStaffChoice(q, s.business_id, input.staffId, s.staff_id);
    staffLocked = staffId !== null;
  }
  if (startTime === s.start_time && staffId === s.staff_id && staffLocked === s.staff_locked) {
    throw Errors.validation('Choose a new time or a new stylist', [{ field: 'slotStart', message: 'Nothing to change' }]);
  }

  const { services, missing } = await loadSeriesServices(q, s.id, s.business_id);
  if (missing.length) throw Errors.invalidState('A service in this booking was removed by the salon — please call them');
  const duration = visitMinutes(services);

  const rule: rec.SeriesRule = { ...oldRule, anchorDate: input.fromDate, startIndex: (oldRule.startIndex ?? 0) + k };
  const replace = await replaceSet(q, s, input.fromDate, now);
  const replaceIds = replace.map((r) => r.id);
  const replacedDates = new Set(replace.map((r) => pgDateText(r.occurrence_date)));

  // Dates already settled another way — skipped, cancelled, checked in, or moved by hand — keep it.
  const others = await q(
    `select occurrence_date::text as d, status, rescheduled_at from appointment
      where series_id = $1 and occurrence_date >= $2::date
        and cancel_reason is distinct from 'superseded' and not (id = any($3::uuid[]))`,
    [s.id, input.fromDate, replaceIds],
  );
  const settled = new Map<string, ChangeDateStatus>();
  for (const o of others) {
    if (settled.has(o.d)) continue;
    settled.set(o.d, o.rescheduled_at && (o.status === 'pending' || o.status === 'confirmed') ? 'kept' : 'skipped');
  }

  const horizon = rec.horizonDate(today, BOOKING_WINDOW_DAYS);
  const windowDays = rec.seriesWindowDays(BOOKING_WINDOW_DAYS);
  const dates: ChangePlan['dates'] = [];
  const conflicts: string[] = [];
  for (const date of rec.datesBetween(rule, rec.addDays(input.fromDate, -1), horizon)) {
    const startAt = rec.occurrenceStart(date, startTime, tz).toISOString();
    const already = settled.get(date);
    if (already && !replacedDates.has(date)) {
      dates.push({ date, startAt, status: already });
      continue;
    }
    const slot = await slotInputFor(q, b, date, duration, staffId, {
      now,
      windowDays,
      excludeIds: replaceIds,
      project: { exceptSeriesId: s.id },
    });
    const v = rec.judgeDate(slot, startAt, { staffLocked });
    const status: ChangeDateStatus = v === 'ok' ? 'ok' : v === 'closed' ? 'closed' : 'taken';
    if (status === 'taken') conflicts.push(date);
    dates.push({ date, startAt, status });
  }
  // A few dates past the horizon, so the preview shows the rhythm going on — booked later by the job.
  const closed = await closedWeekdays(q, s.business_id);
  const lastShown = dates.length ? dates[dates.length - 1].date : rec.addDays(input.fromDate, -1);
  for (const date of rec.nextDates(rule, lastShown, Math.max(0, rec.PREVIEW_DATES - dates.length))) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    // A date out here can already hold a visit — one moved by hand or a "Book another time" — and
    // the change will leave it where it is; it is not "booked later" (owner-web walk-through).
    const already = settled.get(date);
    dates.push({
      date,
      startAt: rec.occurrenceStart(date, startTime, tz).toISOString(),
      status: already ?? (closed.has(weekday) ? 'closed' : 'later'),
    });
  }

  return { rule, startTime, staffId, staffLocked, services, duration, replace, dates, conflicts };
}

function previewDTO(plan: ChangePlan, input: ChangeInput) {
  return {
    fromDate: input.fromDate,
    startTime: plan.startTime,
    staffId: plan.staffId,
    dates: plan.dates,
    conflicts: plan.conflicts,
  };
}

/**
 * Apply a change: supersede the replaced visits, re-anchor the rule (version+1), write each
 * conflict's resolution, then book the rest. One transaction — if anything no longer fits, nothing
 * is written and the caller gets 409 CHANGE_CONFLICTS with the dates to resolve again.
 */
async function applyChange(
  businessId: string,
  seriesId: string,
  input: ChangeInput,
  ctx: { windowDays: number; seat?: string | null; now: Date },
) {
  return transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const [b] = await q('select * from business where id = $1', [businessId]);
    const s = await seriesById(q, seriesId, businessId, true);
    if (!b || !s) throw Errors.notFound('Series not found');
    const plan = await planChange(q, b, s, input, ctx.now);
    assertSeat(ctx.seat, plan.staffId);

    // Every date the new time does not fit needs the person's choice, and a chosen time must be free.
    const byDate = new Map((input.resolutions ?? []).map((r) => [r.date, r]));
    const check = { windowDays: ctx.windowDays, excludeIds: plan.replace.map((r) => r.id), exceptSeriesId: s.id, now: ctx.now };
    const unresolved: string[] = [];
    for (const date of plan.conflicts) {
      const r = byDate.get(date);
      if (!r) unresolved.push(date);
      else if ('slotStart' in r && !(await isFree(q, b, r.slotStart, plan.duration, plan.staffId, check))) unresolved.push(date);
    }
    if (unresolved.length) throw changeConflicts(unresolved);

    const superseded = plan.replace.length
      ? await q(
          `update appointment set status = 'cancelled', cancel_reason = 'superseded', updated_at = $2
            where id = any($1::uuid[]) returning *`,
          [plan.replace.map((r) => r.id), ctx.now.toISOString()],
        )
      : [];
    await q(
      `update appointment_series
          set version = version + 1, anchor_date = $2::date, anchor_index = $3, start_time = $4::time,
              staff_id = $5, staff_locked = $6, generated_through = $7::date, updated_at = $8
        where id = $1`,
      [
        s.id,
        input.fromDate,
        plan.rule.startIndex ?? 0,
        plan.startTime,
        plan.staffId,
        plan.staffLocked,
        rec.addDays(input.fromDate, -1),
        ctx.now.toISOString(),
      ],
    );
    const fresh = (await seriesById(q, s.id, businessId))!;

    // Resolutions first, so the generation below sees those dates as handled.
    const extra: any[] = [];
    for (const date of plan.conflicts) {
      const r = byDate.get(date)!;
      if ('slotStart' in r) {
        // Re-checked inside the lock: two resolutions may have picked the same slot.
        if (!(await isFree(q, b, r.slotStart, plan.duration, plan.staffId, { ...check, excludeIds: [] }))) {
          throw changeConflicts([date]);
        }
        const row = await insertSeriesVisit(q, fresh, date, new Date(r.slotStart), plan.duration, plan.services, {
          rescheduled: true,
          now: ctx.now,
        });
        if (row) extra.push(row);
      } else {
        const ruleStart = rec.occurrenceStart(date, plan.startTime, b.timezone);
        await insertSeriesVisit(q, fresh, date, ruleStart, plan.duration, plan.services, { skipped: true, now: ctx.now });
      }
    }

    // Open Needs-attention items from this date on belong to the old rule — the change settles them.
    await q(
      `update appointment_series_issue set resolved_at = $3, resolution = 'handled'
        where series_id = $1 and resolved_at is null and occurrence_date >= $2::date`,
      [s.id, input.fromDate, ctx.now.toISOString()],
    );

    const gen = await generateSeriesVisits(q, b, fresh, ctx.now, 'change');
    gen.created.unshift(...extra);
    return { superseded, gen };
  });
}

async function afterChange(businessId: string, seriesId: string, out: { superseded: any[]; gen: GenerationResult }) {
  for (const v of out.superseded) emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(v) });
  // No confirmation text: the person changing it is looking at the result (client SMS rule).
  await afterGeneration(businessId, seriesId, out.gen, { confirm: false });
  emitToOwners(businessId, 'series:updated', { seriesId });
}

/** The times a series visit could take on `date` — for a change's new time, or a conflict's choice. */
async function seriesSlots(
  b: any,
  s: SeriesRow,
  query: { date: string; staffId?: string; fromDate?: string },
  windowDays: number,
  now: Date,
) {
  const { services, missing } = await loadSeriesServices(pool, s.id, s.business_id);
  if (missing.length) throw Errors.invalidState('A service in this booking was removed by the salon — please call them');
  const staffId = await resolveStaffChoice(pool, s.business_id, query.staffId, s.staff_id);
  const excludeIds = query.fromDate ? (await replaceSet(pool, s, query.fromDate, now)).map((r) => r.id) : [];
  return slotsFor(pool, b, {
    date: query.date,
    durationMin: visitMinutes(services),
    staffId,
    windowDays,
    excludeIds,
    exceptSeriesId: query.fromDate ? s.id : undefined,
    now,
  });
}

// ---- Owner ----

async function ownerSeries(businessId: string, seriesId: string) {
  const [b] = await pool('select * from business where id = $1', [businessId]);
  const s = await seriesById(pool, seriesId, businessId);
  if (!b || !s) throw Errors.notFound('Series not found');
  return { b, s };
}

export async function ownerSeriesSlots(
  businessId: string,
  seriesId: string,
  query: { date: string; staffId?: string; fromDate?: string },
  now: Date = new Date(),
) {
  const { b, s } = await ownerSeries(businessId, seriesId);
  return seriesSlots(b, s, query, ownerWindowDays(), now);
}

export async function previewChangeByOwner(businessId: string, seriesId: string, input: ChangeInput, now: Date = new Date()) {
  const { b, s } = await ownerSeries(businessId, seriesId);
  return previewDTO(await planChange(pool, b, s, input, now), input);
}

export async function changeSeriesByOwner(
  businessId: string,
  seriesId: string,
  input: ChangeInput,
  seat: string | null,
  now: Date = new Date(),
) {
  const out = await applyChange(businessId, seriesId, input, { windowDays: ownerWindowDays(), seat, now });
  await afterChange(businessId, seriesId, out);
  return getSeries(businessId, seriesId, now);
}

/**
 * "Book another time" for a Needs-attention date: the owner books that one date at a time they
 * pick, under the rule version that produced the issue, and the issue is closed as `booked`.
 */
export async function bookIssue(
  businessId: string,
  issueId: string,
  input: { slotStart: string; staffId?: string },
  userId: string,
  seat: string | null,
  now: Date = new Date(),
) {
  const out = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const [b] = await q('select * from business where id = $1', [businessId]);
    const [issue] = await q(
      `select i.*, i.occurrence_date::text as occ from appointment_series_issue i
        where i.id = $1 and i.business_id = $2 for update`,
      [issueId, businessId],
    );
    if (!b || !issue) throw Errors.notFound('Not found');
    const s = await seriesById(q, issue.series_id, businessId, true);
    // A staff login reaches only its own chair's items — the same 404 as an unknown id.
    if (!s || (seat && s.staff_id !== seat)) throw Errors.notFound('Not found');
    if (issue.resolved_at) throw Errors.invalidState('This item has already been handled');
    if (s.status === 'cancelled') throw Errors.invalidState('This repeating booking was cancelled');

    const { services, missing } = await loadSeriesServices(q, s.id, businessId);
    if (missing.length) throw Errors.invalidState('A service in this booking was removed — it cannot be booked again');
    const duration = visitMinutes(services);
    const staffId = await resolveStaffChoice(q, businessId, input.staffId, s.staff_id);
    assertSeat(seat, staffId);

    if ((await handledDates(q, s.id, issue.occ, issue.occ)).size) {
      throw Errors.conflict('ALREADY_BOOKED', 'This date already has a visit in the series');
    }
    if (!(await isFree(q, b, input.slotStart, duration, staffId, { windowDays: ownerWindowDays(), exceptSeriesId: s.id, now }))) {
      throw slotTaken();
    }
    const row = await insertSeriesVisit(q, s, issue.occ, new Date(input.slotStart), duration, services, {
      version: issue.series_version,
      staffId,
      rescheduled: true,
      now,
    });
    if (!row) throw Errors.conflict('ALREADY_BOOKED', 'This date already has a visit in the series');
    await q(
      `update appointment_series_issue set resolved_at = $2, resolution = 'booked', resolved_by_user_id = $3
        where id = $1`,
      [issueId, now.toISOString(), userId],
    );
    return { row, seriesId: s.id };
  });
  emitToOwners(businessId, 'appointment:created', { appointment: apptDTO(out.row) });
  emitToOwners(businessId, 'series:updated', { seriesId: out.seriesId });
  return apptDTO(out.row);
}

// ---- Customer (manage link) ----

async function tokenSeries(token: string | undefined) {
  const s = await seriesForToken(token);
  const [b] = await pool('select * from business where id = $1', [s.business_id]);
  return { b, s: s as SeriesRow };
}

/**
 * Times for the customer's own picker: moving one visit (`appointmentId` — its own length, and it
 * does not block itself) or changing the series (`fromDate`). Always within today … today+20.
 */
export async function seriesSlotsByToken(
  token: string | undefined,
  query: { date: string; staffId?: string; appointmentId?: string; fromDate?: string },
  now: Date = new Date(),
) {
  const { b, s } = await tokenSeries(token);
  if (query.appointmentId) {
    const [a] = await pool('select * from appointment where id = $1 and business_id = $2 and series_id = $3', [
      query.appointmentId,
      s.business_id,
      s.id,
    ]);
    if (!a) throw Errors.notFound('Appointment not found');
    const staffId = await resolveStaffChoice(pool, s.business_id, query.staffId, a.staff_id);
    return slotsFor(pool, b, {
      date: query.date,
      durationMin: durationOf(a),
      staffId,
      windowDays: customerWindowDays(),
      excludeIds: [a.id],
      now,
    });
  }
  return seriesSlots(b, s, query, customerWindowDays(), now);
}

/** The customer moves one of their series visits (only theirs — the token's series). */
export async function rescheduleVisitByToken(
  token: string | undefined,
  appointmentId: string,
  input: { slotStart: string; staffId?: string },
  now: Date = new Date(),
) {
  const { s } = await tokenSeries(token);
  const row = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${s.business_id}`]);
    const [b] = await q('select * from business where id = $1', [s.business_id]);
    const [a] = await q('select * from appointment where id = $1 and business_id = $2 and series_id = $3 for update', [
      appointmentId,
      s.business_id,
      s.id,
    ]);
    if (!a) throw Errors.notFound('Appointment not found');
    if (!['pending', 'confirmed'].includes(a.status) || new Date(a.scheduled_start_at).getTime() <= now.getTime()) {
      throw Errors.invalidState("This visit can't be moved any more");
    }
    const staffId = await resolveStaffChoice(q, s.business_id, input.staffId, a.staff_id);
    return moveAppointment(q, b, a, { slotStart: input.slotStart, staffId, windowDays: customerWindowDays(), now });
  });
  emitToOwners(s.business_id, 'appointment:updated', { appointment: apptDTO(row) });
  emitToOwners(s.business_id, 'series:updated', { seriesId: s.id });
  return getSeriesByToken(token);
}

export async function previewChangeByToken(token: string | undefined, input: ChangeInput, now: Date = new Date()) {
  const { b, s } = await tokenSeries(token);
  return previewDTO(await planChange(pool, b, s, input, now), input);
}

export async function changeSeriesByToken(token: string | undefined, input: ChangeInput, now: Date = new Date()) {
  const { s } = await tokenSeries(token);
  const out = await applyChange(s.business_id, s.id, input, { windowDays: customerWindowDays(), now });
  await afterChange(s.business_id, s.id, out);
  return getSeriesByToken(token);
}
