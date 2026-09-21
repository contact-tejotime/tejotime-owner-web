/** Hardcoded queue SMS bodies and template ids (Twilio free-text Body). */

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
  return `${brand(businessName)} via TejoTime: You're on the waitlist. Token ${token}. Up to 4 msgs/visit. Reply STOP to opt out, HELP for help.`;
}

export function smsBodyEta(waitMinutes: number, businessName: string): string {
  return `${brand(businessName)} via TejoTime: You're about ${waitMinutes} minutes away. Reply STOP to opt out, HELP for help.`;
}

export function smsBodyYourTurn(businessName: string): string {
  return `${brand(businessName)} via TejoTime: It's your turn — please head in. Reply STOP to opt out, HELP for help.`;
}
