import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('smsSender', () => {
  const originalEnv = { ...process.env };

  function baseEnv(overrides: Record<string, string> = {}) {
    return {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      S3_ENDPOINT: 'https://example.storageapi.dev',
      S3_ACCESS_KEY_ID: 'test-access-key-id',
      S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
      S3_BUCKET: 'test-bucket',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
      SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: 'AC_test_sid',
      TWILIO_AUTH_TOKEN: 'test_token',
      TWILIO_FROM: '+14174413106',
      TWILIO_TEST_TO: '+919824470182',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = baseEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('defers when SMS_ENABLED=false', async () => {
    process.env = baseEnv({ SMS_ENABLED: 'false' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const mod = await import('../../src/integrations/sms');
    const result = await mod.smsSender.send('+911111111111', 'hello', 'your_turn');

    expect(result).toEqual({ id: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses TWILIO_TEST_TO when set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM123' }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const mod = await import('../../src/integrations/sms');
    const result = await mod.smsSender.send('+911111111111', 'hello', 'your_turn');

    expect(result).toEqual({ id: 'SM123' });
    const [, init] = fetchMock.mock.calls[0];
    const body = String(init?.body ?? '');
    expect(body).toContain('To=%2B919824470182');
    expect(body).toContain('From=%2B14174413106');
    expect(body).toContain('Body=hello');
  });

  it('maps Body to Twilio trial template when TWILIO_TRIAL_MODE=true', async () => {
    process.env = baseEnv({ TWILIO_TRIAL_MODE: 'true' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM456' }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const mod = await import('../../src/integrations/sms');
    await mod.smsSender.send('+911111111111', "It's your turn — please head in.", 'your_turn');

    const [, init] = fetchMock.mock.calls[0];
    const body = String(init?.body ?? '');
    expect(body).toContain('Body=sms_account_alerts');
  });

  it('returns null id when provider responds with an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'bad request', code: 572006 }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const mod = await import('../../src/integrations/sms');
    const result = await mod.smsSender.send('+911111111111', 'hello', 'eta_15');

    expect(result).toEqual({ id: null });
  });
});
