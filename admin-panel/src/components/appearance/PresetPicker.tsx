"use client";

import { useMemo } from "react";
import {
  PRESET_LIST,
  resolveTheme,
  tokensForMode,
  type ModeId,
  type PresetId,
  type TokenMap,
} from "@/theme/engine";
import { t } from "@/i18n";
import OptionCards, { type OptionCardItem } from "./OptionCards";

/**
 * Preset picker with real thumbnails.
 *
 * Each card resolves the *actual* theme for that preset against the store's current brand and
 * mode, then paints a mini hero + button + card straight from the resulting tokens. Nothing is
 * hand-drawn or approximated: if a preset ships 2px borders and uppercase labels, the thumbnail
 * shows 2px borders and uppercase labels, and re-tints the instant the brand colour changes.
 * A text-only radio list would make the admin guess.
 */

interface Props {
  value: PresetId;
  /** `#rrggbb` — thumbnails re-tint live as the brand picker moves. */
  brand: string;
  mode: ModeId;
  /** Category suggestion, flagged on the matching card. `null` hides the flag. */
  recommended: PresetId | null;
  onChange: (preset: PresetId) => void;
}

export default function PresetPicker({ value, brand, mode, recommended, onChange }: Props) {
  /**
   * Six resolveTheme calls, memoised on brand+mode. Each one also generates two ramps and a
   * contrast report, so this is the most expensive thing in the panel — but it is pure
   * arithmetic on a handful of colours, and re-running it is what keeps the thumbnails honest.
   */
  const options: OptionCardItem<PresetId>[] = useMemo(
    () =>
      PRESET_LIST.map((preset) => {
        // 'auto' has no single look; thumbnails show the light face, which is what a first-time
        // visitor on a light-preferring device sees.
        const tokens = tokensForMode(
          resolveTheme({ preset: preset.id, mode, brand }),
          mode === "dark" ? "dark" : "light",
        );
        const copy = t.appearance.presets[preset.id];
        return {
          value: preset.id,
          label: copy.label,
          description: copy.desc,
          badge: preset.id === recommended ? t.appearance.recommended : undefined,
          preview: <Thumb tokens={tokens} label={copy.label} />,
        };
      }),
    [brand, mode, recommended],
  );

  return (
    <OptionCards
      legend={t.appearance.presetTitle}
      hint={t.appearance.presetHint}
      value={value}
      options={options}
      onChange={onChange}
      variant="cards"
      gridClassName="ap-preset-grid"
    />
  );
}

/**
 * ~160x110 miniature: hero band with two text bars, then a body strip with a primary button
 * and a card. Values are read straight off the token map (no CSS custom properties), so each
 * thumbnail is self-contained and nothing leaks between cards.
 */
function Thumb({ tokens, label }: { tokens: TokenMap; label: string }) {
  const px = (v: string | undefined, fallback: string) => v || fallback;
  const heroBg = `linear-gradient(${px(tokens["--hero-angle"], "125deg")}, ${px(tokens["--hero-from"], "#2563eb")}, ${px(tokens["--hero-via"], "#2563eb")}, ${px(tokens["--hero-to"], "#1d4ed8")})`;

  return (
    <span
      className="ap-thumb"
      aria-hidden="true"
      title={label}
      style={{
        background: px(tokens["--bg"], "#f8fafc"),
        borderColor: px(tokens["--border"], "#cbd5e1"),
        borderWidth: px(tokens["--border-w"], "1px"),
        borderRadius: px(tokens["--radius-lg"], "14px"),
        boxShadow: px(tokens["--shadow-xs"], "none"),
      }}
    >
      <span className="ap-thumb-hero" style={{ background: heroBg }}>
        <span
          className="ap-thumb-bar"
          style={{
            background: px(tokens["--on-hero"], "#ffffff"),
            width: "58%",
            height: 7,
            borderRadius: px(tokens["--radius-xs"], "4px"),
          }}
        />
        <span
          className="ap-thumb-bar"
          style={{
            background: px(tokens["--on-hero"], "#ffffff"),
            width: "36%",
            height: 4,
            opacity: 0.7,
            borderRadius: px(tokens["--radius-xs"], "4px"),
          }}
        />
      </span>

      <span className="ap-thumb-body">
        <span
          className="ap-thumb-btn"
          style={{
            background: px(tokens["--brand"], "#2563eb"),
            color: px(tokens["--on-brand"], "#ffffff"),
            borderRadius: px(tokens["--radius-sm"], "6px"),
            fontWeight: Number(px(tokens["--fw-label"], "600")) || 600,
            letterSpacing: px(tokens["--tracking-label"], "0"),
            textTransform: px(tokens["--label-transform"], "none") === "uppercase" ? "uppercase" : "none",
            boxShadow: px(tokens["--shadow-sm"], "none"),
          }}
        >
          Book
        </span>
        <span
          className="ap-thumb-card"
          style={{
            background: px(tokens["--surface-1"], "#ffffff"),
            border: `${px(tokens["--border-w"], "1px")} solid ${px(tokens["--border"], "#cbd5e1")}`,
            borderRadius: px(tokens["--radius-md"], "10px"),
          }}
        >
          <span style={{ background: px(tokens["--text"], "#0f172a"), width: "70%", height: 4, borderRadius: 2 }} />
          <span
            style={{ background: px(tokens["--text-secondary"], "#334155"), width: "45%", height: 3, borderRadius: 2, opacity: 0.7 }}
          />
        </span>
      </span>
    </span>
  );
}
