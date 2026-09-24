"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Nothing to subscribe to: "are we in the browser yet" never changes after the first render. */
const subscribe = () => () => {};

/**
 * Renders an overlay (sheet, dialog) at the top of the signed-in shell instead of wherever its
 * trigger happens to sit.
 *
 * WHY. A `position: fixed` overlay is only "above everything" inside its own stacking context.
 * Any ancestor with `isolation`, `transform`, `filter`, `opacity < 1`, `contain`, or a z-index on
 * a positioned box starts a new one, and then the overlay's z-index only ranks it INSIDE that box
 * — later siblings (the seat boards, the fixed bottom nav) paint straight over it. That is how the
 * booking QR ended up under the seat boards on a phone: its trigger sits in Home's live-queue
 * card, which is `isolation: isolate` for its decorative discs.
 *
 * WHERE. The themed shell root (`.app[data-tt-theme]`), not `document.body`. The store theme's
 * custom properties — brand colour, surfaces, text, and the whole dark palette — are declared on
 * that element by StoreThemeStyle, so an overlay portalled to <body> fell back to globals.css's
 * light defaults: a white, blue dialog over a dark, red store. `.app` is not itself a stacking
 * context, so the overlay still ranks against the whole page. <body> is only the fallback for a
 * page outside the shell.
 *
 * Renders nothing on the server and on the hydration pass (useSyncExternalStore's server
 * snapshot), so an overlay that is already open on first paint cannot cause a hydration mismatch.
 * Every current caller mounts it after a click, where the client snapshot applies immediately.
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!inBrowser) return null;
  const host = document.querySelector<HTMLElement>(".app[data-tt-theme]") ?? document.body;
  return createPortal(children, host);
}
