import { describe, it, expect } from 'vitest';
import { shouldDispatchSms } from '../../src/lib/sms-opt-in';

describe('shouldDispatchSms', () => {
  const phone = '+15551234567';

  it('sends only when the visit opted in and has a phone', () => {
    expect(shouldDispatchSms({ customerPhone: phone, smsOptIn: true })).toBe(true);
  });

  it('refuses missing opt-in, false opt-in, no phone, and STOP', () => {
    expect(shouldDispatchSms({ customerPhone: phone, smsOptIn: false })).toBe(false);
    expect(shouldDispatchSms({ customerPhone: phone, smsOptIn: undefined })).toBe(false);
    expect(shouldDispatchSms({ customerPhone: phone, smsOptIn: null })).toBe(false);
    expect(shouldDispatchSms({ customerPhone: null, smsOptIn: true })).toBe(false);
    expect(shouldDispatchSms({ customerPhone: '', smsOptIn: true })).toBe(false);
    expect(
      shouldDispatchSms({
        customerPhone: phone,
        smsOptIn: true,
        smsOptOutAt: '2026-09-21T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});
