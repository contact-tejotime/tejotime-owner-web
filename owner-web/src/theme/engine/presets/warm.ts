/**
 * `warm` — restaurant, café, bakery, food truck, tea house.
 *
 * Tan/oat neutrals and a warm-orange accent. Rounded corners and a friendly humanist type
 * set; motion stays at `normal` because a menu page is browsed, not studied.
 */

import type { PresetDefinition } from '../types';

export const warm: PresetDefinition = {
  id: 'warm',
  label: 'Warm',
  description:
    'Toasted tan neutrals, warm orange accent, rounded corners, friendly humanist type.',

  neutralsLight: {
    0: '#ffffff',
    50: '#fdf8f3',
    100: '#f7ede2',
    200: '#ebd9c6',
    300: '#d8bfa3',
    400: '#b08968',
    500: '#8a6a4b',
    600: '#6b5138',
    700: '#4a3827',
    800: '#34281c',
    900: '#201811',
  },

  neutralsDark: {
    0: '#faf3ec',
    50: '#efe2d5',
    100: '#e0cdba',
    200: '#c5a888',
    300: '#a98a68',
    400: '#87684a',
    500: '#655039',
    600: '#4a3a29',
    700: '#33281c',
    800: '#221a12',
    900: '#15100b',
  },

  accent: { kind: 'fixed', hex: '#e07a3f', step: 500 },

  defaults: { radius: 'rounded', shadow: 'soft', density: 'comfortable', animation: 'normal' },
  typeSet: 'friendly',
  heroVariant: 'cozy',
  borderWidth: '1px',

  hero: {
    angle: '130deg',
    /* Roasted-brown ground with the orange pushed to the far stop — appetising, not neon. */
    light: [{ from: 'neutral', step: 900 }, { from: 'brand', step: 800 }, { from: 'accent', step: 700 }],
    dark: [{ from: 'neutral', step: 900 }, { from: 'neutral', step: 800 }, { from: 'accent', step: 900 }],
  },
};
