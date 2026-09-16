import { describe, it, expect } from 'vitest';
import {
  ETA_NOTIFY_2_MINUTES,
  ETA_NOTIFY_15_MINUTES,
  SMS_TEMPLATES,
  smsBodyEta,
  smsBodyQueueJoined,
  smsBodyYourTurn,
} from '../../src/lib/sms-copy';

describe('sms-copy', () => {
  it('exposes the four template ids', () => {
    expect(SMS_TEMPLATES).toEqual({
      queueJoined: 'queue_joined',
      eta15: 'eta_15',
      eta2: 'eta_2',
      yourTurn: 'your_turn',
    });
  });

  it('builds the four hardcoded bodies', () => {
    expect(smsBodyQueueJoined('A-24')).toBe(
      "You're in the queue. Token A-24. We'll text you as your turn gets close.",
    );
    expect(smsBodyEta(12)).toBe("You're about 12 minutes away — almost your turn.");
    expect(smsBodyYourTurn()).toBe("It's your turn — please head in.");
    expect(ETA_NOTIFY_15_MINUTES).toBe(15);
    expect(ETA_NOTIFY_2_MINUTES).toBe(2);
  });
});
