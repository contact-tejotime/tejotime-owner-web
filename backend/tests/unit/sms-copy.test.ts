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

  it('builds A2P bodies with brand, frequency, STOP and HELP', () => {
    expect(smsBodyQueueJoined('A-24', 'CURV BEAUTY')).toBe(
      "CURV BEAUTY via TejoTime: You're on the waitlist. Token A-24. Up to 4 msgs/visit. Reply STOP to opt out, HELP for help.",
    );
    expect(smsBodyEta(12, 'CURV BEAUTY')).toBe(
      'CURV BEAUTY via TejoTime: You\'re about 12 minutes away. Reply STOP to opt out, HELP for help.',
    );
    expect(smsBodyYourTurn('CURV BEAUTY')).toBe(
      "CURV BEAUTY via TejoTime: It's your turn — please head in. Reply STOP to opt out, HELP for help.",
    );
    expect(ETA_NOTIFY_15_MINUTES).toBe(15);
    expect(ETA_NOTIFY_2_MINUTES).toBe(2);
  });

  it('falls back to TejoTime when the store name is blank', () => {
    expect(smsBodyYourTurn('  ')).toMatch(/^TejoTime via TejoTime:/);
  });
});
