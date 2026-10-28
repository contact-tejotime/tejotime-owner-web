import { many, transaction } from '../../db/pool';
import { Errors } from '../../domain/errors';
import { normalizePhone } from '../../lib/phone';
import { emitToOwners } from '../../realtime/emitters';
import { findOrCreateCustomer } from '../customers/customer.repo';
import { apptDTO } from './appointment.dto';
import {
  combinedServiceName,
  insertAppointmentServices,
  resolveServices,
  visitMinutes,
  type Query,
} from './booking.repo';
import { assertSeat, isFree, ownerWindowDays, resolveStaffChoice, slotTaken, slotsFor } from './reschedule.service';

/**
 * An owner books a visit for a customer — what the "Due to come back" list's Book button does after
 * the call (docs/customer-due-list.md).
 *
 * It replaces an owner `POST /appointments` that no screen had ever called, and that would have
 * taken any time at all: no lock, no opening-hours or overlap check, a stylist from another store,
 * one service, no itemised services for check-in. A booking made here is judged by the SAME rule as
 * a customer's own booking (`isFree` → `isBookable`, under the store's `appt:` lock), over the
 * owner's wider window (today … today+60), with regulars' not-yet-booked series dates counted as
 * taken. A time agreed on the phone must therefore be one the picker offers.
 *
 * No SMS, ever: owner surfaces are never an opt-in path (docs/sms-opt-in-a2p.md), so the visit has
 * `sms_opt_in` and `review_sms_opt_in` false — no confirmation, no reminder, no review text. The
 * owner is on the phone with the customer; that is the confirmation.
 */

const pool: Query = (sql, params) => many(sql, params ?? []);

export interface OwnerBookingInput {
  customerId?: string;
  customerName?: string;
  customerPhone?: string | null;
  serviceIds?: string[];
  serviceId?: string | null;
  /** 'any', a stylist's uuid, or absent: a staff login's own chair, "any" for an owner. */
  staffId?: string;
  slotStart: string;
  notes?: string | null;
  visitorType?: 'mr' | 'patient' | null;
}

async function loadBusiness(q: Query, businessId: string) {
  const [b] = await q('select * from business where id = $1', [businessId]);
  if (!b) throw Errors.notFound('Business not found');
  return b;
}

/** The free times for a new booking of these services on `date`, plus the allowed range. */
export async function ownerNewSlots(
  businessId: string,
  query: { date: string; serviceIds?: string[]; staffId?: string },
  seat: string | null,
  now: Date = new Date(),
) {
  const b = await loadBusiness(pool, businessId);
  const svcs = await resolveServices(pool, businessId, { serviceIds: query.serviceIds }, { activeOnly: true });
  const staffId = await resolveStaffChoice(pool, businessId, query.staffId, seat);
  assertSeat(seat, staffId, 'You can only book on your own chair');
  return slotsFor(pool, b, { date: query.date, durationMin: visitMinutes(svcs), staffId, windowDays: ownerWindowDays(), now });
}

export async function bookByOwner(
  businessId: string,
  input: OwnerBookingInput,
  seat: string | null,
  now: Date = new Date(),
) {
  // A typed customer needs a number that normalises (Book appointment requires it): without one the
  // visit would be linked to no customer record. Checked before the lock — nothing to undo.
  const typedPhone = input.customerId ? null : normalizePhone(input.customerPhone ?? '');
  if (!input.customerId && !typedPhone) {
    throw Errors.validation('Enter a valid phone number', [{ field: 'customerPhone', message: 'Invalid phone number' }]);
  }

  const row = await transaction(async (client) => {
    const q: Query = (sql, params) => client.query(sql, params as unknown[]).then((r) => r.rows);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`appt:${businessId}`]);
    const b = await loadBusiness(q, businessId);

    const svcs = await resolveServices(q, businessId, input, { activeOnly: true });
    const duration = visitMinutes(svcs);
    const staffId = await resolveStaffChoice(q, businessId, input.staffId, seat);
    assertSeat(seat, staffId, 'You can only book on your own chair');

    if (!(await isFree(q, b, input.slotStart, duration, staffId, { windowDays: ownerWindowDays(), now }))) {
      throw slotTaken();
    }

    let customer: { id: string | null; name: string; phone: string | null };
    if (input.customerId) {
      const [c] = await q('select id, name, phone from customer where id = $1 and business_id = $2', [
        input.customerId,
        businessId,
      ]);
      if (!c) throw Errors.notFound('Customer not found');
      customer = c;
    } else {
      // Only after the time is known to be free, as public booking does — a refused booking leaves
      // no stray customer behind. A number already on the books is that customer, not a new one.
      customer = {
        id: await findOrCreateCustomer(businessId, input.customerName!, typedPhone),
        name: input.customerName!,
        phone: typedPhone,
      };
    }

    const start = new Date(input.slotStart);
    const end = new Date(start.getTime() + duration * 60_000);
    const [appt] = await q(
      `insert into appointment
         (business_id, customer_id, customer_name, customer_phone, service_id, service_name, staff_id,
          scheduled_start_at, scheduled_end_at, status, source, notes, sms_opt_in, review_sms_opt_in,
          visitor_type)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', 'owner', $10, false, false, $11)
       returning *`,
      [
        businessId,
        customer.id,
        customer.name,
        customer.phone,
        svcs[0]?.id ?? null,
        combinedServiceName(svcs),
        staffId,
        start.toISOString(),
        end.toISOString(),
        input.notes ?? null,
        input.visitorType ?? null,
      ],
    );
    await insertAppointmentServices(q, appt.id, svcs);
    // Booked: whatever an earlier call logged (no answer, call back later) is settled.
    if (customer.id) {
      await q('delete from customer_followup where customer_id = $1 and business_id = $2', [customer.id, businessId]);
    }
    return appt;
  });
  emitToOwners(businessId, 'appointment:created', { appointment: apptDTO(row) });
  return apptDTO(row);
}
