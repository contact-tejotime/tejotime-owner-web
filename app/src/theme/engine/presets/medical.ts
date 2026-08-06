/**
 * `medical` — hospital, clinic, dental, diagnostics, veterinary.
 *
 * Cool blue-grey neutrals that read as clean rather than cold, a calm emerald accent for
 * "available / confirmed" states, and deliberately understated motion — a patient checking
 * a queue position does not want a page that bounces.
 */

import type { PresetDefinition } from '../types';

export const medical: PresetDefinition = {
  id: 'medical',
  label: 'Medical',
  description:
    'Clean cool neutrals, calm green accent, restrained motion. Built for clarity under stress.',

  neutralsLight: {
    0: '#ffffff',
    50: '#f7fafc',
    100: '#eef4f8',
    200: '#dce7ef',
    300: '#c2d4e0',
    400: '#93a9b8',
    500: '#64798a',
    600: '#4a5c6b',
    700: '#35434f',
    800: '#222c34',
    900: '#131a1f',
  },

  neutralsDark: {
    0: '#f7fafc',
    50: '#e6eef4',
    100: '#d3e0ea',
    200: '#aec2d0',
    300: '#93a9b8',
    400: '#64798a',
    500: '#4a5c6b',
    600: '#35434f',
    700: '#222c34',
    800: '#131a1f',
    900: '#0a0f13',
  },

  /* emerald-500. Reads "healthy" without colliding with the `--success` semantic scale. */
  accent: { kind: 'fixed', hex: '#10b981', step: 500 },

  defaults: { radius: 'medium', shadow: 'soft', density: 'comfortable', animation: 'subtle' },
  typeSet: 'clinical',
  heroVariant: 'trust',
  borderWidth: '1px',

  hero: {
    angle: '135deg',
    light: [{ from: 'brand', step: 800 }, { from: 'brand', step: 700 }, { from: 'accent', step: 800 }],
    dark: [{ from: 'neutral', step: 900 }, { from: 'brand', step: 900 }, { from: 'accent', step: 900 }],
  },
};
