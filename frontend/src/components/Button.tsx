"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * TejoTime primary action button. Ported 1:1 from the design system's
 * components/core/Button.jsx — variants primary/secondary/outline/ghost/danger,
 * sizes sm/md/lg, hover/active/focus states driven by React state.
 */
type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const HEIGHTS: Record<Size, string> = {
  sm: "var(--control-h-sm)",
  md: "var(--control-h-md)",
  lg: "var(--control-h-lg)",
};
const PADS: Record<Size, string> = {
  sm: "0 14px",
  md: "0 18px",
  lg: "0 22px",
};
const FONTS: Record<Size, string> = {
  sm: "var(--fs-body-sm)",
  md: "var(--fs-body-md)",
  lg: "var(--fs-body-lg)",
};
const VARIANTS: Record<Variant, { background: string; color: string; border: string; hoverBg: string; activeBg: string }> = {
  primary: { background: "var(--primary)", color: "var(--text-on-brand)", border: "1px solid transparent", hoverBg: "var(--primary-hover)", activeBg: "var(--primary-active)" },
  secondary: { background: "var(--secondary)", color: "var(--text-on-brand)", border: "1px solid transparent", hoverBg: "var(--secondary-hover)", activeBg: "var(--secondary-hover)" },
  outline: { background: "var(--surface-card)", color: "var(--text-strong)", border: "1px solid var(--border-default)", hoverBg: "var(--surface-hover)", activeBg: "var(--surface-sunken)" },
  ghost: { background: "transparent", color: "var(--text-body)", border: "1px solid transparent", hoverBg: "var(--surface-hover)", activeBg: "var(--surface-sunken)" },
  danger: { background: "var(--error)", color: "#fff", border: "1px solid transparent", hoverBg: "var(--red-700)", activeBg: "var(--red-700)" },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  leadingIcon = null,
  trailingIcon = null,
  fullWidth = false,
  children,
  style = {},
  onClick,
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  const isDisabled = disabled || loading;

  let background = v.background;
  if (!isDisabled && active) background = v.activeBg;
  else if (!isDisabled && hover) background = v.hoverBg;

  const baseShadow = variant === "ghost" ? "none" : "var(--shadow-xs)";
  const css: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    height: HEIGHTS[size],
    padding: PADS[size],
    font: `var(--fw-semibold) ${FONTS[size]}/1 var(--font-sans)`,
    letterSpacing: "var(--ls-snug)",
    borderRadius: "var(--radius-md)",
    background,
    color: v.color,
    border: v.border,
    cursor: isDisabled ? "not-allowed" : "pointer",
    opacity: isDisabled ? 0.5 : 1,
    width: fullWidth ? "100%" : "auto",
    transform: !isDisabled && active ? "translateY(0.5px)" : "none",
    transition: "background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard)",
    boxShadow: baseShadow,
    whiteSpace: "nowrap",
    userSelect: "none",
    outline: "none",
    ...style,
  };

  return (
    <button
      type="button"
      style={css}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = "var(--ring)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = baseShadow;
      }}
    >
      {loading && <Spinner />}
      {!loading && leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: "1em",
        height: "1em",
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderRightColor: "transparent",
        display: "inline-block",
        animation: "tt-spin 0.7s linear infinite",
      }}
    >
      <style>{"@keyframes tt-spin{to{transform:rotate(360deg)}}"}</style>
    </span>
  );
}
