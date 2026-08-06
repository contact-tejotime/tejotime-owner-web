/**
 * The four non-colour modifier axes: radius, shadow, density, animation.
 *
 * These are plain lookup tables on purpose — a store owner moves a segmented control, one row
 * of this file changes, and nothing else in the engine has to know. Colour never leaks in
 * here: shadows carry a *tint* and the focus ring a *brand*, both injected by resolve.ts.
 *
 * PARITY: `RADIUS_SCALES.medium`, `SHADOW_SCALES.soft`, `DENSITY_SCALES.comfortable` and
 * `ANIMATION_SCALES.normal` reproduce frontend/src/app/globals.css exactly. Do not "tidy"
 * their numbers — every existing microsite renders through them.
 */

import type {
  AnimationId,
  AnimationScale,
  DensityId,
  DensityScale,
  RadiusId,
  RadiusScale,
  ShadowId,
  ShadowScale,
} from './types';

/* ============================================================
   Radius
   ============================================================ */

export const RADIUS_SCALES: Record<RadiusId, RadiusScale> = {
  sharp: { xs: 2, sm: 3, md: 4, lg: 6, xl: 8, pill: 999, scale: 0.4 },
  /* Exactly today's globals.css values. */
  medium: { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999, scale: 1 },
  rounded: { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999, scale: 1.6 },
};

/* ============================================================
   Shadow
   ------------------------------------------------------------
   Layers are recipes, not strings: resolve.ts tints them with the
   preset's neutral-900 (so a warm theme casts a warm shadow) and
   the ring with the store brand.
   ============================================================ */

export const SHADOW_SCALES: Record<ShadowId, ShadowScale> = {
  /**
   * Flat. Everything collapses except `xs`, which stays a 1px hairline — without it cards
   * lose their edge entirely on a white-on-white layout. The ring is never removed.
   */
  none: {
    xs: [{ x: 0, y: 1, blur: 2, alpha: 0.06 }],
    sm: [],
    md: [],
    lg: [],
    xl: [],
    ring: [{ x: 0, y: 0, blur: 0, spread: 3, alpha: 0.35 }],
  },

  /** Byte-for-byte today's `--shadow-*` and `--ring`. */
  soft: {
    xs: [{ x: 0, y: 1, blur: 2, alpha: 0.06 }],
    sm: [
      { x: 0, y: 1, blur: 3, alpha: 0.08 },
      { x: 0, y: 1, blur: 2, alpha: 0.04 },
    ],
    md: [
      { x: 0, y: 4, blur: 12, alpha: 0.08 },
      { x: 0, y: 2, blur: 4, alpha: 0.04 },
    ],
    lg: [
      { x: 0, y: 12, blur: 28, alpha: 0.12 },
      { x: 0, y: 4, blur: 8, alpha: 0.06 },
    ],
    xl: [{ x: 0, y: 24, blur: 56, alpha: 0.18 }],
    ring: [{ x: 0, y: 0, blur: 0, spread: 3, alpha: 0.35 }],
  },

  /** Deeper, double-layered, heavier tint — reads as physical elevation on luxury/bold. */
  premium: {
    xs: [{ x: 0, y: 1, blur: 2, alpha: 0.07 }],
    sm: [
      { x: 0, y: 2, blur: 6, alpha: 0.09 },
      { x: 0, y: 1, blur: 2, alpha: 0.05 },
    ],
    md: [
      { x: 0, y: 8, blur: 24, alpha: 0.12 },
      { x: 0, y: 2, blur: 6, alpha: 0.06 },
    ],
    lg: [
      { x: 0, y: 20, blur: 48, alpha: 0.18 },
      { x: 0, y: 6, blur: 14, alpha: 0.08 },
    ],
    xl: [
      { x: 0, y: 40, blur: 90, alpha: 0.26 },
      { x: 0, y: 12, blur: 24, alpha: 0.1 },
    ],
    ring: [{ x: 0, y: 0, blur: 0, spread: 4, alpha: 0.3 }],
  },
};

/* ============================================================
   Density
   ============================================================ */

export const DENSITY_SCALES: Record<DensityId, DensityScale> = {
  /** Today's control heights; `--space-2` stays 8px so nothing already using it shifts. */
  comfortable: {
    controlH: { sm: 36, md: 44, lg: 52 },
    space: [4, 8, 12, 16, 20, 24, 32, 48],
    // Adjacent sections each contribute this, so the GAP between two is 2x — 96px a side
    // read as 192px of dead space on desktop. Tuned against the real page, not in the abstract.
    sectionY: 'clamp(30px, 4.4vw, 52px)',
    cardPad: 24,
    gapTight: 8,
    gap: 16,
    gapLoose: 32,
    scale: 1,
  },
  /** ~0.85×. For businesses with long service lists that want more above the fold. */
  compact: {
    controlH: { sm: 32, md: 38, lg: 44 },
    space: [4, 6, 10, 12, 16, 20, 28, 40],
    sectionY: 'clamp(22px, 3.2vw, 36px)',
    cardPad: 18,
    gapTight: 6,
    gap: 12,
    gapLoose: 24,
    scale: 0.85,
  },
};

/* ============================================================
   Animation
   ------------------------------------------------------------
   `--ease-standard` is identical across all three: it is already
   in globals.css and half the existing transitions reference it.
   Only `--ease-emphasis` and the durations move.
   ============================================================ */

const EASE_STANDARD = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const ANIMATION_SCALES: Record<AnimationId, AnimationScale> = {
  subtle: {
    durFast: '90ms',
    durNormal: '140ms',
    durSlow: '220ms',
    easeStandard: EASE_STANDARD,
    easeEmphasis: 'cubic-bezier(0.3, 0, 0.2, 1)',
    liftY: '0px',
    scaleHover: '1',
  },
  /** `--dur-fast: 120ms` and `--ease-standard` match globals.css. */
  normal: {
    durFast: '120ms',
    durNormal: '220ms',
    durSlow: '320ms',
    easeStandard: EASE_STANDARD,
    easeEmphasis: 'cubic-bezier(0.16, 0.84, 0.44, 1)',
    liftY: '-4px',
    scaleHover: '1.01',
  },
  rich: {
    durFast: '160ms',
    durNormal: '320ms',
    durSlow: '520ms',
    easeStandard: EASE_STANDARD,
    easeEmphasis: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
    liftY: '-6px',
    scaleHover: '1.02',
  },
};
