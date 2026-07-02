import { supabase } from '../../db/supabase';
import { callRpc } from '../../db/rpc';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { businessDayRange } from '../../lib/time';
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
  };
}

export async function listAppointments(businessId: string, opts: { date?: string; status?: string; tz?: string }) {
  const tz = opts.tz;
  let q = supabase.from('appointment').select('*').eq('business_id', businessId);
  if (opts.status) {
    q = q.eq('status', opts.status);
  } else {
    const { startIso, endIso } = businessDayRange(tz, opts.date);
    q = q.gte('scheduled_start_at', startIso).lte('scheduled_start_at', endIso);
  }
  const { data } = await q.order('scheduled_start_at', { ascending: true });
  return { data: (data ?? []).map(apptDTO) };
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
    const { data: svc } = await supabase
      .from('service')
      .select('name, duration_minutes')
      .eq('id', input.serviceId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (!svc) throw Errors.notFound('Service not found');
    serviceName = svc.name;
    durationMinutes = svc.duration_minutes;
  }
  const phone = input.customerPhone ? normalizePhone(input.customerPhone) : null;
  const customerId = await findOrCreateCustomer(businessId, input.customerName, phone);
  const start = new Date(input.scheduledStartAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const { data, error } = await supabase
    .from('appointment')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      customer_name: input.customerName,
      customer_phone: phone,
      service_id: input.serviceId ?? null,
      service_name: serviceName,
      staff_id: input.staffId ?? null,
      scheduled_start_at: start.toISOString(),
      scheduled_end_at: end.toISOString(),
      status: 'confirmed',
      source: 'owner',
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
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
  const { data, error } = await supabase
    .from('appointment')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('business_id', businessId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Errors.notFound('Appointment not found');
  emitToOwners(businessId, 'appointment:updated', { appointment: apptDTO(data) });
  return apptDTO(data);
}
