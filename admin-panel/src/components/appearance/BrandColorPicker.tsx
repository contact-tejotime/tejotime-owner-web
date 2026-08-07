"use client";

import { useRef, type KeyboardEvent } from "react";
import {
  BRAND_INK_IDS,
  RAMP_STOPS,
  type BrandInkId,
  type ModeId,
  type ResolvedTheme,
} from "@/theme/engine";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import OptionCards, { type OptionCardItem } from "./OptionCards";

/**
 * Brand colour: 12 curated swatches, a free hex field, the generated 50→900 ramp, and a live
 * WCAG verdict.
 *
 * The verdict is the point. One hex seeds every button, chip, link and hero stop on the
 * microsite, and a store owner asking for #FFE066 has no way to know it cannot carry white
 * label text. The engine already computed that (it picks `--on-brand` and reports the ratio);
 * this component just refuses to let the answer stay invisible.
 */

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Twelve starting points across the hue circle. The first is the TejoTime blue — the value
 * every existing store resolves to — and the next four are the preset accent colours, so the
 * curated (hand-tuned) ramps in the engine get used rather than generated near-misses.
 */
const SWATCHES: readonly { hex: string; key: keyof typeof t.appearance.swatches }[] = [
  { hex: "#2563EB", key: "blue" },
  { hex: "#14B8A6", key: "teal" },
  { hex: "#10B981", key: "emerald" },
  { hex: "#C9A227", key: "gold" },
  { hex: "#E07A3F", key: "clay" },
  { hex: "#0EA5E9", key: "sky" },
  { hex: "#6366F1", key: "indigo" },
  { hex: "#7C3AED", key: "violet" },
  { hex: "#DB2777", key: "pink" },
  { hex: "#DC2626", key: "red" },
  { hex: "#EA580C", key: "orange" },
  { hex: "#0F766E", key: "pine" },
];

interface Props {
  /** Raw field value — may be mid-typing and invalid; that is the form's business, not ours. */
  value: string;
  onChange: (hex: string) => void;
  /** Label ink on primary buttons — auto / white / dark. */
  brandInk: BrandInkId;
  onBrandInkChange: (ink: BrandInkId) => void;
  /** Resolved from the *current* config, so the ramp and badge always match the live preview. */
  resolved: ResolvedTheme;
  /** Which face of the theme the badge should judge. `auto` is judged as light. */
  mode: ModeId;
}

export default function BrandColorPicker({
  value,
  onChange,
  brandInk,
  onBrandInkChange,
  resolved,
  mode,
}: Props) {
  const valid = HEX_RE.test(value.trim());
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const face = mode === "dark" ? "dark" : "light";
  const tokens = face === "dark" ? resolved.dark : resolved.light;

  // The engine's own verdict on the primary button, in the face being previewed.
  const onBrandCheck = resolved.contrast[face].find((c) => c.id === `${face}/on-brand-on-brand`);
  const usesWhiteInk = (tokens["--on-brand"] ?? "#ffffff").toLowerCase() === "#ffffff";
  const ratio = onBrandCheck ? onBrandCheck.ratio.toFixed(2) : "—";
  const manualFailsAa = brandInk !== "auto" && onBrandCheck != null && !onBrandCheck.pass;

  // Decorative pairs are reported but never gated — see ContrastTier in the engine. Counting
  // them here would show a permanent red badge on the parity theme.
  const gatedFailures = resolved.contrast.failures.filter((c) => c.tier !== "decorative");

  const inkOptions: OptionCardItem<BrandInkId>[] = BRAND_INK_IDS.map((id) => ({
    value: id,
    label: t.appearance.brandInks[id].label,
    description: t.appearance.brandInks[id].desc,
  }));

  /**
   * Roving tabindex over the swatch row, matching every other axis in the panel (OptionCards).
   * Without it these 12 buttons are 12 separate tab stops between the panel heading and the hex
   * field. They stay `aria-pressed` toggles rather than radios: a custom hex means NONE is
   * pressed, which a radiogroup cannot express — so index 0 anchors the tab stop in that case.
   */
  const activeSwatch = Math.max(
    0,
    SWATCHES.findIndex((s) => valid && value.trim().toUpperCase() === s.hex),
  );

  function onSwatchKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const jump: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number;
    if (e.key in jump) next = (index + jump[e.key] + SWATCHES.length) % SWATCHES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SWATCHES.length - 1;
    else return;
    e.preventDefault();
    // Move focus only — unlike a radiogroup, arrowing must not overwrite the store's brand.
    swatchRefs.current[next]?.focus();
  }

  return (
    <div className="ap-group">
      <div className="ap-group-head">
        <span className="ap-group-legend" id="ap-brand-legend">
          {t.appearance.brandTitle}
        </span>
        <span className="ap-group-hint">{t.appearance.brandHint}</span>
      </div>

      <div className="ap-swatches" role="group" aria-labelledby="ap-brand-legend">
        {SWATCHES.map((s, i) => {
          const selected = valid && value.trim().toUpperCase() === s.hex;
          return (
            <button
              key={s.hex}
              ref={(el) => {
                swatchRefs.current[i] = el;
              }}
              type="button"
              className={`ap-swatch${selected ? " is-selected" : ""}`}
              style={{ background: s.hex }}
              aria-pressed={selected}
              tabIndex={i === activeSwatch ? 0 : -1}
              onKeyDown={(e) => onSwatchKeyDown(e, i)}
              title={`${t.appearance.swatches[s.key]} ${s.hex}`}
              aria-label={format(t.appearance.brandSwatchLabel, {
                name: t.appearance.swatches[s.key],
                hex: s.hex,
              })}
              onClick={() => onChange(s.hex)}
            >
              {selected && <Icon name="check" size={14} />}
            </button>
          );
        })}
      </div>

      <div className="ap-hex-row">
        <input
          id="sf-themeColor-swatch"
          type="color"
          className="ap-hex-native"
          aria-label={t.appearance.brandPickerLabel}
          value={valid ? value.trim() : "#2563EB"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        {/* Same id, same `required`/`pattern`, same normalise-on-type behaviour as the field
            this panel replaced: the browser still blocks a malformed hex, and StoreForm's own
            check still produces the identical error UI. */}
        <input
          id="sf-themeColor"
          className="ap-hex-text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(v.startsWith("#") ? v.toUpperCase() : `#${v}`.toUpperCase());
          }}
          placeholder="#2563EB"
          maxLength={7}
          required
          pattern="^#[0-9A-Fa-f]{6}$"
          aria-label={t.appearance.brandCustom}
          aria-invalid={valid ? undefined : true}
          // Point at the error text, so refocusing the field announces WHY it is invalid.
          aria-describedby={valid ? undefined : "sf-themeColor-error"}
          spellCheck={false}
        />
      </div>
      {!valid && (
        <p className="ap-warn" role="alert" id="sf-themeColor-error">
          {t.storeForm.invalidThemeColor}
        </p>
      )}

      <div className="ap-ramp" aria-label={t.appearance.rampTitle} role="img">
        {RAMP_STOPS.map((stop) => (
          <span
            key={stop}
            className="ap-ramp-step"
            style={{ background: resolved.brandRamp[stop] }}
            title={format(t.appearance.rampStep, { step: stop, hex: resolved.brandRamp[stop] })}
          />
        ))}
      </div>
      <p className="ap-ramp-caption">
        {format(t.appearance.rampCaption, { brand: tokens["--brand"] ?? resolved.brandRamp[600] })}
      </p>

      <OptionCards
        legend={t.appearance.brandInkTitle}
        hint={t.appearance.brandInkHint}
        value={brandInk}
        options={inkOptions}
        onChange={onBrandInkChange}
      />

      <div className={`ap-badge${usesWhiteInk ? " is-white" : " is-dark"}`}>
        <Icon name={usesWhiteInk ? "checkCircle" : "info"} size={15} />
        <span>
          {format(usesWhiteInk ? t.appearance.aaWhite : t.appearance.aaDark, { ratio })}
        </span>
      </div>

      {manualFailsAa && (
        <div className="ap-badge is-warn" role="alert">
          <Icon name="alertTriangle" size={15} />
          <span>{format(t.appearance.aaManualFail, { ratio })}</span>
        </div>
      )}

      {gatedFailures.length > 0 ? (
        <div className="ap-badge is-warn" role="alert">
          <Icon name="alertTriangle" size={15} />
          <span>
            {format(
              gatedFailures.length === 1 ? t.appearance.aaFail : t.appearance.aaFailPlural,
              { count: gatedFailures.length },
            )}
            {": "}
            {gatedFailures
              .slice(0, 2)
              .map((c) => `${c.label} ${c.ratio}:1`)
              .join(", ")}
          </span>
        </div>
      ) : (
        <div className="ap-badge is-ok">
          <Icon name="checkCircle" size={15} />
          <span>{t.appearance.aaPass}</span>
        </div>
      )}
    </div>
  );
}
