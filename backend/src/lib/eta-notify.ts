import { QueueSource, QueueStatus } from '../domain/enums';

/** Pure eligibility for the one-shot ~15-minute online-queue WhatsApp alert. */
export interface Eta15NotifyInput {
  source: QueueSource;
  /** Linked appointment — checked-in bookings are excluded (online live join only). */
  appointmentId: string | null | undefined;
  status: QueueStatus | null;
  waitMinutes: number;
  notifiedEta15At: string | null | undefined;
  customerPhone: string | null | undefined;
  /** Threshold minutes (default 15). Alert when 0 < waitMinutes <= threshold. */
  thresholdMinutes: number;
}

/**
 * Returns true when an online live-queue ticket should receive the ETA window alert.
 * One-shot: if notifiedEta15At is set, never again — even if a walk-in bumps ETA back above threshold.
 */
export function shouldNotifyEta15(input: Eta15NotifyInput): boolean {
  if (input.source !== 'online') return false;
  if (input.appointmentId) return false;
  if (input.status !== 'waiting') return false;
  if (!input.customerPhone) return false;
  if (input.notifiedEta15At) return false;
  const wait = input.waitMinutes;
  if (!(wait > 0 && wait <= input.thresholdMinutes)) return false;
  return true;
}
