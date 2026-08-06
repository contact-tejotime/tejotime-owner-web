/**
 * ThemeStyle — the server-rendered `<style>` block that carries a store's theme.
 *
 * This is a SERVER component on purpose. The whole point of the engine is that a microsite
 * ships its colours as plain CSS in the HTML document, so the first paint is already themed:
 * no client JS, no effect, no flash of the default blue before the store's brand lands.
 * Keep it free of hooks, `useEffect`, browser globals and `"use client"`.
 *
 * It renders three blocks (light / dark / auto-in-media) via `themeToCss`, so switching a
 * store's mode is a single attribute write on the wrapper — see engine/css.ts.
 *
 * Pair it with a wrapper element carrying `data-tt-theme` + `data-tt-mode`:
 *
 *   <ThemeStyle config={config} />
 *   <MicrositeClient initialSite={site} />   // its root <div> has the attributes
 *
 * Safe inside a `force-dynamic` route: `resolveTheme` is pure, synchronous and does no I/O.
 */

import { resolveTheme, themeToCss, type ThemeConfig } from './engine';

export interface ThemeStyleProps {
  /** Raw or normalised config. `resolveTheme` normalises internally, so either is fine. */
  config: ThemeConfig;
  /**
   * Selector the tokens are scoped to. Defaults to the canonical `[data-tt-theme]` contract.
   * Pass something narrower (`#tt-preview`) only when several themes share one document.
   */
  selector?: string;
}

export default function ThemeStyle({ config, selector }: ThemeStyleProps) {
  const css = themeToCss(resolveTheme(config), selector);

  // The string is engine-generated and additionally sanitised inside `themeToCss` (it strips
  // <>{};\ from every name, value and the selector), which is what makes this injection safe.
  return <style id="tt-theme" dangerouslySetInnerHTML={{ __html: css }} />;
}
