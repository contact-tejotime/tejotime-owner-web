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
  })
  .strict()
  .refine((v) => !!v.serviceId, { message: 'Pick a service', path: ['serviceId'] });

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
