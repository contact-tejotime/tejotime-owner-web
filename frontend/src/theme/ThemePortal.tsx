'use client';

/**
 * ThemePortal — a themed mount point for anything that has to escape its own DOM subtree.
 *
 * THE PROBLEM IT SOLVES. The engine's tokens are CSS custom properties scoped to
 * `[data-tt-theme]` (the microsite's root element). Custom properties inherit, so every
 * descendant gets them for free — but `createPortal(node, document.body)` puts `node` OUTSIDE
 * that element, where the only definitions in scope are the `:root` fallbacks in globals.css.
 * For the default theme those fallbacks happen to be identical to the engine's output, so the
 * bug is invisible today; for a store on `luxury` + dark + a gold brand, a portalled dropdown
 * renders as a white list with slate text and blue selection on top of a dark gold modal.
 *
 * THE FIX. Portal into the themed root itself instead of `document.body`. That keeps the node
 * inside the token scope while still lifting it out of whatever scrollable/clipping ancestor it
 * was trying to escape — the root is at the top of the microsite tree, above every modal and
 * scroll container, and (position: relative, z-index: auto, no transform/filter) it creates
 * neither a stacking context nor a containing block for `position: fixed`, so the portalled
 * node positions and stacks exactly as it did against `<body>`.
 *
 * Outside a provider — the marketing landing page, say — the hook returns `document.body` and
 * behaviour is unchanged.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * The ELEMENT, not a ref to it. `createPortal` needs its target during render, and reading
 * `ref.current` during render is exactly what React forbids — so the owner attaches the node
 * with a callback ref, keeps it in state, and hands the resolved element down here.
 */
const ThemePortalContext = createContext<HTMLElement | null>(null);

export interface ThemePortalProviderProps {
  /**
   * The element carrying `data-tt-theme` — the same one ThemeStyle's selector matches. `null`
   * before it is attached (first render / SSR), which consumers treat as "no themed root yet".
   */
  container: HTMLElement | null;
  children: ReactNode;
}

export function ThemePortalProvider({ container, children }: ThemePortalProviderProps) {
  return <ThemePortalContext.Provider value={container}>{children}</ThemePortalContext.Provider>;
}

/**
 * The element to portal into. Falls back to `document.body` when there is no themed root
 * (the marketing landing page, say) and to `null` during SSR — so guard the `createPortal`
 * call on a truthy container, or only reach it from an event-driven branch as PhoneField does.
 */
export function useThemePortalContainer(): HTMLElement | null {
  const themed = useContext(ThemePortalContext);
  if (themed) return themed;
  return typeof document === 'undefined' ? null : document.body;
}

export default ThemePortalProvider;
