import type { CSSProperties } from "react";

/**
 * Centred content column shared by the marketing chrome and the pages that sit
 * inside it. It lives in its own module (no "use client") because server
 * components — the industry and resources pages — call it during prerender, and
 * a plain function exported from a client module cannot be invoked on the
 * server.
 */

const MAX = 1120;
const PAD = "0 32px";

export function shell(extra?: CSSProperties): CSSProperties {
  return { maxWidth: MAX, margin: "0 auto", padding: PAD, ...extra };
}
