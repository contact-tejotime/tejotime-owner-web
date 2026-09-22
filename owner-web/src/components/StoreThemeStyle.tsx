import {
  AA_BODY,
  contrastRatio,
  LEGACY_THEME_CONFIG,
  normalizeThemeConfig,
  onColor,
  resolveTheme,
  themeAttributes,
  themeToCss,
  type TokenMap,
} from "@/theme/engine";

const WHITE = "#ffffff";

/**
 * White text stays on a coloured fill while it reaches this contrast: WCAG's minimum for large
 * text and interface elements (3:1). The SAME rule as the owner app (`app/src/theme/ink.ts`,
 * `WHITE_INK_MIN_CONTRAST`), so one store's buttons, chips and seat avatars carry the same ink on
 * both surfaces. Change the two together.
 *
 * Before this, the two surfaces disagreed from opposite ends. The web hardcoded `#fff` on every
 * brand fill (unreadable on a pale yellow brand). The app used the engine's pick, near-black on a
 * mid-tone brand, so an orange store had white labels on the laptop and black ones on the phone.
 */
const WHITE_INK_MIN_CONTRAST = 3;

function preferWhiteOn(fill: string | undefined, preferred?: string): string | null {
  if (!fill) return null;
  if (contrastRatio(WHITE, fill) >= WHITE_INK_MIN_CONTRAST) return WHITE;
  if (preferred && contrastRatio(preferred, fill) >= AA_BODY) return preferred;
  return onColor(fill);
}

/** `--text-on-brand` and `--tt-ink-secondary` for one mode's tokens, as declarations. */
function inkDeclarations(tokens: TokenMap, indent: string): string {
  const onBrand = preferWhiteOn(tokens["--primary"], tokens["--text-on-brand"]);
  const onSecondary = preferWhiteOn(tokens["--secondary"]);
  return [
    onBrand ? `${indent}--text-on-brand: ${onBrand};` : "",
    onSecondary ? `${indent}--tt-ink-secondary: ${onSecondary};` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The engine's CSS, plus the owner surfaces' own ink on brand fills, in the same three places the
 * engine writes a mode: light by default, `data-tt-mode="dark"`, and `auto` under a dark OS.
 */
function ownerThemeCss(resolved: ReturnType<typeof resolveTheme>, selector: string): string {
  return [
    themeToCss(resolved, selector),
    `${selector} {`,
    inkDeclarations(resolved.light, "  "),
    "}",
    `${selector}[data-tt-mode="dark"] {`,
    inkDeclarations(resolved.dark, "  "),
    "}",
    "@media (prefers-color-scheme: dark) {",
    `  ${selector}[data-tt-mode="auto"] {`,
    inkDeclarations(resolved.dark, "    "),
    "  }",
    "}",
  ].join("\n");
}

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
  const css = ownerThemeCss(resolved, ".app[data-tt-theme]");
  return <style id="tt-owner-theme" dangerouslySetInnerHTML={{ __html: css }} />;
}

export function storeThemeAttrs(business: BusinessThemeSource) {
  return themeAttributes(storeThemeFromBusiness(business));
}
