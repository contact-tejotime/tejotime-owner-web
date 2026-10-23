import { firstName } from './sms-copy';

/**
 * The variables of the three approved WhatsApp templates (docs/whatsapp-india.md), in {{1}}..{{n}}
 * order. The templates are the SMS samples' wording with the bracketed values as variables, so
 * the order here is the order those values appear in sms-copy.ts:
 *
 *   booking_confirmed     {{1}} first name  {{2}} store  {{3}} date  {{4}} time  {{5}} link
 *   appointment_reminder  {{1}} first name  {{2}} store  {{3}} address
 *   review_request        {{1}} store       {{2}} first name  {{3}} link
 *
 * Unlike an SMS body, a template's fixed words cannot drop out ("at {{2}}" is always there), and
 * Meta rejects the whole message for an empty variable or one holding a newline, a tab or more
 * than four spaces in a row. So every value goes through `param`, and the blanks an SMS simply
 * leaves out get a stand-in.
 */

/** What a store with a blank name is called inside "your appointment at {{2}}". */
export const STORE_FALLBACK = 'the store';

/** Collapses every run of whitespace (newlines and tabs included) and never returns ''. */
export function param(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v || fallback;
}

export function waParamsBookingConfirmed(
  customerName: string,
  businessName: string,
  date: string,
  time: string,
  link: string,
): string[] {
  return [
    param(firstName(customerName), 'there'),
    param(businessName, STORE_FALLBACK),
    param(date, '-'),
    param(time, '-'),
    param(link, '-'),
  ];
}

/**
 * A store with no address still gets "Address: …" — the template's words are fixed — so it gets
 * the store's booking page instead, which shows where the store is.
 */
export function waParamsReminder(
  customerName: string,
  businessName: string,
  address: string | null | undefined,
  storeLink: string,
): string[] {
  return [
    param(firstName(customerName), 'there'),
    param(businessName, STORE_FALLBACK),
    param(address, param(storeLink, '-')),
  ];
}

export function waParamsReview(customerName: string, businessName: string, reviewUrl: string): string[] {
  return [param(businessName, STORE_FALLBACK), param(firstName(customerName), 'there'), param(reviewUrl, '-')];
}
