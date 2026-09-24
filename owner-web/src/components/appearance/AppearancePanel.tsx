"use client";

import { useId, useMemo } from "react";
import {
  ANIMATION_IDS,
  DENSITY_IDS,
  MODE_IDS,
  RADIUS_IDS,
  SHADOW_IDS,
  getPreset,
  presetForCategory,
  resolveTheme,
  type AnimationId,
  type DensityId,
  type ModeId,
  type PresetId,
  type RadiusId,
  type ShadowId,
  type ThemeConfig,
} from "@/theme/engine";
import { SbSection } from "@/components/store-settings/ui";
import { t, formatAppearance as format } from "./appearanceCopy";
import BrandColorPicker from "./BrandColorPicker";
import ButtonColorPicker from "./ButtonColorPicker";
import MicrositePreview from "./MicrositePreview";
import OptionCards, { type OptionCardItem } from "./OptionCards";
import PresetPicker from "./PresetPicker";

/**
 * The store's microsite appearance — the controls of the app's settings/appearance.tsx, in its
 * order: intro, "Unsaved changes", Brand color, Button color, Theme preset, Mode, Density,
 * Corners, Shadow, Motion, the one-line summary, then the live preview. The page around it
 * (AppearanceEditor) owns the state and the Reset / Open customer site / Save buttons.
 *
 * Design notes worth keeping:
 *
 * - The panel owns NO state. `theme` in, `onChange` out — the editor stays the single source of
 *   truth, so the preview, the legacy `themeColor` column and the payload can never disagree.
 *
 * - The four modifier axes (radius/shadow/density/animation) each offer a leading "Preset
 *   default (…)" chip that DELETES the key from the config. That is not cosmetic: the engine
 *   fills an absent axis from the preset, so leaving it absent is what lets a later switch to
 *   `bold` bring bold's sharp corners along instead of silently keeping minimal's. A pinned value
 *   is an explicit override and survives preset changes, which is the other half of the contract.
 *
 * - Nothing here is applied to the live site until the page is saved.
 */

interface Props {
  theme: ThemeConfig;
  onChange: (next: ThemeConfig) => void;
  /** Free-text business category — drives the "Recommended" flag only. */
  category: string;
  /** Digits-only phone; picks the real microsite over the demo store in the preview. */
  phoneFull: string;
  /** The appearance as last saved. Drives the unsaved-changes line. */
  savedTheme: ThemeConfig;
}

/** Sentinel for "inherit this axis from the preset" — never stored, never sent. */
const INHERIT = "__preset__";
type WithInherit<T extends string> = T | typeof INHERIT;

/**
 * The category's suggested preset. Suggestion only: re-categorising a store must never move its
 * look, so it is shown as a flag on a card and used by Reset, never auto-applied.
 */
export function recommendedPreset(category: string): PresetId | null {
  return category.trim() ? presetForCategory(category) : null;
}

/**
 * Back to the category's recommendation with every override cleared. Brand and light/dark mode
 * are the store's own decisions, not part of the recommendation, so they are kept; everything
 * else goes, including the accent, the label ink and the button colour — they are overrides, and
 * "reset to recommended" means no overrides.
 */
export function resetToRecommended(theme: ThemeConfig, category: string): ThemeConfig {
  return {
    preset: recommendedPreset(category) ?? "minimal",
    mode: theme.mode,
    brand: theme.brand,
  };
}

export default function AppearancePanel({ theme, onChange, category, phoneFull, savedTheme }: Props) {
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const preset = getPreset(resolved.config.preset);
  const recommended = recommendedPreset(category);
  const dirty = key(theme) !== key(savedTheme);

  /** Set an optional axis, or delete it when the owner chooses "Preset default". */
  function setAxis<K extends "radius" | "shadow" | "density" | "animation">(
    axis: K,
    value: WithInherit<NonNullable<ThemeConfig[K]>>,
  ) {
    const next: ThemeConfig = { ...theme };
    if (value === INHERIT) delete next[axis];
    else next[axis] = value as ThemeConfig[K];
    onChange(next);
  }

  /**
   * Switching preset, with one piece of housekeeping.
   *
   * An axis whose stored value is exactly the OUTGOING preset's default was never
   * differentiated from it — that is the state every store starts in. Carrying those pins into
   * the new preset is the trap the engine warns about: pick `bold` and you would get bold's
   * colours with minimal's soft shadows and round corners, with no clue why. Dropping them lets
   * the new preset speak, and the "Preset default" chip lights up so the change is visible
   * rather than magic. A value the owner actually moved off the default survives untouched.
   */
  function setPreset(next: PresetId) {
    const outgoing = getPreset(resolved.config.preset).defaults;
    const cfg: ThemeConfig = { ...theme, preset: next };
    if (cfg.radius === outgoing.radius) delete cfg.radius;
    if (cfg.shadow === outgoing.shadow) delete cfg.shadow;
    if (cfg.density === outgoing.density) delete cfg.density;
    if (cfg.animation === outgoing.animation) delete cfg.animation;
    onChange(cfg);
  }

  /** "Preset default (Soft)" — the label has to say what inheriting actually gets you. */
  function inheritOption<T extends string>(current: string): OptionCardItem<WithInherit<T>> {
    return {
      value: INHERIT,
      label: `${t.appearance.presetDefault} (${current})`,
      description: format(t.appearance.presetDefaultValue, { value: current }),
    };
  }

  const modeOptions: OptionCardItem<ModeId>[] = MODE_IDS.map((id) => ({
    value: id,
    label: t.appearance.modes[id].label,
    description: t.appearance.modes[id].desc,
  }));

  const densityOptions: OptionCardItem<WithInherit<DensityId>>[] = [
    inheritOption(t.appearance.densities[preset.defaults.density].label),
    ...DENSITY_IDS.map((id) => ({
      value: id as WithInherit<DensityId>,
      label: t.appearance.densities[id].label,
      description: t.appearance.densities[id].desc,
    })),
  ];

  const radiusOptions: OptionCardItem<WithInherit<RadiusId>>[] = [
    inheritOption(t.appearance.radii[preset.defaults.radius].label),
    ...RADIUS_IDS.map((id) => ({
      value: id as WithInherit<RadiusId>,
      label: t.appearance.radii[id].label,
      description: t.appearance.radii[id].desc,
    })),
  ];

  const shadowOptions: OptionCardItem<WithInherit<ShadowId>>[] = [
    inheritOption(t.appearance.shadows[preset.defaults.shadow].label),
    ...SHADOW_IDS.map((id) => ({
      value: id as WithInherit<ShadowId>,
      label: t.appearance.shadows[id].label,
      description: t.appearance.shadows[id].desc,
    })),
  ];

  const animationOptions: OptionCardItem<WithInherit<AnimationId>>[] = [
    inheritOption(t.appearance.animations[preset.defaults.animation].label),
    ...ANIMATION_IDS.map((id) => ({
      value: id as WithInherit<AnimationId>,
      label: t.appearance.animations[id].label,
      description: t.appearance.animations[id].desc,
    })),
  ];

  return (
    <>
      <p className="sb-ap-intro">{t.appearance.subtitle}</p>
      {dirty ? (
        <p className="sb-ap-unsaved" role="status">
          {t.appearance.unsaved}
        </p>
      ) : null}

      <div className="sb-ap-layout">
        <div className="sb-ap-controls">
          <BrandColorPicker
            value={theme.brand}
            onChange={(brand) => onChange({ ...theme, brand })}
            resolved={resolved}
            mode={resolved.config.mode}
          />

          <ButtonColorPicker
            value={theme.button}
            brand={theme.brand}
            onChange={(button) => {
              // Absent, never `undefined`-valued: the key has to disappear so the engine falls
              // back to the brand ramp and the config round-trips through jsonb cleanly.
              const next: ThemeConfig = { ...theme };
              if (button === undefined) delete next.button;
              else next.button = button;
              onChange(next);
            }}
            resolved={resolved}
            mode={resolved.config.mode}
            brandInk={theme.brandInk ?? "auto"}
            onBrandInkChange={(ink) => {
              const next: ThemeConfig = { ...theme };
              if (ink === "auto") delete next.brandInk;
              else next.brandInk = ink;
              onChange(next);
            }}
          />

          <PresetPicker
            value={resolved.config.preset}
            brand={theme.brand}
            mode={resolved.config.mode}
            recommended={recommended}
            onChange={setPreset}
          />

          <ChipSection
            title={t.appearance.modeTitle}
            value={resolved.config.mode}
            options={modeOptions}
            onChange={(m) => onChange({ ...theme, mode: m })}
          />
          <ChipSection
            title={t.appearance.densityTitle}
            value={(theme.density ?? INHERIT) as WithInherit<DensityId>}
            options={densityOptions}
            onChange={(v) => setAxis("density", v)}
          />
          <ChipSection
            title={t.appearance.radiusTitle}
            value={(theme.radius ?? INHERIT) as WithInherit<RadiusId>}
            options={radiusOptions}
            onChange={(v) => setAxis("radius", v)}
          />
          <ChipSection
            title={t.appearance.shadowTitle}
            value={(theme.shadow ?? INHERIT) as WithInherit<ShadowId>}
            options={shadowOptions}
            onChange={(v) => setAxis("shadow", v)}
          />
          <ChipSection
            title={t.appearance.animationTitle}
            value={(theme.animation ?? INHERIT) as WithInherit<AnimationId>}
            options={animationOptions}
            onChange={(v) => setAxis("animation", v)}
          />

          <p className="sb-ap-effective">
            {format(t.appearance.effective, {
              preset: t.appearance.presets[resolved.config.preset].label,
              mode: t.appearance.modes[resolved.config.mode].label,
              density: t.appearance.densities[resolved.config.density].label,
              radius: t.appearance.radii[resolved.config.radius].label,
              shadow: t.appearance.shadows[resolved.config.shadow].label,
              animation: t.appearance.animations[resolved.config.animation].label,
            })}
          </p>
        </div>

        <div className="sb-ap-preview-col">
          <MicrositePreview config={theme} phoneFull={phoneFull} />
        </div>
      </div>
    </>
  );
}

/** One axis: the app's `AxisSection` — a titled card holding a row of chips. */
function ChipSection<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: readonly OptionCardItem<T>[];
  onChange: (v: T) => void;
}) {
  const titleId = useId();
  return (
    <SbSection title={title} titleId={titleId}>
      <OptionCards labelledBy={titleId} value={value} options={options} onChange={onChange} />
    </SbSection>
  );
}

/**
 * Stable serialisation for the unsaved-changes check — key order in a spread-built object is
 * insertion order, so a plain JSON.stringify would report a false "changed" after a round trip.
 * Exported because the editor's Save is gated on the same comparison.
 */
export function key(c: ThemeConfig): string {
  return [
    c.preset,
    c.mode,
    c.brand.toUpperCase(),
    c.radius ?? "",
    c.shadow ?? "",
    c.density ?? "",
    c.animation ?? "",
    c.heroVariant ?? "",
    c.accent ?? "",
    c.brandInk ?? "",
    // Every axis the panel can edit has to appear here. Omitting one does not just skip a
    // repaint: `dirty` gates Save, so an unlisted axis is silently unsaveable on its own.
    c.button ?? "",
  ].join("|");
}
