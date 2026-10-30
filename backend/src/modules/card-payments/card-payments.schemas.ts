import { z } from 'zod';

/** One charge attempt's id — the reference the phone handed to the reader. */
export const paymentParams = z.object({ id: z.string().uuid() });

/** Turn card charging on or off. Main owner only; the app does this after signing in to PayPal. */
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    // The PayPal account the owner signed in with, so a phone signed in to another account is
    // refused. Optional: nothing else needs it, and turning off sends none.
    paypalOrgRef: z.string().trim().min(1).max(200).optional().nullable(),
  })
  .strict();

/** Start a charge for an in-service visit. Paise (cents), like every amount on the API. */
export const startSchema = z
  .object({
    queueEntryId: z.string().uuid(),
    // A card charge of nothing is not a charge; the reader refuses it anyway.
    // The WHOLE charge: the bill plus the tip (docs/checkout-tips.md).
    amountPaise: z.coerce.number().int().min(1).max(100_000_000),
    // The part of `amountPaise` that is the tip. Optional for builds that predate tips.
    tipPaise: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
  })
  .strict()
  .refine((v) => (v.tipPaise ?? 0) <= v.amountPaise, {
    message: 'The tip cannot be more than the charge',
    path: ['tipPaise'],
  });

/**
 * What the reader reported for an approved card. Everything but the id is informational, and all
 * of it is optional: whatever the SDK did or did not hand back, the money moved and must be
 * recorded (0043). Brand and last four digits only — never the masked card number.
 */
export const completeSchema = z
  .object({
    providerPaymentId: z.string().trim().max(200).optional().nullable(),
    cardBrand: z.string().trim().max(40).optional().nullable(),
    cardLast4: z.string().regex(/^\d{4}$/).optional().nullable(),
    entryMode: z.string().trim().max(40).optional().nullable(),
    chargedAmountPaise: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
  })
  .strict();

/** The reader declined, the owner cancelled, or the owner gave up on an unconfirmed attempt. */
export const failSchema = z.object({ reason: z.string().trim().min(1).max(200) }).strict();

/** The reader refunded the card (always the whole amount). */
export const refundSchema = z
  .object({ refundReference: z.string().trim().max(200).optional().nullable() })
  .strict();

export const listQuerySchema = z.object({
  status: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
  needsReview: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
