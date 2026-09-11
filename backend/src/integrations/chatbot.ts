import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Layer B of the microsite chatbot — the optional LLM behind a seam.
 *
 * Same shape as the other integrations: an interface, a flag-gated implementation, and a
 * deferred no-op when nothing is configured. Two rules the callers rely on:
 *
 *  - `complete()` NEVER throws and never rejects. Any failure — no key, a 429 from a free tier,
 *    a timeout, a malformed body — resolves to `{ text: null }`, and the chat service falls back
 *    to the key-free FAQ answer. A customer must never see a 500 because a free model hiccuped.
 *  - The key stays here. It travels in a header (never a query string, which pino would log
 *    with the URL), and is never echoed in a log line or a response.
 *
 * Providers are picked by CHATBOT_PROVIDER. Gemini and Groq both have free tiers and are the
 * intended choices; OpenAI is the same wire shape as Groq, so it is accepted, but it is a paid
 * key and never the default.
 */
export type ChatProviderName = 'none' | 'gemini' | 'groq' | 'openai';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionInput {
  system: string;
  /** Oldest first. Already trimmed to CHATBOT_MAX_HISTORY by the caller. */
  history: ChatTurn[];
  message: string;
}

export interface ChatProvider {
  readonly name: ChatProviderName;
  /** True when a call is actually possible: flag on, a provider chosen, a key present. */
  readonly configured: boolean;
  complete(input: ChatCompletionInput): Promise<{ text: string | null }>;
}

/**
 * Free-tier defaults. Model catalogues move; CHATBOT_MODEL overrides these without a deploy of
 * code, so a retired name is an env change, not a hotfix.
 */
export const DEFAULT_CHAT_MODELS: Record<Exclude<ChatProviderName, 'none'>, string> = {
  gemini: 'gemini-2.5-flash-lite',
  groq: 'llama-3.1-8b-instant',
  openai: 'gpt-4o-mini',
};

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';

/** The prompt asks for ≤80 words; this is the hard stop for a model that ignores it. */
const MAX_OUTPUT_TOKENS = 300;
const MAX_REPLY_CHARS = 1_500;

export function chatModel(provider: ChatProviderName = env.CHATBOT_PROVIDER): string {
  if (provider === 'none') return '';
  return env.CHATBOT_MODEL || DEFAULT_CHAT_MODELS[provider];
}

function cleanReply(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  return text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS - 1)}…` : text;
}

/**
 * Gemini wants a conversation that starts with the user and alternates; the client is trusted
 * for shape only, so leading assistant turns are dropped and same-role neighbours merged.
 * Harmless for the OpenAI-style APIs, so applied uniformly.
 */
function tidyHistory(history: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const turn of history) {
    if (!out.length && turn.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n${turn.content}`;
    else out.push({ role: turn.role, content: turn.content });
  }
  // The new message is a user turn, so the history must not end on one.
  if (out.length && out[out.length - 1]!.role === 'user') out.pop();
  return out;
}

async function postJson(
  provider: ChatProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<any | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.CHATBOT_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err, provider }, 'chatbot provider request threw (timeout or network)');
    return null;
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    logger.warn(
      { status: res.status, provider, error: json?.error?.message ?? json?.error ?? null },
      res.status === 429 ? 'chatbot provider rate-limited — falling back to FAQ answer' : 'chatbot provider error',
    );
    return null;
  }
  return json;
}

async function gemini(input: ChatCompletionInput): Promise<string | null> {
  const model = chatModel('gemini');
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const contents = [
    ...tidyHistory(input.history).map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })),
    { role: 'user', parts: [{ text: input.message }] },
  ];
  const json = await postJson('gemini', url, { 'x-goog-api-key': env.CHATBOT_API_KEY }, {
    systemInstruction: { parts: [{ text: input.system }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
  });
  if (!json) return null;
  if (json.promptFeedback?.blockReason) {
    logger.warn({ provider: 'gemini', blockReason: json.promptFeedback.blockReason }, 'chatbot prompt blocked');
    return null;
  }
  const parts = json.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('') : null;
}

/** Groq and OpenAI share the chat-completions wire format. */
async function openaiCompatible(
  provider: 'groq' | 'openai',
  base: string,
  input: ChatCompletionInput,
): Promise<string | null> {
  const messages = [
    { role: 'system', content: input.system },
    ...tidyHistory(input.history),
    { role: 'user', content: input.message },
  ];
  const json = await postJson(provider, `${base}/chat/completions`, { authorization: `Bearer ${env.CHATBOT_API_KEY}` }, {
    model: chatModel(provider),
    messages,
    temperature: 0.2,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  });
  const content = json?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

const configured =
  env.CHATBOT_ENABLED && env.CHATBOT_PROVIDER !== 'none' && env.CHATBOT_API_KEY.trim().length > 0;

if (env.CHATBOT_ENABLED && env.CHATBOT_PROVIDER !== 'none' && !configured) {
  logger.warn(
    { provider: env.CHATBOT_PROVIDER },
    'CHATBOT_PROVIDER is set but CHATBOT_API_KEY is blank — the chatbot will answer from FAQs only',
  );
}

export const chatProvider: ChatProvider = {
  name: env.CHATBOT_PROVIDER,
  configured,

  async complete(input) {
    if (!configured) {
      logger.debug({ provider: env.CHATBOT_PROVIDER }, '[chatbot deferred] no provider configured');
      return { text: null };
    }
    try {
      let raw: string | null = null;
      switch (env.CHATBOT_PROVIDER) {
        case 'gemini':
          raw = await gemini(input);
          break;
        case 'groq':
          raw = await openaiCompatible('groq', GROQ_BASE, input);
          break;
        case 'openai':
          raw = await openaiCompatible('openai', OPENAI_BASE, input);
          break;
        default:
          raw = null;
      }
      return { text: cleanReply(raw) };
    } catch (err) {
      // Belt and braces: postJson already swallows, but a parsing surprise must not escape either.
      logger.error({ err, provider: env.CHATBOT_PROVIDER }, 'chatbot provider threw unexpectedly');
      return { text: null };
    }
  },
};
