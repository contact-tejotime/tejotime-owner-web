import { t } from "@/i18n";

/**
 * TejoTime brand lockup (transparent PNG, trimmed).
 * Brand mark colors: navy ink #102A6B + orange #F5821F.
 */
const LOGO_W = 538;
const LOGO_H = 156;

export function Logo({
  height = 48,
  showTagline = true,
}: {
  height?: number;
  /** Kept for call-site compatibility; the PNG already includes the tagline. */
  showTagline?: boolean;
}) {
  void showTagline;
  const width = Math.round(height * (LOGO_W / LOGO_H));

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset from /public
    <img
      src="/tejotime-logo.png"
      alt={t.brand.logoAlt}
      width={width}
      height={height}
      style={{
        display: "block",
        width,
        height,
        objectFit: "contain",
        userSelect: "none",
      }}
      draggable={false}
    />
  );
}
