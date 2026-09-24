"use client";

import { useState } from "react";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * The store's mark in Home's header — the web twin of the app's `components/ui/StoreMark.tsx`.
 *
 * The uploaded logo on the card surface with a hairline border; without one, or if it fails to
 * load, the initials on a SOLID brand tile in the brand's ink. It used to be a pale brand tint
 * behind brand-tinted initials, which all but disappeared on a warm page (a red brand on a beige
 * preset).
 */
export function StoreMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <span className="store-mark store-mark-logo" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- a /media/* redirect to a signed bucket URL */}
        <img src={logoUrl} alt="" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="store-mark" aria-hidden>
      {initials(name)}
    </span>
  );
}
