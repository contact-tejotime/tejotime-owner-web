/**
 * Which channel a customer's appointment messages arrive on (docs/whatsapp-india.md): an Indian
 * (+91) number gets them on WhatsApp, every other number by text. The backend decides by the same
 * rule (WHATSAPP_COUNTRY_CODES, default "91", in backend/src/config/env.ts) — keep the two in
 * step, or the consent box would promise one channel while the message arrives on the other.
 *
 * Import-free on purpose: the chat flow engine imports it and must stay runnable with plain tsx
 * (`npm run test:chat-flow`).
 */

export const WHATSAPP_DIAL_CODES: readonly string[] = ["91"];

/** True for an E.164 number ("+919824470182") whose calling code gets WhatsApp. */
export function isWhatsAppNumber(e164: string | null | undefined): boolean {
  const m = /^\+(\d+)$/.exec((e164 ?? "").trim());
  return !!m && WHATSAPP_DIAL_CODES.some((code) => m[1].startsWith(code));
}

/** The picker's dial code alone ("91") — the box's wording follows it before a number is typed. */
export function isWhatsAppDialCode(dialCode: string | null | undefined): boolean {
  return WHATSAPP_DIAL_CODES.includes((dialCode ?? "").replace(/^\+/, ""));
}
