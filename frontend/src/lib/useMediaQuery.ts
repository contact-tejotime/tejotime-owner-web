import { useEffect, useState } from "react";

/**
 * SSR-safe media-query hook. Returns `false` on the server and the first client
 * render (desktop-first — avoids a hydration mismatch), then the real match once
 * mounted, and stays in sync as the viewport crosses the breakpoint.
 *
 * Used to drive layout switches (e.g. the nav collapse) from JS + inline styles
 * rather than stylesheet `@media` rules, so the behaviour applies reliably via
 * React rendering instead of depending on a separate CSS bundle.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync immediately on mount / when the query changes
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
