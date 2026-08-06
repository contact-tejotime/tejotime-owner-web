/**
 * `@/theme` — the app-facing surface of the theming system.
 *
 * Deliberately COMPONENT-FREE. It re-exports the pure engine plus the one app-level helper,
 * so a server component and a client component can both import from here without dragging a
 * React component (and its dependencies) across the server/client boundary.
 *
 * The components/hooks are imported by path, on purpose:
 *   import ThemeStyle from '@/theme/ThemeStyle';                       // server only
 *   import { ThemeProvider } from '@/theme/ThemeProvider';             // client only
 *   import { useThemePreview } from '@/theme/usePreviewChannel';       // client only
 *   import { ThemePortalProvider } from '@/theme/ThemePortal';         // client only
 */

export * from './engine';

import { LEGACY_THEME_CONFIG, normalizeThemeConfig, type ThemeConfig } from './engine';

/**
 * The one place that decides how a microsite row becomes a `ThemeConfig`.
 *
 * Precedence is FIELD-level, not object-level: the legacy `theme_color` column seeds `brand`
 * on the base config, and the `theme` jsonb overrides whichever fields it actually carries.
 *
 * Doing it the other way round (`site.theme ?? {brand: …}`) loses the store's colour the moment
 * `theme` is any truthy object: the backend's theme schema is `.partial()`, so a client can
 * legitimately PUT `{theme: {}}`, and the row would then render TejoTime blue while its
 * `theme_color` column still held the real hex.
 *
 * PARITY: a row with `theme IS NULL AND theme_color IS NULL` resolves to
 * `{preset:'minimal', mode:'light', brand:'#2563EB'}`, which produces globals.css token for
 * token. Do not "simplify" this expression — every existing microsite renders through it.
 */
export function micrositeThemeConfig(site: {
  theme?: unknown;
  themeColor?: string | null;
}): ThemeConfig {
  return normalizeThemeConfig(site.theme, {
    ...LEGACY_THEME_CONFIG,
    brand: site.themeColor ?? LEGACY_THEME_CONFIG.brand,
  });
}
