/**
 * The marketing-site chatbot's brain — the TejoTime *product* bot, not a store bot.
 *
 * The microsite bot (chat-faq.ts) answers "when does this salon close?" from one business's row.
 * This one answers "what is TejoTime, what does it cost, who is it for?" and has no business
 * context at all: the landing page is the same for everybody. Everything it can say is in
 * `PLATFORM_FACTS` below, and it points at the landing page's own sections and CTAs rather than
 * taking any action itself.
 *
 * Pure (no env, no database, no fetch) so it is unit-testable, and it shares the ranking in
 * chat-text.ts with the store bot.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SOURCE OF TRUTH for the copy below: `frontend/src/i18n/en.json` → `landingData`
 * (`faqs`, `plans`, `features`, `steps`, `industries`, `inquiryPerks`), rendered by
 * `frontend/src/components/landing/landingData.ts`.
 *
 * It is mirrored here by hand because each app builds from its own folder and the backend cannot
 * import from `frontend/` (CLAUDE.md §1/§11). `npm run check:chat-facts` at the repo root fails
 * if the two drift. **If you change the landing copy, change this file in the same commit** — a
 * bot quoting a retired price is worse than a bot that says nothing.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */
import {
  createMatcher,
  GREETING_RE,
  joinList,
  normalize,
  THANKS_RE,
  type Faq,
} from './chat-text';

export type PlatformActionType = 'pilot' | 'pricing' | 'product' | 'industries' | 'demo' | 'faq' | 'signin';

export interface PlatformAction {
  type: PlatformActionType;
  label: string;
}

export type PlatformChatMode = 'faq_match' | 'facts' | 'llm' | 'fallback';

export interface PlatformReply {
  reply: string;
  mode: PlatformChatMode;
  suggestedActions: PlatformAction[];
}

export type PlatformIntent =
  | 'whatis'
  | 'pricing'
  | 'signup'
  | 'features'
  | 'booking'
  | 'walkins'
  | 'reminders'
  | 'clients'
  | 'mobile'
  | 'industries'
  | 'providers'
  | 'cancel'
  | 'demo'
  | 'support'
  | 'data'
  | 'setup';

// ---------------------------------------------------------------------------------------------
// The facts (mirrored from the landing page — see the header note)
// ---------------------------------------------------------------------------------------------

export interface PlatformFacts {
  name: string;
  /** One sentence the bot may lead with. */
  summary: string;
  /** "U.S. pilot" state — the page says signup is not self-serve yet, so the bot must not promise it. */
  offerMode: string;
  faqs: Faq[];
  plans: { name: string; price: string; per: string; who: string; feats: string[] }[];
  features: { head: string; body: string }[];
  steps: { head: string; body: string }[];
  industries: string[];
  perks: string[];
}

export const PLATFORM_FACTS: PlatformFacts = {
  name: 'TejoTime',
  summary:
    'TejoTime is an online booking, scheduling and client-management platform for appointment-based businesses.',
  offerMode:
    'TejoTime is currently running a U.S. pilot. Signing up is not self-serve yet: you request access from this page and the team sets your booking page up with you, usually replying within one business day.',

  faqs: [
    {
      q: 'What is TejoTime?',
      a: 'TejoTime is an online booking, scheduling, and client-management platform for appointment-based businesses. Clients can book online, and businesses can manage schedules, providers, reminders, client details, and optional walk-ins from one dashboard.',
    },
    {
      q: 'Who is TejoTime for?',
      a: 'TejoTime is built for salons, barbershops, nail studios, spas, med spas, massage practices, physical therapy clinics, tattoo studios, and pet-grooming businesses.',
    },
    {
      q: 'Can clients book online?',
      a: 'Yes. Your booking page is available 24/7, allowing clients to choose a service, provider, and available appointment time.',
    },
    {
      q: 'Can I manage walk-ins?',
      a: 'Yes. Businesses that accept walk-ins can use the optional live waitlist alongside scheduled appointments.',
    },
    {
      q: 'Can I manage multiple providers?',
      a: 'Yes. Each provider has their own availability, and clients can pick a specific person or take whoever is available first.',
    },
    {
      q: 'Does TejoTime send reminders?',
      a: 'Booking confirmations and reminders are part of the paid plans. We will only list the channels that are actually enabled for your business.',
    },
    {
      q: 'Can I run it from my phone?',
      a: 'Yes. The mobile dashboard covers the day’s schedule, the waitlist, your team, and your clients.',
    },
    {
      q: 'Can I cancel?',
      a: 'Yes. You can cancel your TejoTime subscription according to the terms shown for your selected plan.',
    },
  ],

  plans: [
    {
      name: 'Starter',
      price: 'Free',
      per: 'during the U.S. pilot',
      who: 'Best for independent providers.',
      feats: ['Branded booking page', 'One provider schedule', 'Client profiles', 'Optional walk-in waitlist'],
    },
    {
      name: 'Business',
      price: 'Coming soon',
      per: '',
      who: 'Best for growing teams.',
      feats: [
        'Everything in Starter',
        'Multiple provider schedules',
        'Automated reminders',
        'Client history',
        'Shared dashboard',
      ],
    },
    {
      name: 'Multi-location',
      price: 'Contact us',
      per: '',
      who: 'Best for businesses managing multiple locations.',
      feats: ['Centralized scheduling', 'Location management', 'Priority onboarding'],
    },
  ],

  features: [
    {
      head: 'Branded booking page',
      body: 'Create a professional booking page with your services, prices, photos, hours, team members, and reviews — no website required.',
    },
    { head: 'Online booking', body: 'Let clients book a service, choose a provider, and select an available time 24/7.' },
    {
      head: 'Scheduling and walk-ins',
      body: 'Manage provider schedules and appointments in one place. Turn on the live waitlist if your business accepts walk-ins.',
    },
    {
      head: 'Automatic reminders',
      body: 'Automatically send booking confirmations and appointment reminders to help reduce no-shows.',
    },
    {
      head: 'Client profiles',
      body: 'Keep client contact details, visit history, preferences, and notes together for more personalized service.',
    },
    {
      head: 'Mobile dashboard',
      body: 'View today’s appointments, team availability, client information, and optional waitlist from your phone or computer.',
    },
  ],

  steps: [
    {
      head: 'Create your booking page',
      body: 'Add your business details, services, prices, hours, photos, and team members.',
    },
    { head: 'Share your link', body: 'Add it to Google, social media, your website, texts, emails, or an in-store QR code.' },
    {
      head: 'Manage your day',
      body: 'View appointments, update schedules, communicate with clients, and manage optional walk-ins.',
    },
  ],

  industries: [
    'hair salons',
    'barbershops',
    'nail studios',
    'spas',
    'med spas',
    'massage therapy',
    'physical therapy',
    'tattoo studios',
    'pet grooming',
  ],

  perks: ['Free setup', 'No card', 'Cancel anytime'],
};

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * The marketing vocabulary. Deliberately different from the store bot's: here "book" is a
 * product capability to explain, not something the visitor is trying to do right now.
 */
const CONCEPTS: Record<PlatformIntent, string[]> = {
  whatis: `tejotime what about product platform software tool app service overview explain do does
    offering purpose`.split(/\s+/),
  pricing: `price prices pricing priced cost costs costing rate rates fee fees charge charges plan
    plans subscription subscribe billing bill paid pay payment free trial cheap expensive afford
    affordable budget dollar dollars usd month monthly year yearly annual`.split(/\s+/),
  signup: `signup sign register registration join start starting started onboard onboarding
    create account apply application access pilot waitlist invite`.split(/\s+/),
  features: `feature features capability capabilities function functions functionality include
    included includes offer offers does can what dashboard tools`.split(/\s+/),
  booking: `book books booking bookings booked appointment appointments appt scheduling schedule
    scheduled reserve reservation slot slots calendar online`.split(/\s+/),
  walkins: `walkin walkins queue queues waitlist wait waiting line token tokens walk`.split(/\s+/),
  reminders: `reminder reminders remind notification notifications notify alert alerts sms text
    texts whatsapp email confirmation confirmations noshow noshows`.split(/\s+/),
  clients: `client clients customer customers crm profile profiles history contact contacts note
    notes preference preferences database`.split(/\s+/),
  mobile: `mobile phone phones app apps android ios iphone tablet device devices desktop
    computer`.split(/\s+/),
  industries: `industry industries salon salons barbershop barbershops barber nail nails studio
    studios spa spas medspa massage therapy physical physio tattoo pet grooming groomer clinic
    clinics business businesses type types suitable suited suit fit fits built build designed
    design meant intended ideal right`.split(/\s+/),
  providers: `provider providers staff stylist stylists barber employee employees team member
    members multiple seat seats chair chairs`.split(/\s+/),
  cancel: `cancel cancels cancelled canceled cancellation cancelling refund refunds terminate
    stop quit unsubscribe lock contract commitment`.split(/\s+/),
  demo: `demo demos tour walkthrough preview example sample show see try screenshot
    screenshots`.split(/\s+/),
  support: `support help helped helping contact reach team assistance assist question questions
    email call talk sales human`.split(/\s+/),
  data: `data privacy secure security safe safety gdpr encrypted encryption export backup own
    ownership share shared`.split(/\s+/),
  setup: `setup set install installation migrate migration import onboarding configure
    configuration technical tech skill skills difficult easy long time`.split(/\s+/),
};

/**
 * Specific asks first. `whatis` and `features` sit low because their words ("what", "does",
 * "offer") ride along with almost every other question.
 */
const INTENT_PRIORITY: PlatformIntent[] = [
  'pricing',
  'cancel',
  'signup',
  'walkins',
  'reminders',
  'clients',
  'providers',
  'booking',
  'industries',
  'mobile',
  'demo',
  'setup',
  'data',
  'support',
  'features',
  'whatis',
];

const matcher = createMatcher<PlatformIntent>(CONCEPTS, INTENT_PRIORITY);

export const tokenize = matcher.tokenize;
export const matchFaq = matcher.matchFaq;
export const detectIntent = (tokens: string[]): PlatformIntent | null => matcher.detectIntent(tokens);

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

const LABELS: Record<PlatformActionType, string> = {
  pilot: 'Request access',
  pricing: 'See pricing',
  product: 'See features',
  industries: 'Who it’s for',
  demo: 'See how it works',
  faq: 'Read the FAQ',
  signin: 'Sign in',
};

function action(type: PlatformActionType): PlatformAction {
  return { type, label: LABELS[type] };
}

function planLines(): string {
  return PLATFORM_FACTS.plans
    .map((p) => `• ${p.name} — ${p.price}${p.per ? ` ${p.per}` : ''}. ${p.who}`)
    .join('\n');
}

/** A reply built only from `PLATFORM_FACTS`, or null when the facts cannot answer this intent. */
export function factsReply(intent: PlatformIntent): string | null {
  const f = PLATFORM_FACTS;
  switch (intent) {
    case 'whatis':
      return `${f.summary} Clients book from your own page, and you manage the schedule, your team, reminders, client details and optional walk-ins from one dashboard.`;

    case 'pricing':
      return `${planLines()}\n\n${f.perks.join(' · ')}. ${f.offerMode}`;

    case 'signup':
      return `${f.offerMode} Tap Request access, tell us your business name, address and phone number, and the team will reach out.`;

    case 'features':
      return `What you get:\n${f.features.map((x) => `• ${x.head} — ${x.body}`).join('\n')}`;

    case 'booking':
      return 'Your booking page is available 24/7. Clients pick a service, choose a provider, and select an available time. You see it on your schedule straight away.';

    case 'walkins':
      return 'Walk-ins are optional. If your business takes them, you can run a live waitlist beside your scheduled appointments, and clients can watch their place in line from their phone.';

    case 'reminders':
      return 'Booking confirmations and appointment reminders are part of the paid plans, and they exist to cut no-shows. We only list the channels actually enabled for your business.';

    case 'clients':
      return 'Every client gets a profile with their contact details, visit history, preferences and your notes, so the next visit starts with context rather than a blank page.';

    case 'mobile':
      return 'Yes. The dashboard works on a phone, tablet or computer, and covers the day’s schedule, the waitlist, your team and your clients.';

    case 'industries':
      return `TejoTime is built for ${joinList(f.industries)}. If your business runs on appointments, it probably fits.`;

    case 'providers':
      return 'Yes. Each provider keeps their own availability, and a client can either pick a specific person or take whoever is free first.';

    case 'cancel':
      return 'You can cancel according to the terms shown for your plan. During the U.S. pilot there is no card required and no lock-in.';

    case 'demo':
      return 'The page has a live product tour you can click through, plus the booking and walk-in views further up. Tap See how it works to jump to it.';

    case 'setup':
      return `Setup is done with you, and no tech skills are needed. Three steps:\n${f.steps
        .map((s, i) => `${i + 1}. ${s.head} — ${s.body}`)
        .join('\n')}`;

    // Things the landing page does not actually state. Better to hand these to a person.
    case 'support':
    case 'data':
      return null;
  }
}

/** Which landing-page buttons to offer under a reply. At most three, always at least one. */
export function actionsFor(intent: PlatformIntent | null): PlatformAction[] {
  let list: PlatformAction[];
  switch (intent) {
    case 'pricing':
    case 'cancel':
      list = [action('pricing'), action('pilot')];
      break;
    case 'signup':
    case 'setup':
      list = [action('pilot'), action('demo')];
      break;
    case 'industries':
      list = [action('industries'), action('pilot')];
      break;
    case 'demo':
      list = [action('demo'), action('pilot')];
      break;
    case 'features':
    case 'booking':
    case 'walkins':
    case 'reminders':
    case 'clients':
    case 'providers':
    case 'mobile':
      list = [action('product'), action('pilot')];
      break;
    case 'support':
    case 'data':
      list = [action('pilot'), action('faq')];
      break;
    case 'whatis':
      list = [action('product'), action('pricing'), action('pilot')];
      break;
    default:
      list = [action('faq'), action('pricing'), action('pilot')];
  }
  const seen = new Set<PlatformActionType>();
  return list.filter((a) => (seen.has(a.type) ? false : (seen.add(a.type), true))).slice(0, 3);
}

export interface PlatformAnswer extends PlatformReply {
  mode: Exclude<PlatformChatMode, 'llm'>;
  score: number;
  intent: PlatformIntent | null;
}

function fallback(): PlatformAnswer {
  return {
    reply:
      'Sorry, I don’t have that one. The FAQ further down this page may cover it, or tap Request access and a person from the team will get back to you within one business day.',
    mode: 'fallback',
    suggestedActions: actionsFor(null),
    score: 0,
    intent: null,
  };
}

/** The complete key-free answer for the marketing site: FAQ → product facts → fallback. */
export function answerPlatform(message: string): PlatformAnswer {
  const norm = normalize(message);
  const tokens = tokenize(message);

  if (tokens.length === 0) {
    if (GREETING_RE.test(norm)) {
      const reply = THANKS_RE.test(norm)
        ? 'You’re welcome! Ask me anything else about TejoTime.'
        : 'Hi! I can tell you what TejoTime does, who it’s for, what it costs and how to get started. What would you like to know?';
      return { reply, mode: 'facts', suggestedActions: actionsFor(null), score: 0, intent: null };
    }
    return fallback();
  }

  const faq = matchFaq(message, PLATFORM_FACTS.faqs);
  if (faq) {
    const intent = detectIntent(tokens) ?? detectIntent(tokenize(faq.faq.q));
    return { reply: faq.faq.a, mode: 'faq_match', suggestedActions: actionsFor(intent), score: faq.score, intent };
  }

  const intent = detectIntent(tokens);
  if (intent) {
    const reply = factsReply(intent);
    if (reply) return { reply, mode: 'facts', suggestedActions: actionsFor(intent), score: 0, intent };
  }
  return fallback();
}

/**
 * The system prompt for the optional LLM layer. Same discipline as the store bot: answer only
 * from these facts, never invent a price or a feature, never promise a signup that is not live,
 * and hand anything else to the page's own CTAs.
 */
export function buildPlatformSystemPrompt(): string {
  const f = PLATFORM_FACTS;
  const lines: string[] = [
    `You are the help assistant on the marketing website of ${f.name}, a booking and scheduling product for appointment-based businesses. You are talking to a business owner who is evaluating it, not to their customer.`,
    'Answer only from the PRODUCT INFO below. If it is not there, say you do not have it and point them to the buttons on this page: Request access, See pricing, See features, or the FAQ.',
    'Never invent or guess prices, plans, launch dates, integrations, guarantees or features. Never claim to have created an account, started a trial or booked a demo — you cannot take actions; only the buttons on the page can.',
    'Reply in plain text (no markdown, no bullet symbols), in the language the visitor writes in, in at most 80 words. Be concrete and warm, never pushy.',
    '',
    'PRODUCT INFO',
    `Name: ${f.name}`,
    `Summary: ${f.summary}`,
    `Availability: ${f.offerMode}`,
    `Built for: ${joinList(f.industries)}`,
    'Plans:',
    ...f.plans.map((p) => `  - ${p.name}: ${p.price}${p.per ? ` ${p.per}` : ''}. ${p.who} Includes ${p.feats.join(', ')}.`),
    'Features:',
    ...f.features.map((x) => `  - ${x.head}: ${x.body}`),
    'Getting started:',
    ...f.steps.map((s, i) => `  ${i + 1}. ${s.head}: ${s.body}`),
    'FAQs on the page:',
  ];
  for (const q of f.faqs) lines.push(`  Q: ${q.q}`, `  A: ${q.a}`);
  return lines.join('\n');
}
