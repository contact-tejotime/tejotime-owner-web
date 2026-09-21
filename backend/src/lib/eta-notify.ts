import { QueueSource, QueueStatus } from '../domain/enums';

/** Pure eligibility for a one-shot online-queue wait-window SMS. */
export interface EtaNotifyInput {
  source: QueueSource;
  status: QueueStatus | null;
  waitMinutes: number;
  notifiedAt: string | null | undefined;
  customerPhone: string | null | undefined;
  /** Visit-level A2P opt-in. Missing/false must never text. */
  smsOptIn: boolean;
  /** Alert when 0 < waitMinutes <= threshold. */
  thresholdMinutes: number;
}

/** @deprecated Use EtaNotifyInput; kept for existing shouldNotifyEta15 call sites. */
export type Eta15NotifyInput = Omit<EtaNotifyInput, 'notifiedAt'> & {
  notifiedEta15At: string | null | undefined;
  /** Ignored — checked-in appointments are included in ETA SMS. */
  appointmentId?: string | null;
};

/**
 * Returns true when an online queue ticket (live join or checked-in booking) should
 * receive a wait-window alert. One-shot: if notifiedAt is set, never again.
 */
export function shouldNotifyEta(input: EtaNotifyInput): boolean {
  if (input.source !== 'online') return false;
  if (input.status !== 'waiting') return false;
  if (!input.customerPhone) return false;
  if (input.smsOptIn !== true) return false;
  if (input.notifiedAt) return false;
  const wait = input.waitMinutes;
  if (!(wait > 0 && wait <= input.thresholdMinutes)) return false;
  return true;
}

export function shouldNotifyEta15(input: Eta15NotifyInput): boolean {
  return shouldNotifyEta({
    source: input.source,
    status: input.status,
    waitMinutes: input.waitMinutes,
    notifiedAt: input.notifiedEta15At,
    customerPhone: input.customerPhone,
    smsOptIn: input.smsOptIn,
    thresholdMinutes: input.thresholdMinutes,
  });
}
