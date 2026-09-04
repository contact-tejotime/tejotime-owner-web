"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Logo } from "@/components/landing/Logo";
import { Button } from "@/components/landing/ui";
import { footerCols, nav } from "@/components/landing/landingData";
import { shell } from "@/components/landing/shell";
import { t } from "@/i18n";
import { OWNER_ORIGIN } from "@/lib/config";

const eyebrowStyle: CSSProperties = {
  font: "var(--fw-bold) 11px/1 var(--font-sans)",
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

/**
 * Shared chrome for marketing subpages (industry landings, resources).
 * Start Free / Book a Demo return to the homepage inquiry flow via `?join=1`.
 */
export function MarketingChrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="tj-page"
      style={{
        minHeight: "100vh",
        background: "var(--surface-page)",
        color: "var(--text-body)",
        containerType: "inline-size",
        containerName: "page",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "rgba(255,255,255,.92)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          data-t2="hdrow"
          style={{
            ...shell(),
            height: 72,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <Link href="/" aria-label={t.brand.logoAlt} style={{ display: "flex", flexShrink: 0 }}>
            <Logo height={30} />
          </Link>
          <nav
            data-only="desk"
            style={{ display: "flex", alignItems: "center", gap: 22, marginLeft: 12 }}
            aria-label={t.landing.nav.menu}
          >
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="tj-navlink"
                style={{
                  font: "var(--fw-medium) 14.5px/1 var(--font-sans)",
                  color: "var(--text-body)",
                  whiteSpace: "nowrap",
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          <a data-only="desk" href={OWNER_ORIGIN} style={{ display: "flex" }}>
            <Button variant="ghost">{t.landing.nav.signIn}</Button>
          </a>
          <Link href="/?join=1" style={{ display: "flex", flexShrink: 0 }}>
            <Button variant="primary">{t.landing.cta.selfServe}</Button>
          </Link>
        </div>
      </header>

      {children}

      <footer
        className="tj-footer"
        style={{
          background: "var(--surface-card)",
          borderTop: "1px solid var(--border-subtle)",
          padding: "56px 0 40px",
        }}
      >
        <div data-t="pad" style={shell()}>
          <div
            data-t="foot"
            className="tj-foot-grid"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32 }}
          >
            {footerCols.map((fc) => (
              <div
                key={fc.head}
                className="tj-foot-col"
                style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}
              >
                <span className="tj-foot-head" style={eyebrowStyle}>
                  {fc.head}
                </span>
                {fc.links.map((fl) => (
                  <Link
                    key={fl.href + fl.label}
                    href={fl.href}
                    className="tj-footlink"
                    style={{
                      font: "var(--fw-medium) 14px/1.35 var(--font-sans)",
                      color: "var(--text-body)",
                    }}
                  >
                    {fl.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <div
            className="tj-foot-bottom"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 20,
              flexWrap: "wrap",
              marginTop: 44,
              paddingTop: 24,
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <Link href="/" aria-label={t.brand.logoAlt} style={{ display: "flex" }}>
              <Logo height={28} />
            </Link>
            <span
              style={{
                font: "var(--fw-medium) 13px/1.4 var(--font-sans)",
                color: "var(--text-muted)",
              }}
            >
              {t.landing.footer.note}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
