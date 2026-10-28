import { z } from 'zod';
import { staffChoice, ymd } from './series.schemas';

/**
 * Request shapes for an owner booking a customer (owner-booking.service.ts). Times always travel as
 * a slot's `startAt` instant from `GET /appointments/slots` — clients never build one themselves.
 */

const uuid = z.string().uuid();

/** `serviceIds=a,b` in a query string. */
const serviceIdsCsv = z
  .string()
  .max(400)
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(uuid).max(10));

export const ownerSlotsQuery = z.object({
  date: ymd,
  staffId: staffChoice.optional(),
  serviceIds: serviceIdsCsv.optional(),
});

/**
 * Two ways to name the customer:
 *  - `customerId` — someone already on the books ("Due to come back" → Book);
 *  - `customerName` + `customerPhone` — Appointments → "+" Book appointment
 *    (docs/owner-book-appointment.md). The phone is REQUIRED there (owner, 2026-10-28): it is what
 *    links the visit to a customer record (an existing number is matched, never duplicated), so it
 *    shows in Customers, their history and the call list.
 *
 * `slotStart` is the current name; `scheduledStartAt`, `serviceId` and a null `staffId` are what
 * the endpoint took before it was guarded (no client ever sent them, but they cost nothing).
 */
export const ownerBookSchema = z
  .object({
    customerId: uuid.optional(),
    customerName: z.string().trim().min(1).max(80).optional(),
    customerPhone: z.string().trim().max(20).optional().nullable(),
    serviceIds: z.array(uuid).max(10).optional(),
    serviceId: uuid.optional().nullable(),
    staffId: staffChoice.optional().nullable(),
    slotStart: z.string().datetime().optional(),
    scheduledStartAt: z.string().datetime().optional(),
    notes: z.string().max(1000).optional().nullable(),
    /** Hospital-type stores identify the visitor, as a walk-in does (display only). */
    visitorType: z.enum(['mr', 'patient']).optional(),
  })
  .strict()
  .refine((v) => !!v.customerId || !!v.customerName, {
    message: 'Pick a customer',
    path: ['customerId'],
  })
  .refine((v) => !!v.customerId || !!v.customerPhone?.trim(), {
    message: "Enter the customer's phone number",
    path: ['customerPhone'],
  })
  .refine((v) => (v.slotStart ? 1 : 0) + (v.scheduledStartAt ? 1 : 0) === 1, {
    message: 'Pick a time',
    path: ['slotStart'],
  })
  .transform((v) => ({
    customerId: v.customerId,
    customerName: v.customerName,
    customerPhone: v.customerPhone ?? null,
    serviceIds: v.serviceIds,
    serviceId: v.serviceId ?? null,
    staffId: v.staffId === null ? 'any' : v.staffId,
    slotStart: (v.slotStart ?? v.scheduledStartAt)!,
    notes: v.notes ?? null,
    visitorType: v.visitorType ?? null,
  }));
