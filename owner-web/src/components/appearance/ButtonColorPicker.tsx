"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { BRAND_INK_IDS, type BrandInkId, type ModeId, type ResolvedTheme } from "@/theme/engine";
import { SbField, SbSection } from "@/components/store-settings/ui";
import { t, formatAppearance as format } from "./appearanceCopy";
import { Icon } from "@/components/Icon";
import OptionCards, { type OptionCardItem } from "./OptionCards";

/**
 * "Button color" — the app's section, in the app's order: Same as theme / Custom, the custom
 * swatches and hex, the label colour, a live button, its contrast line, then whether every
 * contrast check on the page passes.
 *
 * The theme colour tints the whole microsite (links, chips, hero gradient); the button is one
 * control that often wants to disagree with it, black-on-blue being the usual ask. Only the solid
 * button reads this: its fill, hover, pressed, label ink and outline. Tints and links stay on the
 * theme colour, which is why setting a black button does not drain the site.
 *
 * Absent means "follow the theme colour", and that is the default — an untouched store resolves
 * exactly as it did before this axis existed. Choosing Custom seeds from the current theme colour
 * so the first thing the owner sees is what they already had, not a jump to some default.
 */

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

type SourceId = "theme" | "custom";

/**
 * Neutrals first, deliberately. The reason this axis exists is owners wanting a button that is
 * NOT their brand hue — near-black and charcoal are the two most asked for — so they lead, and
 * the saturated options follow. Same list, same order as the app.
 */
const SWATCHES: readonly { hex: string; key: keyof typeof t.appearance.buttonSwatches }[] = [
  { hex: "#111111", key: "black" },
  { hex: "#334155", key: "charcoal" },
  { hex: "#0F172A", key: "ink" },
  { hex: "#2563EB", key: "blue" },
  { hex: "#0F766E", key: "pine" },
  { hex: "#7C3AED", key: "violet" },
  { hex: "#DB2777", key: "pink" },
  { hex: "#DC2626", key: "red" },
  { hex: "#EA580C", key: "orange" },
  { hex: "#C9A227", key: "gold" },
];

interface Props {
  /** `undefined` → follow the theme colour. Any string is the raw field value, valid or not. */
  value: string | undefined;
  /** Current theme colour, used as the seed when switching to Custom. */
  brand: string;
  /** `undefined` clears the axis back to "same as theme colour". */
  onChange: (hex: string | undefined) => void;
  /** Resolved from the *current* config, so the preview and verdicts match the live site. */
  resolved: ResolvedTheme;
  /** Which face of the theme to judge. `auto` is judged as light. */
  mode: ModeId;
  /** Label ink on the button — auto / white / dark. Lives here because it is a button property. */
  brandInk: BrandInkId;
  onBrandInkChange: (ink: BrandInkId) => void;
}

export default function ButtonColorPicker({
  value,
  brand,
  onChange,
  resolved,
  mode,
  brandInk,
  onBrandInkChange,
}: Props) {
  const titleId = useId();
  const inkLabelId = useId();
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const source: SourceId = value === undefined ? "theme" : "custom";
  const raw = value ?? "";
  const valid = source === "theme" || HEX_RE.test(raw.trim());

  const face = mode === "dark" ? "dark" : "light";
  const tokens = face === "dark" ? resolved.dark : resolved.light;

  // The engine's verdict on the pair actually painted: label ink over the button fill. With this
  // axis set, that fill IS the button colour, so the line answers the question being asked.
  const inkCheck = resolved.contrast[face].find((c) => c.id === `${face}/on-brand-on-brand`);
  const ratio = inkCheck ? inkCheck.ratio.toFixed(2) : "—";
  const inkFails = inkCheck != null && !inkCheck.pass;
  const usesWhiteInk = (tokens["--on-brand"] ?? "#ffffff").toLowerCase() === "#ffffff";
  // A forced ink that fails is the owner's choice, so it warns rather than being overridden.
  const manualFailsAa = brandInk !== "auto" && inkFails;
  // Decorative pairs are reported but never gated — see ContrastTier in the engine. Counting them
  // would show a permanent warning on the parity theme.
  const gatedFailures = resolved.contrast.failures.filter((c) => c.tier !== "decorative");

  const sourceOptions: OptionCardItem<SourceId>[] = [
    { value: "theme", label: t.appearance.buttonSourceTheme, description: t.appearance.buttonSourceThemeDesc },
    { value: "custom", label: t.appearance.buttonSourceCustom, description: t.appearance.buttonSourceCustomDesc },
  ];
  const inkOptions: OptionCardItem<BrandInkId>[] = BRAND_INK_IDS.map((id) => ({
    value: id,
    label: t.appearance.brandInks[id].label,
    description: t.appearance.brandInks[id].desc,
  }));

  const activeSwatch = Math.max(
    0,
    SWATCHES.findIndex((s) => valid && raw.trim().toUpperCase() === s.hex),
  );

  /** Roving tabindex, matching the brand swatches — 10 buttons must not be 10 tab stops. */
  function onSwatchKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const jump: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number;
    if (e.key in jump) next = (index + jump[e.key] + SWATCHES.length) % SWATCHES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SWATCHES.length - 1;
    else return;
    e.preventDefault();
    swatchRefs.current[next]?.focus();
  }

  return (
    <SbSection title={t.appearance.buttonTitle} hint={t.appearance.buttonHint} titleId={titleId}>
      <OptionCards
        label={t.appearance.buttonSourceLegend}
        value={source}
        options={sourceOptions}
        // Switching to Custom seeds from the theme colour rather than a hardcoded default, so the
        // button starts where it already was and the owner edits from there.
        onChange={(next) => onChange(next === "theme" ? undefined : (value ?? brand))}
      />

      {source === "custom" ? (
        <>
          <div className="sb-ap-swatches" role="group" aria-labelledby={titleId}>
            {SWATCHES.map((s, i) => {
              const selected = valid && raw.trim().toUpperCase() === s.hex;
              return (
                <button
                  key={s.hex}
                  ref={(el) => {
                    swatchRefs.current[i] = el;
                  }}
                  type="button"
                  className={`sb-ap-swatch${selected ? " is-selected" : ""}`}
                  style={{ background: s.hex }}
                  aria-pressed={selected}
                  tabIndex={i === activeSwatch ? 0 : -1}
                  onKeyDown={(e) => onSwatchKeyDown(e, i)}
                  title={`${t.appearance.buttonSwatches[s.key]} ${s.hex}`}
                  aria-label={format(t.appearance.brandSwatchLabel, {
                    name: t.appearance.buttonSwatches[s.key],
                    hex: s.hex,
                  })}
                  onClick={() => onChange(s.hex)}
                />
              );
            })}
          </div>

          <SbField
            id="sf-buttonColor"
            label={t.appearance.buttonCustom}
            error={valid ? undefined : t.storeForm.invalidThemeColor}
          >
            <input
              type="color"
              className="sb-ap-native"
              aria-label={t.appearance.buttonPickerLabel}
              value={valid ? raw.trim() : "#111111"}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
            />
            <input
              id="sf-buttonColor"
              value={raw}
              onChange={(e) => {
                const v = e.target.value.trim();
                onChange((v.startsWith("#") ? v.toUpperCase() : `#${v}`.toUpperCase()).slice(0, 7));
              }}
              placeholder="#111111"
              maxLength={7}
              aria-invalid={valid ? undefined : true}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </SbField>
        </>
      ) : null}

      {/* Label ink belongs to the button it colours, not to the theme colour. */}
      <p className="sb-ap-caption" id={inkLabelId}>
        {t.appearance.brandInkTitle}
      </p>
      <OptionCards labelledBy={inkLabelId} value={brandInk} options={inkOptions} onChange={onBrandInkChange} />

      {/* Real resolved tokens, not the raw hex — so this is the colour, ink and outline the site
          will actually paint. */}
      <div className="sb-ap-btnpreview">
        <span
          style={{
            background: tokens["--primary"] ?? brand,
            color: tokens["--on-brand"] ?? "#ffffff",
            border:
              tokens["--brand-outline"] && tokens["--brand-outline"] !== "transparent"
                ? `1px solid ${tokens["--brand-outline"]}`
                : "1px solid transparent",
          }}
        >
          {t.appearance.buttonPreviewLabel}
        </span>
      </div>
      <p className="sb-ap-caption">{format(usesWhiteInk ? t.appearance.aaWhite : t.appearance.aaDark, { ratio })}</p>
      {manualFailsAa ? (
        <p className="sb-ap-caption is-warn" role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>{format(t.appearance.aaManualFail, { ratio })}</span>
        </p>
      ) : inkFails ? (
        // Owner-web keeps this one: on Auto the engine picks the better ink, but a very mid-tone
        // button can fail with either, and the line above would still read "AA".
        <p className="sb-ap-caption is-warn" role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>{format(t.appearance.buttonInkFail, { ratio })}</span>
        </p>
      ) : null}
      <p
        className={`sb-ap-caption ${gatedFailures.length ? "is-warn" : "is-ok"}`}
        role={gatedFailures.length ? "alert" : undefined}
      >
        <Icon name={gatedFailures.length ? "alertTriangle" : "checkCircle"} size={14} />
        <span>
          {gatedFailures.length === 0
            ? t.appearance.aaPass
            : `${format(gatedFailures.length === 1 ? t.appearance.aaFail : t.appearance.aaFailPlural, {
                count: gatedFailures.length,
              })}: ${gatedFailures
                .slice(0, 2)
                .map((c) => `${c.label} ${c.ratio}:1`)
                .join(", ")}`}
        </span>
      </p>
    </SbSection>
  );
}
