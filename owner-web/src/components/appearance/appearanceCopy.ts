/**
 * English copy for the Appearance panel.
 * Owner-web has no full i18n; strings match admin-panel `t.appearance` / storeForm.invalidThemeColor.
 */

const appearance = {
  title: "Appearance",
  subtitle: "How this store's customer website looks. Nothing is applied until you save the form.",
  unsaved: "Unsaved appearance changes",
  reset: "Reset to recommended",
  resetHint:
    "Goes back to the preset suggested for this category and clears every override. Your brand color is kept.",
  brandTitle: "Brand color",
  brandHint: "One color seeds the whole palette — buttons, links, chips, borders and the banner gradient.",
  brandCustom: "Brand color hex",
  brandPickerLabel: "Pick a brand color",
  brandSwatchLabel: "{name} — {hex}",
  rampTitle: "Generated palette",
  rampStep: "Step {step} — {hex}",
  rampCaption: "Buttons and links render as {brand}.",
  aaWhite: "AA — white text on brand ({ratio}:1)",
  aaDark: "Using dark text for contrast ({ratio}:1)",
  aaPass: "All contrast checks pass",
  aaFail: "{count} contrast check needs attention",
  aaFailPlural: "{count} contrast checks need attention",
  aaManualFail:
    "Your button label choice is below 4.5:1 on this brand ({ratio}:1). It will still apply — consider a darker brand or Auto.",
  brandInkTitle: "Button label color",
  brandInkHint: "Text on primary buttons. Auto picks white or dark for contrast; White/Dark force a choice.",
  brandInks: {
    auto: { label: "Auto", desc: "Best contrast for this brand." },
    white: { label: "White", desc: "Always white labels." },
    dark: { label: "Dark", desc: "Always dark labels." },
  },
  swatches: {
    blue: "TejoTime blue",
    teal: "Teal",
    emerald: "Emerald",
    gold: "Gold",
    clay: "Clay",
    sky: "Sky",
    indigo: "Indigo",
    violet: "Violet",
    pink: "Pink",
    red: "Red",
    orange: "Orange",
    pine: "Pine",
  },
  presetTitle: "Theme preset",
  presetHint:
    "Sets the neutrals, typography and banner style — plus the default corners, shadows, spacing and motion.",
  recommended: "Recommended",
  presets: {
    minimal: { label: "Minimal", desc: "Calm slate neutrals and lots of white space. The safe default." },
    luxury: { label: "Luxury", desc: "Warm ink, gold accent, serif headings. Salons, spas, jewellery." },
    modern: { label: "Modern", desc: "Crisp, tech-forward, high contrast. Agencies and services." },
    bold: { label: "Bold", desc: "Heavy type, hard edges, thick borders. Gyms and barbershops." },
    medical: { label: "Medical", desc: "Clean, clinical, unmistakably trustworthy. Clinics and labs." },
    warm: { label: "Warm", desc: "Soft, appetising, inviting. Restaurants and cafés." },
  },
  modeTitle: "Mode",
  modeHint: "Auto follows each visitor's device setting.",
  modes: {
    light: { label: "Light", desc: "Always light." },
    dark: { label: "Dark", desc: "Always dark." },
    auto: { label: "Auto (System)", desc: "Matches the visitor." },
  },
  densityTitle: "Density",
  densityHint: "How much breathing room sections and controls get.",
  densities: {
    comfortable: { label: "Comfortable", desc: "Roomy — the current spacing." },
    compact: { label: "Compact", desc: "Tighter; more fits on screen." },
  },
  radiusTitle: "Border radius",
  radiusHint: "Corner rounding for cards, buttons and images.",
  radii: {
    sharp: { label: "Sharp", desc: "Near-square corners." },
    medium: { label: "Medium", desc: "Gently rounded — the current look." },
    rounded: { label: "Rounded", desc: "Soft, friendly corners." },
  },
  shadowTitle: "Shadow",
  shadowHint: "How much cards lift off the page.",
  shadows: {
    none: { label: "None", desc: "Flat; hairline edges only." },
    soft: { label: "Soft", desc: "Subtle depth — the current look." },
    premium: { label: "Premium", desc: "Deeper, layered elevation." },
  },
  animationTitle: "Animation",
  animationHint: "Hover and transition feel. Reduced-motion visitors always see less.",
  animations: {
    subtle: { label: "Subtle", desc: "Quick and understated." },
    normal: { label: "Normal", desc: "Balanced — the current feel." },
    rich: { label: "Rich", desc: "Slower, more expressive motion." },
  },
  presetDefault: "Preset default",
  presetDefaultValue: "Follows the preset ({value})",
  effective:
    "Rendering as {preset} · {mode} · {density} · {radius} corners · {shadow} shadow · {animation} motion.",
  previewTitle: "Live preview",
  previewHint: "This is the real customer website, themed live. Save the form to publish it.",
  previewLoading: "Loading the live site…",
  previewNotResponding:
    "The site loaded but isn't accepting live theme updates. Locally, run the frontend on port 3000 (or set NEXT_PUBLIC_FRONTEND_URL). Save and open the live site to confirm.",
  previewUnavailable: "The live preview could not load.",
  previewDemo: "No phone number yet — showing the demo store. Add a phone number to preview this store.",
  previewOpen: "Open",
  previewReload: "Reload",
  device: "Preview device",
  devices: {
    desktop: "Desktop",
    tablet: "Tablet",
    mobile: "Mobile",
  },
} as const;

/** Shape matches admin `t.appearance` + the one storeForm string BrandColorPicker needs. */
export const t = {
  appearance,
  storeForm: {
    invalidThemeColor: "Enter a valid hex color like #2563EB.",
  },
} as const;

/** @deprecated Prefer `t.appearance` — kept for any local imports of the flat object. */
export const appearanceCopy = appearance;

/** Fill `{placeholders}` in a template string. */
export function formatAppearance(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
