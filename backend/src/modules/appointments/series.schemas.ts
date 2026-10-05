import { z } from 'zod';

/**
 * Request shapes for recurring-appointment edits (Phase 2, docs/recurring-appointments.md), shared
 * by the owner router (appointments.routes.ts) and the customer's manage-link routes
 * (public.routes.ts) so the two can never accept different things.
 *
 * Times always travel as a slot's `startAt` instant from a slots endpoint — clients never build a
 * store-local date or time themselves.
 */

export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A stylist id, or 'any' for no preference. */
export const staffChoice = z.union([z.literal('any'), z.string().uuid()]);

/** Move one visit. `staffId` absent keeps its stylist. */
export const moveSchema = z.object({ slotStart: z.string().datetime(), staffId: staffChoice.optional() }).strict();

/** Times for moving one booking. */
export const slotsQuery = z.object({ date: ymd, staffId: staffChoice.optional() });
/** Times for a series: `fromDate` when picking a change's new time (its replaced visits don't block it). */
export const seriesSlotsQuery = slotsQuery.extend({ fromDate: ymd.optional() });
/** The customer's picker: one visit (`appointmentId`) or the series (`fromDate`). */
export const publicSeriesSlotsQuery = seriesSlotsQuery.extend({ appointmentId: z.string().uuid().optional() });

const resolution = z.union([
  z.object({ date: ymd, slotStart: z.string().datetime() }).strict(),
  z.object({ date: ymd, skip: z.literal(true) }).strict(),
]);

/** "Change all future visits": a new time (a slot on `fromDate`) and/or a new stylist. */
export const changeSchema = z
  .object({
    fromDate: ymd,
    slotStart: z.string().datetime().optional(),
    staffId: staffChoice.optional(),
    // One per date the new time does not fit (from the preview's `conflicts`). Bounded: the change
    // only ever books up to the horizon, a handful of dates.
    resolutions: z.array(resolution).max(30).optional(),
  })
  .strict()
  .refine((v) => v.slotStart !== undefined || v.staffId !== undefined, {
    message: 'Choose a new time or a new stylist',
    path: ['slotStart'],
  });
