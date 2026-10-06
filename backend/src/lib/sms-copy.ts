import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Hardcoded appointment SMS bodies and template ids (Twilio free-text Body).
 *
 * These bodies ARE the Twilio A2P campaign samples (docs/sms-opt-in-a2p.md) — change both together.
 * There are exactly three, matching the two consent boxes on the booking page:
 *   - appointment texts box → booking confirmation + 15-minute reminder (customer care)
 *   - review box            → one thank-you / review request after checkout (marketing)
 * STOP lives in the first message each box produces (confirmation, review); Advanced Opt-Out on
 * the Messaging Service still honours STOP/HELP replies to any message.
 *
 * Never put punctuation straight after a URL: some handsets fold a trailing "." into the link and
 * open a 404. The approved samples DO have "link. Reply STOP"; the bodies drop that one "." on
 * purpose (decided 2026-10-06). Keep bodies GSM-7: one em dash or curly quote flips the whole text
 * to UCS-2.
 */

export const SMS_TEMPLATES = {
  bookingConfirmed: 'booking_confirmed',
  appointmentReminder: 'appointment_reminder',
  reviewRequest: 'review_request',
} as const;

/** How long before the appointment the reminder goes out. Fixed — it is in the registered copy. */
export const REMINDER_LEAD_MINUTES = 15;

/**
 * Every text opens with the registered brand, never the store's name: the approved samples
 * (2026-10-06) read "TejoTime: …" and name the store inside the sentence, so the reviewer can tie
 * the sender to the brand on the campaign.
 */
const BRAND = 'TejoTime';

/** " at Sharp Cuts", or nothing for a blank name, so a body never reads "at  is confirmed". */
function atStore(businessName: string): string {
  const name = businessName.trim();
  return name ? ` at ${name}` : '';
}

/** First word only ("Hi Alexander", not the full name) — keeps the body as short as it can be. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}

/** "Sep 26" / "1:11 PM" in the store's own timezone — the customer reads the shop's clock. */
export function smsDateTime(iso: string | Date, tz: string): { date: string; time: string } {
  const d = dayjs(iso).tz(tz || 'UTC');
  return { date: d.format('MMM D'), time: d.format('h:mm A') };
}

export function smsBodyBookingConfirmed(
  customerName: string,
  businessName: string,
  date: string,
  time: string,
  link: string,
): string {
  return `${BRAND}: Hi ${firstName(customerName)}, your appointment${atStore(businessName)} is confirmed for ${date} at ${time}. Manage your booking: ${link} Reply STOP to opt out.`;
}

export function smsBodyReminder(customerName: string, businessName: string, address: string | null | undefined): string {
  const base = `${BRAND}: Hi ${firstName(customerName)}, your appointment${atStore(businessName)} starts in ${REMINDER_LEAD_MINUTES} minutes. Please head over now.`;
  const where = (address ?? '').trim();
  // No dangling "Address:" for a store that never entered one.
  return where ? `${base} Address: ${where}` : base;
}

export function smsBodyReview(customerName: string, businessName: string, reviewUrl: string): string {
  const store = businessName.trim();
  const visited = store ? `Thanks for visiting ${store}, ` : 'Thanks for visiting, ';
  return `${BRAND}: ${visited}${firstName(customerName)}! Please leave us a Google review: ${reviewUrl} Reply STOP to opt out.`;
}

/**
 * Pure reminder window: due once the appointment is at most REMINDER_LEAD_MINUTES away and has
 * not started. A booking made inside that window already got its confirmation a moment ago, so it
 * is skipped rather than texted twice back to back.
 */
export function isReminderDue(input: { startAt: Date | string; createdAt: Date | string; now: Date }): boolean {
  const start = new Date(input.startAt).getTime();
  const created = new Date(input.createdAt).getTime();
  const now = input.now.getTime();
  const lead = REMINDER_LEAD_MINUTES * 60_000;
  if (!(start > now)) return false;
  if (start - now > lead) return false;
  if (start - created < lead) return false;
  return true;
}
