/**
 * Token maps → a CSS string, and → a React inline-style object.
 *
 * The emitted stylesheet is ALWAYS three blocks:
 *
 *   [data-tt-theme]                                  { …light… }
 *   [data-tt-theme][data-tt-mode="dark"]             { …dark…  }
 *   @media (prefers-color-scheme: dark) {
 *     [data-tt-theme][data-tt-mode="auto"]           { …dark…  }
 *   }
 *
 * WHY all three, unconditionally: switching a store between light / dark / auto then costs one
 * attribute write on the wrapper element. No restyle pass, no re-render, no second network
 * round-trip, and server and client can never disagree about which block is active — the DOM
 * attribute is the whole state.
 *
 * Both maps are emitted in full rather than as a diff. It costs a few KB of gzipped text and
 * removes an entire class of bug where a token defined only in the light block leaks into
 * dark mode.
 */

import type { ResolvedTheme, TokenMap } from './types';

/**
 * Defence in depth for the `<style>` tag this ends up inside.
 *
 * Values are already engine-generated or hex-validated by `normalizeThemeConfig`, so nothing
 * hostile should reach here — but this string is injected with dangerouslySetInnerHTML, and a
 * single unescaped `</style>` would end the element and turn the rest into markup. Strip the
 * characters that could break out of a declaration or the element.
 */
function sanitizeValue(value: string): string {
  return String(value).replace(/[<>{};\\]/g, '').trim();
}

/** Same treatment for the token name, plus a whitelist on the characters CSS idents allow. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Selectors are supplied by our own call sites, but they land in the same `<style>` tag. */
function sanitizeSelector(selector: string): string {
  const clean = selector.replace(/[<>{};\\]/g, '').trim();
  return clean || '[data-tt-theme]';
}

function declarations(tokens: TokenMap, indent: string): string {
  return Object.keys(tokens)
    .map((name) => {
      const k = sanitizeName(name);
      const v = sanitizeValue(tokens[name]);
      return k && v ? `${indent}${k}: ${v};` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Emit the full three-block stylesheet for a resolved theme.
 *
 * `selector` must match whatever carries `data-tt-theme`; the dark/auto selectors are derived
 * from it, so passing `.tt-preview` yields `.tt-preview[data-tt-mode="dark"]` and friends.
 * That is what lets the admin render several previews on one page without collisions.
 */
export function themeToCss(resolved: ResolvedTheme, selector = '[data-tt-theme]'): string {
  const base = sanitizeSelector(selector);
  const light = declarations(resolved.light, '  ');
  const dark = declarations(resolved.dark, '  ');
  const darkNested = declarations(resolved.dark, '    ');

  return [
    `${base} {`,
    light,
    '}',
    `${base}[data-tt-mode="dark"] {`,
    dark,
    '}',
    '@media (prefers-color-scheme: dark) {',
    `  ${base}[data-tt-mode="auto"] {`,
    darkNested,
    '  }',
    '}',
  ].join('\n');
}

/**
 * A token map as a React `style` object.
 *
 * Custom properties are passed straight through — React writes any `--*` key verbatim. Use
 * this for a single element (the microsite root already does exactly this with
 * `primaryThemeVars`); use `themeToCss` when the theme has to cover descendants in both modes.
 */
export function cssVarsObject(tokens: TokenMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(tokens)) {
    const k = sanitizeName(name);
    const v = sanitizeValue(tokens[name]);
    if (k && v) out[`--${k.replace(/^-+/, '')}`] = v;
  }
  return out;
}

/**
 * The attributes the themed wrapper element needs. Spread onto the root `<div>` alongside the
 * `<style>` produced by `themeToCss`, e.g.
 *   `<div {...themeAttributes(resolved)} style={{ position: 'relative' }}>`
 */
export function themeAttributes(resolved: ResolvedTheme): {
  'data-tt-theme': string;
  'data-tt-mode': string;
} {
  return {
    'data-tt-theme': resolved.config.preset,
    'data-tt-mode': resolved.config.mode,
  };
}
