/**
 * TejoTime wordmark — rendered as scalable SVG + text so it never clips and
 * stays crisp at any size. Brand mark colors: navy ink #102A6B + orange #F5821F.
 *
 * To use a raster logo instead, drop a file at /public/tejotime-logo.png and
 * swap this component back for an <img src="/public/tejotime-logo.png" />.
 */
const INK = "#102A6B";
const ORANGE = "#F5821F";
const BLUE = "#2563EB";

export function Logo({
  height = 40,
  showTagline = true,
}: {
  height?: number;
  showTagline?: boolean;
}) {
  const tagline = Math.max(Math.round(height * 0.135), 7);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: height * 0.16,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <LogoMark size={height} />
      <span style={{ display: "inline-flex", flexDirection: "column", justifyContent: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "baseline", lineHeight: 1 }}>
          <span
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontWeight: 800,
              fontSize: Math.round(height * 0.6),
              letterSpacing: "-0.02em",
              color: INK,
            }}
          >
            Tejo
          </span>
          <span
            style={{
              fontFamily: "var(--font-script), cursive",
              fontWeight: 400,
              fontSize: Math.round(height * 0.74),
              color: ORANGE,
              marginLeft: height * 0.02,
              lineHeight: 1,
            }}
          >
            Time
          </span>
        </span>
        {showTagline && (
          <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: height * 0.07 }}>
            <span style={{ height: 1, width: height * 0.13, background: INK, opacity: 0.45 }} />
            <span
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontWeight: 500,
                fontSize: tagline,
                letterSpacing: "0.01em",
                color: INK,
                whiteSpace: "nowrap",
              }}
            >
              Easy Appointments for Small Business
            </span>
            <span style={{ height: 1, width: height * 0.13, background: INK, opacity: 0.45 }} />
          </span>
        )}
      </span>
    </span>
  );
}

function LogoMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ttCalHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={BLUE} />
          <stop offset="1" stopColor="#1E40AF" />
        </linearGradient>
      </defs>

      {/* calendar top tabs */}
      <rect x="13" y="3.5" width="4" height="8" rx="2" fill={INK} />
      <rect x="27" y="3.5" width="4" height="8" rx="2" fill={INK} />

      {/* calendar frame */}
      <rect x="5.5" y="7.5" width="32" height="32" rx="7" fill="#fff" stroke={INK} strokeWidth="3" />
      {/* header band */}
      <rect x="8" y="9.5" width="27" height="7.5" rx="3.5" fill="url(#ttCalHead)" />

      {/* checkbox + check */}
      <rect x="11.5" y="22" width="13" height="13" rx="3.5" fill={BLUE} />
      <path d="M14.7 28.5l2.7 2.7 4.4-5.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

      {/* clock halo to lift it off the calendar */}
      <circle cx="35" cy="34" r="12" fill="#fff" />
      {/* clock face */}
      <circle cx="35" cy="34" r="10.3" fill="#fff" stroke={INK} strokeWidth="3" />
      {/* hands */}
      <path d="M35 34V27.2" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M35 34h5.2" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      {/* orange accent (second hand) */}
      <path d="M35 34l-3.2 4.3" stroke={ORANGE} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="35" cy="34" r="1.7" fill={INK} />
      {/* 12 o'clock tick */}
      <path d="M35 25.4v1.4" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
