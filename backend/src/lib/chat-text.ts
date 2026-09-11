/**
 * The text machinery both chatbots share: normalise → tokenise → score an FAQ → pick an intent.
 *
 * Pure (no env, no database, no fetch) and deliberately free of any vocabulary of its own. The
 * *words* live with the bot that owns them — a store cares about "timings" and "walk-ins", the
 * marketing site cares about "pricing" and "reminders" — so each caller builds a matcher with
 * its own concept map via `createMatcher`. That keeps one implementation of the ranking, which
 * is the part that is easy to get subtly wrong, without forcing one shared dictionary that would
 * make every question look a little like every other.
 *
 * See chat-faq.ts (store bot) and chat-platform.ts (marketing bot) for the two vocabularies.
 */

export interface Faq {
  q: string;
  a: string;
}

export interface FaqMatch<I extends string = string> {
  index: number;
  faq: Faq;
  /** 0..1 — see `scoreFaq`. */
  score: number;
  /** Present only so callers can re-use the match's own topic; filled by the caller. */
  intent?: I | null;
}

/** Below this the best FAQ is not offered — a wrong FAQ is worse than an honest "don't know". */
export const FAQ_MIN_SCORE = 0.5;

/**
 * Words that carry no topic on their own. Question words are here deliberately: "how", "what"
 * and "when" appear in almost every FAQ question, so keeping them would make every FAQ look a
 * little like every query. "where" is NOT here — it is the whole of "where are you?".
 */
export const STOPWORDS = new Set(
  `a an the is are am was were be been being do does did done i im me my mine we our us you your
   yours it its this that these those there here what whats which who whom when why how can could
   would should will shall may might have has had having get got gets need needs want wants
   please pls plz hi hello hey thanks thank ok okay to of in on at for with from by about and or
   but if so than then any some also just yes no not dont doesnt didnt cant wont isnt arent u ur r
   available availability possible able know tell like much many long today tonight tomorrow now
   guys shop store salon place still their they them one ones something anything everything
   really very`.split(/\s+/),
);

/** Lower-case, no punctuation, one space between words. Letters in any script are kept. */
export function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/₹/g, ' rupees ')
    .replace(/[-–—_/\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    // "walk-in" / "walk ins" is one word to a customer; keep it one token ("ins" is noise).
    .replace(/\bwalk ins?\b/g, 'walkin')
    .trim();
}

/** Crude but sufficient: plurals and -ing/-ed forms of ordinary words meet their base form. */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export interface Matcher<I extends string> {
  /** Canonical, de-duplicated topic tokens, stopwords removed. Empty for "hi" or "??". */
  tokenize(text: string): string[];
  /** 0..1 confidence that `faq` answers `message`. */
  scoreFaq(message: string, faq: Faq): number;
  /** The best FAQ at or above `minScore`, or null. Empty `faqs` is simply null. */
  matchFaq(message: string, faqs: Faq[], minScore?: number): FaqMatch<I> | null;
  /** The highest-priority concept present in `tokens`, or null. */
  detectIntent(tokens: string[]): I | null;
  /** True when `word` is one of this vocabulary's concept words (used to spot proper nouns). */
  isConceptWord(word: string): boolean;
}

/**
 * Build a matcher over one vocabulary.
 *
 * `concepts` maps a canonical intent to every surface form that means it. `priority` decides the
 * winner when a message carries several at once — put the more specific ask first, because it is
 * usually the one the customer actually means ("are you open for walk-ins" is a walk-in
 * question, not an hours question).
 */
export function createMatcher<I extends string>(
  concepts: Record<I, string[]>,
  priority: I[],
): Matcher<I> {
  const canonical = new Map<string, I>();
  for (const [concept, words] of Object.entries(concepts) as [I, string[]][]) {
    for (const w of words) canonical.set(w, concept);
  }

  const canon = (word: string): string => canonical.get(word) ?? canonical.get(stem(word)) ?? stem(word);

  function tokenize(text: string): string[] {
    const out: string[] = [];
    for (const raw of normalize(text).split(' ')) {
      if (raw.length < 2 || STOPWORDS.has(raw)) continue;
      const c = canon(raw);
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  /**
   * Mostly *coverage* — how much of what the person asked the FAQ's question explains — with a
   * little *precision* so a short, on-topic FAQ question outranks a long one that merely
   * mentions the word. Tokens found only in the answer count half: an answer that says "during
   * opening hours" is weaker evidence than a question that asks about them. A literal
   * containment either way is treated as near-certain.
   */
  function scoreFaq(message: string, faq: Faq): number {
    const q = tokenize(message);
    if (q.length === 0) return 0;
    const fq = tokenize(faq.q);
    const fa = tokenize(faq.a);
    let hitQ = 0;
    let hitA = 0;
    for (const tk of q) {
      if (fq.includes(tk)) hitQ += 1;
      else if (fa.includes(tk)) hitA += 1;
    }
    const coverage = (hitQ + 0.5 * hitA) / q.length;
    const precision = fq.length ? hitQ / fq.length : 0;
    let score = 0.75 * coverage + 0.25 * precision;

    const nm = normalize(message);
    const nq = normalize(faq.q);
    if (nm.length >= 4 && nq.length >= 4 && (nq.includes(nm) || nm.includes(nq))) {
      score = Math.max(score, 0.95);
    }
    return Math.min(1, score);
  }

  function matchFaq(message: string, faqs: Faq[], minScore = FAQ_MIN_SCORE): FaqMatch<I> | null {
    let best: FaqMatch<I> | null = null;
    faqs.forEach((faq, index) => {
      if (!faq || typeof faq.q !== 'string' || typeof faq.a !== 'string') return;
      const score = scoreFaq(message, faq);
      if (score >= minScore && (!best || score > best.score)) best = { index, faq, score };
    });
    return best;
  }

  function detectIntent(tokens: string[]): I | null {
    const set = new Set(tokens);
    for (const intent of priority) if (set.has(intent)) return intent;
    return null;
  }

  const isConceptWord = (word: string): boolean => canonical.has(word) || canonical.has(stem(word));

  return { tokenize, scoreFaq, matchFaq, detectIntent, isConceptWord };
}

/** "a, b and c" — the shared list join both bots print. */
export function joinList(items: string[], last = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

export const GREETING_RE =
  /^(hi+|hello|hey+|hiya|yo|hola|namaste|namaskar|good (morning|afternoon|evening|day)|ok|okay|thanks|thank you|thankyou|thx|ty|bye|goodbye)( there| you| so much| a lot)?$/;

export const THANKS_RE = /^(thanks|thank you|thankyou|thx|ty|bye|goodbye|ok|okay)/;
