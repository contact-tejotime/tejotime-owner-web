"use client";

/**
 * An accessible on/off switch, hand-built rather than pulled from a library (no new
 * dependencies in this change).
 *
 * It is a real <button> with role="switch" and aria-checked, so a screen reader announces it as
 * a switch and the browser gives it keyboard behaviour for free: Space and Enter both activate
 * it, and it is reachable in tab order without a tabIndex. A <div> with a click handler would
 * need all of that re-implemented and would still not be announced correctly.
 *
 * Track and knob are styled from `aria-checked` in consent.css rather than from inline styles, so
 * the visual state cannot drift from the state assistive technology is told about — they read the
 * same attribute. Off is a neutral grey track; on is the brand blue (--primary), the same blue as
 * the site's primary buttons.
 */
export function ConsentToggle({
  checked,
  onChange,
  label,
  describedBy,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — the category, e.g. "Analytics". */
  label: string;
  /** Id of the description element, so the one-line explanation is announced too. */
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="ttConsentSwitch"
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    >
      <span className="ttConsentSwitchTrack">
        <span className="ttConsentSwitchKnob" />
      </span>
    </button>
  );
}
