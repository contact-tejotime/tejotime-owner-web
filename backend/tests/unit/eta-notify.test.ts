import { describe, it, expect } from 'vitest';
import { shouldNotifyEta, shouldNotifyEta15 } from '../../src/lib/eta-notify';

const base15 = {
  source: 'online' as const,
  appointmentId: null as string | null,
  status: 'waiting' as const,
  waitMinutes: 12,
  notifiedEta15At: null as string | null,
  customerPhone: '+919876543210',
  smsOptIn: true,
  thresholdMinutes: 15,
};

const baseEta = {
  source: 'online' as const,
  status: 'waiting' as const,
  waitMinutes: 12,
  notifiedAt: null as string | null,
  customerPhone: '+919876543210',
  smsOptIn: true,
  thresholdMinutes: 15,
};

describe('shouldNotifyEta15', () => {
  it('fires when online live-queue wait is in (0, threshold]', () => {
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 15 })).toBe(true);
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 1 })).toBe(true);
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 12 })).toBe(true);
  });

  it('does not fire above threshold or at zero wait', () => {
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 16 })).toBe(false);
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 20 })).toBe(false);
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 0 })).toBe(false);
  });

  it('excludes walk-ins', () => {
    expect(shouldNotifyEta15({ ...base15, source: 'walk_in' })).toBe(false);
  });

  it('includes checked-in appointments (linked appointment_id)', () => {
    expect(shouldNotifyEta15({ ...base15, appointmentId: 'appt-1' })).toBe(true);
  });

  it('excludes in_service and missing phone', () => {
    expect(shouldNotifyEta15({ ...base15, status: 'in_service' })).toBe(false);
    expect(shouldNotifyEta15({ ...base15, customerPhone: null })).toBe(false);
    expect(shouldNotifyEta15({ ...base15, customerPhone: '' })).toBe(false);
  });

  it('is one-shot: never again after notifiedEta15At is set (walk-in bump policy)', () => {
    expect(
      shouldNotifyEta15({
        ...base15,
        waitMinutes: 25,
        notifiedEta15At: '2026-07-21T10:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      shouldNotifyEta15({
        ...base15,
        waitMinutes: 10,
        notifiedEta15At: '2026-07-21T10:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('waits until ETA drops into window when not yet notified', () => {
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 40 })).toBe(false);
    expect(shouldNotifyEta15({ ...base15, waitMinutes: 14 })).toBe(true);
  });
});

describe('shouldNotifyEta (2-minute window)', () => {
  const base2 = { ...baseEta, thresholdMinutes: 2 };

  it('fires when wait is in (0, 2]', () => {
    expect(shouldNotifyEta({ ...base2, waitMinutes: 2 })).toBe(true);
    expect(shouldNotifyEta({ ...base2, waitMinutes: 1 })).toBe(true);
  });

  it('does not fire above 2 minutes or at zero', () => {
    expect(shouldNotifyEta({ ...base2, waitMinutes: 3 })).toBe(false);
    expect(shouldNotifyEta({ ...base2, waitMinutes: 15 })).toBe(false);
    expect(shouldNotifyEta({ ...base2, waitMinutes: 0 })).toBe(false);
  });

  it('is one-shot after notifiedAt is set', () => {
    expect(
      shouldNotifyEta({
        ...base2,
        waitMinutes: 1,
        notifiedAt: '2026-07-21T10:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('excludes walk-in and missing phone', () => {
    expect(shouldNotifyEta({ ...base2, source: 'walk_in', waitMinutes: 1 })).toBe(false);
    expect(shouldNotifyEta({ ...base2, customerPhone: null, waitMinutes: 1 })).toBe(false);
  });

  it('excludes visits that did not opt in to SMS', () => {
    expect(shouldNotifyEta({ ...base2, smsOptIn: false, waitMinutes: 1 })).toBe(false);
    expect(shouldNotifyEta15({ ...base15, smsOptIn: false })).toBe(false);
  });
});
