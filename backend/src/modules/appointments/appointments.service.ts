import { exec, many, one } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { businessDayRange, businessRangeWindow } from '../../lib/time';
import { soonestSeat } from '../../lib/queue-engine';
import { emitToOwners } from '../../realtime/emitters';
import { loadQueueContext } from '../queue/queue.context';
import { broadcastQueue, getEntryDetail } from '../queue/queue.service';
import { findOrCreateCustomer } from '../customers/customer.repo';
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

export async function createAppointment(
  businessId: string,
  input: {
    customerName: string;
    customerPhone?: string | null;
    serviceId?: string | null;
    staffId?: string | null;
    scheduledStartAt: string;
    notes?: string | null;
  },
) {
  let serviceName: string | null = null;
  let durationMinutes = 30;
  if (input.serviceId) {
    const svc = await one('select name, duration_minutes from service where id = $1 and business_id = $2', [
      input.serviceId,
      businessId,
    ]);
    if (!svc) throw Errors.notFound('Service not found');
    serviceName = svc.name;
    durationMinutes = svc.duration_minutes;
  }
  const phone = input.customerPhone ? normalizePhone(input.customerPhone) : null;
  const customerId = await findOrCreateCustomer(businessId, input.customerName, phone);
  const start = new Date(input.scheduledStartAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const data = await one(
    `insert into appointment
       (business_id, customer_id, customer_name, customer_phone, service_id, service_name,
        staff_id, scheduled_start_at, scheduled_end_at, status, source, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', 'owner', $10)
     returning *`,
    [
      businessId,
      customerId,
      input.customerName,
      phone,
      input.serviceId ?? null,
      serviceName,
      input.staffId ?? null,
      start.toISOString(),
      end.toISOString(),
      input.notes ?? null,
    ],
  );
  emitToOwners(businessId, 'appointment:created', { appointment: apptDTO(data) });
  return apptDTO(data);
}

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
  // booking keeps a null reason, as before.
  const data = await one(
    `update appointment set status = $1, updated_at = $2,
            cancel_reason = case when $1 = 'cancelled' and series_id is not null then 'cancelled' else cancel_reason end
      where id = $3 and business_id = $4
      returning *`,
    [status, new Date().toISOString(), appointmentId, businessId],
  );
  if (!data) throw Errors.notFound('Appointment not found');
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(data) });
  if (status === 'no_show') await noteNoShow(businessId, data);
  return apptDTO(data);
}
