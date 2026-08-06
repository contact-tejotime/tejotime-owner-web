/**
 * `bold` — gym, boxing, tattoo, barbershop, gaming café.
 *
 * The one preset that changes structure and not just colour: 2px borders, sharp corners,
 * compact spacing, 900-weight uppercase headlines. Light mode is white with near-black ink;
 * dark mode is true #000 (these businesses want black, not charcoal).
 *
 * The accent is the brand's complement (+180° hue). That is intentionally loud — and it is
 * the reason resolve.ts contrast-checks the accent pairings rather than trusting the recipe:
 * a low-chroma brand rotates into a muddy complement, and `ensureContrast` catches it.
 */

import type { PresetDefinition } from '../types';

export const bold: PresetDefinition = {
  id: 'bold',
  label: 'Bold',
  description:
    'High-contrast black & white, 2px borders, sharp corners, heavy uppercase type, complementary accent.',

  /* Near-black ink (#0a0a0a) rather than #000 in light mode — pure black on white buzzes. */
  neutralsLight: {
    0: '#ffffff',
    50: '#fafafa',
    100: '#f2f2f2',
    200: '#e0e0e0',
    300: '#c7c7c7',
    400: '#9e9e9e',
    500: '#757575',
    600: '#525252',
    700: '#333333',
    800: '#1a1a1a',
    900: '#0a0a0a',
  },

  /* True black at the page level; the four dark steps are the ones the spec calls for. */
  neutralsDark: {
    0: '#ffffff',
    50: '#f5f5f5',
    100: '#ededed',
    200: '#d4d4d4',
    300: '#a3a3a3',
    400: '#808080',
    500: '#4d4d4d',
    600: '#333333',
    700: '#1a1a1a',
    800: '#0d0d0d',
    900: '#000000',
  },

  accent: { kind: 'complementary', hueShift: 180, chromaBoost: 1.15, step: 600 },

  defaults: { radius: 'sharp', shadow: 'premium', density: 'compact', animation: 'rich' },
  typeSet: 'condensed-heavy',
  heroVariant: 'full-bleed',
  borderWidth: '2px',

  hero: {
    angle: '110deg',
    /* Black → brand → complement. Hard, saturated, no softening. */
    light: [{ from: 'neutral', step: 900 }, { from: 'brand', step: 800 }, { from: 'accent', step: 800 }],
    dark: [{ from: 'neutral', step: 900 }, { from: 'brand', step: 900 }, { from: 'accent', step: 900 }],
  },
};
