"use client";

import { SUPPORT } from "@/lib/support";

type Variant = "sidebar" | "settings" | "login" | "mobile" | "main";

/**
 * Shared TejoTime support contact (mailto + tel).
 * Mounted from shell chrome, Settings, and login so salons can always reach us.
 */
export function SupportContact({ variant = "sidebar" }: { variant?: Variant }) {
  if (variant === "main") {
    return (
      <div className="support-contact support-contact--main">
        <span className="support-contact-title">Need help?</span>
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
      <p className="support-contact-title">Need help?</p>
      <p className="support-contact-blurb">Contact TejoTime support</p>
      <div className="support-contact-links">
        <a className="support-contact-link" href={`mailto:${SUPPORT.email}`}>
          {SUPPORT.email}
        </a>
        <a className="support-contact-link" href={`tel:${SUPPORT.phoneTel}`}>
          {SUPPORT.phoneDisplay}
        </a>
      </div>
    </div>
  );
}

/** Compact strip for mobile bottom chrome. */
export function SupportStrip() {
  return (
    <div className="support-strip" role="contentinfo">
      <span className="support-strip-label">Need help?</span>
      <a href={`mailto:${SUPPORT.email}`}>Email</a>
      <span className="support-strip-sep" aria-hidden>
        ·
      </span>
      <a href={`tel:${SUPPORT.phoneTel}`}>Call</a>
    </div>
  );
}
