import { z } from 'zod';
import { isoDateSchema, reportQueryWith } from '../../lib/report-window';

/** `GET /commission/visits` — the report window plus whose visits. */
export const visitsQuerySchema = reportQueryWith({
  staffId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const staffParams = z.object({ staffId: z.string().uuid() });

/** The UTC instant DELETE sends back (`from` on a rate row), not a calendar day. */
export const rateInstantParams = z.object({
  staffId: z.string().uuid(),
  effectiveFrom: z.string().datetime(),
});

/**
 * A rate in basis points (2000 = 20%, 3750 = 37.5%) — whole numbers, for the same reason money is
 * paise. `effectiveFrom` is a store-local day. Omitted, or equal to the store's today, the rate
 * starts at now(). A later day starts at midnight in the store's timezone.
 */
export const setRateSchema = z
  .object({
    rateBp: z
      .number()
      .int('Use at most two decimal places')
      .min(0, 'A rate cannot be negative')
      .max(10000, 'A rate cannot be above 100%'),
    effectiveFrom: isoDateSchema.optional(),
  })
  .strict();
