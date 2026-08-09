import { z } from 'zod';
import { SERVICE_EXTRAS } from '../../config/constants';

export const queueQuerySchema = z.object({
  view: z.enum(['grouped', 'flat']).optional().default('grouped'),
  staffId: z.string().optional(),
});

export const addWalkInSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a customer name').max(80),
    phone: z.string().trim().max(20).optional().nullable(),
    serviceId: z.string().uuid('Pick a service').nullable().optional(),
    staffId: z.string().default('auto'), // 'auto' | uuid
    position: z.enum(['end', 'next']).default('end'),
    visitorType: z.enum(['mr', 'patient']).nullable().optional(),
  })
  .strict();

/**
 * Checkout body. Everything optional so a bare `POST /queue/:id/checkout` — what the mobile app
 * and every earlier client send — still validates and falls through to the derived total.
 *
 * Paise, not rupees: money crosses this boundary as an integer minor unit everywhere else in
 * the API, and a float here would round somebody's bill.
 */
export const checkoutSchema = z
  .object({
    amountPaise: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
  })
  .strict()
  .optional();

export const reassignSchema = z.object({ staffId: z.string().uuid() }).strict();

const extraLabels = SERVICE_EXTRAS.map((e) => e.label);
export const extendSchema = z
  .object({
    label: z.string().min(1).max(40),
    minutes: z.coerce.number().int().min(1).max(240),
  })
  .strict()
  .transform((v) => {
    // Snap to a known add-on's minutes when the label matches the catalog.
    const known = SERVICE_EXTRAS.find((e) => e.label.toLowerCase() === v.label.toLowerCase());
    return known ? { label: known.label, minutes: known.minutes } : v;
  });

export const moveSchema = z.object({ toIndex: z.coerce.number().int().min(0) }).strict();

export const entryParams = z.object({ id: z.string().uuid() });

export { extraLabels };
