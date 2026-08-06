/**
 * Hero variant catalogue — CONTRACT ONLY.
 *
 * The layouts themselves land in a later change (a `HeroVariantId` → component map inside
 * frontend/src/components/microsite/). This file exists now so the admin picker, the theme
 * config validator and the preset definitions can all name the same six variants without
 * waiting on that work, and so adding a seventh is a one-line change here plus a component.
 *
 * The colours a hero paints with are NOT here: they come out of resolve.ts as
 * `--hero-from` / `--hero-via` / `--hero-to` / `--on-hero` / `--hero-angle`, already
 * contrast-checked for the active mode.
 */

import type { HeroVariantId, HeroVariantMeta, PresetId } from './types';

export const HERO_VARIANTS: Record<HeroVariantId, HeroVariantMeta> = {
  'split-classic': {
    id: 'split-classic',
    label: 'Split — classic',
    description:
      'Copy left, booking card right, gradient panel behind. The current TejoTime microsite hero.',
    preset: 'minimal',
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    description:
      'Centred serif headline over a full-width image with a soft scrim; the CTA sits below the fold line.',
    preset: 'luxury',
  },
  'split-modern': {
    id: 'split-modern',
    label: 'Split — modern',
    description:
      'Flat neutral background, oversized tight-tracked headline, single primary CTA, thin rule beneath.',
    preset: 'modern',
  },
  'full-bleed': {
    id: 'full-bleed',
    label: 'Full bleed',
    description:
      'Edge-to-edge photo, heavy uppercase headline over a hard scrim, CTA pinned bottom-left.',
    preset: 'bold',
  },
  trust: {
    id: 'trust',
    label: 'Trust',
    description:
      'Calm two-column with credential chips (hours, insurance, team size) directly under the headline.',
    preset: 'medical',
  },
  cozy: {
    id: 'cozy',
    label: 'Cozy',
    description:
      'Warm gradient wash, rounded image collage, menu/booking CTA pair centred beneath the headline.',
    preset: 'warm',
  },
};

/** Stable list for admin dropdowns — declaration order, not object key order. */
export const HERO_VARIANT_LIST: HeroVariantMeta[] = [
  HERO_VARIANTS['split-classic'],
  HERO_VARIANTS['split-modern'],
  HERO_VARIANTS.editorial,
  HERO_VARIANTS['full-bleed'],
  HERO_VARIANTS.trust,
  HERO_VARIANTS.cozy,
];

/** The variant a preset ships with when the admin has not picked one explicitly. */
export function defaultHeroVariantFor(preset: PresetId): HeroVariantId {
  const found = HERO_VARIANT_LIST.find((v) => v.preset === preset);
  return found ? found.id : 'split-classic';
}
