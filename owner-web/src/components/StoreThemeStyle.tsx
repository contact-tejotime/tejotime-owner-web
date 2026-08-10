import {
  LEGACY_THEME_CONFIG,
  normalizeThemeConfig,
  resolveTheme,
  themeAttributes,
  themeToCss,
} from "@/theme/engine";

type BusinessThemeSource = {
  theme?: unknown;
  themeColor?: string | null;
};

/**
 * Server-rendered store theme for the authenticated owner-web shell.
 *
 * Same contract as the customer microsite's ThemeStyle: CSS custom properties scoped to
 * `.app[data-tt-theme]`, so `--primary*` (and the rest of the legacy token set) override
 * globals.css for every role — including staff who never open Appearance.
 */
export function storeThemeFromBusiness(business: BusinessThemeSource) {
  const legacyBrand =
    typeof business.themeColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(business.themeColor)
      ? business.themeColor.toUpperCase()
      : undefined;
  const config = normalizeThemeConfig(business.theme ?? null, {
    ...LEGACY_THEME_CONFIG,
    ...(legacyBrand ? { brand: legacyBrand } : {}),
  });
  return resolveTheme(config);
}

export function StoreThemeStyle({ business }: { business: BusinessThemeSource }) {
  const resolved = storeThemeFromBusiness(business);
  const css = themeToCss(resolved, ".app[data-tt-theme]");
  return <style id="tt-owner-theme" dangerouslySetInnerHTML={{ __html: css }} />;
}

export function storeThemeAttrs(business: BusinessThemeSource) {
  return themeAttributes(storeThemeFromBusiness(business));
}
