import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  answerPlatform,
  buildPlatformSystemPrompt,
  detectIntent,
  factsReply,
  matchFaq,
  PLATFORM_FACTS,
  tokenize,
} from '../../src/lib/chat-platform';

/**
 * The marketing-site bot. Pure, so this needs no database, no server and no LLM.
 *
 * The sharp edge here is different from the store bot's: this one talks to a prospective
 * customer about price and availability, so the expensive failure is inventing a plan, a date or
 * a guarantee. Most of what follows pins the honest-refusal behaviour, not the happy path.
 */
describe('platform tokenizer + intents', () => {
  it('maps commercial phrasings onto one concept', () => {
    expect(detectIntent(tokenize('how much does it cost?'))).toBe('pricing');
    expect(detectIntent(tokenize('what are your plans'))).toBe('pricing');
    expect(detectIntent(tokenize('is there a free trial'))).toBe('pricing');
    expect(detectIntent(tokenize('how do I sign up'))).toBe('signup');
    expect(detectIntent(tokenize('can I get started today'))).toBe('signup');
  });

  it('separates product capabilities from each other', () => {
    expect(detectIntent(tokenize('do you handle walk-ins'))).toBe('walkins');
    expect(detectIntent(tokenize('does it send sms reminders'))).toBe('reminders');
    expect(detectIntent(tokenize('can I keep client notes'))).toBe('clients');
    expect(detectIntent(tokenize('can I add multiple stylists'))).toBe('providers');
    expect(detectIntent(tokenize('is there an android app'))).toBe('mobile');
    expect(detectIntent(tokenize('is this good for a tattoo studio'))).toBe('industries');
  });

  it('is empty for greetings', () => {
    expect(tokenize('hi')).toEqual([]);
    expect(tokenize('thanks!')).toEqual([]);
  });
});

describe('matchFaq over the product FAQs', () => {
  it('returns the page FAQ verbatim when the visitor asks its question', () => {
    const m = matchFaq('What is TejoTime?', PLATFORM_FACTS.faqs);
    expect(m?.faq.q).toBe('What is TejoTime?');
    expect(m!.score).toBeGreaterThanOrEqual(0.9);
  });

  it('matches paraphrases', () => {
    expect(matchFaq('can my clients book online?', PLATFORM_FACTS.faqs)?.faq.q).toBe('Can clients book online?');
    expect(matchFaq('can I run it from my phone', PLATFORM_FACTS.faqs)?.faq.q).toBe('Can I run it from my phone?');
  });

  it('returns null rather than a wrong FAQ', () => {
    expect(matchFaq('do you integrate with quickbooks', PLATFORM_FACTS.faqs)).toBeNull();
    expect(matchFaq('zzzz qqqq', PLATFORM_FACTS.faqs)).toBeNull();
  });
});

describe('answerPlatform', () => {
  it('answers "what is TejoTime" from the page FAQ', () => {
    const a = answerPlatform('What is TejoTime?');
    expect(a.mode).toBe('faq_match');
    expect(a.reply).toBe(PLATFORM_FACTS.faqs[0]!.a);
  });

  it('quotes pricing exactly as the pricing section states it, pilot caveat included', () => {
    const a = answerPlatform('how much does it cost?');
    expect(a.mode).toBe('facts');
    expect(a.reply).toContain('Starter — Free during the U.S. pilot');
    expect(a.reply).toContain('Business — Coming soon');
    expect(a.reply).toContain('Multi-location — Contact us');
    expect(a.reply).toContain('No card');
    // The one thing it must never do: put a number on a plan that has no number.
    expect(a.reply).not.toMatch(/\$\s?\d/);
    expect(a.suggestedActions.map((x) => x.type)).toEqual(['pricing', 'pilot']);
  });

  it('never promises self-serve signup while the pilot is on', () => {
    const a = answerPlatform('how do I sign up');
    expect(a.mode).toBe('facts');
    expect(a.reply).toContain('not self-serve yet');
    expect(a.reply).toContain('Request access');
    expect(a.suggestedActions[0]!.type).toBe('pilot');
  });

  it('lists the industries it actually claims', () => {
    const a = answerPlatform('is this suitable for a pet grooming business?');
    expect(a.reply).toContain('pet grooming');
    expect(a.reply).toContain('barbershops');
  });

  it('answers "who is it built for" — the phrasing where every other word is a stopword', () => {
    const a = answerPlatform('who is it built for');
    expect(a.mode).not.toBe('fallback');
    expect(a.reply).toContain('barbershops');
    expect(a.reply).toContain('physical therapy');
  });

  it('explains walk-ins as optional rather than assumed', () => {
    const a = answerPlatform('do you support walk-ins?');
    expect(a.reply.toLowerCase()).toContain('optional');
  });

  it('greets back instead of failing', () => {
    expect(answerPlatform('hi').mode).toBe('facts');
    expect(answerPlatform('hi').reply).toContain('TejoTime');
    expect(answerPlatform('thanks').reply).toContain('welcome');
  });

  it('falls back honestly on anything the page does not state', () => {
    for (const q of [
      'do you integrate with quickbooks',
      'is my data GDPR compliant',
      'what is your uptime SLA',
      'do you have an api',
    ]) {
      const a = answerPlatform(q);
      expect(a.mode, q).toBe('fallback');
      expect(a.reply).toContain('don’t have that one');
      expect(a.suggestedActions.map((x) => x.type)).toEqual(['faq', 'pricing', 'pilot']);
    }
  });

  it('a discount question is answered with the real plans and never an invented discount', () => {
    const a = answerPlatform('can I get a discount for two years upfront?');
    expect(a.reply).not.toMatch(/discount|% off|percent/i);
    expect(a.reply).toContain('Starter — Free during the U.S. pilot');
  });

  it('intents the page cannot answer produce no invented facts', () => {
    expect(factsReply('support')).toBeNull();
    expect(factsReply('data')).toBeNull();
  });

  it('every suggested action is a real landing-page destination', () => {
    const valid = new Set(['pilot', 'pricing', 'product', 'industries', 'demo', 'faq', 'signin']);
    const questions = [
      'what is tejotime', 'how much', 'sign up', 'walk ins', 'reminders', 'client notes',
      'multiple providers', 'phone app', 'which industries', 'show me a demo', 'how long is setup',
      'cancel anytime', 'something unrelated entirely',
    ];
    for (const q of questions) {
      const a = answerPlatform(q);
      expect(a.suggestedActions.length, q).toBeGreaterThan(0);
      expect(a.suggestedActions.length, q).toBeLessThanOrEqual(3);
      for (const act of a.suggestedActions) {
        expect(valid.has(act.type), `${q} → ${act.type}`).toBe(true);
        expect(act.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('actionsFor always returns at least one action for every intent', () => {
    const intents = [
      'whatis', 'pricing', 'signup', 'features', 'booking', 'walkins', 'reminders', 'clients',
      'mobile', 'industries', 'providers', 'cancel', 'demo', 'support', 'data', 'setup', null,
    ] as const;
    for (const i of intents) expect(actionsFor(i as never).length, String(i)).toBeGreaterThan(0);
  });
});

describe('buildPlatformSystemPrompt', () => {
  it('carries the facts and the no-invention rules', () => {
    const p = buildPlatformSystemPrompt();
    expect(p).toContain('marketing website of TejoTime');
    expect(p).toContain('business owner who is evaluating it');
    expect(p).toContain('Never invent or guess prices, plans, launch dates');
    expect(p).toContain('Never claim to have created an account');
    expect(p).toContain('Starter: Free during the U.S. pilot');
    expect(p).toContain('Q: Can I cancel?');
  });
});
