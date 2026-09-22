/**
 * Hardcoded queue SMS bodies and template ids (Twilio free-text Body).
 *
 * These bodies ARE the Twilio A2P campaign samples (docs/sms-opt-in-a2p.md) — change both together.
 * Frequency + STOP + HELP live only in the first (opt-in confirmation) message, which is all CTIA
 * requires; repeating them on every alert read as spam to customers. Advanced Opt-Out on the
 * Messaging Service still honours STOP/HELP replies to any message.
 * Keep bodies GSM-7: one em dash or curly quote flips the whole text to UCS-2 (70 chars/segment).
 */

export const SMS_TEMPLATES = {
  queueJoined: 'queue_joined',
  eta15: 'eta_15',
  eta2: 'eta_2',
  yourTurn: 'your_turn',
} as const;

/** Wait-minute thresholds for ETA SMS (fixed — not env-driven). */
export const ETA_NOTIFY_15_MINUTES = 15;
export const ETA_NOTIFY_2_MINUTES = 2;

function brand(businessName: string): string {
  return businessName.trim() || 'TejoTime';
}

export function smsBodyQueueJoined(token: string, businessName: string): string {
  return `${brand(businessName)} via TejoTime: You're on the waitlist. Token ${token}. We'll text you up to 3 more updates for this visit. Reply STOP to opt out, HELP for help.`;
}

export function smsBodyEta(waitMinutes: number, businessName: string): string {
  return `${brand(businessName)} via TejoTime: You're about ${waitMinutes} minutes away.`;
}

export function smsBodyYourTurn(businessName: string): string {
  return `${brand(businessName)} via TejoTime: It's your turn, please head in.`;
}
