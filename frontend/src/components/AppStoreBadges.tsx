import type { CSSProperties } from "react";

import { t } from "@/i18n";

/**
 * App Store + Google Play badges for the owner app.
 *
 * Hand-mirrored between `frontend/src/components/AppStoreBadges.tsx` and
 * `owner-web/src/components/AppStoreBadges.tsx` (each app builds from its own folder, CLAUDE.md §1).
 * Change both together.
 *
 * The App Store link is region-less on purpose: `apps.apple.com/in/...` opens the Indian
 * storefront for everyone, which for a US visitor is the wrong store. Without the country segment
 * Apple sends each visitor to their own. The Play link drops the `pcampaignid=web_share` that a
 * share-sheet copy adds — it tags every footer click as a "share".
 */
export const APP_STORE_URL = "https://apps.apple.com/app/tejotime/id6810681166";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.tejotime.tejotimemobile";

function AppleMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="14" fill="url(#tt-badge-appstore)" />
      <path d="M18.4468 8.65403C18.7494 8.12586 18.5685 7.45126 18.0428 7.14727C17.5171 6.84328 16.8456 7.02502 16.543 7.55318L16.0153 8.47442L15.4875 7.55318C15.1849 7.02502 14.5134 6.84328 13.9877 7.14727C13.462 7.45126 13.2811 8.12586 13.5837 8.65403L14.748 10.6864L11.0652 17.1149H8.09831C7.49173 17.1149 7 17.6089 7 18.2183C7 18.8277 7.49173 19.3217 8.09831 19.3217H18.4324C18.523 19.0825 18.6184 18.6721 18.5169 18.2949C18.3644 17.7279 17.8 17.1149 16.8542 17.1149H13.5997L18.4468 8.65403Z" fill="white" />
      <path d="M11.6364 20.5419C11.449 20.3328 11.0292 19.9987 10.661 19.8888C10.0997 19.7211 9.67413 19.8263 9.45942 19.9179L8.64132 21.346C8.33874 21.8741 8.51963 22.5487 9.04535 22.8527C9.57107 23.1567 10.2425 22.975 10.5451 22.4468L11.6364 20.5419Z" fill="white" />
      <path d="M22.2295 19.3217H23.9017C24.5083 19.3217 25 18.8277 25 18.2183C25 17.6089 24.5083 17.1149 23.9017 17.1149H20.9653L17.6575 11.3411C17.4118 11.5757 16.9407 12.175 16.8695 12.8545C16.778 13.728 16.9152 14.4636 17.3271 15.1839C18.7118 17.6056 20.0987 20.0262 21.4854 22.4468C21.788 22.975 22.4594 23.1567 22.9852 22.8527C23.5109 22.5487 23.6918 21.8741 23.3892 21.346L22.2295 19.3217Z" fill="white" />
      <defs>
        <linearGradient id="tt-badge-appstore" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2AC9FA" />
          <stop offset="1" stopColor="#1F65EB" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function PlayMark() {
  return (
    <svg width="24" height="26" viewBox="6 2 26 28" fill="none" aria-hidden focusable="false">
      <mask id="tt-badge-play-mask" style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="7" y="3" width="24" height="26">
        <path d="M30.0484 14.4004C31.3172 15.0986 31.3172 16.9014 30.0484 17.5996L9.75627 28.7659C8.52052 29.4459 7 28.5634 7 27.1663L7 4.83374C7 3.43657 8.52052 2.55415 9.75627 3.23415L30.0484 14.4004Z" fill="#C4C4C4" />
      </mask>
      <g mask="url(#tt-badge-play-mask)">
        <path d="M7.63473 28.5466L20.2923 15.8179L7.84319 3.29883C7.34653 3.61721 7 4.1669 7 4.8339V27.1664C7 27.7355 7.25223 28.2191 7.63473 28.5466Z" fill="url(#tt-badge-play-0)" />
        <path d="M30.048 14.4003C31.3169 15.0985 31.3169 16.9012 30.048 17.5994L24.9287 20.4165L20.292 15.8175L24.6923 11.4531L30.048 14.4003Z" fill="url(#tt-badge-play-1)" />
        <path d="M24.9292 20.4168L20.2924 15.8179L7.63477 28.5466C8.19139 29.0232 9.02389 29.1691 9.75635 28.766L24.9292 20.4168Z" fill="url(#tt-badge-play-2)" />
        <path d="M7.84277 3.29865L20.2919 15.8177L24.6922 11.4533L9.75583 3.23415C9.11003 2.87878 8.38646 2.95013 7.84277 3.29865Z" fill="url(#tt-badge-play-3)" />
      </g>
      <defs>
        <linearGradient id="tt-badge-play-0" x1="15.6769" y1="10.874" x2="7.07106" y2="19.5506" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00C3FF" />
          <stop offset="1" stopColor="#1BE2FA" />
        </linearGradient>
        <linearGradient id="tt-badge-play-1" x1="20.292" y1="15.8176" x2="31.7381" y2="15.8176" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFCE00" />
          <stop offset="1" stopColor="#FFEA00" />
        </linearGradient>
        <linearGradient id="tt-badge-play-2" x1="7.36932" y1="30.1004" x2="22.595" y2="17.8937" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DE2453" />
          <stop offset="1" stopColor="#FE3944" />
        </linearGradient>
        <linearGradient id="tt-badge-play-3" x1="8.10725" y1="1.90137" x2="22.5971" y2="13.7365" gradientUnits="userSpaceOnUse">
          <stop stopColor="#11D574" />
          <stop offset="1" stopColor="#01F176" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const badge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  minHeight: 46,
  padding: "7px 16px 7px 12px",
  borderRadius: 12,
  background: "#0b0b0f",
  color: "#fff",
  textDecoration: "none",
  border: "1px solid rgba(255,255,255,.14)",
  lineHeight: 1.1,
};
const pre: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 500, letterSpacing: ".02em", opacity: 0.82 };
const name: CSSProperties = { display: "block", fontSize: 16, fontWeight: 700, letterSpacing: "-.01em", marginTop: 2 };

/** `heading` shows the "Get the TejoTime app" label above the pair. */
export function AppStoreBadges({ heading = true, className }: { heading?: boolean; className?: string }) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {heading ? (
        <span style={{ font: "600 12.5px/1.3 var(--font-sans, inherit)", color: "var(--text-muted)" }}>
          {t.appBadges.heading}
        </span>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <a className="tt-store-badge" style={badge} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label={t.appBadges.appStoreLabel}>
          <AppleMark />
          <span>
            <span style={pre}>{t.appBadges.appStorePre}</span>
            <span style={name}>{t.appBadges.appStore}</span>
          </span>
        </a>
        <a className="tt-store-badge" style={badge} href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label={t.appBadges.playLabel}>
          <PlayMark />
          <span>
            <span style={pre}>{t.appBadges.playPre}</span>
            <span style={name}>{t.appBadges.play}</span>
          </span>
        </a>
      </div>
    </div>
  );
}
