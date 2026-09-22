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

  it('first message carries brand, frequency, STOP and HELP; alerts carry brand only', () => {
    expect(smsBodyQueueJoined('A-24', 'CURV BEAUTY')).toBe(
      "CURV BEAUTY via TejoTime: You're on the waitlist. Token A-24. We'll text you up to 3 more updates for this visit. Reply STOP to opt out, HELP for help.",
    );
    expect(smsBodyEta(12, 'CURV BEAUTY')).toBe("CURV BEAUTY via TejoTime: You're about 12 minutes away.");
    expect(smsBodyYourTurn('CURV BEAUTY')).toBe("CURV BEAUTY via TejoTime: It's your turn, please head in.");
    expect(ETA_NOTIFY_15_MINUTES).toBe(15);
    expect(ETA_NOTIFY_2_MINUTES).toBe(2);
  });

  it('keeps STOP/HELP out of the alerts and every body GSM-7 safe', () => {
    expect(smsBodyEta(15, 'CURV BEAUTY')).not.toMatch(/STOP|HELP/);
    expect(smsBodyEta(2, 'CURV BEAUTY')).not.toMatch(/STOP|HELP/);
    expect(smsBodyYourTurn('CURV BEAUTY')).not.toMatch(/STOP|HELP/);
    // An em dash / curly quote forces UCS-2 and halves the segment size.
    for (const body of [smsBodyQueueJoined('A-24', 'X'), smsBodyEta(15, 'X'), smsBodyYourTurn('X')]) {
      expect(body).not.toMatch(/[—–‘’“”]/);
    }
  });

  it('falls back to TejoTime when the store name is blank', () => {
    expect(smsBodyYourTurn('  ')).toMatch(/^TejoTime via TejoTime:/);
  });
});
