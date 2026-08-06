/**
 * `modern` — Vercel/Linear. Coworking, agencies, tech-adjacent services, repair shops.
 *
 * Pure-neutral zinc greys with no colour cast, one brand colour and nothing else: the accent
 * is a *tint of the brand* (ramp 400) rather than a second hue, which is what keeps the look
 * disciplined. Tight display tracking and restrained motion do the rest.
 */

import type { PresetDefinition } from '../types';

export const modern: PresetDefinition = {
  id: 'modern',
  label: 'Modern',
  description:
    'Neutral zinc greys, single-hue palette, very tight headline tracking, minimal motion.',

  neutralsLight: {
    0: '#ffffff',
    50: '#fafafa',
    100: '#f4f4f5',
    200: '#e4e4e7',
    300: '#d4d4d8',
    400: '#a1a1aa',
    500: '#71717a',
    600: '#52525b',
    700: '#3f3f46',
    800: '#27272a',
    900: '#18181b',
  },

  neutralsDark: {
    0: '#fafafa',
    50: '#f4f4f5',
    100: '#e4e4e7',
    200: '#c4c4c8',
    300: '#a1a1aa',
    400: '#71717a',
    500: '#52525b',
    600: '#3f3f46',
    700: '#27272a',
    800: '#18181b',
    900: '#09090b',
  },

  /* No second hue — the accent is the brand, lighter. */
  accent: { kind: 'brand-step', step: 400 },

  defaults: { radius: 'medium', shadow: 'soft', density: 'comfortable', animation: 'subtle' },
  typeSet: 'grotesk',
  heroVariant: 'split-modern',
  borderWidth: '1px',

  hero: {
    angle: '160deg',
    /* Near-monochrome wash; the brand only shows up at the far stop. */
    light: [{ from: 'neutral', step: 900 }, { from: 'neutral', step: 800 }, { from: 'brand', step: 800 }],
    dark: [{ from: 'neutral', step: 900 }, { from: 'neutral', step: 800 }, { from: 'brand', step: 900 }],
  },
};
