import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which provider a customer message goes to (sms-dispatch.ts, docs/whatsapp-india.md): an Indian
 * (+91) number gets the WhatsApp template, everyone else the Twilio text. WHATSAPP_ENABLED plays
 * no part in the choice — like SMS_ENABLED it only stops the sender calling out — so with it off a
 * +91 message is recorded as a deferred WhatsApp message and never falls back to SMS. The pool and
 * both senders are stubbed: this pins the routing and the notification row, not the network.
 */

const { one, exec, smsSend, waSend } = vi.hoisted(() => ({
  one: vi.fn(),
  exec: vi.fn(async () => 1),
  smsSend: vi.fn<(to: string, body: string, template?: string) => Promise<{ id: string | null; error?: string }>>(
    async () => ({ id: 'SM-1' }),
  ),
  waSend: vi.fn<(to: string, template: string, params: string[]) => Promise<{ id: string | null; error?: string }>>(
    async () => ({ id: 'wamid.1' }),
  ),
}));

vi.mock('../../src/db/pool', () => ({
  exec,
  many: vi.fn(async () => []),
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));
vi.mock('../../src/integrations/sms', () => ({ smsSender: { send: smsSend } }));
vi.mock('../../src/integrations/whatsapp', () => ({ whatsappSender: { send: waSend } }));

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
  WHATSAPP_COUNTRY_CODES: '91',
};

const STORE = 'b0000000-0000-4000-8000-000000000001';
const APPT = 'a0000000-0000-4000-8000-000000000001';

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Asha Rao',
    customer_phone: '+919824470182',
    sms_opt_in: true,
    // 08:00 UTC = 1:30 PM in Kolkata.
    scheduled_start_at: '2026-10-24T08:00:00.000Z',
    name: 'Sharp Cuts',
    timezone: 'Asia/Kolkata',
    phone_full: '919399385943',
    manage_token: null,
    ...overrides,
  };
}

/** Insert params of the notification row: [business, entry, appointment, channel, template, to, body, status, sent_at]. */
function notificationInsert() {
  const call = one.mock.calls.find(([sql]) => /insert into notification/.test(String(sql)));
  return call?.[1] as unknown[] | undefined;
}

/** The status update after the send: [status, provider id, sent_at, error, row id]. */
function statusUpdate() {
  const call = exec.mock.calls.find(([sql]) => /update notification/.test(String(sql)));
  return call?.[1] as unknown[] | undefined;
}

describe('customer message routing', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  function stubRows(row: Record<string, unknown> | null, optedOutAt: string | null = null) {
    one.mockImplementation(async (sql: string) => {
      if (/from appointment a/.test(sql)) return row;
      if (/from customer/.test(sql)) return { sms_opt_out_at: optedOutAt };
      if (/insert into notification/.test(sql)) return { id: 'n-1' };
      return null;
    });
  }

  async function confirm(env: Record<string, string> = {}) {
    process.env = { ...originalEnv, ...TEST_ENV, ...env };
    const { sendBookingConfirmation } = await import('../../src/modules/notifications/sms-dispatch');
    await sendBookingConfirmation(STORE, APPT);
  }

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    exec.mockClear();
    smsSend.mockClear();
    waSend.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('a +91 customer gets the WhatsApp template, recorded on the whatsapp channel', async () => {
    stubRows(appointmentRow());
    await confirm({ WHATSAPP_ENABLED: 'true' });

    expect(smsSend).not.toHaveBeenCalled();
    expect(waSend).toHaveBeenCalledWith('+919824470182', 'booking_confirmed', [
      'Asha',
      'Sharp Cuts',
      'Oct 24',
      '1:30 PM',
      'https://www.tejotime.com/919399385943',
    ]);
    const row = notificationInsert();
    expect(row?.[3]).toBe('whatsapp');
    expect(row?.[4]).toBe('booking_confirmed');
    // The record keeps the readable message, the same wording the template carries.
    expect(String(row?.[6])).toContain('your appointment at Sharp Cuts is confirmed for Oct 24 at 1:30 PM.');
    expect(statusUpdate()?.slice(0, 2)).toEqual(['sent', 'wamid.1']);
  });

  it('WHATSAPP_ENABLED=false: still a whatsapp row, deferred — and never an SMS instead', async () => {
    stubRows(appointmentRow());
    // The real sender's contract when the flag is off (integrations/whatsapp.ts): no id, no call out.
    waSend.mockResolvedValueOnce({ id: null });
    await confirm({ WHATSAPP_ENABLED: 'false', SMS_ENABLED: 'true' });

    expect(smsSend).not.toHaveBeenCalled();
    expect(notificationInsert()?.[3]).toBe('whatsapp');
    const update = statusUpdate();
    expect(update?.[0]).toBe('failed');
    expect(update?.[3]).toBe('WhatsApp send failed or deferred');
  });

  it("a refusal of ours is named on the row (Meta's code or country_not_allowed)", async () => {
    stubRows(appointmentRow());
    waSend.mockResolvedValueOnce({ id: null, error: 'meta_131030' });
    await confirm({ WHATSAPP_ENABLED: 'true' });

    expect(statusUpdate()?.[3]).toBe('meta_131030');
  });

  it('a +1 customer still gets the approved Twilio text', async () => {
    stubRows(appointmentRow({ customer_phone: '+12399385943', timezone: 'America/New_York' }));
    await confirm({ WHATSAPP_ENABLED: 'true' });

    expect(waSend).not.toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(smsSend.mock.calls[0][0]).toBe('+12399385943');
    expect(notificationInsert()?.[3]).toBe('sms');
  });

  it('WHATSAPP_COUNTRY_CODES decides who gets WhatsApp', async () => {
    stubRows(appointmentRow({ customer_phone: '+447700900123' }));
    await confirm({ WHATSAPP_ENABLED: 'true', WHATSAPP_COUNTRY_CODES: '91,44' });

    expect(waSend).toHaveBeenCalledTimes(1);
    expect(notificationInsert()?.[3]).toBe('whatsapp');
  });

  it('a customer who replied STOP gets nothing on either channel, and no row is stored', async () => {
    stubRows(appointmentRow(), '2026-10-20T10:00:00.000Z');
    await confirm({ WHATSAPP_ENABLED: 'true' });

    expect(waSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(notificationInsert()).toBeUndefined();
  });

  it('a +1 customer who replied STOP gets no text, and no row is stored', async () => {
    stubRows(appointmentRow({ customer_phone: '+12399385943' }), '2026-10-20T10:00:00.000Z');
    await confirm({ SMS_ENABLED: 'true' });

    expect(smsSend).not.toHaveBeenCalled();
    expect(notificationInsert()).toBeUndefined();
  });

  it('an unticked box sends and records nothing', async () => {
    stubRows(appointmentRow({ sms_opt_in: false }));
    await confirm({ WHATSAPP_ENABLED: 'true' });

    expect(waSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(notificationInsert()).toBeUndefined();
  });

  it('the reminder sweep sends the reminder template, with the store page when there is no address', async () => {
    process.env = { ...originalEnv, ...TEST_ENV, WHATSAPP_ENABLED: 'true' };
    const now = new Date('2026-10-24T07:50:00.000Z');
    const pool = await import('../../src/db/pool');
    vi.mocked(pool.many).mockResolvedValueOnce([
      {
        id: APPT,
        business_id: STORE,
        customer_name: 'Asha Rao',
        customer_phone: '+919824470182',
        scheduled_start_at: '2026-10-24T08:00:00.000Z',
        created_at: '2026-10-20T08:00:00.000Z',
        name: 'Sharp Cuts',
        address: null,
        phone_full: '919399385943',
      },
    ]);
    stubRows(null);
    const { appointmentReminderSweep } = await import('../../src/modules/notifications/sms-dispatch');

    expect(await appointmentReminderSweep(now)).toBe(1);
    expect(waSend).toHaveBeenCalledWith('+919824470182', 'appointment_reminder', [
      'Asha',
      'Sharp Cuts',
      'https://www.tejotime.com/919399385943',
    ]);
  });
});
