import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  answerLocally,
  buildSystemPrompt,
  detectIntent,
  matchFaq,
  normalize,
  scoreFaq,
  tokenize,
  type StoreFacts,
} from '../../src/lib/chat-faq';

/**
 * Layer A is what every customer gets when no LLM key is configured — and what every customer
 * gets the moment a free tier says 429. Pure, so pinned here without a database or a network.
 */

const FAQS = [
  { q: 'What are your opening hours?', a: 'We are open 10:00 AM to 8:00 PM, Monday to Saturday.' },
  { q: 'Do you take walk-ins?', a: 'Yes — walk in any time we are open and take a token at the door.' },
  { q: 'What payment methods do you accept?', a: 'UPI, cards and cash.' },
  { q: 'Is parking available?', a: 'Yes, there is free parking behind the building.' },
];

function facts(over: Partial<StoreFacts> = {}): StoreFacts {
  return {
    name: 'Sharp Cuts',
    category: 'Salon & Barber',
    hasHours: true,
    isOpen: true,
    statusLabel: 'Open now · till 8:00 PM',
    hoursLines: [
      'Sunday: Closed',
      'Monday: 10:00 AM – 8:00 PM',
      'Tuesday: 10:00 AM – 8:00 PM',
      'Wednesday: 10:00 AM – 8:00 PM',
      'Thursday: 10:00 AM – 8:00 PM',
      'Friday: 10:00 AM – 8:00 PM',
      'Saturday: 10:00 AM – 8:00 PM',
    ],
    address: 'Shop 4, Linking Road, Bandra West',
    phone: '+919399385943',
    payments: ['UPI', 'Card', 'Cash'],
    services: [
      { name: 'Haircut', priceLabel: '₹350', minutes: 30 },
      { name: 'Beard Trim', priceLabel: '₹150', minutes: 15 },
      { name: 'Hair Extensions', priceLabel: '₹2,000–₹6,000', minutes: 90 },
    ],
    staff: [
      { name: 'John', roleLabel: 'Master barber' },
      { name: 'Lisa', roleLabel: 'Stylist' },
    ],
    live: { waitMinutes: 25, queueCount: 3 },
    faqs: FAQS,
    ...over,
  };
}

describe('tokenize', () => {
  it('maps surface forms onto one concept and drops stopwords', () => {
    expect(tokenize('Walk-ins?')).toEqual(['walkin']);
    expect(tokenize('What are your timings?')).toEqual(['hours']);
    expect(tokenize('when do you close on sundays')).toEqual(['hours']);
    expect(tokenize('How much does a haircut cost?')).toEqual(['haircut', 'price']);
  });

  it('is empty for greetings and punctuation', () => {
    expect(tokenize('hi')).toEqual([]);
    expect(tokenize('???')).toEqual([]);
    expect(normalize("What's up?!")).toBe('whats up');
  });
});

describe('matchFaq', () => {
  it('returns the FAQ when the customer asks its question almost verbatim', () => {
    const m = matchFaq('what are your opening hours', FAQS);
    expect(m?.index).toBe(0);
    expect(m!.score).toBeGreaterThanOrEqual(0.9);
  });

  it('matches a paraphrase through the synonym table', () => {
    expect(matchFaq('do you accept cards?', FAQS)?.index).toBe(2);
    expect(matchFaq('can i just walk in', FAQS)?.index).toBe(1);
    expect(matchFaq('is there parking nearby', FAQS)?.index).toBe(3);
  });

  it('returns null rather than a wrong FAQ when nothing fits', () => {
    expect(matchFaq('do you sell gift vouchers', FAQS)).toBeNull();
    expect(matchFaq('qwerty zxcvb', FAQS)).toBeNull();
  });

  it('handles empty inputs', () => {
    expect(matchFaq('opening hours', [])).toBeNull();
    expect(matchFaq('', FAQS)).toBeNull();
    expect(matchFaq('   ', FAQS)).toBeNull();
    // Malformed jsonb rows are skipped, not thrown on.
    expect(matchFaq('opening hours', [null as any, { q: 5, a: 'x' } as any, ...FAQS])?.faq.q).toBe(FAQS[0]!.q);
  });

  it('ranks the FAQ whose question is about the topic above one that merely mentions it', () => {
    const mentions = { q: 'Do you take walk-ins?', a: 'Yes, during our opening hours.' };
    const about = { q: 'What are your opening hours?', a: '10 to 8.' };
    expect(scoreFaq('opening hours?', about)).toBeGreaterThan(scoreFaq('opening hours?', mentions));
    expect(matchFaq('opening hours?', [mentions, about])?.faq).toBe(about);
  });
});

describe('detectIntent', () => {
  it('prefers the specific ask over the generic one it travels with', () => {
    expect(detectIntent(tokenize('are you open for walk-ins today'))).toBe('walkin');
    expect(detectIntent(tokenize('how long is the wait'))).toBe('waitlist');
    expect(detectIntent(tokenize('where are you located'))).toBe('location');
  });

  it('treats a bare service or team-member name as a question about it', () => {
    expect(detectIntent(tokenize('haircut?'), facts())).toBe('services');
    expect(detectIntent(tokenize('is Lisa in today'), facts())).toBe('staff');
    expect(detectIntent(tokenize('haircut?'))).toBeNull();
  });
});

describe('answerLocally', () => {
  it('returns an owner FAQ verbatim as faq_match', () => {
    const a = answerLocally('What are your opening hours?', facts());
    expect(a.mode).toBe('faq_match');
    expect(a.reply).toBe(FAQS[0]!.a);
    expect(a.score).toBeGreaterThanOrEqual(0.9);
  });

  it('answers hours from the store facts when no FAQ covers them', () => {
    const a = answerLocally('Hours?', facts({ faqs: [] }));
    expect(a.mode).toBe('facts');
    expect(a.reply).toContain('Monday: 10:00 AM – 8:00 PM');
    expect(a.reply).toContain('Open now');
    expect(a.suggestedActions.map((x) => x.type)).toEqual(['join', 'book']);
  });

  it('walk-ins while closed: says so, and never offers Join', () => {
    const closed = facts({ faqs: [], isOpen: false, statusLabel: 'Closed · Opens tomorrow at 10:00 AM' });
    const a = answerLocally('Walk-ins?', closed);
    expect(a.mode).toBe('facts');
    expect(a.reply).toContain('closed right now');
    expect(a.reply).toContain('Opens tomorrow at 10:00 AM');
    expect(a.suggestedActions.some((x) => x.type === 'join')).toBe(false);
    expect(a.suggestedActions[0]!.type).toBe('book');
  });

  it('walk-ins while open: live wait plus the Join action', () => {
    const a = answerLocally('Walk-ins?', facts({ faqs: [] }));
    expect(a.reply).toContain('3 people are waiting right now, about 25 min wait');
    expect(a.suggestedActions[0]!.type).toBe('join');
  });

  it('a store with no hours configured is "unknown", not closed', () => {
    const a = answerLocally('can I walk in', facts({ faqs: [], hasHours: false, isOpen: false, hoursLines: [] }));
    expect(a.mode).toBe('facts');
    expect(a.reply).not.toContain('closed');
    expect(a.suggestedActions[0]!.type).toBe('join');
    // …and an hours question is honestly a fallback rather than an invented schedule.
    expect(answerLocally('what are your hours', facts({ faqs: [], hasHours: false, hoursLines: [] })).mode).toBe('fallback');
  });

  it('explains the waitlist and offers Join + Track', () => {
    const a = answerLocally('How does waitlist work?', facts({ faqs: [] }));
    expect(a.mode).toBe('facts');
    expect(a.reply).toContain('Join the Waitlist');
    expect(a.reply).toContain('token');
    expect(a.suggestedActions.map((x) => x.type)).toEqual(['join', 'track']);
  });

  it('quotes a named service exactly as the page prices it', () => {
    const a = answerLocally('how much is a haircut', facts({ faqs: [] }));
    expect(a.mode).toBe('facts');
    expect(a.reply).toBe('• Haircut — ₹350 · 30 min');
    const range = answerLocally('hair extensions price', facts({ faqs: [] }));
    expect(range.reply).toContain('₹2,000–₹6,000');
  });

  it('lists services when asked generally, capped', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Service ${i + 1}`, priceLabel: '₹100', minutes: 10 }));
    const a = answerLocally('what services do you offer', facts({ faqs: [], services: many }));
    expect(a.reply).toContain('Sharp Cuts services:');
    expect(a.reply).toContain('…and 4 more on this page.');
  });

  it('falls back politely and points at the page buttons', () => {
    const a = answerLocally('do you sell gift vouchers', facts());
    expect(a.mode).toBe('fallback');
    expect(a.reply).toContain("couldn't find that");
    expect(a.reply).toContain('FAQ on this page');
    expect(a.reply).toContain('Join the Waitlist, Book an Appointment or Call');
    expect(a.suggestedActions.map((x) => x.type)).toEqual(['faq', 'join', 'call']);
  });

  it('fallback adapts to what the store actually has', () => {
    const bare = facts({ faqs: [], phone: null, isOpen: false, statusLabel: 'Closed today' });
    const a = answerLocally('do you sell gift vouchers', bare);
    expect(a.reply).not.toContain('FAQ');
    expect(a.reply).toContain('Book an Appointment buttons');
    expect(a.suggestedActions).toEqual([{ type: 'book', label: 'Book an Appointment' }]);
  });

  it('greets back instead of failing on "hi"', () => {
    const a = answerLocally('hi', facts());
    expect(a.mode).toBe('facts');
    expect(a.reply).toContain('Sharp Cuts');
    expect(answerLocally('thanks!', facts()).reply).toContain("You're welcome");
  });

  it('a policy the page does not state is a fallback, not a guess', () => {
    expect(answerLocally('can I cancel my booking', facts({ faqs: [] })).mode).toBe('fallback');
    expect(answerLocally('do you cut kids hair', facts({ faqs: [] })).mode).toBe('fallback');
  });
});

describe('actionsFor', () => {
  it('never offers what the store cannot do', () => {
    const none = facts({ phone: null, faqs: [], isOpen: false });
    for (const intent of ['pay', 'location', 'contact', 'hours', 'walkin', null] as const) {
      const types = actionsFor(intent, none).map((x) => x.type);
      expect(types.length).toBeGreaterThan(0);
      expect(types.length).toBeLessThanOrEqual(3);
      expect(types).not.toContain('call');
      expect(types).not.toContain('faq');
      expect(types).not.toContain('join');
    }
  });
});

describe('buildSystemPrompt', () => {
  it('carries every fact and the grounding rules', () => {
    const p = buildSystemPrompt(facts());
    expect(p).toContain('"Sharp Cuts"');
    expect(p).toContain('Never invent or guess prices, hours, services');
    expect(p).toContain('Never claim to have booked, joined, cancelled');
    expect(p).toContain('Monday: 10:00 AM – 8:00 PM');
    expect(p).toContain('- Haircut: ₹350, 30 min');
    expect(p).toContain('Q: What are your opening hours?');
    expect(p).toContain('Team: John (Master barber), Lisa (Stylist)');
    expect(p).toContain('3 people are waiting right now');
  });

  it('says hours are not listed rather than implying closed', () => {
    const p = buildSystemPrompt(facts({ hasHours: false, hoursLines: [], isOpen: false, statusLabel: 'Closed today' }));
    expect(p).toContain('hours not listed on the page');
    expect(p).not.toContain('Closed today');
  });
});
