/**
 * `minimal` — the parity preset.
 *
 * Its light neutral ramp IS the `--gray-*` scale in frontend/src/app/globals.css and its
 * accent IS teal-500 (today's `--secondary`). Combined with radius `medium` / shadow `soft` /
 * density `comfortable` / animation `normal`, resolving it against brand #2563EB reproduces
 * the live microsite exactly. Changing any value in this file changes every existing store.
 */

import type { PresetDefinition } from '../types';

export const minimal: PresetDefinition = {
  id: 'minimal',
  label: 'Minimal',
  description:
    'Apple/Notion calm. Cool slate neutrals, lots of white space, quiet motion. The safe default.',

  /* Exactly globals.css `--gray-0` … `--gray-900`. */
  neutralsLight: {
    0: '#ffffff',
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },

  /**
   * Dark ramp, same orientation (0 lightest → 900 darkest) but re-tuned so the dark end has
   * the four steps a dark UI actually needs: page (900), card (800), raised (700), rule (600).
   * The light end supplies text. It is deliberately NOT the light ramp reversed.
   */
  neutralsDark: {
    0: '#f8fafc',
    50: '#e9eef5',
    100: '#dbe3ed',
    200: '#b9c4d3',
    300: '#94a3b8',
    400: '#64748b',
    500: '#475569',
    600: '#334155',
    700: '#1e293b',
    800: '#0f172a',
    900: '#070c17',
  },

  /* teal-500 — preserves `--secondary` / `--secondary-hover` / `--secondary-soft*`. */
  accent: { kind: 'fixed', hex: '#14b8a6', step: 500 },

  defaults: { radius: 'medium', shadow: 'soft', density: 'comfortable', animation: 'normal' },
  typeSet: 'geometric',
  heroVariant: 'split-classic',
  borderWidth: '1px',

  hero: {
    angle: '125deg',
    /* Deep brand → brand → deep accent: three dark stops, so one white label clears all of them. */
    light: [{ from: 'brand', step: 800 }, { from: 'brand', step: 600 }, { from: 'accent', step: 700 }],
    dark: [{ from: 'neutral', step: 900 }, { from: 'brand', step: 800 }, { from: 'accent', step: 800 }],
  },
};
