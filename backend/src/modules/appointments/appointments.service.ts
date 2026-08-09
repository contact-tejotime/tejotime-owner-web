import { many, one } from '../../db/pool';
import { callRpc } from '../../db/rpc';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { businessDayRange, businessRangeWindow } from '../../lib/time';
import { soonestSeat } from '../../lib/queue-engine';
import { emitToOwners } from '../../realtime/emitters';
import { loadQueueContext } from '../queue/queue.context';
import { broadcastQueue, getEntryDetail } from '../queue/queue.service';
import { findOrCreateCustomer } from '../customers/customer.repo';

function apptDTO(a: any) {
  return {
    id: a.id,
    customerName: a.customer_name,
    customerPhone: a.customer_phone,
    serviceId: a.service_id,
    serviceName: a.service_name,
    staffId: a.staff_id,
    scheduledStartAt: a.scheduled_start_at,
    scheduledEndAt: a.scheduled_end_at,
    status: a.status,
    source: a.source,
    queueEntryId: a.queue_entry_id,
    notes: a.notes,
    visitorType: a.visitor_type ?? null,
  };
}

export async function listAppointments(
  businessId: string,
  opts: { date?: string; from?: string; to?: string; status?: string; staffId?: string | null; tz?: string },
) {
  const tz = opts.tz;
  // An explicit status filter, a from/to range, or the business day window — never more than one.
  const where = ['business_id = $1'];
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
  // Resolve the soonest seat using the live queue engine, then hand to the RPC.
  const ctx = await loadQueueContext(businessId);
  const staffId = soonestSeat(ctx.engineEntries, ctx.engineStaff, ctx.engineServices);
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
  await broadcastQueue(businessId);
  const entry = await getEntryDetail(businessId, result.entry.id);
  return { appointmentId, entry, token: result.entry.token };
}

export async function setStatus(businessId: string, appointmentId: string, status: 'cancelled' | 'no_show') {
  const data = await one(
    `update appointment set status = $1, updated_at = $2
      where id = $3 and business_id = $4
      returning *`,
    [status, new Date().toISOString(), appointmentId, businessId],
  );
  if (!data) throw Errors.notFound('Appointment not found');
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(data) });
  return apptDTO(data);
}
