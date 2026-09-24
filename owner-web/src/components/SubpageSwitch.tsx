"use client";

import "@/styles/settings-a.css";

/**
 * The app's `TSwitch` for the settings sub-pages (Working hours, Notifications): a 42×24 track
 * with a white knob, brand-coloured when on.
 *
 * A real `<button role="switch">`, not a checkbox dressed up, so a screen reader announces it as a
 * switch with its on/off state and Space/Enter flip it. It needs a name — `label`, or
 * `labelledBy` pointing at the row's visible text.
 */
export function SubpageSwitch({
  checked,
  onChange,
  label,
  labelledBy,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className="sa-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="sa-switch-track">
        <span className="sa-switch-knob" />
      </span>
    </button>
  );
}
