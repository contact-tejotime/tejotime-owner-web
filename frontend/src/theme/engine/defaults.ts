/**
 * Defaults, category suggestions, and the untrusted-input normaliser.
 *
 * The single most important thing in this file is `LEGACY_THEME_CONFIG`. Every business row
 * whose `theme` jsonb is NULL — which today is all of them — resolves through it, and it must
 * keep producing exactly what frontend/src/app/globals.css produces. It is frozen. Never edit
 * it; if the default look should change, change `DEFAULT_THEME_CONFIG`, which only applies to
 * stores that have actively saved a theme.
 *
 * `normalizeThemeConfig()` is the boundary between Postgres jsonb (arbitrary, possibly
 * hand-edited, possibly from an older schema version) and the rest of the engine. It never
 * throws and never returns a partial object.
 */

import type {
  AnimationId,
  BrandInkId,
  DensityId,
  HeroVariantId,
  ModeId,
  PresetId,
  RadiusId,
  ShadowId,
  ThemeConfig,
} from './types';
import {
  ANIMATION_IDS,
  BRAND_INK_IDS,
  DENSITY_IDS,
  HERO_VARIANT_IDS,
  MODE_IDS,
  PRESET_IDS,
  RADIUS_IDS,
  SHADOW_IDS,
} from './types';
import { isHex } from './color/oklch';

/**
 * The pixel-parity config. Resolving this reproduces globals.css token for token.
 * FROZEN — see the file header.
 */
export const LEGACY_THEME_CONFIG: ThemeConfig = Object.freeze({
  preset: 'minimal',
  mode: 'light',
  brand: '#2563EB',
  radius: 'medium',
  shadow: 'soft',
  density: 'comfortable',
  animation: 'normal',
});

/**
 * What the admin form seeds a *new* store with.
 *
 * Deliberately does NOT pin the four modifier axes: leaving them unset is what lets a store
 * that later switches to `bold` pick up sharp corners and compact spacing instead of dragging
 * `minimal`'s soft/comfortable settings along. It still resolves identically to
 * `LEGACY_THEME_CONFIG` today, because `minimal`'s own defaults are those same values — the
 * self-check asserts exactly that.
 *
 * Corollary for the admin UI: only send `radius`/`shadow`/`density`/`animation` when the
 * control has actually been moved off its "Preset default" position. Use
 * `getPreset(id).defaults` to label that position.
 */
export const DEFAULT_THEME_CONFIG: ThemeConfig = Object.freeze({
  preset: 'minimal',
  mode: 'light',
  brand: '#2563EB',
});

/* ============================================================
   Category → preset suggestion
   ------------------------------------------------------------
   SUGGESTION ONLY. This is consulted when the admin creates a
   store and picks a category, to pre-fill the preset field. It
   is never consulted at render time, so re-categorising an
   existing store cannot change how its microsite looks.
   ============================================================ */

/**
 * Keyword → preset, matched as WHOLE WORDS against the lower-cased category.
 *
 * `master_data.business_category` is free text ("Salon & Barber", "Hospital", "Restaurant")
 * and admins add rows without telling us, so this has to be forgiving — but not by substring:
 * "Coworking Space" contains "spa", and "Hospitality" contains "hospital". Word matching is
 * dumber, predictable, and the cost is spelling out the plurals below.
 *
 * Order matters: the first entry whose keyword appears wins, so "Salon & Barber" lands on
 * luxury rather than bold.
 */
export const CATEGORY_PRESETS: readonly (readonly [string, PresetId])[] = [
  /* Health — first, so "dental clinic" cannot fall through to something else. */
  ['hospital', 'medical'],
  ['hospitals', 'medical'],
  ['clinic', 'medical'],
  ['clinics', 'medical'],
  ['dental', 'medical'],
  ['dentist', 'medical'],
  ['dentists', 'medical'],
  ['doctor', 'medical'],
  ['doctors', 'medical'],
  ['physio', 'medical'],
  ['physiotherapy', 'medical'],
  ['diagnostic', 'medical'],
  ['diagnostics', 'medical'],
  ['pathology', 'medical'],
  ['medical', 'medical'],
  ['medicine', 'medical'],
  ['health', 'medical'],
  ['healthcare', 'medical'],
  ['pharmacy', 'medical'],
  ['veterinary', 'medical'],
  ['vet', 'medical'],
  ['optical', 'medical'],
  ['optician', 'medical'],
  ['opticians', 'medical'],

  /* Food. */
  ['restaurant', 'warm'],
  ['restaurants', 'warm'],
  ['cafe', 'warm'],
  ['café', 'warm'],
  ['cafes', 'warm'],
  ['coffee', 'warm'],
  ['bakery', 'warm'],
  ['bakeries', 'warm'],
  ['baker', 'warm'],
  ['bakers', 'warm'],
  ['dining', 'warm'],
  ['food', 'warm'],
  ['foods', 'warm'],
  ['kitchen', 'warm'],
  ['bistro', 'warm'],
  ['pizzeria', 'warm'],
  ['catering', 'warm'],
  ['tea', 'warm'],
  ['juice', 'warm'],

  /* High-touch personal care. */
  ['spa', 'luxury'],
  ['spas', 'luxury'],
  ['salon', 'luxury'],
  ['salons', 'luxury'],
  ['beauty', 'luxury'],
  ['nail', 'luxury'],
  ['nails', 'luxury'],
  ['makeup', 'luxury'],
  ['bridal', 'luxury'],
  ['jewellery', 'luxury'],
  ['jewelry', 'luxury'],
  ['jeweller', 'luxury'],
  ['jeweler', 'luxury'],
  ['boutique', 'luxury'],
  ['wellness', 'luxury'],
  ['aesthetics', 'luxury'],

  /* High-energy. `barber` sits here rather than with salons — barbershops skew bold. */
  ['gym', 'bold'],
  ['gyms', 'bold'],
  ['fitness', 'bold'],
  ['crossfit', 'bold'],
  ['boxing', 'bold'],
  ['martial', 'bold'],
  ['tattoo', 'bold'],
  ['tattoos', 'bold'],
  ['piercing', 'bold'],
  ['gaming', 'bold'],
  ['esport', 'bold'],
  ['esports', 'bold'],
  ['barber', 'bold'],
  ['barbers', 'bold'],
  ['barbershop', 'bold'],

  /* Professional / technical. */
  ['coworking', 'modern'],
  ['software', 'modern'],
  ['tech', 'modern'],
  ['technology', 'modern'],
  ['agency', 'modern'],
  ['consulting', 'modern'],
  ['consultant', 'modern'],
  ['legal', 'modern'],
  ['law', 'modern'],
  ['finance', 'modern'],
  ['bank', 'modern'],
  ['banking', 'modern'],
  ['automotive', 'modern'],
  ['auto', 'modern'],
  ['repair', 'modern'],
  ['service', 'modern'],
  ['services', 'modern'],
  ['education', 'modern'],
  ['coaching', 'modern'],
];

/**
 * Suggested preset for a free-text business category. Falls back to `minimal`.
 *
 * SUGGESTION ONLY — see the section header. Never call this from a render path.
 */
export function presetForCategory(category: string | null | undefined): PresetId {
  if (typeof category !== 'string') return 'minimal';
  // Fold punctuation to spaces so "Salon & Barber", "salon/barber" and "SALON-BARBER" agree.
  // The À-ɏ range keeps accented Latin ("café") intact.
  const words = new Set(
    category
      .toLowerCase()
      .replace(/[^a-z0-9À-ɏ]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean),
  );
  if (words.size === 0) return 'minimal';
  for (const [keyword, preset] of CATEGORY_PRESETS) {
    if (words.has(keyword)) return preset;
  }
  return 'minimal';
}

/* ============================================================
   Normalisation
   ============================================================ */

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** `#abc` → `#aabbcc`, trims, upper-cases. Returns undefined for anything unusable. */
function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let v = value.trim();
  if (!v) return undefined;
  if (v[0] !== '#') v = `#${v}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
    v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return isHex(v) ? v.toUpperCase() : undefined;
}

/**
 * Repair arbitrary input into a usable `ThemeConfig`. Never throws.
 *
 * Two different fallback rules, on purpose:
 *
 * - `preset` / `mode` / `brand` have no preset-level default, so an invalid or missing value
 *   falls back to `base` (which defaults to the frozen legacy config). That is what makes
 *   `normalizeThemeConfig(null)` — a business row with `theme IS NULL` — resolve to exactly
 *   today's site.
 * - The four modifier axes and `heroVariant` stay ABSENT when the input object does not
 *   specify them, so `resolveTheme()` can fill them from the chosen preset. Inheriting them
 *   from `base` here would mean picking `bold` silently kept `minimal`'s soft shadows.
 *   `base` still supplies them when `input` is not a usable object at all.
 *
 * Callers that also have a legacy `business.theme_color` should layer it on top:
 *   `{ ...normalizeThemeConfig(row.theme), brand: row.theme_color }`
 */
export function normalizeThemeConfig(
  input: unknown,
  base: ThemeConfig = LEGACY_THEME_CONFIG,
): ThemeConfig {
  const safeBase: ThemeConfig = {
    preset: pick<PresetId>(base?.preset, PRESET_IDS, 'minimal'),
    mode: pick<ModeId>(base?.mode, MODE_IDS, 'light'),
    brand: normalizeHex(base?.brand) ?? '#2563EB',
  };
  assignOptional(safeBase, base ?? {});

  // Anything that is not a plain object (null, "", 4, [], a JSON string) → the base config.
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return safeBase;
  }

  const raw = input as Record<string, unknown>;
  const out: ThemeConfig = {
    preset: pick<PresetId>(raw.preset, PRESET_IDS, safeBase.preset),
    mode: pick<ModeId>(raw.mode, MODE_IDS, safeBase.mode),
    brand: normalizeHex(raw.brand) ?? safeBase.brand,
  };
  assignOptional(out, raw);
  return out;
}

/**
 * Copy the optional axes across when — and only when — the source carries a valid value.
 * Keys stay absent rather than becoming `undefined`, so the object round-trips through
 * JSON.stringify without noise and `'radius' in config` means what it looks like it means.
 */
function assignOptional(target: ThemeConfig, source: Record<string, unknown> | ThemeConfig): void {
  const raw = source as Record<string, unknown>;
  const radius = pickOptional<RadiusId>(raw.radius, RADIUS_IDS);
  if (radius) target.radius = radius;
  const shadow = pickOptional<ShadowId>(raw.shadow, SHADOW_IDS);
  if (shadow) target.shadow = shadow;
  const density = pickOptional<DensityId>(raw.density, DENSITY_IDS);
  if (density) target.density = density;
  const animation = pickOptional<AnimationId>(raw.animation, ANIMATION_IDS);
  if (animation) target.animation = animation;
  const hero = pickOptional<HeroVariantId>(raw.heroVariant, HERO_VARIANT_IDS);
  if (hero) target.heroVariant = hero;
  const accent = normalizeHex(raw.accent);
  if (accent) target.accent = accent;
  const button = normalizeHex(raw.button);
  if (button) target.button = button;
  const brandInk = pickOptional<BrandInkId>(raw.brandInk, BRAND_INK_IDS);
  if (brandInk) target.brandInk = brandInk;
}

function pickOptional<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
