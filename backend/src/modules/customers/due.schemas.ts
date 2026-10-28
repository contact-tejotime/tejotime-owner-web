import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** What a call achieved (docs/customer-due-list.md). "No answer" snoozes to tomorrow on the server. */
export const followupSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('no_answer') }).strict(),
  z.object({ outcome: z.literal('call_later'), callBackOn: ymd }).strict(),
  z.object({ outcome: z.literal('not_interested') }).strict(),
]);

export type FollowupInput = z.infer<typeof followupSchema>;
