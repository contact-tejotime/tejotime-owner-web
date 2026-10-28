import { exec, many, one } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { Errors } from '../../domain/errors';
import { businessDayRange, businessRangeWindow } from '../../lib/time';
import { soonestSeat } from '../../lib/queue-engine';
import { emitToOwners } from '../../realtime/emitters';
import { loadQueueContext } from '../queue/queue.context';
import { broadcastQueue, getEntryDetail } from '../queue/queue.service';
import { apptDTO } from './appointment.dto';
import { noteNoShow } from './series.service';

// Re-exported so the public self-service cancel (public.service.ts) sends owners the exact same
// `appointment:updated` payload an owner-side cancel does.
export { apptDTO };

export async function listAppointments(
  businessId: string,
  opts: { date?: string; from?: string; to?: string; status?: string; staffId?: string | null; tz?: string },
) {
  const tz = opts.tz;
  // An explicit status filter, a from/to range, or the business day window — never more than one.
  // Visits a "change all future visits" replaced are never shown: nobody cancelled them, and the
  // day's list would otherwise fill with phantom cancellations.
  const where = ['business_id = $1', `cancel_reason is distinct from 'superseded'`];
  const params: unknown[] = [businessId];
  // Own-chair scoping for staff logins. Set by the route from the token, never from the query.
  if (opts.staffId) {
    params.push(opts.staffId);
    where.push(`staff_id = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  } else {
    const { startIso, endIso } =
      opts.from && opts.to ? businessRangeWindow(tz, opts.from, opts.to) : businessDayRange(tz, opts.date);
    params.push(startIso);
    where.push(`scheduled_start_at >= $${params.length}`);
    params.push(endIso);
    where.push(`scheduled_start_at <= $${params.length}`);
  }
  const data = await many(
    `select * from appointment where ${where.join(' and ')} order by scheduled_start_at`,
    params,
  );
  return { data: data.map(apptDTO) };
}

// Creating an owner booking lives in owner-booking.service.ts: it is checked like a customer's own
// booking. The unguarded insert that used to be here was never called by any screen.

export async function checkIn(businessId: string, appointmentId: string) {
  const ctx = await loadQueueContext(businessId);
  // The stylist the customer booked, while they are still an active stylist here; otherwise the
  // soonest seat from the live queue engine. Check-in used to ignore the booking and always take
  // the soonest seat, so a regular who books Lisa every fortnight was put in whichever chair was
  // lightest. Unknown id → 404 from the RPC below, so a missing row is not decided here.
  const booked = await one<{ staff_id: string | null }>(
    'select staff_id from appointment where id = $1 and business_id = $2',
    [appointmentId, businessId],
  );
  const bookedStaff =
    booked?.staff_id && ctx.staffRows.some((s) => s.id === booked.staff_id) ? booked.staff_id : null;
  const staffId = bookedStaff ?? soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
  const result = await callRpc<{ appointment_id: string; entry: { id: string; token: string } }>(
    'appointment_check_in',
    { p_business_id: businessId, p_appointment_id: appointmentId, p_staff_id: staffId },
  );
  emitToOwners(businessId, 'appointment:checked_in', {
    appointmentId,
    queueEntryId: result.entry.id,
  });
  emitToOwners(businessId, 'queue:entry.created', {
    entryId: result.entry.id,
    seatId: staffId,
    source: 'online',
  });

  // Copy the booking's consent flags onto the new ticket. queue_add cannot take them
  // (overload trap). The review flag matters here: checkout reads it off the queue entry,
  // so without this copy a booked customer who ticked the review box would never get it.
  // No SMS at check-in — the waitlist "joined" text was retired (docs/sms-opt-in-a2p.md).
  await exec(
    `update queue_entry q
        set sms_opt_in = a.sms_opt_in,
            review_sms_opt_in = a.review_sms_opt_in
       from appointment a
      where q.id = $1 and q.business_id = $2
        and a.id = $3 and a.business_id = $2`,
    [result.entry.id, businessId, appointmentId],
  );

  await broadcastQueue(businessId);
  const entry = await getEntryDetail(businessId, result.entry.id);
  return { appointmentId, entry, token: result.entry.token };
}

export async function setStatus(businessId: string, appointmentId: string, status: 'cancelled' | 'no_show') {
  // A cancelled series visit is marked so reports can tell it from a customer's skip; a one-off
  // booking keeps a null reason, as before. "Is this a cancel?" is its own boolean parameter: reusing
  // $1 for it made Postgres deduce one parameter as both appointment_status and text ("inconsistent
  // types deduced for parameter $1"), so every owner Cancel and No-show answered 500 from 2026-10-05
  // until 2026-10-28 (caught by smoke-due-list.mjs).
  const data = await one(
    `update appointment set status = $1, updated_at = $2,
            cancel_reason = case when $5 and series_id is not null then 'cancelled' else cancel_reason end
      where id = $3 and business_id = $4
      returning *`,
    [status, new Date().toISOString(), appointmentId, businessId, status === 'cancelled'],
  );
  if (!data) throw Errors.notFound('Appointment not found');
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(data) });
  if (status === 'no_show') await noteNoShow(businessId, data);
  return apptDTO(data);
}
