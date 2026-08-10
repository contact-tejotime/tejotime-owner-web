/** Domain constants ported from the app design (see app/src/*). */

/** Service/seat color tokens — from app/src/data/sample.ts ServiceColorToken. */
export const COLOR_TOKENS = ['primary', 'secondary', 'amber500', 'green500'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Fallback service duration when none resolves — matches lib/queue.ts (20 min). */
export const DEFAULT_SERVICE_MINUTES = 20;

/**
 * Service add-on catalog for "extend service". Clients pick a category-gated
 * subset; every label here must remain accepted by `extend` validation.
 * Prices are conservative defaults — checkout amount override still wins.
 */
export const SERVICE_EXTRAS = [
  // Default / Barber
  { label: 'Shave', minutes: 10, pricePaise: 5000 },
  { label: 'Beard trim', minutes: 15, pricePaise: 8000 },
  { label: 'Hair wash', minutes: 10, pricePaise: 5000 },
  { label: 'Hair color', minutes: 30, pricePaise: 30000 },
  { label: 'Touch-up cut', minutes: 15, pricePaise: 8000 },
  { label: 'Mustache trim', minutes: 10, pricePaise: 5000 },
  { label: 'Blow-dry', minutes: 15, pricePaise: 8000 },
  { label: 'Head massage', minutes: 15, pricePaise: 8000 },
  // Hospital
  { label: 'Consultation', minutes: 15, pricePaise: 15000 },
  { label: 'Injection', minutes: 10, pricePaise: 5000 },
  { label: 'Medication', minutes: 5, pricePaise: 3000 },
  { label: 'Check-up', minutes: 10, pricePaise: 5000 },
  { label: 'Blood test', minutes: 15, pricePaise: 15000 },
  { label: 'First aid', minutes: 10, pricePaise: 5000 },
  { label: 'Assisted care', minutes: 20, pricePaise: 10000 },
  { label: 'Dental', minutes: 20, pricePaise: 20000 },
  // Restaurant
  { label: 'Dine-in', minutes: 30, pricePaise: 5000 },
  { label: 'Burger', minutes: 15, pricePaise: 15000 },
  { label: 'Pizza', minutes: 20, pricePaise: 20000 },
  { label: 'Coffee', minutes: 10, pricePaise: 8000 },
  { label: 'Beverage', minutes: 5, pricePaise: 5000 },
  { label: 'Dessert', minutes: 10, pricePaise: 10000 },
  { label: 'Takeaway', minutes: 10, pricePaise: 5000 },
  { label: 'Chef special', minutes: 25, pricePaise: 25000 },
] as const;

export const API_PREFIX = '/api/v1';

/** Categories where a fixed service menu / staff roster doesn't fit the business — the public
 *  queue/booking flow (and the owner's manual walk-in flow) allow zero services/staff. */
export const OPTIONAL_SERVICES_STAFF_CATEGORIES = new Set(['Hospital', 'Restaurant']);

/** Categories where the customer/owner must identify the visitor as MR (Medical Representative)
 *  or Patient before joining the queue / booking a slot / adding a walk-in. */
export const VISITOR_TYPE_CATEGORIES = new Set(['Hospital']);
