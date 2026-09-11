/**
 * Layer A of the microsite chatbot — the key-free answerer.
 *
 * Everything in this file is pure (no env, no database, no fetch), for two reasons. It is what
 * the chat endpoint runs when no LLM provider is configured, when the provider is down, or when
 * a free tier is exhausted — so it has to be dependable on its own. And it is the only part of
 * the bot whose behaviour can be pinned by a unit test without a network.
 *
 * It answers in three ways, tried in this order:
 *   1. an owner-written FAQ whose question reads like the customer's (`matchFaq`);
 *   2. a store fact the page already shows — hours, address, services, team, live wait —
 *      selected by a small intent vocabulary (`detectIntent` + `factsReply`);
 *   3. a polite "I couldn't find that" that points at the page's own buttons.
 *
 * It never invents: every sentence is assembled from `StoreFacts`, which the service builds
 * from the same DTO the microsite renders. The same `StoreFacts` also feeds the LLM system
 * prompt (`buildSystemPrompt`), so both layers are grounded on one context.
 *
 * The ranking itself lives in chat-text.ts and is shared with the marketing-site bot
 * (chat-platform.ts). What stays here is the STORE vocabulary and the store's answers.
 */
import {
  createMatcher,
  FAQ_MIN_SCORE,
  GREETING_RE,
  joinList,
  normalize,
  THANKS_RE,
  type Faq,
  type FaqMatch,
} from './chat-text';

export { FAQ_MIN_SCORE, normalize, type Faq, type FaqMatch };

export type ChatActionType = 'track' | 'book' | 'join' | 'call' | 'faq';
export interface ChatAction {
  type: ChatActionType;
  label: string;
}

/**
 * `faq_match` — an owner-written FAQ, returned verbatim.
 * `facts` — assembled from public store facts (hours, services, address…).
 * `llm` — a configured provider answered, grounded on the same facts.
 * `fallback` — nothing matched; the reply points at the page's buttons.
 */
export type ChatMode = 'faq_match' | 'facts' | 'llm' | 'fallback';

export interface ChatReply {
  reply: string;
  mode: ChatMode;
  suggestedActions: ChatAction[];
}

/**
 * The public facts the bot may speak from. Built by the service from the microsite DTO — the
 * page and the bot can therefore never disagree about a price or an opening time.
 */
export interface StoreFacts {
  name: string;
  category: string | null;
  /** False when the store never configured hours: open/closed is then unknown, not "closed". */
  hasHours: boolean;
  isOpen: boolean;
  /** "Open now · till 8:00 PM" / "Closed · Opens tomorrow at 10:00 AM", as the page prints it. */
  statusLabel: string;
  /** One line per weekday, e.g. "Monday: 10:00 AM – 8:00 PM" or "Sunday: Closed". */
  hoursLines: string[];
  address: string | null;
  /** Display number with a leading "+", or null when the store has none. */
  phone: string | null;
  payments: string[];
  services: { name: string; priceLabel: string; minutes: number }[];
  staff: { name: string; roleLabel: string | null }[];
  live: { waitMinutes: number; queueCount: number };
  faqs: Faq[];
}

export type Intent =
  | 'hours'
  | 'walkin'
  | 'waitlist'
  | 'track'
  | 'book'
  | 'price'
  | 'services'
  | 'pay'
  | 'location'
  | 'contact'
  | 'staff'
  | 'cancel'
  | 'kids'
  | 'parking';

export interface LocalAnswer extends ChatReply {
  mode: Exclude<ChatMode, 'llm'>;
  /** FAQ confidence for `faq_match`; 0 otherwise. The service uses it to skip the LLM. */
  score: number;
  intent: Intent | null;
}

// ---------------------------------------------------------------------------------------------
// Text → tokens
// ---------------------------------------------------------------------------------------------

/**
 * Surface forms → one canonical concept token. Both the customer's message and every FAQ go
 * through this, so "timings", "opening hours" and "when do you close" all meet at `hours`.
 * Indian-English forms ("timings", "rs", "gpay") are included on purpose — this is who asks.
 */
const CONCEPTS: Record<Intent, string[]> = {
  hours: `hour hours timing timings open opens opened opening close closes closed closing shut
    sunday monday tuesday wednesday thursday friday saturday sun mon tue tues wed thu thur thurs
    fri sat weekday weekdays weekend weekends holiday holidays`.split(/\s+/),
  // "walk-in" normalises to "walk in"; "in" is a stopword, so "walk" alone has to carry it.
  walkin: 'walkin walkins walk walking'.split(' '),
  waitlist: `waitlist waitlisted wait waits waiting queue queues line token tokens turn ahead crowd
    crowded busy rush`.split(/\s+/),
  track: 'track tracking status position progress'.split(' '),
  book: `book books booking bookings booked appointment appointments appt appts reserve reserved
    reservation reservations slot slots schedule scheduled scheduling`.split(/\s+/),
  price: `price prices pricing priced cost costs costing rate rates charge charges charged fee fees
    rs rupees inr expensive cheap cheaper affordable budget`.split(/\s+/),
  pay: `pay payment payments paying paid upi gpay phonepe paytm card cards cash credit debit
    netbanking wallet`.split(/\s+/),
  services: `service services offer offers offering menu treatment treatments package packages
    procedure procedures options`.split(/\s+/),
  location: `location located address where direction directions reach near nearby map area
    landmark route`.split(/\s+/),
  contact: 'contact phone call calling number whatsapp email mail'.split(' '),
  staff: `staff barber barbers stylist stylists doctor doctors dr team member members employee
    employees specialist specialists hairdresser hairdressers provider providers therapist
    therapists artist artists`.split(/\s+/),
  cancel: `cancel cancels cancelled canceled cancellation cancelling canceling reschedule
    rescheduled rescheduling refund refunds`.split(/\s+/),
  kids: 'kid kids child children baby babies toddler toddlers'.split(' '),
  parking: 'park parking'.split(' '),
};

/**
 * When several concepts appear at once, the first one here wins. Ordered so the more specific
 * ask beats the generic one it usually travels with: "are you open for walk-ins" is a walk-in
 * question (whose answer states the open status anyway), not an hours question.
 */
const INTENT_PRIORITY: Intent[] = [
  'walkin',
  'track',
  'waitlist',
  // Before `book`: "cancel my booking" is about cancelling, and the page says nothing about
  // that — so it must reach an FAQ or the honest fallback, never the how-to-book blurb.
  'cancel',
  'book',
  'price',
  'services',
  'hours',
  'pay',
  'parking',
  'kids',
  'location',
  'contact',
  'staff',
];


const matcher = createMatcher<Intent>(CONCEPTS, INTENT_PRIORITY);

export const tokenize = matcher.tokenize;
export const scoreFaq = matcher.scoreFaq;
export const matchFaq = matcher.matchFaq;

// ---------------------------------------------------------------------------------------------
// Store-fact answers
// ---------------------------------------------------------------------------------------------

/** Name tokens that identify a service or team member — never a concept word, never a stopword. */
function nameTokens(name: string): string[] {
  return tokenize(name).filter((t) => t.length >= 3 && !matcher.isConceptWord(t) && !(t in CONCEPTS));
}

function matchedServices(tokens: string[], facts: StoreFacts): StoreFacts['services'] {
  return facts.services.filter((s) => nameTokens(s.name).some((t) => tokens.includes(t)));
}

function matchedStaff(tokens: string[], facts: StoreFacts): StoreFacts['staff'] {
  return facts.staff.filter((s) => nameTokens(s.name).some((t) => tokens.includes(t)));
}

/**
 * The topic of a message, or null. A bare service or team-member name ("haircut?", "is Lisa
 * in today?") counts as a services / staff question even without a concept word.
 */
export function detectIntent(tokens: string[], facts?: StoreFacts): Intent | null {
  const direct = matcher.detectIntent(tokens);
  if (direct) return direct;
  if (facts && matchedServices(tokens, facts).length) return 'services';
  if (facts && matchedStaff(tokens, facts).length) return 'staff';
  return null;
}

/** Mirrors the page's own gate: walk-ins are closed only when hours exist AND say closed. */
function walkInsClosed(facts: StoreFacts): boolean {
  return facts.hasHours && !facts.isOpen;
}

function liveLine(facts: StoreFacts): string {
  const { queueCount, waitMinutes } = facts.live;
  if (queueCount <= 0) return 'No one is waiting right now.';
  const people = queueCount === 1 ? '1 person is' : `${queueCount} people are`;
  return waitMinutes > 0
    ? `${people} waiting right now, about ${waitMinutes} min wait.`
    : `${people} waiting right now.`;
}

function serviceLines(list: StoreFacts['services']): string {
  const shown = list.slice(0, 8);
  const lines = shown.map((s) => `• ${s.name} — ${s.priceLabel} · ${s.minutes} min`);
  const more = list.length - shown.length;
  return lines.join('\n') + (more > 0 ? `\n…and ${more} more on this page.` : '');
}

/** A reply built only from `facts`, or null when the facts cannot answer this intent. */
export function factsReply(intent: Intent, tokens: string[], facts: StoreFacts): string | null {
  const closed = walkInsClosed(facts);
  switch (intent) {
    case 'hours':
      if (!facts.hasHours) return null;
      return `${facts.name} hours:\n${facts.hoursLines.join('\n')}\n\n${facts.statusLabel}.`;

    case 'walkin':
      if (closed) {
        return `Walk-ins are welcome when we're open, but we're closed right now (${facts.statusLabel}). You can book an appointment for later from this page.`;
      }
      return `${
        facts.hasHours ? `Yes — walk-ins are welcome, and we're open now (${facts.statusLabel}).` : 'Yes — walk-ins are welcome.'
      } ${liveLine(facts)} Tap Join the Waitlist to get your token, or book an appointment for a fixed time.`;

    case 'waitlist':
      return `${closed ? `We're closed right now (${facts.statusLabel}), so the waitlist opens with the store.` : liveLine(facts)} Here's how it works: tap Join the Waitlist, enter your name and phone number, pick a service, and you'll get a token. Your place updates live on this page, and we'll alert you when your turn is near.`;

    case 'track':
      return 'Tap Check Waitlist Status and enter the phone number you joined with to see your token, your place in line and the estimated wait.';

    case 'book':
      return `Tap Book an Appointment, pick a day and time, choose your service${
        facts.staff.length ? ' (and a preferred team member if you like)' : ''
      }, and enter your name and phone number. Your confirmation shows on screen right away.`;

    case 'price':
    case 'services': {
      const hits = matchedServices(tokens, facts);
      const list = hits.length ? hits : facts.services;
      if (!list.length) return null;
      return hits.length ? serviceLines(hits) : `${facts.name} services:\n${serviceLines(list)}`;
    }

    case 'pay':
      return facts.payments.length ? `We accept ${joinList(facts.payments)}.` : null;

    case 'location':
      return facts.address ? `We're at ${facts.address}. Tap Get Directions on this page for the map.` : null;

    case 'contact':
      return facts.phone ? `You can call us at ${facts.phone}.` : null;

    case 'staff': {
      const hits = matchedStaff(tokens, facts);
      const list = hits.length ? hits : facts.staff;
      if (!list.length) return null;
      const names = list.map((s) => (s.roleLabel ? `${s.name} (${s.roleLabel})` : s.name));
      return `${hits.length ? '' : 'Our team: '}${joinList(names)}. You can pick a team member when you join the waitlist or book.`;
    }

    // Policies the page does not state. An FAQ may have covered them; otherwise, honestly, no.
    case 'cancel':
    case 'kids':
    case 'parking':
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Actions and the assembled answer
// ---------------------------------------------------------------------------------------------

const LABELS: Record<ChatActionType, string> = {
  join: 'Join the Waitlist',
  book: 'Book an Appointment',
  track: 'Check Waitlist Status',
  call: 'Call us',
  faq: 'See FAQs',
};

function action(type: ChatActionType): ChatAction {
  return { type, label: LABELS[type] };
}

/**
 * Which page buttons to offer under a reply. Never a `join` while walk-ins are closed (the page
 * itself re-points every walk-in control to booking then), never a `call` without a number,
 * never a `faq` without FAQs. At most three, and always at least one.
 */
export function actionsFor(intent: Intent | null, facts: StoreFacts): ChatAction[] {
  const canJoin = !walkInsClosed(facts);
  const walkOrBook = canJoin ? 'join' : 'book';
  const call = facts.phone ? action('call') : null;
  const faq = facts.faqs.length ? action('faq') : null;
  const compact = (...xs: (ChatAction | null)[]) => xs.filter((x): x is ChatAction => !!x);

  let list: ChatAction[];
  switch (intent) {
    case 'walkin':
    case 'waitlist':
      list = [action(walkOrBook), action('track')];
      break;
    case 'track':
      list = [action('track')];
      break;
    case 'book':
    case 'cancel':
      list = [action('book')];
      break;
    case 'hours':
      list = canJoin ? [action('join'), action('book')] : [action('book')];
      break;
    case 'price':
    case 'services':
    case 'staff':
      list = canJoin ? [action('book'), action('join')] : [action('book')];
      break;
    case 'pay':
    case 'location':
    case 'contact':
    case 'parking':
    case 'kids':
      list = compact(call, faq);
      if (!list.length) list = [action(walkOrBook)];
      break;
    default:
      list = compact(faq, action(walkOrBook), call);
  }
  // De-duplicate by type (compact() can pair a null with a repeat) and cap at three.
  const seen = new Set<ChatActionType>();
  return list.filter((a) => (seen.has(a.type) ? false : (seen.add(a.type), true))).slice(0, 3);
}

function fallback(facts: StoreFacts): LocalAnswer {
  const canJoin = !walkInsClosed(facts);
  const buttons = [canJoin ? 'Join the Waitlist' : null, 'Book an Appointment', facts.phone ? 'Call' : null].filter(
    (x): x is string => !!x,
  );
  const reply = `Sorry, I couldn't find that in ${facts.name}'s info.${
    facts.faqs.length ? ' Please check the FAQ on this page, or use' : ' Please use'
  } the ${joinList(buttons, 'or')} buttons on this page.`;
  return { reply, mode: 'fallback', suggestedActions: actionsFor(null, facts), score: 0, intent: null };
}

/**
 * The complete key-free answer: FAQ first (the owner's own words beat anything assembled),
 * then store facts, then the fallback. Also the safety net under the LLM path.
 */
export function answerLocally(message: string, facts: StoreFacts): LocalAnswer {
  const norm = normalize(message);
  const tokens = tokenize(message);

  if (tokens.length === 0) {
    if (GREETING_RE.test(norm)) {
      const thanks = THANKS_RE.test(norm);
      const reply = thanks
        ? "You're welcome! If you need anything else, I'm right here."
        : `Hi! I can help with ${facts.name}'s hours, services, prices and how the waitlist works. What would you like to know?`;
      return { reply, mode: 'facts', suggestedActions: actionsFor(null, facts), score: 0, intent: null };
    }
    return fallback(facts);
  }

  const faq = matchFaq(message, facts.faqs);
  if (faq) {
    // The FAQ's own topic picks the buttons when the question itself carried none
    // ("do you take cards?" → the FAQ about payments → Call / See FAQs).
    const intent = detectIntent(tokens, facts) ?? detectIntent(tokenize(faq.faq.q), facts);
    return { reply: faq.faq.a, mode: 'faq_match', suggestedActions: actionsFor(intent, facts), score: faq.score, intent };
  }

  const intent = detectIntent(tokens, facts);
  if (intent) {
    const reply = factsReply(intent, tokens, facts);
    if (reply) return { reply, mode: 'facts', suggestedActions: actionsFor(intent, facts), score: 0, intent };
  }
  return fallback(facts);
}

// ---------------------------------------------------------------------------------------------
// LLM grounding
// ---------------------------------------------------------------------------------------------

/**
 * The system prompt for Layer B. The same `StoreFacts` the local answerer speaks from, spelled
 * out, plus the rules the product decision fixed: answer only from this, never invent a price
 * or an hour, never claim to have taken an action, escalate to the page's buttons.
 */
export function buildSystemPrompt(facts: StoreFacts): string {
  const lines: string[] = [
    `You are the help assistant on the online booking page of "${facts.name}"${facts.category ? ` (${facts.category})` : ''}.`,
    'Answer only from the STORE INFO below. If the information is not there, say you do not have it and point the customer to the buttons on this page: Join the Waitlist (walk in now), Book an Appointment (a fixed time), Check Waitlist Status, or Call.',
    'Never invent or guess prices, hours, services, team members, offers, discounts or policies. Never claim to have booked, joined, cancelled or changed anything — you cannot take actions; only the buttons on the page can.',
    'Reply in plain text (no markdown, no bullet symbols), in the language the customer writes in, in at most 80 words. Be warm and brief.',
    '',
    'STORE INFO',
    `Name: ${facts.name}`,
  ];
  if (facts.category) lines.push(`Type: ${facts.category}`);
  lines.push(`Status right now: ${facts.hasHours ? facts.statusLabel : 'hours not listed on the page'}`);
  lines.push(`Live waitlist right now: ${liveLine(facts)}`);
  if (facts.hoursLines.length) lines.push('Hours:', ...facts.hoursLines.map((l) => `  ${l}`));
  if (facts.address) lines.push(`Address: ${facts.address}`);
  if (facts.phone) lines.push(`Phone: ${facts.phone}`);
  if (facts.payments.length) lines.push(`Payments accepted: ${facts.payments.join(', ')}`);
  if (facts.services.length) {
    lines.push('Services:', ...facts.services.map((s) => `  - ${s.name}: ${s.priceLabel}, ${s.minutes} min`));
  }
  if (facts.staff.length) {
    lines.push(`Team: ${facts.staff.map((s) => (s.roleLabel ? `${s.name} (${s.roleLabel})` : s.name)).join(', ')}`);
  }
  if (facts.faqs.length) {
    lines.push('FAQs written by the store:');
    for (const f of facts.faqs) lines.push(`  Q: ${f.q}`, `  A: ${f.a}`);
  }
  return lines.join('\n');
}
