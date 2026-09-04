"use client";

import { SUPPORT } from "@/lib/support";
import { t } from "@/i18n";

type Variant = "sidebar" | "settings" | "login" | "mobile" | "main";

/**
 * Shared TejoTime support contact (mailto + tel).
 * Mounted from shell chrome, Settings, and login so salons can always reach us.
 */
export function SupportContact({ variant = "sidebar" }: { variant?: Variant }) {
  if (variant === "main") {
    return (
      <div className="support-contact support-contact--main">
        <span className="support-contact-title">{t.support.needHelp}</span>
        <a className="support-contact-link" href={`mailto:${SUPPORT.email}`}>
          {SUPPORT.email}
        </a>
        <span className="support-contact-sep" aria-hidden>
          ·
        </span>
        <a className="support-contact-link" href={`tel:${SUPPORT.phoneTel}`}>
          {SUPPORT.phoneDisplay}
        </a>
      </div>
    );
  }

  return (
    <div className={`support-contact support-contact--${variant}`}>
      <p className="support-contact-title">{t.support.needHelp}</p>
      <p className="support-contact-blurb">{t.support.contactUs}</p>
      <div className="support-contact-links">
        <a className="support-contact-link" href={`mailto:${SUPPORT.email}`}>
          {SUPPORT.email}
        </a>
        <a className="support-contact-link" href={`tel:${SUPPORT.phoneTel}`}>
          {SUPPORT.phoneDisplay}
        </a>
      </div>
      <address className="support-contact-address">
        {SUPPORT.addressLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </address>
    </div>
  );
}

/** Compact strip for mobile bottom chrome. */
export function SupportStrip() {
  return (
    <div className="support-strip" role="contentinfo">
      <span className="support-strip-label">{t.support.needHelp}</span>
      <a href={`mailto:${SUPPORT.email}`}>{t.support.email}</a>
      <span className="support-strip-sep" aria-hidden>
        ·
      </span>
      <a href={`tel:${SUPPORT.phoneTel}`}>{t.support.call}</a>
    </div>
  );
}
