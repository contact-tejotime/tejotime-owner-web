import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../domain/errors';
import { chatProvider, type ChatTurn } from '../../integrations/chatbot';
import {
  answerPlatform,
  buildPlatformSystemPrompt,
  type PlatformReply,
} from '../../lib/chat-platform';
import {
  answerLocally,
  buildSystemPrompt,
  type ChatReply,
  type Faq,
  type StoreFacts,
} from '../../lib/chat-faq';
import { getMicrositeByKey, type MicrositeDTO } from './public.service';

/**
 * The customer microsite chatbot (docs/customer-chatbot-v1.md).
 *
 * Read-only by construction: this module imports nothing that can write — no `callRpc`, no
 * `exec`, no queue or appointment service. It answers questions; the page's own buttons take
 * actions. Stateless too: the client sends back the last few turns, and nothing is stored.
 *
 * Answer order:
 *   1. a confident FAQ match is returned verbatim — the owner's own words, and no quota spent;
 *   2. otherwise the configured provider (if any) answers, grounded on the same facts;
 *   3. otherwise — provider absent, down, rate-limited or empty — the local answer.
 */

export interface ChatBody {
  message: string;
  sessionId: string;
  history?: ChatTurn[];
}

/**
 * At or above this an FAQ is handed back as written rather than paraphrased by a model. A
 * literal containment scores 0.95, so this is "the customer asked the FAQ's question".
 */
const STRONG_FAQ_SCORE = 0.9;

/** A turn sent back by the client can be one of the bot's own longer replies (an hours list). */
const HISTORY_TURN_CHARS = 2_000;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatMoney(amount: number, currency: string): string {
  const units = amount / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: Number.isInteger(units) ? 0 : 2,
    }).format(units);
  } catch {
    return `${currency} ${units}`;
  }
}

/** Same three renderings as the microsite's `priceLabel`, so the bot never quotes a bare 0. */
function priceLabel(s: MicrositeDTO['services'][number]): string {
  const type = s.priceType ?? (s.price.amount > 0 ? 'fixed' : 'unset');
  if (type === 'unset') return 'Price on request';
  const min = formatMoney(s.price.amount, s.price.currency);
  if (type === 'range' && s.priceMax) return `${min}–${formatMoney(s.priceMax.amount, s.priceMax.currency)}`;
  return min;
}

// `business.faqs` is jsonb the owner edits; trust its shape no further than this.
function isFaq(f: unknown): f is Faq {
  const x = f as Partial<Faq> | null;
  return !!x && typeof x.q === 'string' && typeof x.a === 'string' && x.q.trim().length > 0 && x.a.trim().length > 0;
}

/** The public microsite DTO, reduced to what the bot may speak from. */
export function storeFacts(site: MicrositeDTO): StoreFacts {
  const digits = `${site.countryCode ?? ''}${site.phoneNumber ?? ''}`.replace(/\D/g, '');
  return {
    name: site.name,
    category: site.category ?? null,
    hasHours: site.hours.length > 0,
    isOpen: site.openStatus.isOpen,
    statusLabel: site.openStatus.label,
    hoursLines: site.hours.map((h) => `${DAY_NAMES[h.dayOfWeek] ?? `Day ${h.dayOfWeek}`}: ${h.label}`),
    address: [site.address, site.area].filter(Boolean).join(', ') || null,
    phone: digits ? `+${digits}` : null,
    payments: Array.isArray(site.payments) ? site.payments.map(String).filter(Boolean) : [],
    services: site.services.map((s) => ({ name: s.name, priceLabel: priceLabel(s), minutes: s.durationMinutes })),
    staff: site.staff.map((s) => ({ name: s.name, roleLabel: s.roleLabel ?? null })),
    live: { waitMinutes: site.live.waitMinutes, queueCount: site.live.queueCount },
    faqs: (Array.isArray(site.faqs) ? (site.faqs as unknown[]) : []).filter(isFaq),
  };
}

function trimHistory(history: ChatTurn[] | undefined): ChatTurn[] {
  return (history ?? [])
    .slice(-env.CHATBOT_MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.content.slice(0, HISTORY_TURN_CHARS) }));
}

export async function chatWithStore(key: string, body: ChatBody): Promise<ChatReply> {
  // Off means off at the API, not merely a hidden button. 404 rather than 403: to a client this
  // feature does not exist, and the page hides the widget on the same flag.
  if (!env.CHATBOT_ENABLED) {
    throw new AppError(404, 'CHATBOT_DISABLED', 'Chat is not enabled for this store');
  }

  const site = await getMicrositeByKey(key); // 404 for an unknown slug/phone
  const facts = storeFacts(site);
  const local = answerLocally(body.message, facts);

  let reply: ChatReply = { reply: local.reply, mode: local.mode, suggestedActions: local.suggestedActions };

  if (!(local.mode === 'faq_match' && local.score >= STRONG_FAQ_SCORE) && chatProvider.configured) {
    const { text } = await chatProvider.complete({
      system: buildSystemPrompt(facts),
      history: trimHistory(body.history),
      message: body.message,
    });
    if (text) reply = { reply: text, mode: 'llm', suggestedActions: local.suggestedActions };
  }

  // Never the message itself: it is free text from an anonymous customer and may carry a phone
  // number or a name. The mode and intent are what tell us whether the bot is earning its keep.
  logger.info(
    { businessId: site.id, sessionId: body.sessionId, mode: reply.mode, intent: local.intent, provider: chatProvider.name },
    'microsite chat reply',
  );
  return reply;
}

/**
 * The marketing-site bot (tejotime.com/), which has no business context at all.
 *
 * Same two layers and the same escalation discipline as the store bot, but grounded on
 * `PLATFORM_FACTS` — what TejoTime is, who it is for, what it costs, how to get started. It
 * suggests the landing page's own sections and its Request-access CTA; it cannot create an
 * account or start a trial, and the prompt says so.
 */
export async function chatWithPlatform(body: ChatBody): Promise<PlatformReply> {
  if (!env.CHATBOT_ENABLED) {
    throw new AppError(404, 'CHATBOT_DISABLED', 'Chat is not enabled');
  }

  const local = answerPlatform(body.message);
  let reply: PlatformReply = { reply: local.reply, mode: local.mode, suggestedActions: local.suggestedActions };

  if (!(local.mode === 'faq_match' && local.score >= STRONG_FAQ_SCORE) && chatProvider.configured) {
    const { text } = await chatProvider.complete({
      system: buildPlatformSystemPrompt(),
      history: trimHistory(body.history),
      message: body.message,
    });
    if (text) reply = { reply: text, mode: 'llm', suggestedActions: local.suggestedActions };
  }

  // Never the message itself — free text from an anonymous visitor may carry a name or a number.
  logger.info(
    { surface: 'marketing', sessionId: body.sessionId, mode: reply.mode, intent: local.intent, provider: chatProvider.name },
    'marketing chat reply',
  );
  return reply;
}
