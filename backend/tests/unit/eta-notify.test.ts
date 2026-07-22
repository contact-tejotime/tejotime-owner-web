import { describe, it, expect } from 'vitest';
import { shouldNotifyEta15 } from '../../src/lib/eta-notify';

const base = {
  source: 'online' as const,
  appointmentId: null as string | null,
  status: 'waiting' as const,
  waitMinutes: 12,
  notifiedEta15At: null as string | null,
  customerPhone: '+919876543210',
  thresholdMinutes: 15,
};

describe('shouldNotifyEta15', () => {
  it('fires when online live-queue wait is in (0, threshold]', () => {
    expect(shouldNotifyEta15({ ...base, waitMinutes: 15 })).toBe(true);
    expect(shouldNotifyEta15({ ...base, waitMinutes: 1 })).toBe(true);
    expect(shouldNotifyEta15({ ...base, waitMinutes: 12 })).toBe(true);
  });

  it('does not fire above threshold or at zero wait', () => {
    expect(shouldNotifyEta15({ ...base, waitMinutes: 16 })).toBe(false);
    expect(shouldNotifyEta15({ ...base, waitMinutes: 20 })).toBe(false);
    expect(shouldNotifyEta15({ ...base, waitMinutes: 0 })).toBe(false);
  });

  it('excludes walk-ins', () => {
    expect(shouldNotifyEta15({ ...base, source: 'walk_in' })).toBe(false);
  });

  it('excludes checked-in appointments (linked appointment_id)', () => {
    expect(shouldNotifyEta15({ ...base, appointmentId: 'appt-1' })).toBe(false);
  });

  it('excludes in_service and missing phone', () => {
    expect(shouldNotifyEta15({ ...base, status: 'in_service' })).toBe(false);
    expect(shouldNotifyEta15({ ...base, customerPhone: null })).toBe(false);
    expect(shouldNotifyEta15({ ...base, customerPhone: '' })).toBe(false);
  });

  it('is one-shot: never again after notifiedEta15At is set (walk-in bump policy)', () => {
    // Customer was alerted at 12 min; walk-in pushed wait back to 25 — no second send.
    expect(
      shouldNotifyEta15({
        ...base,
        waitMinutes: 25,
        notifiedEta15At: '2026-07-21T10:00:00.000Z',
      }),
    ).toBe(false);
    // Even if wait drops into the window again, still no second send.
    expect(
      shouldNotifyEta15({
        ...base,
        waitMinutes: 10,
        notifiedEta15At: '2026-07-21T10:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('waits until ETA drops into window when not yet notified', () => {
    expect(shouldNotifyEta15({ ...base, waitMinutes: 40 })).toBe(false);
    expect(shouldNotifyEta15({ ...base, waitMinutes: 14 })).toBe(true);
  });
});
