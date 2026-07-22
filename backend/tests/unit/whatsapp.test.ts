import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('whatsappSender', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-12345',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
      WHATSAPP_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: 'AC_test_sid',
      TWILIO_AUTH_TOKEN: 'test_token',
      TWILIO_FROM: '+14174413106',
      TWILIO_TEST_TO: '+919824470182',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('uses TWILIO_TEST_TO when set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM123' }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const mod = await import('../../src/integrations/whatsapp');
    const result = await mod.whatsappSender.send('+911111111111', 'hello', 'your_turn');

    expect(result).toEqual({ id: 'SM123' });
    const [, init] = fetchMock.mock.calls[0];
    const body = String(init?.body ?? '');
    expect(body).toContain('To=%2B919824470182');
    expect(body).toContain('From=%2B14174413106');
    expect(body).toContain('Body=hello');
  });

  it('returns null id when provider responds with an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'bad request' }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const mod = await import('../../src/integrations/whatsapp');
    const result = await mod.whatsappSender.send('+911111111111', 'hello', 'eta_15');

    expect(result).toEqual({ id: null });
  });
});
