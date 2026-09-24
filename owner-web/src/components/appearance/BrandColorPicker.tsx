"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { RAMP_STOPS, type ModeId, type ResolvedTheme } from "@/theme/engine";
import { SbField, SbSection } from "@/components/store-settings/ui";
import { t, formatAppearance as format } from "./appearanceCopy";
import { Icon } from "@/components/Icon";

/**
 * "Brand color" — the app's section: 12 swatches, the hex field, the generated 50→900 ramp.
 *
 * Owner-web adds two things the app does not have: the browser's own colour picker at the head
 * of the hex field, and a line under the ramp judging LINKS on the page, which is what this
 * colour still drives. The verdict is the point: a store owner asking for #FFE066 has no way to
 * know it cannot carry readable link text, and the engine already computed that.
 *
 * The primary BUTTON is judged separately, in ButtonColorPicker — it has its own colour axis
 * since `theme.button` landed, so a button verdict here would describe a control this colour may
 * not even touch. The overall "all checks pass" line sits there too, where the app puts it.
 */

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Twelve starting points across the hue circle. The first is the TejoTime blue — the value
 * every existing store resolves to — and the next four are the preset accent colours, so the
 * curated (hand-tuned) ramps in the engine get used rather than generated near-misses. Same list,
 * same order as the app.
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
  /** Raw field value — may be mid-typing and invalid; the page's Save refuses it until fixed. */
  value: string;
  onChange: (hex: string) => void;
  /** Resolved from the *current* config, so the ramp and verdict always match the live preview. */
  resolved: ResolvedTheme;
  /** Which face of the theme the verdict judges. `auto` is judged as light. */
  mode: ModeId;
}

export default function BrandColorPicker({ value, onChange, resolved, mode }: Props) {
  const titleId = useId();
  const valid = HEX_RE.test(value.trim());
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const face = mode === "dark" ? "dark" : "light";

  const linkCheck = resolved.contrast[face].find((c) => c.id === `${face}/text-link-on-bg`);
  const linkRatio = linkCheck ? linkCheck.ratio.toFixed(2) : "—";
  const linkFails = linkCheck != null && !linkCheck.pass;

  /**
   * Roving tabindex over the swatch row, so these 12 buttons are one tab stop between the
   * heading and the hex field. They stay `aria-pressed` toggles rather than radios: a custom hex
   * means NONE is pressed, which a radiogroup cannot express — so index 0 anchors the tab stop.
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
    <SbSection title={t.appearance.brandTitle} hint={t.appearance.brandHint} titleId={titleId}>
      <div className="sb-ap-swatches" role="group" aria-labelledby={titleId}>
        {SWATCHES.map((s, i) => {
          const selected = valid && value.trim().toUpperCase() === s.hex;
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
              title={`${t.appearance.swatches[s.key]} ${s.hex}`}
              aria-label={format(t.appearance.brandSwatchLabel, {
                name: t.appearance.swatches[s.key],
                hex: s.hex,
              })}
              onClick={() => onChange(s.hex)}
            />
          );
        })}
      </div>

      <SbField
        id="sf-themeColor"
        label={t.appearance.brandCustom}
        error={valid ? undefined : t.storeForm.invalidThemeColor}
      >
        <input
          type="color"
          className="sb-ap-native"
          aria-label={t.appearance.brandPickerLabel}
          value={valid ? value.trim() : "#2563EB"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          id="sf-themeColor"
          value={value}
          onChange={(e) => {
            // Normalised as typed, as in the app: a leading # and upper case, capped at 7.
            const v = e.target.value.trim();
            onChange((v.startsWith("#") ? v.toUpperCase() : `#${v}`.toUpperCase()).slice(0, 7));
          }}
          placeholder="#2563EB"
          maxLength={7}
          aria-invalid={valid ? undefined : true}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </SbField>

      <div className="sb-ap-ramp" aria-label={t.appearance.rampTitle} role="img">
        {RAMP_STOPS.map((stop) => (
          <span
            key={stop}
            style={{ background: resolved.brandRamp[stop] }}
            title={format(t.appearance.rampStep, { step: stop, hex: resolved.brandRamp[stop] })}
          />
        ))}
      </div>

      <p className={`sb-ap-caption ${linkFails ? "is-warn" : "is-ok"}`} role={linkFails ? "alert" : undefined}>
        <Icon name={linkFails ? "alertTriangle" : "checkCircle"} size={14} />
        <span>{format(linkFails ? t.appearance.linkAaFail : t.appearance.linkAa, { ratio: linkRatio })}</span>
      </p>
    </SbSection>
  );
}
