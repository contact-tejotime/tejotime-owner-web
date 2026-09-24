"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * The one radio control every Appearance axis uses, drawn as the app's `ChipRow` (and, for the
 * presets, its 2-up preset cards).
 *
 * It is a real ARIA radiogroup, not a row of buttons: exactly one option is in the tab order
 * (roving tabindex), arrow keys move *and* select, Home/End jump to the ends, and the group
 * wraps. That is the WAI-ARIA radio pattern — a keyboard user reaches the group with one Tab and
 * never has to tab through seven shadow options to get to the next field.
 *
 * `aria-checked` (not `checked`) carries the state because these are `<button role="radio">`
 * rather than `<input type="radio">`: the preset cards hold a live thumbnail that a native radio
 * cannot.
 *
 * The group's heading is the caller's (a section title, or a caption inside one), referenced by
 * `labelledBy`; `label` names a group that has no visible heading.
 */

export interface OptionCardItem<T extends string> {
  value: T;
  label: string;
  /** Optional second line. Cards show it; chips carry it as a hover tooltip, as the app's chips
   *  are label-only. */
  description?: string;
  /** Optional visual above the label. Preset thumbnails ride here. */
  preview?: ReactNode;
  /** Optional flag above the label, e.g. "Recommended". */
  badge?: string;
}

interface Props<T extends string> {
  /** Accessible name when no visible heading labels the group. */
  label?: string;
  /** Id of the visible heading that names the group. */
  labelledBy?: string;
  value: T;
  options: readonly OptionCardItem<T>[];
  onChange: (value: T) => void;
  /**
   * `chips` — the app's ChipRow: one-line pills (mode, density, corners…).
   * `cards` — the app's preset cards: badge, label and description, plus a preview on the web.
   */
  variant?: "chips" | "cards";
}

export default function OptionCards<T extends string>({
  label,
  labelledBy,
  value,
  options,
  onChange,
  variant = "chips",
}: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // An unknown value (a config from a newer schema) must not strand the keyboard: fall back to
  // the first option so something is always tabbable.
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function move(from: number, delta: number) {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index, -1);
        break;
      case "Home":
        e.preventDefault();
        move(index, -index);
        break;
      case "End":
        e.preventDefault();
        move(index, options.length - 1 - index);
        break;
      default:
        break;
    }
  }

  const cards = variant === "cards";

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cards ? "sb-ap-presets" : "sb-ap-chips"}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === selectedIndex ? 0 : -1}
            className={`${cards ? "sb-ap-preset" : "sb-ap-chip"}${checked ? " is-selected" : ""}`}
            title={cards ? undefined : opt.description}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {cards ? (
              <>
                {opt.preview}
                {opt.badge ? <span className="sb-ap-preset-badge">{opt.badge}</span> : null}
                <span className="sb-ap-preset-label">{opt.label}</span>
                {opt.description ? <span className="sb-ap-preset-desc">{opt.description}</span> : null}
              </>
            ) : (
              opt.label
            )}
          </button>
        );
      })}
    </div>
  );
}
