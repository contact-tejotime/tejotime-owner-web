/** Domain constants ported from the app design (see app/src/*). */

/** Service/seat color tokens — from app/src/data/sample.ts ServiceColorToken. */
export const COLOR_TOKENS = ['primary', 'secondary', 'amber500', 'green500'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Fallback service duration when none resolves — matches lib/queue.ts (20 min). */
export const DEFAULT_SERVICE_MINUTES = 20;

/**
 * Service add-on catalog for "extend service" — from
 * app/src/components/feedback/DetailPanel.tsx EXTRAS. Prices are a backend
 * addition (the mock had none — see docs/17 Q8); tune per business later.
 */
export const SERVICE_EXTRAS = [
  { label: 'Shave', minutes: 10, pricePaise: 5000 },
  { label: 'Beard trim', minutes: 15, pricePaise: 8000 },
  { label: 'Hair wash', minutes: 10, pricePaise: 5000 },
  { label: 'Hair color', minutes: 30, pricePaise: 30000 },
] as const;

export const API_PREFIX = '/api/v1';
