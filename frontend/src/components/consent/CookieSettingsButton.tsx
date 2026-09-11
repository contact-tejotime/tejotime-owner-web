"use client";

import { t } from "@/i18n";
import { useConsent } from "./ConsentProvider";
import "./consent.css";

/**
 * "Cookie Settings" for the footers and the microsite's bottom links.
 *
 * Withdrawing consent has to be as easy as giving it, so this needs to be reachable from every
 * page rather than only from the banner that appears once. It is a real <button> — it opens a
 * dialog, it does not navigate — styled to sit inline among the anchor links around it, so the
 * caller passes whatever className and style that particular footer uses for its links.
 */
export function CookieSettingsButton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const { openPreferences } = useConsent();
  return (
    <button
      type="button"
      onClick={openPreferences}
      className={`ttConsentSettingsBtn ${className}`.trim()}
      style={style}
    >
      {t.consent.settingsButton}
    </button>
  );
}
