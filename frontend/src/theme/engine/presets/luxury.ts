/**
 * `luxury` — spa, high-end salon, jeweller, boutique clinic.
 *
 * Cream/beige neutrals instead of cool slate (a warm page ground is what separates "premium"
 * from "corporate"), a soft gold accent, serif headlines, deeper layered shadows and slower,
 * richer motion. Radius is `rounded` because hard corners read as utilitarian here.
 */

import type { PresetDefinition } from '../types';

export const luxury: PresetDefinition = {
  id: 'luxury',
  label: 'Luxury',
  description:
    'Warm cream neutrals, soft gold accent, serif headlines, deep shadows and unhurried motion.',

  neutralsLight: {
    0: '#ffffff',
    /**
     * Page cream. Lifted two steps per channel from the original #faf7f2 (same hue, same
     * channel spread) because that value's relative luminance put `--warning` #d97706 at
     * 2.98:1 on the page — under the 3:1 non-text floor. #fcf9f4 is 3.03:1, the same headroom
     * `minimal` (#f8fafc, 3.04) and `warm` (#fdf8f3, 3.02) have. Asserted by the
     * `warning-on-bg` contrast check, so it cannot silently regress.
     */
    50: '#fcf9f4',
    100: '#f3ede3',
    200: '#e7ddcd',
    300: '#d6c7af',
    400: '#b8a588',
    500: '#8c7b5e',
    600: '#6b5c43',
    700: '#4e4231',
    800: '#332b20',
    900: '#1c1712',
  },

  /* Warm-dark: espresso rather than charcoal, so the gold accent still reads as gold. */
  neutralsDark: {
    0: '#f7f2e9',
    50: '#ece4d6',
    100: '#ddd2bf',
    200: '#c3b599',
    300: '#a08d6d',
    400: '#7d6c50',
    500: '#5d5040',
    600: '#453b2e',
    700: '#2f2820',
    800: '#201b15',
    900: '#14100c',
  },

  accent: { kind: 'fixed', hex: '#c9a227', step: 500 },

  defaults: { radius: 'rounded', shadow: 'premium', density: 'comfortable', animation: 'rich' },
  typeSet: 'serif-display',
  heroVariant: 'editorial',
  borderWidth: '1px',

  hero: {
    angle: '135deg',
    /* Warm ink → brand → gold: an editorial band that still takes a light headline. */
    light: [{ from: 'neutral', step: 900 }, { from: 'brand', step: 800 }, { from: 'accent', step: 700 }],
    dark: [{ from: 'neutral', step: 900 }, { from: 'neutral', step: 800 }, { from: 'accent', step: 900 }],
  },
};
