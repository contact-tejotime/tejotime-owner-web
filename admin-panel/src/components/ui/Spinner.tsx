import type { CSSProperties } from "react";
import { t } from "@/i18n";

/**
 * Inline loading spinner. Tints to the surrounding text color (via currentColor
 * in the .spinner rule), so it reads correctly inside any button variant. Size is
 * driven by font-size — the spinner box is 1em square.
 */
export default function Spinner({
  size,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={className ? `spinner ${className}` : "spinner"}
      style={size ? { fontSize: size, ...style } : style}
      role="status"
      aria-label={t.common.loading}
    />
  );
}
