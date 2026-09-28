import { z } from 'zod';

/**
 * The Google review link texted after a visit, or '' to clear it (the review SMS is then not sent).
 * Shared by the owner PATCH /business and the admin store form so the two cannot disagree.
 * https only: it goes out in an SMS, and carriers filter plain-http links. Google's own write-review
 * URLs run long (a place id plus query), hence the roomier cap than a social link.
 */
export const reviewUrl = z
  .union([z.string().trim().url().max(500).regex(/^https:\/\//i, 'Must start with https://'), z.literal('')])
  .optional();
