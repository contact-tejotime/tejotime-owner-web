/**
 * Type sets — one per preset.
 *
 * HARD CONSTRAINT: no page pays for a font it does not paint with. Every stack below is either
 * a face the app already loads (`--font-inter`, wired up in the Next root layout), a system
 * face that exists on the platform, or — for `luxury` alone — a next/font face registered with
 * `preload: false`, which the browser fetches only if that preset actually renders. A preset
 * expresses itself mostly through weight, tracking and casing, not through a font download.
 *
 * These emit `--font-display` / `--font-body` AND override the legacy `--font-sans` inside the
 * themed scope. That last part is what makes them matter: MicrositeClient names
 * `var(--font-sans)` in ~100 inline styles, so before the override a preset's typography reached
 * almost nothing on the page.
 */

import type { TypeSet, TypeSetId } from './types';

/** The stack globals.css uses for `--font-sans`. Kept for `modern`, whose whole look is Inter. */
const INTER =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Plus Jakarta Sans — the default voice.
 *
 * Registered with next/font in the root layout, and already the owner app's face, so the
 * microsite, the app and the admin preview all read as one product. It carries more character
 * than Inter at heading sizes (higher contrast, more open counters) while staying as legible
 * in body copy, which is what the sections needed once headings grew to 42px.
 */
const JAKARTA =
  'var(--font-jakarta), "Plus Jakarta Sans", var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Editorial serif for `luxury`.
 *
 * `--font-display-serif` is Playfair Display, registered with next/font in the frontend root
 * layout — self-hosted at build time, `preload: false`, so it is only fetched when a page
 * actually paints with it (i.e. a luxury store). Every other preset uses INTER and never
 * touches this stack, so no existing microsite gains a request.
 *
 * The `var()` carries a literal fallback on purpose: the admin mirror of this engine runs in a
 * document that does not define `--font-display-serif`, and a bare `var()` on an undefined
 * property would make the whole `--font-display` declaration invalid-at-computed-value-time.
 * Behind it, the old-style serifs that ship with macOS/iOS/Windows.
 */
const SERIF =
  'var(--font-display-serif, "Playfair Display"), "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif';

/** Heavy grotesque for gym/tattoo headlines. Arial Black is the universal fallback. */
const HEAVY =
  '"Helvetica Neue", "Arial Black", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Rounded-ish humanist for hospitality. Avenir Next / Segoe UI Variable where available. */
const HUMANIST =
  '"Avenir Next", Avenir, "Segoe UI", var(--font-inter), "Inter", Roboto, Helvetica, Arial, sans-serif';

export const TYPE_SETS: Record<TypeSetId, TypeSet> = {
  /** minimal — the current TejoTime voice. Quiet, tight-ish headings, normal body. */
  geometric: {
    id: 'geometric',
    display: JAKARTA,
    body: JAKARTA,
    weightDisplay: '800',
    weightBody: '400',
    weightLabel: '600',
    trackingDisplay: '-0.02em',
    trackingBody: '0em',
    trackingLabel: '0.01em',
    labelTransform: 'none',
  },

  /** luxury — serif headlines over sans body, wide uppercase eyebrows. */
  'serif-display': {
    id: 'serif-display',
    display: SERIF,
    body: JAKARTA,
    weightDisplay: '600',
    weightBody: '400',
    weightLabel: '600',
    trackingDisplay: '-0.005em',
    trackingBody: '0.005em',
    trackingLabel: '0.14em',
    labelTransform: 'uppercase',
  },

  /** modern — Vercel/Linear. Aggressively tight display tracking is the whole look. */
  grotesk: {
    id: 'grotesk',
    display: INTER,
    body: INTER,
    weightDisplay: '600',
    weightBody: '400',
    weightLabel: '500',
    trackingDisplay: '-0.035em',
    trackingBody: '-0.011em',
    trackingLabel: '0em',
    labelTransform: 'none',
  },

  /** bold — maximum weight, uppercase micro-labels, letter-spaced out. */
  'condensed-heavy': {
    id: 'condensed-heavy',
    display: HEAVY,
    body: JAKARTA,
    weightDisplay: '900',
    weightBody: '500',
    weightLabel: '800',
    trackingDisplay: '-0.03em',
    trackingBody: '0em',
    trackingLabel: '0.12em',
    labelTransform: 'uppercase',
  },

  /** medical — plain, legible, nothing clever. Slightly looser body for scanability. */
  clinical: {
    id: 'clinical',
    display: JAKARTA,
    body: JAKARTA,
    weightDisplay: '700',
    weightBody: '400',
    weightLabel: '600',
    trackingDisplay: '-0.01em',
    trackingBody: '0.003em',
    trackingLabel: '0.02em',
    labelTransform: 'none',
  },

  /** warm — friendly humanist, relaxed tracking, small-caps-ish labels. */
  friendly: {
    id: 'friendly',
    display: HUMANIST,
    body: JAKARTA,
    weightDisplay: '700',
    weightBody: '400',
    weightLabel: '600',
    trackingDisplay: '-0.015em',
    trackingBody: '0.004em',
    trackingLabel: '0.08em',
    labelTransform: 'uppercase',
  },
};
