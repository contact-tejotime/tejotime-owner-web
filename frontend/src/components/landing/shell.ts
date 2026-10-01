import type { CSSProperties } from "react";

/**
 * Centred content column shared by the marketing chrome and the pages that sit
 * inside it. It lives in its own module (no "use client") because server
 * components — the resources page — call it during prerender, and a plain
 * function exported from a client module cannot be invoked on the server.
 */

const MAX = 1120;
const PAD = "0 32px";

export function shell(extra?: CSSProperties): CSSProperties {
  return { maxWidth: MAX, margin: "0 auto", padding: PAD, ...extra };
}

/**
 * Read by screen readers, invisible on screen — e.g. "(opens in a new tab)" on the store links.
 * Inline because this app's globals.css does not load Tailwind, so there is no `sr-only` class.
 */
export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
