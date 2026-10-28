import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The WhatsApp seam (integrations/whatsapp.ts, docs/whatsapp-india.md): what reaches Meta's Graph
 * API, and — like SMS_ENABLED — that nothing does while WHATSAPP_ENABLED is off. `fetch` is
 * stubbed; no network.
 */
describe('whatsappSender', () => {
  const originalEnv = { ...process.env };

  function baseEnv(overrides: Record<string, string> = {}) {
    return {
      ...originalEnv,
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
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token',
      WHATSAPP_PHONE_NUMBER_ID: '106540352242922',
      // Explicitly set: dotenv fills any key that is ABSENT from backend/.env.
      WHATSAPP_API_BASE_URL: 'https://graph.facebook.com',
      WHATSAPP_API_VERSION: 'v23.0',
      WHATSAPP_TEMPLATE_LANGUAGE: 'en',
      WHATSAPP_TEMPLATE_BOOKING_CONFIRMED: 'booking_confirmed',
      WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER: 'appointment_reminder',
      WHATSAPP_TEMPLATE_REVIEW_REQUEST: 'review_request',
      WHATSAPP_COUNTRY_CODES: '91',
      WHATSAPP_TEST_TO: '',
      ...overrides,
    };
  }

  const okFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.HBgM-test' }] }),
    });

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = baseEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the approved template with its variables to the Graph API', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    const result = await whatsappSender.send('+919824470182', 'booking_confirmed', [
      'Darshil',
      'Sharp Cuts',
      'Oct 6',
      '6:22 AM',
      'https://www.tejotime.com/919399385943',
    ]);

    expect(result).toEqual({ id: 'wamid.HBgM-test' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/106540352242922/messages');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer EAAG-test-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Digits only — Meta does not take the "+".
      to: '919824470182',
      type: 'template',
      template: {
        name: 'booking_confirmed',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Darshil' },
              { type: 'text', text: 'Sharp Cuts' },
              { type: 'text', text: 'Oct 6' },
              { type: 'text', text: '6:22 AM' },
              { type: 'text', text: 'https://www.tejotime.com/919399385943' },
            ],
          },
        ],
      },
    });
  });

  it('uses the template names and language set in the environment', async () => {
    process.env = baseEnv({ WHATSAPP_TEMPLATE_REVIEW_REQUEST: 'tejotime_review_v2', WHATSAPP_TEMPLATE_LANGUAGE: 'en_US' });
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    await whatsappSender.send('+919824470182', 'review_request', ['Sharp Cuts', 'Darshil', 'https://x.test/r']);

    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.template.name).toBe('tejotime_review_v2');
    expect(sent.template.language).toEqual({ code: 'en_US' });
  });

  it('a blank template setting falls back to the default rather than stopping boot', async () => {
    process.env = baseEnv({ WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER: '', WHATSAPP_API_VERSION: '' });
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    await whatsappSender.send('+919824470182', 'appointment_reminder', ['Darshil', 'Sharp Cuts', 'MG Road']);

    expect(fetchMock.mock.calls[0][0]).toContain('/v23.0/');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).template.name).toBe('appointment_reminder');
  });

  it('sends to WHATSAPP_TEST_TO instead of the customer when it is set', async () => {
    process.env = baseEnv({ WHATSAPP_TEST_TO: '+911111111111' });
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).to).toBe('911111111111');
  });

  describe('WHATSAPP_ENABLED (works like SMS_ENABLED)', () => {
    it('off: Meta is never called and nothing is reported sent', async () => {
      process.env = baseEnv({ WHATSAPP_ENABLED: 'false' });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock as typeof fetch);

      const { whatsappSender } = await import('../../src/integrations/whatsapp');
      const result = await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

      expect(result).toEqual({ id: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('unset: defaults to off', async () => {
      const env = baseEnv();
      delete (env as Record<string, string | undefined>).WHATSAPP_ENABLED;
      // dotenv would otherwise fill the key from backend/.env; point it at a file that is not there.
      process.env = { ...env, DOTENV_CONFIG_PATH: '__no_such_env_file__' };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock as typeof fetch);

      const { env: parsed } = await import('../../src/config/env');
      const { whatsappSender } = await import('../../src/integrations/whatsapp');
      const result = await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

      expect(parsed.WHATSAPP_ENABLED).toBe(false);
      expect(result).toEqual({ id: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('on but with a blank token or phone number id: nothing is sent', async () => {
      for (const blank of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) {
        vi.resetModules();
        process.env = baseEnv({ [blank]: '' });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock as typeof fetch);

        const { whatsappSender } = await import('../../src/integrations/whatsapp');
        const result = await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

        expect(result).toEqual({ id: null });
        expect(fetchMock).not.toHaveBeenCalled();
      }
    });
  });

  it("names Meta's error code when the Graph API refuses the message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 132001, message: '(#132001) Template name does not exist in the translation' } }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    const result = await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

    expect(result).toEqual({ id: null, error: 'meta_132001' });
  });

  it('returns no id when the request itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')) as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    const result = await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

    expect(result).toEqual({ id: null });
  });

  it('refuses a message with no approved template', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { whatsappSender } = await import('../../src/integrations/whatsapp');
    const result = await whatsappSender.send('+919824470182', 'your_turn', ['a']);

    expect(result).toEqual({ id: null, error: 'unknown_template' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('country allow-list (WHATSAPP_COUNTRY_CODES)', () => {
    it('is India when left blank: a +1 number is never sent to Meta', async () => {
      process.env = baseEnv({ WHATSAPP_COUNTRY_CODES: '' });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock as typeof fetch);

      const { whatsappSender } = await import('../../src/integrations/whatsapp');
      expect(await whatsappSender.send('+12399385943', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e'])).toEqual({
        id: null,
        error: 'country_not_allowed',
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e'])).toEqual({
        id: 'wamid.HBgM-test',
      });
    });

    it('checks the number that receives it, so a WHATSAPP_TEST_TO abroad is refused', async () => {
      process.env = baseEnv({ WHATSAPP_TEST_TO: '+12399385943' });
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock as typeof fetch);

      const { whatsappSender } = await import('../../src/integrations/whatsapp');
      const result = await whatsappSender.send('+919824470182', 'booking_confirmed', ['a', 'b', 'c', 'd', 'e']);

      expect(result).toEqual({ id: null, error: 'country_not_allowed' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to boot on a value that is not a list of calling codes', async () => {
      process.env = baseEnv({ WHATSAPP_COUNTRY_CODES: 'IN' });
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as never);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(import('../../src/config/env')).rejects.toThrow('process.exit(1)');
    });
  });
});
