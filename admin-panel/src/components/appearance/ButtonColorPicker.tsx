"use client";

import { useRef, type KeyboardEvent } from "react";
import { BRAND_INK_IDS, type BrandInkId, type ModeId, type ResolvedTheme } from "@/theme/engine";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import OptionCards, { type OptionCardItem } from "./OptionCards";

/**
 * Button colour — the solid primary button, split off the theme colour.
 *
 * The theme colour tints the whole microsite (links, chips, hero gradient); the button is one
 * control that often wants to disagree with it, black-on-blue being the usual ask. Only the
 * solid button reads this: its fill, hover, pressed, label ink and outline. Tints and links stay
 * on the theme colour, which is why setting a black button does not drain the site.
 *
 * Absent means "follow the theme colour", and that is the default — an untouched store resolves
 * exactly as it did before this axis existed. Choosing Custom seeds from the current theme
 * colour so the first thing the owner sees is what they already had, not a jump to some default.
 */

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

type SourceId = "theme" | "custom";

/**
 * Neutrals first, deliberately. The reason this axis exists is owners wanting a button that is
 * NOT their brand hue — near-black and charcoal are the two most asked for — so they lead, and
 * the saturated options follow for stores that just want a louder call to action.
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
  /** Current theme colour, used as the seed when switching to Custom and for the preview label. */
  brand: string;
  /** `undefined` clears the axis back to "same as theme colour". */
  onChange: (hex: string | undefined) => void;
  /** Resolved from the *current* config, so the preview and verdict match the live site. */
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
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const source: SourceId = value === undefined ? "theme" : "custom";
  const raw = value ?? "";
  const valid = source === "theme" || HEX_RE.test(raw.trim());

  const face = mode === "dark" ? "dark" : "light";
  const tokens = face === "dark" ? resolved.dark : resolved.light;

  // The engine's verdict on the pair actually painted: label ink over the button fill. With this
  // axis set, that fill IS the button colour, so the badge answers the question being asked.
  const inkCheck = resolved.contrast[face].find((c) => c.id === `${face}/on-brand-on-brand`);
  const ratio = inkCheck ? inkCheck.ratio.toFixed(2) : "—";
  const inkFails = inkCheck != null && !inkCheck.pass;
  const usesWhiteInk = (tokens["--on-brand"] ?? "#ffffff").toLowerCase() === "#ffffff";
  // A forced ink that fails is the owner's choice, so it warns rather than being overridden.
  const manualFailsAa = brandInk !== "auto" && inkCheck != null && !inkCheck.pass;

  const inkOptions: OptionCardItem<BrandInkId>[] = BRAND_INK_IDS.map((id) => ({
    value: id,
    label: t.appearance.brandInks[id].label,
    description: t.appearance.brandInks[id].desc,
  }));

  const sourceOptions: OptionCardItem<SourceId>[] = [
    { value: "theme", label: t.appearance.buttonSourceTheme, description: t.appearance.buttonSourceThemeDesc },
    { value: "custom", label: t.appearance.buttonSourceCustom, description: t.appearance.buttonSourceCustomDesc },
  ];

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
    <div className="ap-group">
      <div className="ap-group-head">
        <span className="ap-group-legend" id="ap-button-legend">
          {t.appearance.buttonTitle}
        </span>
        <span className="ap-group-hint">{t.appearance.buttonHint}</span>
      </div>

      <OptionCards
        legend={t.appearance.buttonSourceLegend}
        value={source}
        options={sourceOptions}
        // Switching to Custom seeds from the theme colour rather than a hardcoded default, so the
        // button starts where it already was and the owner edits from there.
        onChange={(next) => onChange(next === "theme" ? undefined : (value ?? brand))}
      />

      {source === "custom" && (
        <>
          <div className="ap-swatches" role="group" aria-labelledby="ap-button-legend">
            {SWATCHES.map((s, i) => {
              const selected = valid && raw.trim().toUpperCase() === s.hex;
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
                  title={`${t.appearance.buttonSwatches[s.key]} ${s.hex}`}
                  aria-label={format(t.appearance.brandSwatchLabel, {
                    name: t.appearance.buttonSwatches[s.key],
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
              id="sf-buttonColor-swatch"
              type="color"
              className="ap-hex-native"
              aria-label={t.appearance.buttonPickerLabel}
              value={valid ? raw.trim() : "#111111"}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
            />
            <input
              id="sf-buttonColor"
              className="ap-hex-text"
              value={raw}
              onChange={(e) => {
                const v = e.target.value.trim();
                onChange(v.startsWith("#") ? v.toUpperCase() : `#${v}`.toUpperCase());
              }}
              placeholder="#111111"
              maxLength={7}
              required
              pattern="^#[0-9A-Fa-f]{6}$"
              aria-label={t.appearance.buttonCustom}
              aria-invalid={valid ? undefined : true}
              aria-describedby={valid ? undefined : "sf-buttonColor-error"}
              spellCheck={false}
            />
          </div>
          {!valid && (
            <p className="ap-warn" role="alert" id="sf-buttonColor-error">
              {t.storeForm.invalidThemeColor}
            </p>
          )}
        </>
      )}

      <OptionCards
        legend={t.appearance.brandInkTitle}
        hint={t.appearance.brandInkHint}
        value={brandInk}
        options={inkOptions}
        onChange={onBrandInkChange}
      />

      <div className={`ap-badge${usesWhiteInk ? " is-white" : " is-dark"}`}>
        <Icon name={usesWhiteInk ? "checkCircle" : "info"} size={15} />
        <span>{format(usesWhiteInk ? t.appearance.aaWhite : t.appearance.aaDark, { ratio })}</span>
      </div>

      {manualFailsAa && (
        <div className="ap-badge is-warn" role="alert">
          <Icon name="alertTriangle" size={15} />
          <span>{format(t.appearance.aaManualFail, { ratio })}</span>
        </div>
      )}

      {/* Live preview: the real resolved tokens, not the raw hex — so what is shown is what the
          engine will paint, including the ink it picked and any outline a pale colour needs. */}
      <div className="ap-button-preview">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 20px",
            borderRadius: "var(--radius-md, 10px)",
            background: tokens["--primary"],
            color: tokens["--on-brand"],
            border:
              tokens["--brand-outline"] && tokens["--brand-outline"] !== "transparent"
                ? `1px solid ${tokens["--brand-outline"]}`
                : "1px solid transparent",
            font: "var(--fw-semibold, 600) 14px/1 var(--font-sans, inherit)",
          }}
        >
          {t.appearance.buttonPreviewLabel}
        </span>
        <span className={`ap-badge ${inkFails ? "is-warn" : "is-ok"}`} role={inkFails ? "alert" : undefined}>
          {format(inkFails ? t.appearance.buttonInkFail : t.appearance.buttonInkPass, { ratio })}
        </span>
      </div>
    </div>
  );
}
