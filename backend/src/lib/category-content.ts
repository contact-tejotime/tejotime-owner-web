/**
 * The single source of per-category marketing copy for "autofill a store from a business name"
 * (docs/store-autofill-from-name.md). Pure, import-free, unit-tested.
 *
 * WHY A "CONTENT PRESET" IS NOT A CATEGORY. The admin Create-a-store Category dropdown has only
 * three real values (`Salon & Barber`, `Hospital`, `Restaurant`; seeded in master_data, 0005). The
 * ten presets below are finer-grained than that on purpose: they drive the generated *copy* (a
 * barbershop reads differently from a nail studio), and each snaps to one of the three real
 * categories via PRESET_CATEGORY — or to '' ("pick a category") when none fits (pet grooming).
 *
 * COMPLIANCE (a hard rule, see the doc). The copy here — and the LLM prompt that uses it as a style
 * guide — may mention ONLY features that exist in this product: the live queue / walk-in list,
 * booking ahead, choosing a specific staff member, live wait times, combining services, repeat
 * (recurring) visits, tips, and the "it's your turn" update that shows live on the customer's phone.
 * It must NEVER claim features we do not have: deposits, pet notes, service packages/bundles, or a
 * per-turn SMS ("we'll text you when it's your turn" — only an opt-in ~15-minute ETA text exists).
 * `FORBIDDEN_PHRASES` / `containsForbiddenClaim` enforce this on model output; `category-content.test.ts`
 * enforces it on the templates.
 */

export type ContentPreset =
  | 'hair_salon'
  | 'barbershop'
  | 'nail'
  | 'spa'
  | 'medspa'
  | 'massage'
  | 'physio'
  | 'tattoo'
  | 'pet'
  | 'beauty_parlour';

/** One of the three real master_data categories, or '' when none fits and the admin must choose. */
export type StoreCategory = 'Salon & Barber' | 'Hospital' | 'Restaurant' | '';

export interface StarterService {
  name: string;
  /** Minutes — always a real duration (the API requires ≥ 1); price is deliberately left "unset". */
  durationMinutes: number;
}

export interface Faq {
  q: string;
  a: string;
}

export interface GeneratedCopy {
  headline: string;
  /** Alternate headlines the admin could pick — the client renders its own chips too, so these are style only. */
  headlineIdeas: string[];
  heroSubtitle: string;
  aboutHeading: string;
  description: string;
  faqs: Faq[];
}

export interface CopyContext {
  name: string;
  city?: string;
  area?: string;
  /** US/Canada wording (line/salon/"book ahead") vs India (queue/parlour/"book a time ahead"). */
  isUsStore: boolean;
}

interface PresetSpec {
  category: StoreCategory;
  /** The staff role label a seat gets when the website gave a name but no role. May carry tokens. */
  staffRole: string;
  /** For the About sentence: "{name} is a {categoryWord} in {place}." May carry tokens. */
  categoryWord: string;
  headlineIdeas: readonly string[];
  heroSubtitle: string;
  aboutHeading: string;
  /** One true, generic sentence about what the business does — never an invented specific. */
  aboutExtra: string;
  galleryHeading: string;
  services: readonly StarterService[];
  /** Category-specific Q&A; the two universal ones are prepended by `buildFaqs`. */
  faqExtras: readonly Faq[];
  /**
   * Amenities typical for this kind of business — NOT facts about any one store. Offered to the
   * admin as yellow "Suggested — please check" chips and saved only if tapped. Names must be in
   * lib/amenities.ts AMENITIES (category-content.test.ts checks it).
   */
  amenitySuggestions: readonly string[];
}

// Tokens, resolved by `wording()` for the store's market.
const QUEUE = '{queue}'; // queue (India) / line (US)
const PARLOUR = '{parlour}'; // parlour (India) / salon (US)
const PHYSIO_ROLE = '{physioRole}'; // Physiotherapist / Physical therapist
const PHYSIO_FIELD = '{physioField}'; // physiotherapy / physical therapy

function wording(s: string, isUs: boolean): string {
  return s
    .replace(/\{queue\}/g, isUs ? 'line' : 'queue')
    .replace(/\{parlour\}/g, isUs ? 'salon' : 'parlour')
    .replace(/\{physioRole\}/g, isUs ? 'Physical therapist' : 'Physiotherapist')
    .replace(/\{physioField\}/g, isUs ? 'physical therapy' : 'physiotherapy');
}

/** Always-true Q&A, shown for every category (answers reference only features that exist). */
const COMMON_FAQS: readonly Faq[] = [
  {
    q: 'Do I need an appointment?',
    a: `No — you can book a time ahead, or just join the ${QUEUE} from your phone and come in when it's your turn.`,
  },
  {
    q: "How do I know when it's my turn?",
    a: 'Your place updates live on your phone — you can see how many people are ahead of you and your estimated wait.',
  },
];

const PRESETS: Record<ContentPreset, PresetSpec> = {
  hair_salon: {
    category: 'Salon & Barber',
    staffRole: 'Stylist',
    categoryWord: 'hair salon',
    headlineIdeas: ['Great hair, without the wait', 'Your stylist, on your schedule', '{name} — book ahead or join the {queue}'],
    heroSubtitle: 'Pick your stylist and book in seconds · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Our stylists look after cuts, colour, styling and treatments.',
    galleryHeading: 'Our Work',
    services: [
      { name: 'Haircut', durationMinutes: 45 },
      { name: 'Wash & blow-dry', durationMinutes: 30 },
      { name: 'Hair colour', durationMinutes: 90 },
      { name: 'Highlights', durationMinutes: 120 },
      { name: 'Hair treatment', durationMinutes: 45 },
    ],
    faqExtras: [
      { q: 'Can I choose my stylist?', a: 'Yes — pick your stylist when you book or join.' },
      { q: 'Can I add a service when I book?', a: 'Yes — add more than one service and the wait time adjusts automatically.' },
    ],
    amenitySuggestions: ['Air conditioned', 'Free Wi-Fi', 'Waiting area', 'TV', 'Complimentary tea/coffee', 'Phone charging'],
  },
  barbershop: {
    category: 'Salon & Barber',
    staffRole: 'Barber',
    categoryWord: 'barbershop',
    headlineIdeas: ['Fresh cuts, no waiting around', 'Walk in or book — see your wait live', '{name} — sharp cuts, short waits'],
    heroSubtitle: 'Join the {queue} from your phone and see your wait time · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Our barbers handle cuts, beard trims and shaves.',
    galleryHeading: 'Fresh Cuts',
    services: [
      { name: 'Haircut', durationMinutes: 30 },
      { name: 'Beard trim', durationMinutes: 15 },
      { name: 'Haircut + beard', durationMinutes: 45 },
      { name: 'Hot towel shave', durationMinutes: 30 },
      { name: 'Kids cut', durationMinutes: 20 },
    ],
    faqExtras: [
      { q: 'Can I just walk in?', a: `Yes — join the ${QUEUE} from your phone and come in when it's your turn.` },
      { q: 'Can I pick my barber?', a: 'Yes — choose your barber when you book or join.' },
    ],
    amenitySuggestions: ['Air conditioned', 'Free Wi-Fi', 'Waiting area', 'TV', 'Complimentary drinks', 'Phone charging'],
  },
  nail: {
    category: 'Salon & Barber',
    staffRole: 'Nail technician',
    categoryWord: 'nail studio',
    headlineIdeas: ['Beautiful nails, no long wait', 'Pick your nail tech and book in seconds', '{name} — polish, art and more'],
    heroSubtitle: 'Choose your nail technician and combine services · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Our team looks after manicures, pedicures, gel and nail art.',
    galleryHeading: 'Nail Art',
    services: [
      { name: 'Manicure', durationMinutes: 30 },
      { name: 'Pedicure', durationMinutes: 45 },
      { name: 'Gel polish', durationMinutes: 45 },
      { name: 'Acrylic full set', durationMinutes: 90 },
      { name: 'Nail art add-on', durationMinutes: 15 },
    ],
    faqExtras: [{ q: 'Can I book a manicure and pedicure together?', a: 'Yes — add both and the time is combined for you.' }],
    amenitySuggestions: ['Air conditioned', 'Free Wi-Fi', 'Massage chairs', 'Waiting area', 'Complimentary drinks', 'Phone charging'],
  },
  spa: {
    category: 'Salon & Barber',
    staffRole: 'Therapist',
    categoryWord: 'spa',
    headlineIdeas: ['Your calm hour, booked in seconds', "Relax — we'll tell you when it's time", '{name} — unwind without the wait'],
    heroSubtitle: 'Book your treatment and arrive relaxed · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Come in for massages, facials and other treatments at your own pace.',
    galleryHeading: 'Our Space',
    services: [
      { name: 'Signature massage', durationMinutes: 60 },
      { name: 'Facial', durationMinutes: 60 },
      { name: 'Body scrub', durationMinutes: 45 },
      { name: 'Foot spa', durationMinutes: 30 },
    ],
    faqExtras: [{ q: 'Can I choose my therapist?', a: 'Yes — pick your therapist when you book.' }],
    amenitySuggestions: ['Private rooms', 'Shower', 'Lockers', 'Changing room', 'Robes & slippers', 'Relaxation lounge'],
  },
  medspa: {
    category: 'Hospital',
    staffRole: 'Provider',
    categoryWord: 'med spa',
    headlineIdeas: ['Book your consultation in seconds', 'The right provider, at the right time', '{name} — consultations made easy'],
    heroSubtitle: 'Book a consultation or follow-up visit · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Book a consultation to talk through your options with a provider.',
    galleryHeading: 'Our Clinic',
    services: [
      { name: 'Consultation', durationMinutes: 30 },
      { name: 'Follow-up visit', durationMinutes: 20 },
    ],
    faqExtras: [{ q: 'Do I need a consultation first?', a: "You can book a consultation to discuss what you're looking for and the right next step." }],
    amenitySuggestions: ['Private treatment rooms', 'Consultation room', 'Changing room', 'Lockers', 'Waiting lounge', 'Air conditioned'],
  },
  massage: {
    category: 'Salon & Barber',
    staffRole: 'Massage therapist',
    categoryWord: 'massage therapy studio',
    headlineIdeas: ['Book your massage in seconds', 'Pick your therapist and session length', '{name} — relax on your schedule'],
    heroSubtitle: 'Choose your therapist and session length · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Choose your therapist and the session length that suits you.',
    galleryHeading: 'Our Space',
    services: [
      { name: 'Swedish massage', durationMinutes: 60 },
      { name: 'Deep tissue massage', durationMinutes: 60 },
      { name: 'Back & shoulder', durationMinutes: 30 },
      { name: 'Hot stone', durationMinutes: 75 },
      { name: 'Foot reflexology', durationMinutes: 30 },
    ],
    faqExtras: [{ q: 'Can I book regular visits?', a: 'Yes — you can set up repeat visits so your usual slot is saved.' }],
    amenitySuggestions: ['Private rooms', 'Shower', 'Changing room', 'Lockers', 'Couples room', 'Relaxation lounge'],
  },
  physio: {
    category: 'Hospital',
    staffRole: PHYSIO_ROLE,
    categoryWord: `${PHYSIO_FIELD} clinic`,
    headlineIdeas: ['Book your evaluation in seconds', 'Your therapist, on your schedule', '{name} — easy booking for every visit'],
    heroSubtitle: 'Book your evaluation or follow-up visit · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Book an evaluation or a follow-up session with your therapist.',
    galleryHeading: 'Our Clinic',
    services: [
      { name: 'Initial evaluation', durationMinutes: 60 },
      { name: 'Follow-up session', durationMinutes: 45 },
    ],
    faqExtras: [{ q: 'What should I bring to my first visit?', a: "Please bring any doctor's notes, reports or prescriptions you have." }],
    amenitySuggestions: ['Private treatment rooms', 'Lift/elevator', 'Waiting area', 'Changing room', 'Air conditioned', 'Free Wi-Fi'],
  },
  tattoo: {
    category: 'Salon & Barber',
    staffRole: 'Tattoo artist',
    categoryWord: 'tattoo studio',
    headlineIdeas: ['Your next piece starts here', 'Book a consultation with the right artist', '{name} — book your session'],
    heroSubtitle: 'See our artists, book a consultation, plan your session · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'Meet our artists, plan your piece and book your session.',
    galleryHeading: 'Artist Portfolio',
    services: [
      { name: 'Consultation', durationMinutes: 30 },
      { name: 'Small tattoo', durationMinutes: 60 },
      { name: 'Medium tattoo', durationMinutes: 120 },
      { name: 'Large session', durationMinutes: 240 },
    ],
    faqExtras: [{ q: 'Do I need a consultation first?', a: 'You can book a consultation to talk through your idea before your session.' }],
    amenitySuggestions: ['Private booth', 'Waiting area', 'Air conditioned', 'Free Wi-Fi', 'Music', 'Phone charging'],
  },
  pet: {
    category: '', // none of Salon & Barber / Hospital / Restaurant fits grooming — the admin picks.
    staffRole: 'Groomer',
    categoryWord: 'pet grooming salon',
    headlineIdeas: ['Happy pets, easy booking', "Book your pet's groom in seconds", '{name} — grooming made simple'],
    heroSubtitle: "Pick a drop-off time and book your pet's groom · {area}",
    aboutHeading: 'About {name}',
    aboutExtra: 'Bring your pet in for a bath, a full groom or a quick tidy-up.',
    galleryHeading: 'Happy Pets',
    services: [
      { name: 'Bath & brush', durationMinutes: 60 },
      { name: 'Full groom', durationMinutes: 120 },
      { name: 'Nail trim', durationMinutes: 15 },
      { name: 'Puppy groom', durationMinutes: 60 },
      { name: 'De-shedding', durationMinutes: 90 },
    ],
    // NB: NO "notes about your pet" — that feature does not exist. "we'll show" (not "text").
    faqExtras: [
      {
        q: "How do I book my pet's grooming?",
        a: `Book a time online or join the walk-in ${QUEUE} — choose a groomer, see the live wait, and we'll show when it's your turn.`,
      },
    ],
    amenitySuggestions: ['Pickup & drop', 'Waiting area', 'Viewing window', 'Air conditioned', 'Pet treats', 'Free Wi-Fi'],
  },
  beauty_parlour: {
    category: 'Salon & Barber',
    staffRole: 'Beautician',
    categoryWord: `beauty ${PARLOUR}`,
    headlineIdeas: ['Look your best, without the wait', 'Beauty care that fits your day', '{name} — book your beauty time'],
    heroSubtitle: 'Book your appointment or join the {queue} · {area}',
    aboutHeading: 'About {name}',
    aboutExtra: 'We look after hair, skin, waxing, make-up and more.',
    galleryHeading: 'Our Looks',
    services: [
      { name: 'Eyebrow threading', durationMinutes: 10 },
      { name: 'Cleanup', durationMinutes: 30 },
      { name: 'Facial', durationMinutes: 60 },
      { name: 'Waxing', durationMinutes: 30 },
      { name: 'Manicure', durationMinutes: 30 },
      { name: 'Pedicure', durationMinutes: 45 },
      { name: 'Party makeup', durationMinutes: 60 },
      { name: 'Bridal makeup', durationMinutes: 180 },
    ],
    faqExtras: [
      { q: 'Can I choose who sees me?', a: 'Yes — pick your beautician when you book or join.' },
      { q: 'Can I book more than one service?', a: 'Yes — add several and the time is combined for you.' },
    ],
    amenitySuggestions: ['Air conditioned', 'Free Wi-Fi', 'Waiting area', 'Separate ladies section', 'Bridal room', 'Complimentary tea/coffee'],
  },
};

export const CONTENT_PRESETS = Object.keys(PRESETS) as ContentPreset[];

/** Which of the three real categories a preset maps to ('' = admin must pick). */
export function categoryForPreset(preset: ContentPreset): StoreCategory {
  return PRESETS[preset].category;
}

/** The staff role label for a preset, in the store's market (for seats the website left unlabelled). */
export function staffRoleFor(preset: ContentPreset, isUsStore: boolean): string {
  return wording(PRESETS[preset].staffRole, isUsStore);
}

/** The noun used in the About sentence ("…is a barbershop in…"), resolved for the market. */
export function categoryWordFor(preset: ContentPreset, isUsStore: boolean): string {
  return wording(PRESETS[preset].categoryWord, isUsStore);
}

/** The starter services for a preset (duration only; price is always left "unset" — never invented). */
export function starterServices(preset: ContentPreset): StarterService[] {
  return PRESETS[preset].services.map((s) => ({ ...s }));
}

export function galleryHeadingFor(preset: ContentPreset): string {
  return PRESETS[preset].galleryHeading;
}

/** Typical amenities for a preset — suggestions only, never saved unless the admin taps one. */
export function amenitySuggestionsFor(preset: ContentPreset): string[] {
  return [...PRESETS[preset].amenitySuggestions];
}

/**
 * Pick a preset from Google Places types first, then the business name. Region matters for one case:
 * a `beauty_salon` is a beauty parlour in India but reads as a hair salon in the US/Canada (spec).
 * Returns null when nothing fits (e.g. a hospital), so the caller can warn "pick a category".
 */
export function presetFor(types: string[] | undefined, name: string, region?: string | null): ContentPreset | null {
  const typeSet = new Set((types ?? []).map((x) => x.toLowerCase()));
  const n = (name ?? '').toLowerCase();
  const hasType = (...keys: string[]) => keys.some((k) => typeSet.has(k));
  const inName = (re: RegExp) => re.test(n);
  const india = (region ?? '').toUpperCase() === 'IN';

  // Specific signals first (a name keyword or a specific Places type beats a generic one).
  if (inName(/\b(tattoo|ink|piercing)\b/) || hasType('body_art_service', 'tattoo_parlor', 'tattoo_shop')) return 'tattoo';
  if (inName(/\b(pet|pets|dog|dogs|cat|cats|paws|groom|grooming|groomer|groomers)\b/)) return 'pet';
  if (inName(/\b(med ?spa|medspa|aesthetic|aesthetics|laser|botox)\b/) || hasType('skin_care_clinic')) return 'medspa';
  if (inName(/\b(physio|physiotherapy|physical therapy|rehab|rehabilitation)\b/) || hasType('physiotherapist', 'chiropractor')) return 'physio';
  if (inName(/\bmassage\b/) || hasType('massage')) return 'massage';
  if (inName(/\bnails?\b/) || hasType('nail_salon')) return 'nail';
  if (inName(/\bbarber\b/) || hasType('barber_shop')) return 'barbershop';
  if (inName(/\bspa\b/) || hasType('spa', 'sauna', 'wellness_center')) return 'spa';
  if (hasType('hair_salon', 'hair_care')) return 'hair_salon';
  if (hasType('beauty_salon', 'beautician', 'make_up_artist', 'makeup_artist') || inName(/\b(beauty|parlour|parlor)\b/)) {
    return india ? 'beauty_parlour' : 'hair_salon';
  }
  return null;
}

/** Phrases the copy must never contain — features this product does not have. */
export const FORBIDDEN_PHRASES: readonly RegExp[] = [
  /\bdeposits?\b/i,
  /notes? about (your|my|the) pet/i,
  /\bpackages?\b/i,
  /\bbundles?\b/i,
  /\b(text|sms|message)[^.]{0,30}when it'?s your turn/i,
  // No promised medical outcomes for med spa / physio.
  /\bguaranteed? results?\b/i,
];

export function containsForbiddenClaim(text: string): boolean {
  return FORBIDDEN_PHRASES.some((re) => re.test(text));
}

function place(ctx: CopyContext): string {
  const parts = [ctx.area?.trim(), ctx.city?.trim()].filter(Boolean);
  return parts.join(', ');
}

/** Drop a dangling " · {area}" (or a trailing separator) when the area is unknown. */
function fill(template: string, ctx: CopyContext): string {
  const out = template
    .replace(/\{name\}/g, ctx.name)
    .replace(/\{area\}/g, ctx.area?.trim() || '')
    .replace(/\{city\}/g, ctx.city?.trim() || '');
  return wording(out, ctx.isUsStore)
    .replace(/\s*[·•]\s*$/, '') // trailing separator left by an empty {area}
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildFaqs(spec: PresetSpec, ctx: CopyContext): Faq[] {
  return [...COMMON_FAQS, ...spec.faqExtras].map((f) => ({ q: fill(f.q, ctx), a: fill(f.a, ctx) }));
}

/**
 * The deterministic templates — used when the LLM is off, down, rate-limited or returns something
 * that fails the forbidden-phrase check. Interpolates {name}/{area}/{city} and switches wording for
 * the market. Every output here is compliant by construction (see `category-content.test.ts`).
 */
export function templateCopy(preset: ContentPreset, ctx: CopyContext): GeneratedCopy {
  const spec = PRESETS[preset];
  const ideas = spec.headlineIdeas.map((h) => fill(h, ctx));
  const where = place(ctx);
  const categoryWord = wording(spec.categoryWord, ctx.isUsStore);
  const join = ctx.isUsStore
    ? "Join the line from your phone and come in when it's your turn, or book ahead."
    : "Join the queue from your phone and come in when it's your turn, or book a time ahead.";
  const description = [
    where ? `${ctx.name} is a ${categoryWord} in ${where}.` : `${ctx.name} is a ${categoryWord}.`,
    fill(spec.aboutExtra, ctx),
    join,
  ]
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    headline: ideas[0] ?? ctx.name,
    headlineIdeas: ideas,
    heroSubtitle: fill(spec.heroSubtitle, ctx),
    aboutHeading: fill(spec.aboutHeading, ctx),
    description,
    faqs: buildFaqs(spec, ctx),
  };
}
