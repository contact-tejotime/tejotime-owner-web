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

export function smsBodyQueueJoined(token: string): string {
  return `You're in the queue. Token ${token}. We'll text you as your turn gets close.`;
}

export function smsBodyEta(waitMinutes: number): string {
  return `You're about ${waitMinutes} minutes away — almost your turn.`;
}

export function smsBodyYourTurn(): string {
  return "It's your turn — please head in.";
}
