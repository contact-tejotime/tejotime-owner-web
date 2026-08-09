/**
 * TejoTime brand lockup (transparent PNG).
 * Brand mark colors: navy ink #102A6B + orange #F5821F.
 */
export function Logo({
  height = 40,
  showTagline = true,
}: {
  height?: number;
  /** Kept for call-site compatibility; the PNG already includes the tagline. */
  showTagline?: boolean;
}) {
  // Source is 612×408 with tagline; without tagline, crop to the wordmark band.
  const aspect = showTagline ? 612 / 408 : 612 / 320;
  const width = Math.round(height * aspect);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset from /public
    <img
      src="/tejotime-logo.png"
      alt="TejoTime — Easy Appointments for Small Business"
      width={width}
      height={height}
      style={{
        display: "block",
        width,
        height,
        objectFit: showTagline ? "contain" : "cover",
        objectPosition: "left top",
        userSelect: "none",
      }}
      draggable={false}
    />
  );
}
