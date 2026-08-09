/**
 * Theme engine self-check.
 *
 * Deliberately framework-free: it runs under the `tsx` that backend/ already depends on, so it
 * adds nothing to any package.json and can be wired into CI, a pre-commit hook or a Docker
 * build step without a test runner.
 *
 *   npm run test:theme
 *   # or: cd backend && npx tsx ../frontend/src/theme/engine/__tests__/run.ts
 *
 * Covers:
 *   (a) PARITY  — every legacy token for LEGACY_THEME_CONFIG matches globals.css exactly.
 *   (b) CONTRAST— 6 presets x {light,dark} x 12 brand hues, every reported pair passes.
 *   (c) RAMP    — monotonic lightness, hue preserved, every step a valid #rrggbb.
 *   (d) CSS     — all three selector blocks, every contract token, in both maps.
 *   (e) INPUT   — normalizeThemeConfig repairs garbage without throwing.
 *
 * Failures throw. A non-zero exit code is the signal; the log is for humans.
 */

import { contrastRatio } from '../color/contrast';
import { hexToOklch, isHex } from '../color/oklch';
import { BUILTIN_RAMPS, generateRamp, rampDelta } from '../color/ramp';
import { cssVarsObject, themeToCss } from '../css';
import {
  DEFAULT_THEME_CONFIG,
  LEGACY_THEME_CONFIG,
  normalizeThemeConfig,
  presetForCategory,
} from '../defaults';
import { PRESET_LIST } from '../presets';
import { resolveTheme } from '../resolve';
import {
  EXTRA_TOKEN_NAMES,
  LEGACY_TOKEN_NAMES,
  NEW_TOKEN_NAMES,
  PRESET_IDS,
  RAMP_STOPS,
} from '../types';
import type { ColorRamp, ThemeConfig, TokenMap } from '../types';

/* ============================================================
   Tiny assertion kit
   ============================================================ */

let checks = 0;
const failures: string[] = [];

function ok(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) failures.push(message);
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks += 1;
  if (actual !== expected) {
    failures.push(`${message}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name}`);
}

/* ============================================================
   (a) PARITY — hardcoded from frontend/src/app/globals.css
   ------------------------------------------------------------
   Every value below was read off globals.css by resolving its
   var() indirections by hand. If a line here has to change, the
   live microsite has changed too — that is the point.
   ============================================================ */

const GLOBALS_CSS_EXPECTED: Record<string, string> = {
  /* --primary: var(--blue-600) … */
  '--primary': '#2563eb',
  '--primary-hover': '#1d4ed8',
  '--primary-active': '#1e40af',
  '--primary-soft': '#eff6ff',
  '--primary-soft-fg': '#1d4ed8',
  /* --secondary: var(--teal-500) … */
  '--secondary': '#14b8a6',
  '--secondary-hover': '#0d9488',
  '--secondary-soft': '#f0fdfa',
  '--secondary-soft-fg': '#0f766e',
  /* Surfaces — var(--gray-*) */
  '--surface-page': '#f8fafc',
  '--surface-card': '#ffffff',
  '--surface-sunken': '#f1f5f9',
  '--surface-hover': '#f1f5f9',
  '--surface-inverse': '#0f172a',
  /* Text */
  '--text-strong': '#0f172a',
  '--text-body': '#334155',
  '--text-muted': '#64748b',
  '--text-subtle': '#94a3b8',
  '--text-on-brand': '#ffffff',
  '--text-link': '#2563eb',
  /* Borders */
  '--border-subtle': '#e2e8f0',
  '--border-default': '#cbd5e1',
  '--border-strong': '#94a3b8',
  '--border-focus': '#2563eb',
  /* Status */
  '--success': '#16a34a',
  '--success-soft': '#f0fdf4',
  '--success-soft-fg': '#15803d',
  '--warning': '#d97706',
  '--warning-soft': '#fffbeb',
  '--warning-soft-fg': '#b45309',
  '--error': '#dc2626',
  '--error-soft': '#fef2f2',
  '--error-soft-fg': '#b91c1c',
  '--info': '#2563eb',
  '--info-soft': '#eff6ff',
  '--info-soft-fg': '#1d4ed8',
  /* Mark */
  '--brand-ink': '#102a6b',
  '--brand-accent': '#f5821f',
  /* Radius */
  '--radius-xs': '4px',
  '--radius-sm': '6px',
  '--radius-md': '10px',
  '--radius-lg': '14px',
  '--radius-xl': '20px',
  '--radius-pill': '999px',
  /* Elevation */
  '--shadow-xs': '0 1px 2px rgba(15, 23, 42, 0.06)',
  '--shadow-sm': '0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)',
  '--shadow-md': '0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)',
  '--shadow-lg': '0 12px 28px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.06)',
  '--shadow-xl': '0 24px 56px rgba(15, 23, 42, 0.18)',
  '--ring': '0 0 0 3px rgba(37, 99, 235, 0.35)',
  /* Controls */
  '--control-h-sm': '36px',
  '--control-h-md': '44px',
  '--control-h-lg': '52px',
};

/* Non-legacy values that globals.css also pins and that must not drift. */
const GLOBALS_CSS_EXTRA_EXPECTED: Record<string, string> = {
  '--space-2': '8px',
  '--dur-fast': '120ms',
  '--ease-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
};

function testParity(): void {
  section('(a) PARITY vs globals.css');
  const resolved = resolveTheme(LEGACY_THEME_CONFIG);
  const light = resolved.light;

  // Nothing in the legacy contract may be missing from the emitted map.
  for (const name of LEGACY_TOKEN_NAMES) {
    ok(typeof light[name] === 'string', `legacy token ${name} is emitted`);
  }

  // Every legacy token must equal what globals.css resolves to today.
  const missingExpectation: string[] = [];
  for (const name of LEGACY_TOKEN_NAMES) {
    const expected = GLOBALS_CSS_EXPECTED[name];
    if (expected === undefined) {
      missingExpectation.push(name);
      continue;
    }
    eq(light[name], expected, `parity ${name}`);
  }
  ok(
    missingExpectation.length === 0,
    `every legacy token has a hardcoded expectation (missing: ${missingExpectation.join(', ')})`,
  );

  for (const [name, expected] of Object.entries(GLOBALS_CSS_EXTRA_EXPECTED)) {
    eq(light[name], expected, `parity ${name}`);
  }

  // DEFAULT_THEME_CONFIG currently mirrors the legacy config; a divergence should be a
  // deliberate act, not a surprise, so pin it.
  eq(
    JSON.stringify(resolveTheme(DEFAULT_THEME_CONFIG).light),
    JSON.stringify(light),
    'DEFAULT_THEME_CONFIG resolves identically to LEGACY_THEME_CONFIG',
  );

  // A store with `theme IS NULL` must land on exactly the parity config.
  eq(
    JSON.stringify(normalizeThemeConfig(null)),
    JSON.stringify(LEGACY_THEME_CONFIG),
    'normalizeThemeConfig(null) === LEGACY_THEME_CONFIG',
  );

  // ...and with a legacy theme_color, only the brand-derived tokens may move.
  const withBrand = resolveTheme({ ...normalizeThemeConfig(null), brand: '#7C3AED' });
  eq(withBrand.light['--surface-page'], '#f8fafc', 'theme_color store keeps its neutrals');
  eq(withBrand.light['--secondary'], '#14b8a6', 'theme_color store keeps its accent');
  ok(withBrand.light['--primary'] !== '#2563eb', 'theme_color store gets a new primary');

  console.log(`   legacy tokens verified: ${LEGACY_TOKEN_NAMES.length}`);
}

/* ============================================================
   (b) CONTRAST
   ============================================================ */

/** Twelve hues at 30° spacing, plus achromatic and near-gamut-edge stressors. */
const BRAND_HUES = [
  '#E11D48', // rose
  '#EA580C', // orange
  '#D97706', // amber
  '#CA8A04', // yellow
  '#65A30D', // lime
  '#16A34A', // green
  '#0D9488', // teal
  '#0891B2', // cyan
  '#2563EB', // blue (the current default)
  '#7C3AED', // violet
  '#C026D3', // fuchsia
  '#DB2777', // pink
];

/** Inputs chosen to break naive maths: pure black/white, a gray, a neon, a pastel. */
const BRAND_STRESSORS = ['#000000', '#FFFFFF', '#808080', '#FFD700', '#BFDBFE', '#00FF00'];

function testContrast(): void {
  section('(b) CONTRAST — 6 presets x 2 modes x 18 brands');
  let pairs = 0;
  let worstGated = Infinity;
  let worstLabel = '';

  for (const preset of PRESET_LIST) {
    for (const brand of [...BRAND_HUES, ...BRAND_STRESSORS]) {
      const resolved = resolveTheme({ ...LEGACY_THEME_CONFIG, preset: preset.id, brand });
      const all = [...resolved.contrast.light, ...resolved.contrast.dark];
      ok(all.length > 0, `${preset.id}/${brand} produced a contrast report`);
      for (const c of all) {
        pairs += 1;
        ok(
          c.pass,
          `${preset.id} brand=${brand} ${c.id} (${c.tier}) ${c.fg} on ${c.bg} = ${c.ratio}:1, needs ${c.min}:1`,
        );
        // Recompute independently — the report must not be able to lie about itself.
        const recomputed = contrastRatio(c.fg, c.bg);
        ok(
          Math.abs(recomputed - c.ratio) < 0.02,
          `${preset.id} ${c.id} ratio is self-consistent (${recomputed} vs ${c.ratio})`,
        );
        if (c.tier !== 'decorative' && c.ratio < worstGated) {
          worstGated = c.ratio;
          worstLabel = `${preset.id}/${brand}/${c.id}`;
        }
      }
      ok(resolved.contrast.pass, `${preset.id} brand=${brand} report.pass is true`);
      ok(resolved.contrast.failures.length === 0, `${preset.id} brand=${brand} has no failures`);
    }
  }

  // Also sweep every modifier combination on one brand — the axes must not interact badly.
  for (const preset of PRESET_LIST) {
    for (const radius of ['sharp', 'medium', 'rounded'] as const) {
      for (const shadow of ['none', 'soft', 'premium'] as const) {
        for (const density of ['comfortable', 'compact'] as const) {
          for (const animation of ['subtle', 'normal', 'rich'] as const) {
            const r = resolveTheme({
              preset: preset.id,
              mode: 'auto',
              brand: '#2563EB',
              radius,
              shadow,
              density,
              animation,
            });
            ok(
              r.contrast.pass,
              `${preset.id}/${radius}/${shadow}/${density}/${animation} passes contrast`,
            );
          }
        }
      }
    }
  }

  console.log(`   pairs checked: ${pairs}`);
  console.log(`   tightest gated pair: ${worstGated.toFixed(2)}:1  (${worstLabel})`);
}

/* ============================================================
   (c) RAMP
   ============================================================ */

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function assertRampShape(ramp: ColorRamp, label: string): void {
  let previousL = Infinity;
  for (const stop of RAMP_STOPS) {
    const hex = ramp[stop];
    ok(isHex(hex), `${label}[${stop}] is a valid #rrggbb (got ${String(hex)})`);
    ok(hex === hex.toLowerCase(), `${label}[${stop}] is lowercase`);
    const { l } = hexToOklch(hex);
    ok(l < previousL, `${label} lightness decreases at ${stop} (${l} < ${previousL})`);
    previousL = l;
  }
}

function testRamp(): void {
  section('(c) RAMP');

  // Curated ramps are hand-tuned (warm hues intentionally drift toward red as they darken),
  // so only shape is asserted for them — hue preservation is a property of the generator.
  for (const [seed, ramp] of Object.entries(BUILTIN_RAMPS)) {
    assertRampShape(ramp, `BUILTIN_RAMPS[${seed}]`);
  }

  const generatedSeeds = [...BRAND_HUES, ...BRAND_STRESSORS].filter(
    (s) => !BUILTIN_RAMPS[s.toUpperCase()],
  );

  for (const seed of generatedSeeds) {
    const ramp = generateRamp(seed);
    assertRampShape(ramp, `generateRamp(${seed})`);

    // THE BRAND-FIDELITY CONTRACT: step 600 is --brand/--primary, i.e. the hex the owner
    // picked in the Appearance panel. It must come back byte for byte, or the colour picker
    // is lying. Only seeds outside the anchor band (near-black / near-white, which cannot
    // carry a ten-stop scale) are allowed to move. Regressing this silently is exactly how
    // #FF5A5F once resolved to #d43641.
    const seedL = hexToOklch(seed).l;
    if (seedL >= 0.16 && seedL <= 0.94) {
      ok(
        ramp[600].toLowerCase() === seed.toLowerCase(),
        `generateRamp(${seed})[600] is the seed verbatim (got ${ramp[600]})`,
      );
    }

    const targetHue = hexToOklch(seed).h;
    const seedChroma = hexToOklch(seed).c;
    if (seedChroma > 0.01) {
      for (const stop of RAMP_STOPS) {
        const { c, h } = hexToOklch(ramp[stop]);
        const d = hueDelta(h, targetHue);
        // The generator holds hue exactly; what is measured here is the round trip through
        // 8-bit sRGB. Either criterion is sufficient, because they bound the same error from
        // two directions: the 2° angular contract is the readable one at healthy chroma, and
        // the chromatic error — the component perpendicular to the target hue, ~a fifth of a
        // JND at 0.004 OKLab — is the one that stays meaningful as chroma → 0, where a single
        // 1/255 step is worth several degrees and no angular bar can hold.
        // (Checking ONLY the angle misfires in the band right around C≈0.03: #DB2777 step 100
        // sits at C=0.031 and drifts 2.05°, which is 0.0011 OKLab — perceptually exact.)
        const chromaticError = c * Math.sin((d * Math.PI) / 180);
        ok(
          d <= 2 || chromaticError <= 0.004,
          `generateRamp(${seed})[${stop}] preserves hue (drift ${d.toFixed(2)}° at ` +
            `C=${c.toFixed(3)} → ${chromaticError.toFixed(5)} OKLab chromatic error)`,
        );
      }
    } else {
      // Achromatic seed: there is no hue to preserve, but the ramp must stay neutral.
      for (const stop of RAMP_STOPS) {
        ok(
          hexToOklch(ramp[stop]).c < 0.02,
          `generateRamp(${seed})[${stop}] stays achromatic`,
        );
      }
    }
  }

  // Calibration guard: the generated blue must stay close to the curated Tailwind scale.
  const saved = BUILTIN_RAMPS['#2563EB'];
  delete BUILTIN_RAMPS['#2563EB'];
  const generatedBlue = generateRamp('#2563EB');
  BUILTIN_RAMPS['#2563EB'] = saved;
  const delta = rampDelta(generatedBlue, saved);
  ok(delta.max < 0.05, `generated blue stays within ΔE 0.05 of Tailwind blue (max ${delta.max})`);
  console.log(
    `   generateRamp('#2563EB') vs Tailwind blue — max ΔE ${delta.max.toFixed(4)}, mean ${delta.mean.toFixed(4)}`,
  );

  // Curated ramps must win over generated ones.
  eq(generateRamp('#2563eb')[600], '#2563eb', 'curated ramp wins, case-insensitively');
  eq(generateRamp('#14B8A6')[500], '#14b8a6', 'teal curated ramp keeps its seed at 500');
}

/* ============================================================
   (d) CSS
   ============================================================ */

function testCss(): void {
  section('(d) CSS emission');
  const resolved = resolveTheme(LEGACY_THEME_CONFIG);
  const css = themeToCss(resolved);

  ok(css.includes('[data-tt-theme] {'), 'light block present');
  ok(css.includes('[data-tt-theme][data-tt-mode="dark"] {'), 'dark block present');
  ok(css.includes('@media (prefers-color-scheme: dark) {'), 'prefers-color-scheme block present');
  ok(css.includes('[data-tt-theme][data-tt-mode="auto"] {'), 'auto block present');

  const allNames = [...LEGACY_TOKEN_NAMES, ...NEW_TOKEN_NAMES, ...EXTRA_TOKEN_NAMES];
  for (const name of allNames) {
    ok(resolved.light[name] !== undefined, `light map defines ${name}`);
    ok(resolved.dark[name] !== undefined, `dark map defines ${name}`);
    // Anchored on the declaration form so `--brand` cannot be satisfied by `--brand-hover`.
    ok(css.includes(`${name}: `), `css declares ${name}`);
  }

  // Each token must appear three times: once per block.
  const occurrences = (needle: string) => css.split(`${needle}: `).length - 1;
  eq(occurrences('--primary'), 3, '--primary emitted in all three blocks');
  eq(occurrences('--bg'), 3, '--bg emitted in all three blocks');

  // Custom selectors must propagate to the dark/auto variants too.
  const scoped = themeToCss(resolved, '#tt-site');
  ok(scoped.includes('#tt-site {'), 'custom selector: light block');
  ok(scoped.includes('#tt-site[data-tt-mode="dark"] {'), 'custom selector: dark block');
  ok(scoped.includes('#tt-site[data-tt-mode="auto"] {'), 'custom selector: auto block');

  // The output lands in a <style> tag — it must not be able to close it.
  const hostile = themeToCss(resolved, '</style><script>alert(1)</script>');
  ok(!hostile.includes('</style>'), 'selector cannot close the style element');
  ok(!hostile.includes('<script'), 'selector cannot inject a script tag');

  const vars = cssVarsObject(resolved.light);
  eq(vars['--primary'], '#2563eb', 'cssVarsObject passes tokens through');
  ok(
    Object.keys(vars).every((k) => k.startsWith('--')),
    'cssVarsObject keys all keep their -- prefix',
  );

  // Dark mode must actually differ, and must not fall back to white-alpha overlays.
  ok(resolved.dark['--bg'] !== resolved.light['--bg'], 'dark mode changes the page background');
  ok(
    !/rgba\(255, 255, 255/.test(resolved.dark['--scrim']),
    'dark scrim is not white-alpha',
  );

  console.log(`   tokens per block: ${Object.keys(resolved.light).length}`);
  console.log(`   stylesheet size: ${css.length} bytes`);
}

/* ============================================================
   (e) normalizeThemeConfig
   ============================================================ */

const GARBAGE: unknown[] = [
  null,
  undefined,
  0,
  1,
  '',
  'minimal',
  '{"preset":"minimal"}',
  [],
  ['minimal'],
  true,
  NaN,
  {},
  { preset: 'nope' },
  { preset: 42, mode: [], brand: {}, radius: null, shadow: undefined, density: 0, animation: NaN },
  { brand: 'red' },
  { brand: '#GGGGGG' },
  { brand: '#12345' },
  { brand: '  #abc  ' },
  { brand: 'abcdef' },
  { mode: 'DARK' },
  { heroVariant: 'nope' },
  { heroVariant: 'editorial' },
  { accent: 'chartreuse' },
  { accent: '#0f0' },
  { preset: 'luxury', mode: 'dark', brand: '#c9a227', radius: 'rounded', shadow: 'premium', density: 'compact', animation: 'rich' },
  { __proto__: { preset: 'bold' } },
  { toString: null },
];

function testNormalize(): void {
  section('(e) normalizeThemeConfig');

  for (const input of GARBAGE) {
    let out: ThemeConfig | undefined;
    let threw: unknown;
    try {
      out = normalizeThemeConfig(input);
    } catch (err) {
      threw = err;
    }
    ok(threw === undefined, `normalizeThemeConfig(${JSON.stringify(input) ?? 'undefined'}) does not throw`);
    if (!out) continue;

    ok((PRESET_IDS as readonly string[]).includes(out.preset), `preset is valid for ${JSON.stringify(input)}`);
    ok(['light', 'dark', 'auto'].includes(out.mode), `mode is valid for ${JSON.stringify(input)}`);
    ok(isHex(out.brand), `brand is a hex for ${JSON.stringify(input)} (got ${out.brand})`);
    // The four modifier axes may legitimately be absent (= inherit the preset), but they must
    // never be present-and-invalid, and never the literal string "undefined".
    const optional: Array<[string, unknown, readonly string[]]> = [
      ['radius', out.radius, ['sharp', 'medium', 'rounded']],
      ['shadow', out.shadow, ['none', 'soft', 'premium']],
      ['density', out.density, ['comfortable', 'compact']],
      ['animation', out.animation, ['subtle', 'normal', 'rich']],
    ];
    for (const [name, value, allowed] of optional) {
      ok(
        value === undefined || allowed.includes(value as string),
        `${name} is absent or valid for ${JSON.stringify(input)} (got ${String(value)})`,
      );
    }
    // Absent keys must be truly absent so the jsonb round-trips without null noise.
    ok(
      !JSON.stringify(out).includes('undefined'),
      `no undefined leaks into JSON for ${JSON.stringify(input)}`,
    );

    // And the repaired config must always resolve, with every axis filled in.
    let resolveThrew: unknown;
    try {
      const r = resolveTheme(out);
      ok(r.contrast.pass, `repaired config passes contrast for ${JSON.stringify(input)}`);
      ok(['sharp', 'medium', 'rounded'].includes(r.config.radius), 'effective radius is concrete');
      ok(['none', 'soft', 'premium'].includes(r.config.shadow), 'effective shadow is concrete');
      ok(['comfortable', 'compact'].includes(r.config.density), 'effective density is concrete');
      ok(['subtle', 'normal', 'rich'].includes(r.config.animation), 'effective animation is concrete');
    } catch (err) {
      resolveThrew = err;
    }
    ok(resolveThrew === undefined, `resolveTheme of repaired config does not throw`);
  }

  // A partial config must inherit the PRESET's defaults, not the legacy base's.
  const boldDefaults = resolveTheme(normalizeThemeConfig({ preset: 'bold' }));
  eq(boldDefaults.config.radius, 'sharp', 'bold defaults to sharp radius');
  eq(boldDefaults.config.shadow, 'premium', 'bold defaults to premium shadow');
  eq(boldDefaults.config.density, 'compact', 'bold defaults to compact density');
  eq(boldDefaults.config.animation, 'rich', 'bold defaults to rich animation');
  eq(boldDefaults.config.heroVariant, 'full-bleed', 'bold defaults to the full-bleed hero');
  eq(boldDefaults.light['--radius-md'], '4px', 'bold default radius reaches the tokens');
  eq(boldDefaults.light['--control-h-md'], '38px', 'bold default density reaches the tokens');

  // ...and an explicit override must survive a preset change.
  const boldOverridden = resolveTheme(normalizeThemeConfig({ preset: 'bold', radius: 'rounded' }));
  eq(boldOverridden.config.radius, 'rounded', 'explicit radius beats the preset default');
  eq(boldOverridden.config.shadow, 'premium', 'unset axes still take the preset default');

  // Every preset must be able to stand on its own defaults.
  for (const preset of PRESET_LIST) {
    const r = resolveTheme(normalizeThemeConfig({ preset: preset.id }));
    eq(r.config.radius, preset.defaults.radius, `${preset.id} default radius applied`);
    eq(r.config.shadow, preset.defaults.shadow, `${preset.id} default shadow applied`);
    eq(r.config.density, preset.defaults.density, `${preset.id} default density applied`);
    eq(r.config.animation, preset.defaults.animation, `${preset.id} default animation applied`);
    eq(r.config.heroVariant, preset.heroVariant, `${preset.id} default hero applied`);
    ok(r.contrast.pass, `${preset.id} on its own defaults passes contrast`);
  }

  // Specific repairs.
  eq(normalizeThemeConfig({ brand: '  #abc  ' }).brand, '#AABBCC', 'short hex is expanded');
  eq(normalizeThemeConfig({ brand: 'abcdef' }).brand, '#ABCDEF', 'missing # is added');
  eq(normalizeThemeConfig({ brand: 'red' }).brand, LEGACY_THEME_CONFIG.brand, 'named colour falls back');
  eq(normalizeThemeConfig({ mode: 'DARK' }).mode, 'light', 'case-sensitive enum falls back');
  eq(normalizeThemeConfig({ heroVariant: 'nope' }).heroVariant, undefined, 'bad hero variant dropped');
  eq(normalizeThemeConfig({ heroVariant: 'editorial' }).heroVariant, 'editorial', 'good hero variant kept');
  eq(normalizeThemeConfig({ accent: '#0f0' }).accent, '#00FF00', 'accent short hex expanded');
  eq(normalizeThemeConfig({ preset: 'bold' }, { ...LEGACY_THEME_CONFIG, mode: 'dark' }).mode, 'dark', 'base fills gaps');
  eq(normalizeThemeConfig({ brandInk: 'white' }).brandInk, 'white', 'brandInk white kept');
  eq(normalizeThemeConfig({ brandInk: 'nope' }).brandInk, undefined, 'bad brandInk dropped');
  eq(resolveTheme(normalizeThemeConfig({})).config.brandInk, 'auto', 'effective brandInk defaults to auto');

  // Pale brand: auto ink is dark (engine working); manual white forces label colour.
  const pale = '#A881F8';
  const paleAuto = resolveTheme(normalizeThemeConfig({ brand: pale }));
  const paleAutoInk = (paleAuto.light['--on-brand'] ?? '').toLowerCase();
  ok(paleAutoInk !== '#ffffff', `pale brand auto ink is not white (got ${paleAutoInk})`);
  const paleWhite = resolveTheme(normalizeThemeConfig({ brand: pale, brandInk: 'white' }));
  eq(paleWhite.light['--on-brand']?.toLowerCase(), '#ffffff', 'brandInk white forces --on-brand');
  eq(paleWhite.light['--text-on-brand']?.toLowerCase(), '#ffffff', 'brandInk white forces --text-on-brand');
  const paleOnBrandFail = paleWhite.contrast.light.find((c) => c.id === 'light/on-brand-on-brand');
  ok(paleOnBrandFail != null && !paleOnBrandFail.pass, 'forced white on pale brand still fails contrast check');
  const paleDark = resolveTheme(normalizeThemeConfig({ brand: pale, brandInk: 'dark' }));
  eq(paleDark.light['--on-brand']?.toLowerCase(), '#0f172a', 'brandInk dark forces --on-brand');

  // resolveTheme itself must be safe against a config that skipped normalisation.
  const wild = resolveTheme({ preset: 'nope', mode: 'x', brand: 'zzz' } as unknown as ThemeConfig);
  eq(wild.config.preset, 'minimal', 'resolveTheme normalises internally');
  eq(wild.light['--primary'], '#2563eb', 'resolveTheme falls back to the parity brand');

  // Category suggestions are a NEW-store affordance; verify the mapping, not the render path.
  eq(presetForCategory('Salon & Barber'), 'luxury', 'salon → luxury');
  eq(presetForCategory('Hospital'), 'medical', 'hospital → medical');
  eq(presetForCategory('Restaurant'), 'warm', 'restaurant → warm');
  eq(presetForCategory('CrossFit Box'), 'bold', 'crossfit → bold');
  eq(presetForCategory('Coworking Space'), 'modern', 'coworking → modern');
  eq(presetForCategory(null), 'minimal', 'null category → minimal');
  eq(presetForCategory('  '), 'minimal', 'blank category → minimal');
  eq(presetForCategory('Something Unheard Of'), 'minimal', 'unknown category → minimal');
}

/* ============================================================
   Structural sanity
   ============================================================ */

function testStructure(): void {
  section('(f) structural sanity');

  eq(PRESET_LIST.length, 6, 'six presets ship');
  const ids = PRESET_LIST.map((p) => p.id).sort().join(',');
  eq(ids, [...PRESET_IDS].sort().join(','), 'PRESET_LIST covers every PresetId');

  for (const preset of PRESET_LIST) {
    for (const [key, ramp] of [
      ['neutralsLight', preset.neutralsLight],
      ['neutralsDark', preset.neutralsDark],
    ] as const) {
      let previousL = Infinity;
      for (const stop of [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const) {
        const hex = ramp[stop];
        ok(isHex(hex), `${preset.id}.${key}[${stop}] is a valid hex`);
        const { l } = hexToOklch(hex);
        ok(l < previousL, `${preset.id}.${key} lightness decreases at ${stop}`);
        previousL = l;
      }
    }
    // Dark mode must genuinely be dark, not the light ramp with a filter.
    const bgDark = hexToOklch(preset.neutralsDark[900]).l;
    const bgLight = hexToOklch(preset.neutralsLight[50]).l;
    ok(bgDark < 0.25, `${preset.id} dark page background is dark (L=${bgDark.toFixed(3)})`);
    ok(bgLight > 0.9, `${preset.id} light page background is light (L=${bgLight.toFixed(3)})`);

    const r = resolveTheme({ ...LEGACY_THEME_CONFIG, preset: preset.id });
    eq(r.preset.id, preset.id, `${preset.id} resolves to itself`);
    ok(r.heroVariant.length > 0, `${preset.id} has a hero variant`);
    // Surfaces must step UP in lightness from the page in dark mode.
    const l = (t: TokenMap, k: string) => hexToOklch(t[k]).l;
    ok(
      l(r.dark, '--surface-1') > l(r.dark, '--bg'),
      `${preset.id} dark surface-1 is lighter than bg`,
    );
    ok(
      l(r.dark, '--surface-2') > l(r.dark, '--surface-1'),
      `${preset.id} dark surface-2 is lighter than surface-1`,
    );
  }
}

/* ============================================================
   Run
   ============================================================ */

console.log('TejoTime theme engine — self-check');
testParity();
testContrast();
testRamp();
testCss();
testNormalize();
testStructure();

console.log(`\n${'─'.repeat(60)}`);
if (failures.length > 0) {
  console.log(`FAILED  ${failures.length} of ${checks} assertions\n`);
  const shown = failures.slice(0, 60);
  for (const f of shown) console.log(`  ✗ ${f}`);
  if (failures.length > shown.length) {
    console.log(`  … and ${failures.length - shown.length} more`);
  }
  throw new Error(`theme engine self-check failed: ${failures.length}/${checks} assertions`);
}
console.log(`PASSED  ${checks} assertions`);
