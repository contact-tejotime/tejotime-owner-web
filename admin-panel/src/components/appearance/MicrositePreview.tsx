"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThemeConfig } from "@/theme/engine";
import { t } from "@/i18n";
import { Icon } from "@/components/icons";

/**
 * Live preview of the REAL microsite.
 *
 * It is an iframe pointing at the customer site — not a re-implementation — because a
 * hand-built preview drifts the moment anyone touches a component over in frontend/, and the
 * admin would be confidently wrong. Theme changes travel as `postMessage`, so the page is
 * loaded once and re-themed in place (the engine emits all three mode blocks, so switching
 * light/dark is one attribute write on the other side).
 *
 * Protocol:
 *   frontend → admin : { type: 'tt-theme-ready' }              once the listener is mounted
 *   admin    → frontend : { type: 'tt-theme-preview', config } on every (debounced) change
 *
 * `targetOrigin` is pinned to the frontend origin, never '*': the config is not secret, but a
 * wildcard would broadcast it to whatever ends up in that frame after a redirect.
 */

const FRONTEND_URL = (process.env.NEXT_PUBLIC_FRONTEND_URL ?? "https://www.tejotime.com").replace(/\/+$/, "");

/** Pinned postMessage target. Empty string only if the env var is malformed — then we do not post. */
const FRONTEND_ORIGIN = (() => {
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

/** How long to wait for the handshake before telling the admin the preview is not live. */
const HANDSHAKE_TIMEOUT_MS = 9000;
/** Colour pickers fire continuously while dragging; one post per frame is plenty. */
const POST_DEBOUNCE_MS = 60;

interface Props {
  config: ThemeConfig;
  /** Digits-only country code + national number. Blank/short in create mode. */
  phoneFull: string;
}

export default function MicrositePreview({ config, phoneFull }: Props) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stalled, setStalled] = useState(false);
  /** Bumped by the reload button — remounts the iframe and resets the handshake. */
  const [reloadKey, setReloadKey] = useState(0);
  const [frameW, setFrameW] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  // A store being created has no phone yet, and a half-typed one 404s — fall back to the demo
  // store so the preview is never a blank error page.
  const isRealStore = /^\d{7,15}$/.test(phoneFull);
  const src = useMemo(
    () => `${FRONTEND_URL}/${isRealStore ? phoneFull : "demo-store"}?preview=1`,
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
  // than leaving the admin to wonder why nothing moves.
  useEffect(() => {
    if (ready || failed) return;
    const id = window.setTimeout(() => setStalled(true), HANDSHAKE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [ready, failed, reloadKey]);

  /* ---- Push the config ------------------------------------------------ */
  const post = useCallback(() => {
    if (!ready || !FRONTEND_ORIGIN) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "tt-theme-preview", config },
      FRONTEND_ORIGIN,
    );
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
    const measure = () => setFrameW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dev = DEVICES[device];
  const scale = frameW > 0 ? Math.min(1, frameW / dev.w) : 0;
  // Until the first measurement lands, reserve the mobile height so the sticky column does not
  // jump; after that the frame is exactly as tall as the scaled device.
  const shellH = scale > 0 ? Math.round(dev.h * scale) : 520;

  function reload() {
    setReady(false);
    setFailed(false);
    setStalled(false);
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="ap-preview">
      <div className="ap-preview-head">
        <span className="ap-group-legend">{t.appearance.previewTitle}</span>
        <div className="ap-preview-actions">
          <a className="ap-mini-btn" href={src} target="_blank" rel="noreferrer">
            <Icon name="externalLink" size={13} />
            {t.appearance.previewOpen}
          </a>
          <button type="button" className="ap-mini-btn" onClick={reload}>
            {t.appearance.previewReload}
          </button>
        </div>
      </div>

      <div className="ap-devices" role="radiogroup" aria-label={t.appearance.device}>
        {DEVICE_IDS.map((id, i) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={device === id}
            tabIndex={device === id ? 0 : -1}
            className={`ap-device${device === id ? " is-selected" : ""}`}
            onClick={() => setDevice(id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              e.preventDefault();
              const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
              const next = DEVICE_IDS[(i + delta + DEVICE_IDS.length) % DEVICE_IDS.length];
              setDevice(next);
              (e.currentTarget.parentElement?.children[DEVICE_IDS.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
          >
            {t.appearance.devices[id]}
            <span className="ap-device-w">{DEVICES[id].w}</span>
          </button>
        ))}
      </div>

      {!isRealStore && <p className="ap-note">{t.appearance.previewDemo}</p>}

      <div className="ap-preview-shell" ref={shellRef} style={{ height: shellH }}>
        {failed ? (
          <div className="ap-preview-fallback">
            <Icon name="alertTriangle" size={20} />
            <p>{t.appearance.previewUnavailable}</p>
            <code>{src}</code>
            <button type="button" className="ap-mini-btn" onClick={reload}>
              {t.appearance.previewReload}
            </button>
          </div>
        ) : (
          <iframe
            key={`${src}#${reloadKey}`}
            ref={iframeRef}
            src={src}
            title={t.appearance.previewTitle}
            className="ap-preview-frame"
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

      <p className="ap-note">
        {ready ? t.appearance.previewHint : stalled ? t.appearance.previewNotResponding : t.appearance.previewLoading}
      </p>
    </div>
  );
}
