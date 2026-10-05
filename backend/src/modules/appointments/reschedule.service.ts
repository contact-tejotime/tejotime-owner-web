import { env } from '../../config/env';
import { BOOKING_WINDOW_DAYS } from '../../config/constants';
import { many, transaction } from '../../db/pool';
import { Errors } from '../../domain/errors';
import { computeSlots, isBookable } from '../../lib/booking-slots';
import * as rec from '../../lib/recurrence';
import { REMINDER_LEAD_MINUTES } from '../../lib/sms-copy';
import { emitToOwners } from '../../realtime/emitters';
import { apptDTO } from './appointment.dto';
import { slotInputFor, type Query } from './booking.repo';

/**
 * Moving a booking to another time — recurring appointments Phase 2 (docs/recurring-appointments.md).
 *
 * Its own module so both appointments.service and series.service can use it without importing each
 * other. Everything here checks a new time with the SAME rule public booking uses (`isBookable`),
 * so a move can never be given a time a customer could not book — plus two things only an edit
 * needs: the visit being moved must not block itself (`excludeIds`), and a regular's
 * not-yet-booked series dates count as taken (`project`).
 *
 * No SMS (client rule: only the three registered texts). The moved visit's 15-minute reminder is
 * re-armed for its new time.
 */

const pool: Query = (sql, params) => many(sql, params ?? []);

/** An owner may move a booking up to today+60 (today included). */
export const OWNER_MOVE_DAYS = 60;
export const ownerWindowDays = (): number => OWNER_MOVE_DAYS + 1;
/**
 * A customer moves a series visit within the job's horizon (today … today+20): every series date in
 * it is already booked, so nothing projected can collide. Derived from the window, never a literal.
 */
export const customerWindowDays = (): number => rec.seriesWindowDays(BOOKING_WINDOW_DAYS);

/** A stylist choice in a request: a uuid, 'any' for no preference, or absent to keep the current one. */
export type StaffChoice = string | undefined;

export async function resolveStaffChoice(
  q: Query,
  businessId: string,
  choice: StaffChoice,
  current: string | null,
): Promise<string | null> {
  if (choice === undefined) return current;
  if (choice === 'any') return null;
  const [st] = await q('select id from staff where id = $1 and business_id = $2 and is_active = true', [choice, businessId]);
  if (!st) throw Errors.validation('Pick a team member from this store', [{ field: 'staffId', message: 'Unknown team member' }]);
  return choice;
}

/**
 * A staff login may only keep a booking on its OWN chair. `requireOwnRow` checks where the row is
 * now; this checks where it is going — without it a staff login could hand a visit to a colleague.
 */
export function assertSeat(seat: string | null | undefined, staffId: string | null): void {
  if (seat && staffId !== seat) throw Errors.forbidden('You can only move bookings on your own chair');
}

/** A booking keeps its own length when it moves; a row with no end counts as one slot. */
export function durationOf(a: { scheduled_start_at: string | Date; scheduled_end_at: string | Date | null }): number {
  if (!a.scheduled_end_at) return env.BOOKING_SLOT_MINUTES;
  const mins = Math.round((new Date(a.scheduled_end_at).getTime() - new Date(a.scheduled_start_at).getTime()) / 60_000);
  return mins > 0 ? mins : env.BOOKING_SLOT_MINUTES;
}

export interface EditCheck {
  windowDays: number;
  excludeIds?: string[];
  /** Leave this series' own projected dates out (a change re-books them itself). */
  exceptSeriesId?: string;
  now: Date;
}

/**
 * The times a booking of `durationMin` could move to on `date`, plus the allowed range as
 * store-local days — so no client ever works out "today" or an instant on its own clock.
 */
export async function slotsFor(
  q: Query,
  b: any,
  args: { date: string; durationMin: number; staffId: string | null } & EditCheck,
) {
  const input = await slotInputFor(q, b, args.date, args.durationMin, args.staffId, {
    now: args.now,
    windowDays: args.windowDays,
    excludeIds: args.excludeIds,
    project: { exceptSeriesId: args.exceptSeriesId },
  });
  const today = rec.storeToday(args.now, b.timezone);
  return { date: args.date, slots: computeSlots(input), today, lastDay: rec.addDays(today, args.windowDays - 1) };
}

/** True when `startIso` is a time `slotsFor` would offer with the same inputs. */
export async function isFree(
  q: Query,
  b: any,
  startIso: string,
  durationMin: number,
  staffId: string | null,
  check: EditCheck,
): Promise<boolean> {
  const date = rec.storeDate(startIso, b.timezone);
  const input = await slotInputFor(q, b, date, durationMin, staffId, {
    now: check.now,
    windowDays: check.windowDays,
    excludeIds: check.excludeIds,
    project: { exceptSeriesId: check.exceptSeriesId },
  });
  return isBookable(input, new Date(startIso).toISOString());
}

export const slotTaken = () =>
  Errors.conflict('SLOT_UNAVAILABLE', 'That time is no longer available. Please pick another time.');

/**
 * Move one booking in place. The caller holds the store's `appt:` lock and passes the row it read
 * `for update`. The visit keeps its `occurrence_date` and series fields; `rescheduled_at` marks it
 * as a deliberate exception that a later "change all future visits" leaves where it is.
 */
export async function moveAppointment(
  q: Query,
  b: any,
  a: any,
  input: { slotStart: string; staffId: string | null; windowDays: number; now: Date },
): Promise<any> {
  const duration = durationOf(a);
  if (!(await isFree(q, b, input.slotStart, duration, input.staffId, { windowDays: input.windowDays, excludeIds: [a.id], now: input.now }))) {
    throw slotTaken();
  }
  const start = new Date(input.slotStart);
  const end = new Date(start.getTime() + duration * 60_000);
  const nowIso = input.now.toISOString();
  const reminderEdge = new Date(input.now.getTime() + REMINDER_LEAD_MINUTES * 60_000).toISOString();
  const [row] = await q(
    `update appointment
        set scheduled_start_at = $3, scheduled_end_at = $4, staff_id = $5,
            rescheduled_at = $6::timestamptz, updated_at = $6::timestamptz,
            -- Re-arm the 15-minute reminder for the new time — unless that time is already inside the
            -- window, when the reminder would go out at once saying "starts in 15 minutes".
            reminder_sent_at = case when $3::timestamptz <= $7::timestamptz then $6::timestamptz else null end
      where id = $1 and business_id = $2 and status in ('pending', 'confirmed')
      returning *`,
    [a.id, b.id, start.toISOString(), end.toISOString(), input.staffId, nowIso, reminderEdge],
  );
  if (!row) throw Errors.invalidState("This booking can't be moved any more");
  return row;
}

/** A booking an owner may still move: not started, and today or later on the store's clock. */
function assertMovable(a: any, b: any, now: Date): void {
  if (!['pending', 'confirmed'].includes(a.status)) throw Errors.invalidState("Only a booking that hasn't been checked in can be moved");
  if (rec.storeDate(a.scheduled_start_at, b.timezone) < rec.storeToday(now, b.timezone)) {
    throw Errors.invalidState('This booking has already passed');
  }
}

// ---------------------------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------------------------

async function loadOwned(q: Query, businessId: string, appointmentId: string, forUpdate = false) {
  const [b] = await q('select * from business where id = $1', [businessId]);
  const [a] = await q(
    `select * from appointment where id = $1 and business_id = $2 ${forUpdate ? 'for update' : ''}`,
    [appointmentId, businessId],
  );
  if (!b || !a) throw Errors.notFound('Appointment not found');
  return { b, a };
}

/** Times an owner could move this booking to on `date` (up to today+60). */
export async function ownerSlotsForAppointment(
  businessId: string,
  appointmentId: string,
  query: { date: string; staffId?: string },
  now: Date = new Date(),
) {
  const { b, a } = await loadOwned(pool, businessId, appointmentId);
  const staffId = await resolveStaffChoice(pool, businessId, query.staffId, a.staff_id);
  return slotsFor(pool, b, {
    date: query.date,
    durationMin: durationOf(a),
    staffId,
    windowDays: ownerWindowDays(),
    excludeIds: [a.id],
    now,
  });
}

/** Owner (web or app) moves any booking — one-off or series — to a free time up to today+60. */
export async function rescheduleByOwner(
  businessId: string,
  appointmentId: string,
  input: { slotStart: string; staffId?: string },
  seat: string | null,
  now: Date = new Date(),
) {
  const row = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const { b, a } = await loadOwned(q, businessId, appointmentId, true);
    assertMovable(a, b, now);
    const staffId = await resolveStaffChoice(q, businessId, input.staffId, a.staff_id);
    assertSeat(seat, staffId);
    return moveAppointment(q, b, a, { slotStart: input.slotStart, staffId, windowDays: ownerWindowDays(), now });
  });
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(row) });
  if (row.series_id) emitToOwners(businessId, 'series:updated', { seriesId: row.series_id });
  return apptDTO(row);
}

// ---------------------------------------------------------------------------------------------
// Customer — by appointment key ("My appointments", docs/customer-my-appointments.md)
// ---------------------------------------------------------------------------------------------

/**
 * Times a customer could move this booking to on `date` (today … today+20, the same range as a
 * series visit). The caller has already checked the appointment key and passes the row it read.
 */
export async function customerSlotsForAppointment(
  a: any,
  query: { date: string; staffId?: string },
  now: Date = new Date(),
) {
  const [b] = await pool('select * from business where id = $1', [a.business_id]);
  if (!b) throw Errors.notFound('Appointment not found');
  const staffId = await resolveStaffChoice(pool, a.business_id, query.staffId, a.staff_id);
  return slotsFor(pool, b, {
    date: query.date,
    durationMin: durationOf(a),
    staffId,
    windowDays: customerWindowDays(),
    excludeIds: [a.id],
    now,
  });
}

/**
 * A customer moves their booking — a one-off, or one visit of their series — to a free time up to
 * today+20. The caller has already checked the appointment key. Same guards as
 * rescheduleVisitByToken, deliberately not assertMovable: that one lets an owner move a booking
 * from earlier today, and a customer only ever moves one that hasn't started.
 */
export async function rescheduleByCustomer(
  businessId: string,
  appointmentId: string,
  input: { slotStart: string; staffId?: string },
  now: Date = new Date(),
) {
  const row = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const { b, a } = await loadOwned(q, businessId, appointmentId, true);
    if (!['pending', 'confirmed'].includes(a.status) || new Date(a.scheduled_start_at).getTime() <= now.getTime()) {
      throw Errors.invalidState("This booking can't be moved any more");
    }
    const staffId = await resolveStaffChoice(q, businessId, input.staffId, a.staff_id);
    return moveAppointment(q, b, a, { slotStart: input.slotStart, staffId, windowDays: customerWindowDays(), now });
  });
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(row) });
  // A moved series visit changes what the owner's series sheet shows.
  if (row.series_id) emitToOwners(businessId, 'series:updated', { seriesId: row.series_id });
  return row;
}
