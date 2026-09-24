"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThemeConfig } from "@/theme/engine";
import { frontendUrl } from "@/lib/frontend-url";
import { t } from "./appearanceCopy";
import { Icon } from "@/components/Icon";

/**
 * "Live preview" — the app's MicrositePreview (title + Reload, the real customer site in a frame,
 * a status line under it), plus owner-web's device switch: a browser can show the site at desktop
 * and tablet widths too, scaled to fit, where the app's WebView can only be a phone.
 *
 * It is an iframe pointing at the customer site — not a re-implementation — because a hand-built
 * preview drifts the moment anyone touches a component over in frontend/, and the owner would be
 * confidently wrong. Theme changes travel as `postMessage`, so the page is loaded once and
 * re-themed in place (the engine emits all three mode blocks, so switching light/dark is one
 * attribute write on the other side).
 *
 * Protocol:
 *   frontend → owner-web : { type: 'tt-theme-ready' }              once the listener is mounted
 *   owner-web → frontend : { type: 'tt-theme-preview', config } on every (debounced) change
 *
 * `targetOrigin` is pinned to the frontend origin, never '*': the config is not secret, but a
 * wildcard would broadcast it to whatever ends up in that frame after a redirect.
 */

/**
 * Live preview must hit a frontend build that speaks the same preview protocol (and theme
 * engine). Set `NEXT_PUBLIC_FRONTEND_URL` per env; local `next dev` falls back to localhost:3000.
 * Production builds with no env do not iframe a hardcoded host.
 */
const FRONTEND_URL = frontendUrl();

/** Pinned postMessage target. Empty string only if the env var is missing/malformed — then we do not post. */
const FRONTEND_ORIGIN = (() => {
  if (!FRONTEND_URL) return "";
  try {
    return new URL(FRONTEND_URL).origin;
  } catch {
    return "";
  }
})();

const DEVICES = {
  desktop: { w: 1280, h: 820 },
  tablet: { w: 834, h: 1112 },
  mobile: { w: 390, h: 844 },
} as const;

type DeviceId = keyof typeof DEVICES;
const DEVICE_IDS = ["desktop", "tablet", "mobile"] as const;

/** How long to wait for the handshake before saying the preview is not live. */
const HANDSHAKE_TIMEOUT_MS = 9000;
/** Colour pickers fire continuously while dragging; one post per frame is plenty. */
const POST_DEBOUNCE_MS = 60;
/**
 * Below this frame width the desktop site scaled to fit is unreadable (a phone's column shrinks it
 * to a quarter), so the preview opens on the phone layout — which is what the app shows.
 */
const PHONE_FRAME_MAX = 520;

interface Props {
  config: ThemeConfig;
  /** Digits-only country code + national number. */
  phoneFull: string;
}

export default function MicrositePreview({ config, phoneFull }: Props) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stalled, setStalled] = useState(false);
  /** Bumped by Reload — remounts the iframe and resets the handshake. */
  const [reloadKey, setReloadKey] = useState(0);
  const [frameW, setFrameW] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  /** Once the owner picks a device, the width-based default never overrides it again. */
  const pickedRef = useRef(false);

  // A half-typed or missing phone 404s — fall back to the demo store so the preview is never a
  // blank error page.
  const isRealStore = /^\d{7,15}$/.test(phoneFull);
  const src = useMemo(
    () => (FRONTEND_URL ? `${FRONTEND_URL}/${isRealStore ? phoneFull : "demo-store"}?preview=1` : ""),
    [isRealStore, phoneFull],
  );

  /* ---- Handshake ------------------------------------------------------ */
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!FRONTEND_ORIGIN || e.origin !== FRONTEND_ORIGIN) return;
      const data = e.data as { type?: unknown } | null;
      if (data && typeof data === "object" && data.type === "tt-theme-ready") {
        setReady(true);
        setStalled(false);
        setFailed(false);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The frame may be up but running a build that predates the preview listener. Say so rather
  // than leaving the owner to wonder why nothing moves.
  useEffect(() => {
    if (ready || failed) return;
    const id = window.setTimeout(() => setStalled(true), HANDSHAKE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [ready, failed, reloadKey]);

  /* ---- Push the config ------------------------------------------------ */
  const post = useCallback(() => {
    if (!ready || !FRONTEND_ORIGIN) return;
    iframeRef.current?.contentWindow?.postMessage({ type: "tt-theme-preview", config }, FRONTEND_ORIGIN);
  }, [ready, config]);

  // Serialised so a parent re-render that rebuilds an identical config object is a no-op.
  const configKey = JSON.stringify(config);
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(post, POST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
    // `post` is recreated whenever `config` changes; configKey keeps identical objects quiet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, configKey]);

  /* ---- Scale to fit --------------------------------------------------- */
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setFrameW(w);
      // Decided from the measured frame, not the viewport, and only after mount: the server
      // render cannot know the width, and guessing there would mismatch on hydration.
      if (!pickedRef.current && w > 0) setDevice(w < PHONE_FRAME_MAX ? "mobile" : "desktop");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dev = DEVICES[device];
  const scale = frameW > 0 ? Math.min(1, frameW / dev.w) : 0;
  // Until the first measurement lands, reserve the app's 420px so the column does not jump;
  // after that the frame is exactly as tall as the scaled device.
  const shellH = scale > 0 ? Math.round(dev.h * scale) : 420;

  function reload() {
    setReady(false);
    setFailed(false);
    setStalled(false);
    setReloadKey((k) => k + 1);
  }

  function pick(id: DeviceId) {
    pickedRef.current = true;
    setDevice(id);
  }

  return (
    <div className="sb-ap-preview">
      <div className="sb-ap-preview-head">
        <h2 className="sb-ap-preview-title">{t.appearance.previewTitle}</h2>
        <button type="button" className="sb-ap-textbtn" onClick={reload} disabled={!FRONTEND_URL}>
          {t.appearance.previewReload}
        </button>
      </div>

      <div className="sb-ap-chips" role="radiogroup" aria-label={t.appearance.device}>
        {DEVICE_IDS.map((id, i) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={device === id}
            tabIndex={device === id ? 0 : -1}
            className={`sb-ap-chip${device === id ? " is-selected" : ""}`}
            onClick={() => pick(id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              e.preventDefault();
              const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
              const next = DEVICE_IDS[(i + delta + DEVICE_IDS.length) % DEVICE_IDS.length];
              pick(next);
              (e.currentTarget.parentElement?.children[DEVICE_IDS.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
          >
            {t.appearance.devices[id]}
          </button>
        ))}
      </div>

      {!isRealStore ? <p className="sb-ap-caption">{t.appearance.previewDemo}</p> : null}

      <div className="sb-ap-frame" ref={shellRef} style={{ height: shellH }}>
        {!FRONTEND_URL || failed ? (
          <div className="sb-ap-fallback">
            <Icon name="alertTriangle" size={20} />
            <p>{t.appearance.previewUnavailable}</p>
            {src ? <code>{src}</code> : null}
            {FRONTEND_URL ? (
              <button type="button" className="sb-ap-textbtn" onClick={reload}>
                {t.appearance.previewReload}
              </button>
            ) : null}
          </div>
        ) : (
          <iframe
            key={`${src}#${reloadKey}`}
            ref={iframeRef}
            src={src}
            title={t.appearance.previewTitle}
            loading="lazy"
            // Same-origin is required for nothing here — the child talks back over postMessage —
            // but scripts must run for the theme listener to exist.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{
              width: dev.w,
              height: dev.h,
              transform: `scale(${scale || 0.0001})`,
              transformOrigin: "top left",
            }}
            onLoad={() => {
              // A reload wipes the child's listener; if it had already handshaken we re-post
              // immediately, and the fresh `tt-theme-ready` (if any) will post again.
              if (ready) post();
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      <p className="sb-ap-caption">
        {ready ? t.appearance.previewHint : stalled ? t.appearance.previewNotResponding : t.appearance.previewLoading}
      </p>
    </div>
  );
}
