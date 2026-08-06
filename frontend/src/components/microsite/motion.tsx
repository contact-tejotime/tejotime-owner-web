"use client";

/**
 * Scroll-reveal + count-up motion for the microsite.
 *
 * Everything here is driven by the theme engine's animation axis (`--dur-normal`, `--lift-y`,
 * `--scale-hover`), so a store on Subtle gets a plain fade and one on Rich gets staggered rise
 * — without any component knowing which. The CSS lives in salon.css; this file only decides
 * WHEN an element becomes visible.
 *
 * Reduced motion is honoured twice over: `prefers-reduced-motion` short-circuits the observer
 * here (elements render visible immediately, never animating), and salon.css disables the
 * keyframes too, so it holds even if JS is slow to hydrate.
 *
 * SSR-safe: `visible` starts true on the server and flips to false only after mount, so a
 * crawler and a JS-disabled visitor see fully-rendered content rather than a blank page.
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveal an element once it scrolls into view. Never un-reveals — re-animating on scroll-up
 * reads as jitter, not polish.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    setVisible(false);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      // Fire a little before the element reaches the fold so the animation has finished by
      // the time it is properly on screen.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return { ref, visible };
}

/**
 * Wrapper that fades + rises its children into view.
 *
 * `index` staggers siblings (capped, so a 40-item grid does not take four seconds to appear).
 */
export function Reveal({
  children,
  index = 0,
  style,
  id,
  className,
}: {
  children: ReactNode;
  index?: number;
  style?: CSSProperties;
  id?: string;
  className?: string;
}) {
  const { ref, visible } = useReveal();
  const delay = Math.min(index, 8) * 60;

  return (
    <div
      ref={ref}
      id={id}
      className={`ttReveal${visible ? " isIn" : ""}${className ? ` ${className}` : ""}`}
      style={{ ...style, transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * Count a number up when it scrolls into view.
 *
 * Returns the display string, so a value like "100+" or "4.8" keeps its suffix/precision —
 * the trust stats are free text, not integers.
 */
export function useCountUp<T extends HTMLElement = HTMLDivElement>(
  target: number,
  decimals = 0,
  durationMs = 1100,
) {
  const { ref, visible } = useReveal<T>();
  const [value, setValue] = useState(target);

  useEffect(() => {
    // State already holds `target`, so the non-animating paths simply leave it alone — which
    // also keeps every setState below inside the rAF callback rather than in the effect body.
    if (!visible || prefersReducedMotion()) return;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — fast start, gentle settle. Matches the hover easing elsewhere.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, target, durationMs]);

  return { ref, display: value.toFixed(decimals) };
}

export interface ParsedStat {
  /** Symbols before the number — "★ ", "₹". Rendered smaller than the numeral. */
  prefix: string;
  value: number;
  decimals: number;
  /** Symbols glued to the number — "+", "%". Stay at full numeral size. */
  symbol: string;
  /** A trailing WORD — "yrs", "members". Must not be set at numeral size. */
  unit: string;
}

/**
 * Split a stat like "100+", "10+ yrs", "2 members" or "★ 4.8" into its parts.
 *
 * The word and the symbol are separated deliberately: "+"/"%" belong to the number and read
 * fine at 48px, but a word does not — rendering "2 members" wholesale at numeral size wrapped
 * "members" onto its own line and dwarfed the 2 it was labelling.
 */
export function splitStat(raw: string): ParsedStat | null {
  const m = /^(\D*?)(\d+(?:\.\d+)?)(.*)$/.exec(raw.trim());
  if (!m) return null;
  const [, prefix, num, rest] = m;
  const dot = num.indexOf(".");
  // Everything up to the first letter is symbol; from there on it is the unit word.
  const tail = /^([^A-Za-z]*)(.*)$/.exec(rest) ?? ["", rest, ""];
  return {
    prefix,
    value: Number(num),
    decimals: dot === -1 ? 0 : num.length - dot - 1,
    symbol: (tail[1] ?? "").trim(),
    unit: (tail[2] ?? "").trim(),
  };
}
