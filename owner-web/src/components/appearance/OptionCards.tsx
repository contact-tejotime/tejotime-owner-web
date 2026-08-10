"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * The one radio-card control every Appearance axis uses.
 *
 * It is a real ARIA radiogroup, not a row of buttons: exactly one card is in the tab order
 * (roving tabindex), arrow keys move *and* select, Home/End jump to the ends, and the group
 * wraps. That is the WAI-ARIA radio pattern — a keyboard user reaches the group with one Tab
 * and never has to tab through seven shadow options to get to the next field.
 *
 * `aria-checked` (not `checked`) carries the state because these are `<button role="radio">`
 * rather than `<input type="radio">`: the cards render arbitrary content (preset thumbnails,
 * colour chips) that a native radio cannot hold without hacks.
 */

export interface OptionCardItem<T extends string> {
  value: T;
  label: string;
  /** Optional second line — one short sentence, never a paragraph. */
  description?: string;
  /** Optional visual above the label. Preset thumbnails ride here. */
  preview?: ReactNode;
  /** Optional corner flag, e.g. "Recommended". */
  badge?: string;
}

interface Props<T extends string> {
  /** Group heading, rendered as the radiogroup's accessible name. */
  legend: string;
  /** Optional helper line under the heading. */
  hint?: string;
  value: T;
  options: readonly OptionCardItem<T>[];
  onChange: (value: T) => void;
  /**
   * `chips` — dense one-line pills (mode, density, radius…).
   * `cards` — larger cards with a preview area (the preset picker).
   */
  variant?: "chips" | "cards";
  /** Extra class on the option grid, for per-group column counts. */
  gridClassName?: string;
}

export default function OptionCards<T extends string>({
  legend,
  hint,
  value,
  options,
  onChange,
  variant = "chips",
  gridClassName,
}: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const legendId = useId();
  const hintId = useId();

  // An unknown value (a config from a newer schema) must not strand the keyboard: fall back to
  // the first card so something is always tabbable.
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

  return (
    <div className="ap-group">
      <div className="ap-group-head">
        <span className="ap-group-legend" id={legendId}>
          {legend}
        </span>
        {hint && (
          <span className="ap-group-hint" id={hintId}>
            {hint}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={legendId}
        aria-describedby={hint ? hintId : undefined}
        className={`ap-options ${variant === "cards" ? "as-cards" : "as-chips"}${gridClassName ? ` ${gridClassName}` : ""}`}
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
              className={`ap-card${checked ? " is-selected" : ""}`}
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {opt.badge && <span className="ap-card-badge">{opt.badge}</span>}
              {opt.preview && <span className="ap-card-preview">{opt.preview}</span>}
              <span className="ap-card-label">{opt.label}</span>
              {opt.description && <span className="ap-card-desc">{opt.description}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
