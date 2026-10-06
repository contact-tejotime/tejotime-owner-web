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
      // The tests above the country block text +91 numbers on purpose.
      TWILIO_ALLOWED_COUNTRY_CODES: '1,91',
      // Explicitly blank: dotenv fills any key that is ABSENT from backend/.env, which would
      // silently switch these tests from From to MessagingServiceSid.
      TWILIO_MESSAGING_SERVICE_SID: '',
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
    await mod.smsSender.send('+911111111111', 'Thanks for visiting — please review us.', 'review_request');

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

  // TWILIO_MESSAGING_SERVICE_SID — send through the Messaging Service the A2P campaign is linked to.
  describe('messaging service', () => {
    const MG = 'MG6e6d92636ac250c2a9f34e09616f31ad';

    function okFetch() {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM321' }) });
      vi.stubGlobal('fetch', fetchMock as typeof fetch);
      return fetchMock;
    }

    it('sends with MessagingServiceSid instead of From when it is set', async () => {
      process.env = baseEnv({ TWILIO_MESSAGING_SERVICE_SID: MG });
      const fetchMock = okFetch();

      const mod = await import('../../src/integrations/sms');
      expect(await mod.smsSender.send('+911111111111', 'hello', 'booking_confirmed')).toEqual({ id: 'SM321' });

      const body = String(fetchMock.mock.calls[0][1]?.body ?? '');
      expect(body).toContain(`MessagingServiceSid=${MG}`);
      expect(body).not.toContain('From=');
      expect(body).toContain('To=%2B919824470182');
    });

    it('needs no TWILIO_FROM when the Messaging Service is set', async () => {
      process.env = baseEnv({ TWILIO_MESSAGING_SERVICE_SID: MG, TWILIO_FROM: '' });
      const fetchMock = okFetch();

      const mod = await import('../../src/integrations/sms');
      expect(await mod.smsSender.send('+911111111111', 'hello', 'booking_confirmed')).toEqual({ id: 'SM321' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when there is neither a Messaging Service nor a From number', async () => {
      process.env = baseEnv({ TWILIO_MESSAGING_SERVICE_SID: '', TWILIO_FROM: '' });
      const fetchMock = okFetch();

      const mod = await import('../../src/integrations/sms');
      expect(await mod.smsSender.send('+911111111111', 'hello', 'booking_confirmed')).toEqual({ id: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to boot on a value that is not a Messaging Service SID', async () => {
      process.env = baseEnv({ TWILIO_MESSAGING_SERVICE_SID: 'PN6e6d92636ac250c2a9f34e09616f31ad' });
      const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as typeof process.exit);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(import('../../src/config/env')).rejects.toThrow('process.exit(1)');
      expect(exit).toHaveBeenCalledWith(1);
      expect(JSON.stringify(consoleError.mock.calls)).toContain('TWILIO_MESSAGING_SERVICE_SID');
    });
  });

  // TWILIO_ALLOWED_COUNTRY_CODES — the A2P campaign covers US numbers only (docs/sms-opt-in-a2p.md).
  describe('country allow-list', () => {
    function okFetch() {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM789' }) });
      vi.stubGlobal('fetch', fetchMock as typeof fetch);
      return fetchMock;
    }

    it('is US-only when left blank: a +91 number is never sent to Twilio', async () => {
      process.env = baseEnv({ TWILIO_ALLOWED_COUNTRY_CODES: '', TWILIO_TEST_TO: '' });
      const fetchMock = okFetch();

      const mod = await import('../../src/integrations/sms');
      const result = await mod.smsSender.send('+919824470182', 'hello', 'booking_confirmed');

      expect(result).toEqual({ id: null, error: 'country_not_allowed' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends to a listed country and refuses an unlisted one', async () => {
      process.env = baseEnv({ TWILIO_ALLOWED_COUNTRY_CODES: '1', TWILIO_TEST_TO: '' });
      const fetchMock = okFetch();

      const mod = await import('../../src/integrations/sms');
      expect(await mod.smsSender.send('+12395061324', 'hello', 'booking_confirmed')).toEqual({ id: 'SM789' });
      expect(String(fetchMock.mock.calls[0][1]?.body ?? '')).toContain('To=%2B12395061324');

      expect(await mod.smsSender.send('+447700900123', 'hello', 'booking_confirmed')).toEqual({
        id: null,
        error: 'country_not_allowed',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('checks the number that receives the text, so a +91 TWILIO_TEST_TO needs 91 listed', async () => {
      process.env = baseEnv({ TWILIO_ALLOWED_COUNTRY_CODES: '1', TWILIO_TEST_TO: '+919824470182' });
      const fetchMock = okFetch();

      const mod = await import('../../src/integrations/sms');
      // A US customer, but the text would land on the +91 test phone.
      const result = await mod.smsSender.send('+12395061324', 'hello', 'booking_confirmed');

      expect(result).toEqual({ id: null, error: 'country_not_allowed' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to boot on a value that is not a list of calling codes', async () => {
      process.env = baseEnv({ TWILIO_ALLOWED_COUNTRY_CODES: 'US' });
      const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as typeof process.exit);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(import('../../src/config/env')).rejects.toThrow('process.exit(1)');
      expect(exit).toHaveBeenCalledWith(1);
      expect(JSON.stringify(consoleError.mock.calls)).toContain('TWILIO_ALLOWED_COUNTRY_CODES');
    });
  });
});
