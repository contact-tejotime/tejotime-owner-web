import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The provider seam's contract is "never throw, null on any failure, key only in a header".
 * `fetch` is stubbed, so this runs with no network and no real key.
 */
describe('chatProvider', () => {
  const originalEnv = { ...process.env };

  const baseEnv = {
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
  };

  function setEnv(extra: Record<string, string>) {
    vi.resetModules();
    process.env = { ...originalEnv, ...baseEnv, ...extra };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const input = {
    system: 'You are the help assistant on the online booking page of "Sharp Cuts".',
    history: [
      { role: 'assistant' as const, content: 'welcome (must be dropped: a conversation starts with the user)' },
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'Hello! Ask me about hours.' },
    ],
    message: 'Are you open on Sunday?',
  };

  it('provider none: null, and no network call', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'none' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { chatProvider } = await import('../../src/integrations/chatbot');
    expect(chatProvider.configured).toBe(false);
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a provider without a key is not configured', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'gemini', CHATBOT_API_KEY: '' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { chatProvider } = await import('../../src/integrations/chatbot');
    expect(chatProvider.configured).toBe(false);
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the master flag off wins over a fully configured provider', async () => {
    setEnv({ CHATBOT_ENABLED: 'false', CHATBOT_PROVIDER: 'groq', CHATBOT_API_KEY: 'gsk_test' });
    const { chatProvider } = await import('../../src/integrations/chatbot');
    expect(chatProvider.configured).toBe(false);
  });

  it('gemini: request shape, key in a header, model default, alternating history', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'gemini', CHATBOT_API_KEY: 'AIza-test' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'We are ' }, { text: 'closed on Sundays.' }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { chatProvider, chatModel } = await import('../../src/integrations/chatbot');
    expect(chatProvider.configured).toBe(true);
    expect(chatModel()).toBe('gemini-2.5-flash-lite');

    const out = await chatProvider.complete(input);
    expect(out).toEqual({ text: 'We are closed on Sundays.' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    );
    expect(String(url)).not.toContain('AIza-test');
    expect(init.headers['x-goog-api-key']).toBe('AIza-test');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe(input.system);
    expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[2].parts[0].text).toBe(input.message);
    expect(body.generationConfig.maxOutputTokens).toBe(300);
  });

  it('groq: OpenAI-style wire format with a Bearer key and the free llama default', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'groq', CHATBOT_API_KEY: 'gsk_test' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: '  Closed on Sundays.  ' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { chatProvider } = await import('../../src/integrations/chatbot');
    expect(await chatProvider.complete(input)).toEqual({ text: 'Closed on Sundays.' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('llama-3.1-8b-instant');
    expect(body.messages[0]).toEqual({ role: 'system', content: input.system });
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: input.message });
    expect(body.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('openai is accepted only when explicitly chosen, and honours CHATBOT_MODEL', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'openai', CHATBOT_API_KEY: 'sk-test', CHATBOT_MODEL: 'gpt-4.1-nano' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { chatProvider } = await import('../../src/integrations/chatbot');
    await chatProvider.complete(input);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('gpt-4.1-nano');
  });

  it('a 429 from a free tier is null, not an exception', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'gemini', CHATBOT_API_KEY: 'AIza-test' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) }),
    );
    const { chatProvider } = await import('../../src/integrations/chatbot');
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });
  });

  it('a network failure or timeout is null, not an exception', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'groq', CHATBOT_API_KEY: 'gsk_test' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const { chatProvider } = await import('../../src/integrations/chatbot');
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });
  });

  it('an empty or malformed body is null', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'gemini', CHATBOT_API_KEY: 'AIza-test' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [] }) }));
    const { chatProvider } = await import('../../src/integrations/chatbot');
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }));
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });
  });

  it('a blocked prompt is null', async () => {
    setEnv({ CHATBOT_ENABLED: 'true', CHATBOT_PROVIDER: 'gemini', CHATBOT_API_KEY: 'AIza-test' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }),
    );
    const { chatProvider } = await import('../../src/integrations/chatbot');
    await expect(chatProvider.complete(input)).resolves.toEqual({ text: null });
  });
});
