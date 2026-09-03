"use client";

import { useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  onDark = false,
  leadingIcon,
  trailingIcon,
  onClick,
  disabled = false,
  style,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  onDark?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);

  // Heights come from the design system's control tokens so buttons line up
  // with inputs and every other control on the page.
  const sizing: CSSProperties =
    size === "lg"
      ? { height: "var(--control-h-lg)", padding: "0 22px", fontSize: "var(--fs-body-lg)" }
      : size === "sm"
        ? { height: "var(--control-h-sm)", padding: "0 14px", fontSize: "var(--fs-body-sm)" }
        : { height: "var(--control-h-md)", padding: "0 18px", fontSize: "var(--fs-body-md)" };

  let look: CSSProperties;
  if (variant === "primary") {
    look = {
      background: hover ? "var(--primary-hover)" : "var(--primary)",
      color: "#fff",
      border: "1px solid transparent",
    };
  } else if (variant === "secondary") {
    look = {
      background: hover ? "var(--secondary-hover)" : "var(--secondary)",
      color: "#fff",
      border: "1px solid transparent",
    };
  } else if (variant === "ghost") {
    look = {
      background: hover ? "var(--surface-hover)" : "transparent",
      color: onDark ? "var(--text-on-brand)" : "var(--text-body)",
      border: "1px solid transparent",
    };
  } else if (onDark) {
    look = {
      background: hover ? "rgba(255,255,255,.14)" : "transparent",
      color: "#fff",
      border: "1.5px solid rgba(255,255,255,.55)",
    };
  } else {
    look = {
      background: hover ? "var(--surface-hover)" : "var(--surface-card)",
      color: "var(--text-strong)",
      border: "1px solid var(--border-default)",
    };
  }

  const iconSize = size === "sm" ? 16 : 18;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setDown(false);
      }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: fullWidth ? "100%" : undefined,
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        letterSpacing: "-.01em",
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transform: down ? "translateY(.5px)" : "none",
        transition:
          "background .15s ease, border-color .15s ease, color .15s ease, transform .08s ease",
        ...sizing,
        ...look,
        ...style,
      }}
    >
      {leadingIcon && <Icon name={leadingIcon} size={iconSize} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={iconSize} />}
    </button>
  );
}

export function Input({
  label,
  placeholder,
  leadingIcon,
  prefix,
  value,
  onChange,
  name,
  type = "text",
  required,
}: {
  label: string;
  placeholder?: string;
  leadingIcon?: IconName;
  prefix?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  name?: string;
  type?: string;
  required?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)",
          color: "var(--text-body)",
          marginBottom: 8,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 48,
          padding: "0 14px",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-card)",
          border: `1px solid ${focus ? "var(--primary)" : "var(--border-default)"}`,
          boxShadow: focus ? "var(--ring)" : "none",
          transition: "border-color .15s ease, box-shadow .15s ease",
        }}
      >
        {leadingIcon && (
          <span style={{ color: "var(--text-subtle)", display: "flex" }}>
            <Icon name={leadingIcon} size={18} />
          </span>
        )}
        {prefix && (
          <span
            style={{
              font: "var(--fw-semibold) var(--fs-body-md)/1 var(--font-sans)",
              color: "var(--text-body)",
            }}
          >
            {prefix}
          </span>
        )}
        <input
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            font: "var(--fw-medium) var(--fs-body-md)/1 var(--font-sans)",
            color: "var(--text-strong)",
          }}
        />
      </div>
    </label>
  );
}
