/**
 * The canonical amenity vocabulary for "autofill a store from a business name"
 * (docs/store-autofill-from-name.md §Amenities). Pure and import-free, so it is unit-testable.
 *
 * WHY THIS LIST EXISTS. Amenities are free text everywhere else in the product — admin-panel,
 * owner-web and the app all use plain "+ Add amenity" rows, and the microsite shows every amenity
 * with the same ✓ icon. Autofill pulls amenities from three sources that each phrase things their
 * own way ("AC", "Fully air-conditioned", "a/c"…), so it maps everything onto ONE set of names here
 * and drops anything that does not match, rather than pasting raw page text onto a customer page.
 *
 * Sources, in priority order (see store-autofill.service.ts):
 *  A) Google Places booleans   → `amenitiesFromGoogle`   confirmed, filled
 *  B) the business website     → `canonicalAmenity`      confirmed, filled — only if written there
 *  C) category suggestions     → `suggestAmenities`      NOT confirmed — offered as tap-to-add chips
 */

export const AMENITIES = [
  // A — Google data
  'Free parking',
  'Free street parking',
  'Paid parking',
  'Valet parking',
  'Wheelchair accessible entrance',
  'Wheelchair accessible parking',
  'Wheelchair accessible restroom',
  'Restroom',
  'Kid friendly',
  'Pet friendly',
  // B — what a business website typically lists
  'Air conditioned',
  'Free Wi-Fi',
  'Waiting area',
  'Complimentary tea/coffee',
  'Separate ladies section',
  'Private rooms',
  'Shower',
  'Lockers',
  'Changing room',
  'Bridal room',
  'Pickup & drop',
  // C — extra names used by the category suggestions
  'TV',
  'Phone charging',
  'Complimentary drinks',
  'Massage chairs',
  'Robes & slippers',
  'Relaxation lounge',
  'Couples room',
  'Private treatment rooms',
  'Consultation room',
  'Waiting lounge',
  'Lift/elevator',
  'Private booth',
  'Music',
  'Viewing window',
  'Pet treats',
] as const;

export type Amenity = (typeof AMENITIES)[number];

/** At most this many CONFIRMED amenities (A + B) are filled; suggestions are separate. */
export const MAX_AUTOFILL_AMENITIES = 8;

/** Loose key for exact-name matching: case, "&"/"and", and punctuation do not matter. */
const keyOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const BY_KEY = new Map<string, Amenity>(AMENITIES.map((a) => [keyOf(a), a]));

const ACCESS = /(wheel ?chair|disab|handicap|accessib)/;

/**
 * Phrasing rules, FIRST MATCH WINS — so the specific ones sit above the general ones (wheelchair
 * restroom before restroom, street parking before free parking, a waiting lounge before a waiting
 * area, private treatment rooms before private rooms). Each test sees the lower-cased raw text.
 */
const RULES: ReadonlyArray<readonly [Amenity, (s: string) => boolean]> = [
  ['Wheelchair accessible restroom', (s) => ACCESS.test(s) && /(rest ?room|toilet|washroom|bath ?room|lavatory)/.test(s)],
  ['Wheelchair accessible parking', (s) => ACCESS.test(s) && /park/.test(s)],
  ['Wheelchair accessible entrance', (s) => /(wheel ?chair|step[- ]free|\bramps?\b)/.test(s) || /accessible (entrance|entry|door)/.test(s)],
  ['Valet parking', (s) => /valet/.test(s)],
  ['Free street parking', (s) => /street/.test(s) && /park/.test(s) && /free/.test(s)],
  ['Paid parking', (s) => /(paid|pay)[- ]?(parking|lot|garage)|parking (fees?|charges?)/.test(s)],
  ['Free parking', (s) => /(free|complimentary)/.test(s) && /park/.test(s)],
  ['Restroom', (s) => /(rest ?room|toilet|washroom|bath ?room|lavatory|\bwc\b)/.test(s)],
  ['Kid friendly', (s) => /(kid|child|family).{0,12}(friendly|welcome|area|corner|zone|play)|play ?area/.test(s)],
  ['Pet treats', (s) => /(pet|dog|cat)s? treats?|treats? for (pets|dogs|cats)/.test(s)],
  ['Pet friendly', (s) => /(pet|dog)s?[- ]?(friendly|welcome|allowed)|(pets|dogs) (are )?(welcome|allowed)/.test(s)],
  // No payment amenities (tap to pay, cards, UPI…): how a store takes money is not an amenity, so
  // such text matches nothing here and is dropped.
  ['Air conditioned', (s) => /(air[- ]?condition|\ba\/c\b|\bac\b|climate[- ]?controll)/.test(s)],
  ['Free Wi-Fi', (s) => /(wi[- ]?fi|wireless internet|internet access)/.test(s)],
  ['Massage chairs', (s) => /(massage|pedicure) chairs?/.test(s)],
  ['Waiting lounge', (s) => /waiting lounge/.test(s)],
  ['Relaxation lounge', (s) => /relax/.test(s) && /(lounge|room|area|zone|space)/.test(s)],
  ['Waiting area', (s) => /(waiting|seating area|reception area)/.test(s)],
  ['Complimentary tea/coffee', (s) => /\b(tea|coffee|chai|espresso|cappuccino)\b/.test(s)],
  ['Complimentary drinks', (s) => /\b(drinks?|beverages?|refreshments?|juices?|mocktails?|champagne|wine)\b/.test(s)],
  ['Separate ladies section', (s) => /(ladies|women|female)/.test(s) && /(section|area|only|separate|zone)/.test(s)],
  ['Private treatment rooms', (s) => /private treatment/.test(s)],
  ['Private booth', (s) => /private booths?/.test(s)],
  ['Couples room', (s) => /couples?/.test(s) && /(room|suite|massage|area)/.test(s)],
  ['Consultation room', (s) => /consult\w*\s+(room|area|space)/.test(s)],
  // No "spaces" here on purpose: "private parking spaces" is not a private room.
  ['Private rooms', (s) => /private/.test(s) && /\b(rooms?|cabins?|suites?)\b/.test(s)],
  ['Shower', (s) => /shower/.test(s)],
  ['Lockers', (s) => /locker/.test(s)],
  ['Changing room', (s) => /(chang\w*\s+(room|area)|dressing room|change room)/.test(s)],
  ['Robes & slippers', (s) => /\b(robes?|slippers?)\b/.test(s)],
  ['Bridal room', (s) => /bridal\s+(room|suite|area|lounge|studio)/.test(s)],
  ['Pickup & drop', (s) => /(pick[- ]?up|drop[- ]?off|pick (and|&) drop|pet taxi)/.test(s)],
  ['TV', (s) => /(\btv\b|television|netflix)/.test(s)],
  ['Phone charging', (s) => /(charging|charger|power (socket|outlet)|\busb\b)/.test(s)],
  // Not a "lash lift" or "brow lift" — those are services, not a building lift.
  ['Lift/elevator', (s) => /(?<!lash |brow )\blift\b|elevator/.test(s)],
  ['Music', (s) => /(\bmusic\b|playlist|sound system)/.test(s)],
  ['Viewing window', (s) => /(viewing window|watch your pet|see your pet)/.test(s)],
];

/**
 * The canonical name for a piece of free text, or null when it matches nothing ("skip if no match").
 * Never invents: an unqualified "Parking available" says neither free nor paid, so it is skipped.
 */
export function canonicalAmenity(raw: unknown): Amenity | null {
  if (typeof raw !== 'string') return null;
  const exact = BY_KEY.get(keyOf(raw));
  if (exact) return exact;
  const s = raw.toLowerCase();
  for (const [name, test] of RULES) if (test(s)) return name;
  return null;
}

/** The Places (New) fields we read, as they arrive (every flag may be absent). */
export interface GoogleAmenityFacts {
  parkingOptions?: {
    freeParkingLot?: boolean;
    paidParkingLot?: boolean;
    freeStreetParking?: boolean;
    paidStreetParking?: boolean;
    valetParking?: boolean;
    freeGarageParking?: boolean;
    paidGarageParking?: boolean;
  };
  accessibilityOptions?: {
    wheelchairAccessibleParking?: boolean;
    wheelchairAccessibleEntrance?: boolean;
    wheelchairAccessibleRestroom?: boolean;
    wheelchairAccessibleSeating?: boolean;
  };
  restroom?: boolean;
  goodForChildren?: boolean;
  allowsDogs?: boolean;
}

/** Source A: only flags Google says are TRUE (false or missing adds nothing). */
export function amenitiesFromGoogle(g: GoogleAmenityFacts): Amenity[] {
  const out: Amenity[] = [];
  const p = g.parkingOptions ?? {};
  if (p.freeParkingLot === true || p.freeGarageParking === true) out.push('Free parking');
  if (p.freeStreetParking === true) out.push('Free street parking');
  if (p.paidParkingLot === true || p.paidGarageParking === true || p.paidStreetParking === true) out.push('Paid parking');
  if (p.valetParking === true) out.push('Valet parking');
  const a = g.accessibilityOptions ?? {};
  if (a.wheelchairAccessibleEntrance === true) out.push('Wheelchair accessible entrance');
  if (a.wheelchairAccessibleParking === true) out.push('Wheelchair accessible parking');
  if (a.wheelchairAccessibleRestroom === true) out.push('Wheelchair accessible restroom');
  if (g.restroom === true) out.push('Restroom');
  if (g.goodForChildren === true) out.push('Kid friendly');
  if (g.allowsDogs === true) out.push('Pet friendly');
  return out;
}

/**
 * The confirmed amenities: each list mapped to canonical names (unmatched text dropped), merged in
 * the order given — Google first, then the website — de-duplicated and capped at
 * MAX_AUTOFILL_AMENITIES.
 */
export function mergeAmenities(...lists: ReadonlyArray<readonly unknown[]>): Amenity[] {
  const out: Amenity[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const name = canonicalAmenity(raw);
      if (!name || out.includes(name)) continue;
      out.push(name);
      if (out.length >= MAX_AUTOFILL_AMENITIES) return out;
    }
  }
  return out;
}

/** Source C: the category's suggestions, minus anything already confirmed by A or B. */
export function suggestAmenities(suggestions: readonly string[], confirmed: readonly string[]): Amenity[] {
  const have = new Set(confirmed.map((c) => canonicalAmenity(c) ?? c));
  const out: Amenity[] = [];
  for (const raw of suggestions) {
    const name = canonicalAmenity(raw);
    if (!name || have.has(name) || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}
