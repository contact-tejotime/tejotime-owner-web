'use client';

/**
 * usePreviewChannel — live theme preview for the admin panel.
 *
 * The admin opens the public microsite with `?preview=1` (in an iframe or a popup) and then
 * postMessages theme configs at it while the owner drags sliders. This hook is the receiving
 * end.
 *
 * THREE RULES IT OBEYS
 *
 * 1. NO-OP WITHOUT `?preview=1`. Real visitors must not pay for this: without the flag the
 *    effect returns before it attaches a listener, and the engine is never even downloaded
 *    (it is behind a dynamic `import()`, so it lands in its own chunk).
 *
 * 2. TOKENS ONLY, NEVER DATA. The message payload is fed straight to `normalizeThemeConfig`,
 *    which whitelists the seven known keys and drops everything else. Nothing from the
 *    message can reach the page as content, markup or a URL.
 *
 * 3. NO REACT STATE FOR COLOURS. Applying a preview writes CSS custom properties directly
 *    with `element.style.setProperty`. A drag can fire 60 messages a second; if each one set
 *    state, the whole microsite would re-render 60 times. Inline properties outrank the
 *    `<style>` block from ThemeStyle by specificity, so the override is immediate and the
 *    server-rendered stylesheet stays intact underneath.
 *
 * Security: `event.origin` is checked against a fixed allowlist before the payload is even
 * looked at. Everything else is dropped silently.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { ModeId, ThemeConfig, TokenMap } from './engine';

/** Production admin origin; overridable per-deploy, never per-request. */
const DEFAULT_ADMIN_ORIGIN = 'https://admin.tejotime.com';

/** The message the admin sends. */
const PREVIEW_MESSAGE = 'tt-theme-preview';
/** The handshake we send back so the admin knows the frame is listening. */
const READY_MESSAGE = 'tt-theme-ready';

interface PreviewMessage {
  type: typeof PREVIEW_MESSAGE;
  config: unknown;
}

/**
 * Origins allowed to drive the preview.
 *
 * Production ships EXACTLY one: `NEXT_PUBLIC_ADMIN_ORIGIN` (declared as a build ARG in
 * frontend/Dockerfile) or the default above. The two local dev hosts are behind a
 * `NODE_ENV !== 'production'` test so the bundler drops them from the production build —
 * otherwise any page a visitor happens to have open on localhost:3001 could iframe a live
 * microsite with `?preview=1` and repaint it.
 *
 * `NEXT_PUBLIC_*` and `NODE_ENV` are inlined at build time, so this is a constant in the
 * bundle — it cannot be influenced by a request.
 */
function allowedOrigins(): string[] {
  const configured = process.env.NEXT_PUBLIC_ADMIN_ORIGIN?.trim();
  const list = [configured && configured.length > 0 ? configured : DEFAULT_ADMIN_ORIGIN];
  if (process.env.NODE_ENV !== 'production') {
    list.push('http://localhost:3001', 'http://127.0.0.1:3001');
  }
  // Normalise away a trailing slash — `event.origin` never has one.
  return Array.from(new Set(list.map((o) => o.replace(/\/+$/, ''))));
}

function isPreviewMessage(data: unknown): data is PreviewMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === PREVIEW_MESSAGE
  );
}

/** `auto` has no fixed answer until we can ask the browser. */
function effectiveMode(mode: ModeId): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Attach the preview channel to the element carrying `data-tt-theme`.
 *
 * @param rootRef ref to the themed wrapper — the same element ThemeStyle's selector matches.
 */
export function useThemePreview(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Rule 1: nothing at all unless the admin explicitly asked for a preview.
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    if (params.get('preview') !== '1') return;

    const origins = allowedOrigins();
    let disposed = false;
    /** Messages that arrive before the engine chunk resolves. Only the newest matters. */
    let pending: unknown = null;
    let apply: ((raw: unknown) => void) | null = null;
    /**
     * The last config we painted, kept so a `prefers-color-scheme` change can repaint it.
     * The inline custom properties written below outrank ThemeStyle's `@media` block by
     * specificity, so under `mode: 'auto'` the stylesheet can no longer follow the OS on its
     * own — this listener is what keeps 'auto' actually automatic inside the preview.
     */
    let lastRaw: unknown = null;
    let schemeQuery: MediaQueryList | null = null;
    let onSchemeChange: (() => void) | null = null;

    const onMessage = (event: MessageEvent) => {
      if (!origins.includes(event.origin)) return; // Security gate — before touching data.
      if (!isPreviewMessage(event.data)) return;
      const config = event.data.config;
      if (apply) apply(config);
      else pending = config;
    };

    window.addEventListener('message', onMessage);

    // The engine is only pulled in on the preview path, so the public bundle is unaffected.
    void import('./engine').then(({ normalizeThemeConfig, resolveTheme, tokensForMode }) => {
      if (disposed) return;

      apply = (raw: unknown) => {
        lastRaw = raw;
        const root = rootRef.current;
        if (!root) return;

        const config: ThemeConfig = normalizeThemeConfig(raw);
        const resolved = resolveTheme(config);
        const tokens: TokenMap = tokensForMode(resolved, effectiveMode(resolved.config.mode));

        // Rule 3: write custom properties, do not touch React state.
        for (const name of Object.keys(tokens)) {
          root.style.setProperty(name, tokens[name]);
        }
        root.setAttribute('data-tt-theme', resolved.config.preset);
        root.setAttribute('data-tt-mode', resolved.config.mode);
      };

      if (typeof window.matchMedia === 'function') {
        schemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        onSchemeChange = () => {
          // Only 'auto' depends on the OS; the other two modes are already pinned.
          if (lastRaw !== null && normalizeThemeConfig(lastRaw).mode === 'auto') apply?.(lastRaw);
        };
        schemeQuery.addEventListener('change', onSchemeChange);
      }

      if (pending !== null) {
        apply(pending);
        pending = null;
      }
    });

    // Handshake: tell whoever opened us that the channel is live. Sent to every allowed
    // origin rather than '*' so the message body never leaks to an unexpected embedder.
    const ready = { type: READY_MESSAGE } as const;
    const sendReady = () => {
      for (const target of [window.opener, window.parent]) {
        if (!target || target === window) continue;
        for (const origin of origins) {
          try {
            (target as Window).postMessage(ready, origin);
          } catch {
            /* cross-origin frame that refuses the post — nothing to do. */
          }
        }
      }
    };
    sendReady();
    // A bfcache restore (back/forward, or an iframe the parent re-shows) does not re-run this
    // effect, so re-announce — otherwise the parent keeps waiting for a handshake that already
    // happened in a previous page lifecycle.
    window.addEventListener('pageshow', sendReady);

    return () => {
      disposed = true;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pageshow', sendReady);
      if (schemeQuery && onSchemeChange) schemeQuery.removeEventListener('change', onSchemeChange);
    };
  }, [rootRef]);
}

export default useThemePreview;
