import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Check in texts (docs/sms-opt-in-a2p.md): a walk-in who ticks the box gets the approved
 * confirmation (with the waitlist's estimated time) and, if they joined with more than 15 minutes
 * to wait, the approved "starts in 15 minutes" text. No DB and no Twilio: the pool and the sender
 * are stubbed, so this pins what is sent, to whom, and against which queue entry.
 */

const { one, exec, send } = vi.hoisted(() => ({
  one: vi.fn(),
  exec: vi.fn(async () => 1),
  send: vi.fn<(to: string, body: string, template?: string) => Promise<{ id: string | null }>>(async () => ({
    id: 'SM-checkin',
  })),
}));

vi.mock('../../src/db/pool', () => ({
  exec,
  many: vi.fn(async () => []),
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/integrations/sms', () => ({ smsSender: { send } }));

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
  S3_ENDPOINT: 'https://example.storageapi.dev',
  S3_ACCESS_KEY_ID: 'test-access-key-id',
  S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
  S3_BUCKET: 'test-bucket',
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
  TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
  PUBLIC_WEB_URL: 'https://www.tejotime.com',
};

const STORE = 'b0000000-0000-4000-8000-000000000001';
const ENTRY = 'e0000000-0000-4000-8000-000000000001';

/** The queue_entry + business row both senders read. */
function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Darshil Patel',
    customer_phone: '+12399385943',
    sms_opt_in: true,
    name: 'A one',
    timezone: 'America/New_York',
    phone_full: '12396667772',
    address: '1011 5th Ave N, Naples, FL 34102',
    ...overrides,
  };
}

/** Insert params of the notification row, in recordSmsNotification's column order. */
function notificationInsert() {
  const call = one.mock.calls.find(([sql]) => /insert into notification/.test(String(sql)));
  return call?.[1] as unknown[] | undefined;
}

describe('check-in texts', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  function stubRows(row: Record<string, unknown> | null) {
    one.mockImplementation(async (sql: string) => {
      if (/from queue_entry q/.test(sql)) return row;
      if (/from customer/.test(sql)) return { sms_opt_out_at: null };
      if (/insert into notification/.test(sql)) return { id: 'n-1' };
      return null;
    });
  }

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    exec.mockClear();
    send.mockClear();
    process.env = { ...originalEnv, ...TEST_ENV };
    // 10:00 UTC is 6:00 AM in New York (EDT) on Oct 6 2026.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it('confirms a ticked check-in with the approved wording and the estimated time, on the store clock', async () => {
    stubRows(entryRow());
    const { sendCheckInConfirmation } = await import('../../src/modules/notifications/sms-dispatch');

    await sendCheckInConfirmation(STORE, ENTRY, 22);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      '+12399385943',
      'TejoTime: Hi Darshil, your appointment at A one is confirmed for Oct 6 at 6:22 AM. Manage your booking: https://www.tejotime.com/12396667772 Reply STOP to opt out.',
      'booking_confirmed',
    );
    // Linked to the queue entry, not an appointment — that is what marks it a check-in text.
    const params = notificationInsert();
    expect(params?.[1]).toBe(ENTRY);
    expect(params?.[2]).toBeNull();
    expect(params?.[3]).toBe('sms');
  });

  it('still confirms when there is no wait — the time is now', async () => {
    stubRows(entryRow());
    const { sendCheckInConfirmation } = await import('../../src/modules/notifications/sms-dispatch');

    await sendCheckInConfirmation(STORE, ENTRY, 0);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toContain('is confirmed for Oct 6 at 6:00 AM.');
  });

  it('sends nothing, and records nothing, when the box was not ticked', async () => {
    stubRows(entryRow({ sms_opt_in: false }));
    const { sendCheckInConfirmation, sendWaitlistReminder } = await import(
      '../../src/modules/notifications/sms-dispatch'
    );

    await sendCheckInConfirmation(STORE, ENTRY, 22);
    await sendWaitlistReminder(STORE, ENTRY);

    expect(send).not.toHaveBeenCalled();
    expect(notificationInsert()).toBeUndefined();
  });

  it('sends nothing for an entry that no longer exists', async () => {
    stubRows(null);
    const { sendCheckInConfirmation, sendWaitlistReminder } = await import(
      '../../src/modules/notifications/sms-dispatch'
    );

    await sendCheckInConfirmation(STORE, ENTRY, 22);
    await sendWaitlistReminder(STORE, ENTRY);

    expect(send).not.toHaveBeenCalled();
  });

  it('sends the approved "starts in 15 minutes" text with the address, linked to the queue entry', async () => {
    stubRows(entryRow());
    const { sendWaitlistReminder } = await import('../../src/modules/notifications/sms-dispatch');

    await sendWaitlistReminder(STORE, ENTRY);

    expect(send).toHaveBeenCalledWith(
      '+12399385943',
      'TejoTime: Hi Darshil, your appointment at A one starts in 15 minutes. Please head over now. Address: 1011 5th Ave N, Naples, FL 34102',
      'appointment_reminder',
    );
    const params = notificationInsert();
    expect(params?.[1]).toBe(ENTRY);
    expect(params?.[2]).toBeNull();
  });
});
