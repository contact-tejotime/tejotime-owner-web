"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/Icon";
import { t } from "@/i18n";
import { Z_INDEX } from "@/lib/consent";
import { useConsent } from "./ConsentProvider";
import "./consent.css";

/**
 * The consent banner. Rendered by ConsentProvider only after the cookie read has resolved and
 * only when no current-version choice exists, so it never appears in server HTML and never
 * flashes for a returning visitor.
 *
 * Entrance is a class flip one frame after mount rather than an animation on mount, because the
 * element must exist (and be measured, see the body-padding note below) before it is revealed.
 */

/** A microsite URL is /{digits} — the store's full phone number — optionally /card under it. */
const MICROSITE_PATH = /^\/\d{7,15}(\/|$)/;

/**
 * How long to hold the banner back on a store's booking page.
 *
 * Someone who just scanned a QR code on a salon door is there to join the queue, and the first
 * thing they should see is the wait time and the check-in button, not a consent dialog. Same
 * component and same consent state either way — only the entrance is deferred.
 */
const MICROSITE_DELAY_MS = 1500;

export function CookieBanner() {
  const { acceptAll, rejectAll, openPreferences } = useConsent();
  const pathname = usePathname();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isMicrosite = !!pathname && MICROSITE_PATH.test(pathname);

  useEffect(() => {
    const delay = isMicrosite ? MICROSITE_DELAY_MS : 0;
    // rAF on the immediate path so the browser paints the hidden state first and the transition
    // actually runs; a plain setState in the same tick would jump straight to the end state.
    const id = window.setTimeout(() => requestAnimationFrame(() => setShown(true)), delay);
    return () => window.clearTimeout(id);
  }, [isMicrosite]);

  /**
   * Reserve space at the bottom of the document for as long as the banner is up.
   *
   * On a phone the banner is a full-width bar pinned to the floor, which is exactly where the
   * hero's "Start Free" button sits. Padding the body pushes the page's own bottom edge clear of
   * it. This adds scroll height below the fold rather than moving anything already on screen, so
   * it costs no layout shift — the banner itself only ever animates opacity and transform, both
   * of which are composited.
   *
   * The measured height is also published as `--tt-consent-h` so the chat launcher can step over
   * the banner on the narrow viewports where the two would otherwise share the same corner. From
   * 1024px up they cannot collide at all, because the banner's positioning box stops 88px short
   * of the right edge (consent.css), so chat.css only applies the offset below that width.
   *
   * useLayoutEffect so the measurement and the padding land in the same frame as the paint.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = document.body.style.paddingBottom;
    const apply = () => {
      const h = el.offsetHeight + 16;
      document.body.style.paddingBottom = `${h}px`;
      document.documentElement.style.setProperty("--tt-consent-h", `${h}px`);
    };
    apply();
    // The bar reflows when the viewport changes (buttons stack below 768px).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      document.body.style.paddingBottom = previous;
      document.documentElement.style.removeProperty("--tt-consent-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`ttConsentBanner${shown ? " isIn" : ""}`}
      style={{ zIndex: Z_INDEX.banner }}
      role="region"
      aria-label={t.consent.banner.label}
    >
      <div className="ttConsentBannerInner">
        <div className="ttConsentHead">
          <span className="ttConsentIcon" aria-hidden="true">
            <Icon name="cookie" size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                font: "var(--fw-semibold) 15px/1.3 var(--font-sans)",
                letterSpacing: "var(--ls-snug)",
                color: "var(--brand-ink)",
                margin: "0 0 2px",
              }}
            >
              {t.consent.banner.title}
            </p>
            {/* The policy link rides at the END of the sentence rather than sitting on its own
                line, so the copy stays two lines in the column a 720px card leaves. */}
            <p
              style={{
                font: "var(--fw-regular) 13px/1.5 var(--font-sans)",
                color: "var(--text-body)",
                margin: 0,
                textWrap: "pretty",
              }}
            >
              {t.consent.banner.body}{" "}
              <Link href="/cookies" className="ttConsentLink">
                {t.consent.banner.policyLink}
              </Link>
            </p>
          </div>
        </div>

        {/* Accept and Reject are identical in height, size and weight — see consent.css. */}
        <div className="ttConsentActions">
          <button type="button" className="ttConsentBtn ttConsentBtnPrimary" onClick={acceptAll}>
            {t.consent.banner.acceptAll}
          </button>
          <button type="button" className="ttConsentBtn ttConsentBtnOutline" onClick={rejectAll}>
            {t.consent.banner.rejectAll}
          </button>
          <button type="button" className="ttConsentBtn ttConsentBtnGhost" onClick={openPreferences}>
            {t.consent.banner.customize}
          </button>
        </div>
      </div>
    </div>
  );
}
