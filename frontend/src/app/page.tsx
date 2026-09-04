"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/landing/Icon";
import { Logo } from "@/components/landing/Logo";
import { Button, Input } from "@/components/landing/ui";
import { AppointmentCard, Avatar, Badge, WaitTimeWidget } from "@/components/landing/ds";
import { ProductTour } from "@/components/landing/ProductTour";
import PhoneField from "@/components/ui/PhoneField";
import { t } from "@/i18n";
import { publicApi } from "@/lib/api";
import { OWNER_ORIGIN } from "@/lib/config";
import { combineToE164, DEFAULT_DIAL_CODE, DEFAULT_ISO2, isValidNational } from "@/lib/phone";
import {
  bookingBullets,
  calCols,
  calHours,
  client,
  clientBullets,
  faqs,
  features,
  footerCols,
  industries,
  inquiryPerks,
  nav,
  phoneDay,
  phoneNav,
  plans,
  scheduleRows,
  slots,
  steps,
  proofSignals,
  proofStats,
  waitBoard,
  walkBullets,
  WAIT_MINUTES,
} from "@/components/landing/landingData";

const MAX = 1240;
const PAD = "0 40px";

/**
 * Self-serve signup isn't live yet, so the page runs in "pilot" mode: the CTA
 * asks people to join the U.S. pilot rather than to start an account they
 * can't finish creating. Flip this when signup ships.
 */
const OFFER_MODE: "pilot" | "selfServe" = "pilot";
const isPilot = OFFER_MODE === "pilot";

const ctaPrimary = isPilot ? t.landing.cta.pilot : t.landing.cta.selfServe;
const heroMicro = isPilot ? t.landing.hero.microPilot : t.landing.hero.microSelfServe;

/* ------------------------------------------------------------ typography -- */

const h2Style: React.CSSProperties = {
  font: "var(--fw-extrabold) clamp(28px,3.4cqw,42px)/1.12 var(--font-sans)",
  letterSpacing: "-.03em",
  color: "var(--text-strong)",
  margin: 0,
};
const h2SplitStyle: React.CSSProperties = {
  ...h2Style,
  font: "var(--fw-extrabold) clamp(26px,3.2cqw,38px)/1.14 var(--font-sans)",
  margin: "18px 0 0",
  maxWidth: "22ch",
};
const leadStyle: React.CSSProperties = {
  font: "var(--fw-regular) 16.5px/1.65 var(--font-sans)",
  color: "var(--text-muted)",
  textWrap: "pretty",
};
const eyebrowStyle: React.CSSProperties = {
  font: "var(--fw-bold) 11px/1 var(--font-sans)",
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};
const bulletStyle: React.CSSProperties = {
  font: "var(--fw-medium) 15.5px/1.5 var(--font-sans)",
  color: "var(--text-body)",
};

/** Five solid stars for the social-proof strip (decorative). */
function shell(extra?: React.CSSProperties): React.CSSProperties {
  return { maxWidth: MAX, margin: "0 auto", padding: PAD, ...extra };
}

/** A checked bullet; the tick takes the colour of the section it belongs to. */
function Bullet({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
      <span style={{ color, flexShrink: 0, paddingTop: 2, display: "flex" }}>
        <Icon name="check" size={17} />
      </span>
      <span style={bulletStyle}>{children}</span>
    </span>
  );
}

/**
 * Industry / gallery photo tile. Pass `image` when photography is ready; without
 * it the soft gradient + big number still read as designed rather than broken.
 * Caption sits under the media (not overlaid) so 2-up mobile grids never clip type.
 * `delayMs` staggers the scroll-reveal so a row of cards cascades in.
 */
function PhotoWell({
  n,
  title,
  caption,
  numberSize,
  gradient,
  image,
  href,
  delayMs = 0,
}: {
  n: string;
  title: string;
  caption: string;
  numberSize: number;
  gradient: string;
  image?: string;
  href?: string;
  delayMs?: number;
}) {
  const style: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    border: "1px solid var(--border-subtle)",
    background: "var(--surface-card)",
    animationDelay: `${delayMs}ms`,
    transitionDelay: `${delayMs}ms`,
    height: "100%",
    textDecoration: "none",
    color: "inherit",
  };

  const body = (
    <>
      <span
        aria-hidden="true"
        className="tj-photo-media"
        style={{
          position: "relative",
          display: "block",
          aspectRatio: "5 / 4",
          background: gradient,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- static public assets for the marketing grid
          <img
            src={image}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <>
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: `var(--fw-extrabold) ${numberSize}px/1 var(--font-sans)`,
                letterSpacing: "-.06em",
                color: "var(--brand-ink)",
                opacity: 0.13,
              }}
            >
              {n}
            </span>
            <span
              style={{
                position: "absolute",
                left: 10,
                top: 10,
                font: "var(--fw-semibold) 9px/1 var(--font-sans)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--brand-ink)",
                background: "rgba(255,255,255,.82)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-pill)",
                padding: "5px 8px",
              }}
            >
              {t.landing.gallery.placeholder}
            </span>
          </>
        )}
      </span>
      <span
        className="tj-photo-caption"
        style={{
          padding: "12px 14px 14px",
          background: "var(--brand-ink)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
        }}
      >
        <span
          className="tj-photo-title"
          style={{
            font: "var(--fw-bold) 15px/1.25 var(--font-sans)",
            color: "var(--text-on-brand)",
            letterSpacing: "-.01em",
          }}
        >
          {title}
        </span>
        <span
          className="tj-photo-body"
          style={{
            font: "var(--fw-medium) 12px/1.4 var(--font-sans)",
            color: "var(--text-on-brand)",
            opacity: 0.82,
          }}
        >
          {caption}
        </span>
      </span>
    </>
  );

  if (href) {
    return (
      <Link data-reveal="1" href={href} className="tj-photo-well" style={style}>
        {body}
      </Link>
    );
  }

  return (
    <div data-reveal="1" className="tj-photo-well" style={style}>
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ page -- */

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [walkInAdded, setWalkInAdded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [showInquiry, setShowInquiry] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<{ dialCode: string; iso2: string }>({
    dialCode: DEFAULT_DIAL_CODE,
    iso2: DEFAULT_ISO2,
  });
  const [national, setNational] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Scroll-reveal for every [data-reveal] — works in all browsers (IO), not only
  // those with CSS scroll-driven animations.
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const openInquiry = () => {
    setSubmitted(false);
    setBusinessName("");
    setAddress("");
    setPhoneCountry({ dialCode: DEFAULT_DIAL_CODE, iso2: DEFAULT_ISO2 });
    setNational("");
    setFormError("");
    setMenuOpen(false);
    setShowInquiry(true);
  };
  const closeInquiry = () => setShowInquiry(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("join") !== "1") return;
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    const id = window.setTimeout(() => openInquiry(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const submitInquiry = async () => {
    if (submitting) return;
    if (!businessName.trim() || !address.trim() || !isValidNational(national, phoneCountry.iso2)) {
      setFormError(t.landing.inquiry.invalid);
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await publicApi.submitInquiry({
        businessName: businessName.trim(),
        address: address.trim(),
        phone: combineToE164(phoneCountry.dialCode, national),
      });
      setSubmitted(true);
    } catch (e) {
      setFormError((e as Error)?.message ?? t.landing.inquiry.failed);
    } finally {
      setSubmitting(false);
    }
  };

  // Lock scroll while the inquiry modal or mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = showInquiry || menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showInquiry, menuOpen]);

  // Close the mobile menu on Escape or when the layout returns to desktop.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      if (window.matchMedia("(min-width: 1081px)").matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  const addWalkIn = () => {
    setWalkInAdded(true);
    showToast(t.landing.walkins.addedToast);
  };

  const waitRows = waitBoard.slice(0, walkInAdded ? 4 : 3);
  const waitMinutes = walkInAdded ? WAIT_MINUTES.afterAdd : WAIT_MINUTES.base;

  return (
    <div
      id="top"
      data-t="page"
      style={{
        containerType: "inline-size",
        containerName: "page",
        background: "var(--surface-card)",
        fontFamily: "var(--font-sans)",
        color: "var(--text-body)",
        overflowX: "clip",
      }}
    >
      {/* ------------------------------------------------------- header -- */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 60,
          background: "var(--surface-card)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          data-t="pad"
          data-t2="hdrow"
          style={shell({ padding: PAD, height: 72, display: "flex", alignItems: "center", gap: 34 })}
        >
          <a
            href="#top"
            data-t2="logo"
            className="tj-logo-link"
            aria-label={t.brand.logoAlt}
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
          >
            <Logo height={34} />
          </a>
          <nav data-only="desk" style={{ display: "flex", alignItems: "center", gap: 26 }}>
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="tj-navlink"
                style={{
                  font: "var(--fw-medium) 14.5px/1 var(--font-sans)",
                  color: "var(--text-body)",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          <a data-only="desk" href={OWNER_ORIGIN} style={{ display: "flex" }}>
            <Button variant="ghost">{t.landing.nav.signIn}</Button>
          </a>
          <span data-t="hdr-cta" style={{ display: "flex", flexShrink: 1, minWidth: 0 }}>
            <Button variant="primary" onClick={openInquiry}>
              {ctaPrimary}
            </Button>
          </span>
          <button
            type="button"
            data-only="hamb"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="tj-mobile-menu"
            aria-label={t.landing.nav.menu}
            style={{
              display: "none",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-default)",
              background: "transparent",
              color: "var(--text-strong)",
              cursor: "pointer",
              font: "var(--fw-semibold) 16px/1 var(--font-sans)",
            }}
          >
            ≡
          </button>
        </div>
      </header>

      {menuOpen && (
        <div
          id="tj-mobile-menu"
          className="tj-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label={t.landing.nav.menu}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
          }}
        >
          <button
            type="button"
            className="tj-mobile-menu-backdrop"
            aria-label={t.common.close}
            onClick={() => setMenuOpen(false)}
            style={{
              position: "absolute",
              inset: 0,
              border: 0,
              padding: 0,
              cursor: "pointer",
              background: "rgba(15, 23, 42, 0.42)",
            }}
          />
          <div
            className="tj-mobile-menu-panel"
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              background: "var(--surface-card)",
              boxShadow: "var(--shadow-xl)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              textAlign: "left",
              borderRadius: "0 0 20px 20px",
            }}
          >
            <div
              style={{
                height: 64,
                padding: "0 20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderBottom: "1px solid var(--border-subtle)",
                flexShrink: 0,
              }}
            >
              <a
                href="#top"
                className="tj-logo-link"
                aria-label={t.brand.logoAlt}
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                style={{ display: "flex", flexShrink: 0, cursor: "pointer" }}
              >
                <Logo height={28} />
              </a>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t.common.close}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-default)",
                  background: "transparent",
                  color: "var(--text-strong)",
                  cursor: "pointer",
                }}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <nav
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "8px 12px 4px",
                alignItems: "stretch",
              }}
            >
              {nav.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    font: "var(--fw-semibold) 17px/1.2 var(--font-sans)",
                    color: "var(--text-strong)",
                    padding: "16px 12px",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {n.label}
                </a>
              ))}
            </nav>

            <div
              style={{
                padding: "12px 20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <a href={OWNER_ORIGIN} style={{ display: "flex", width: "100%" }}>
                <Button variant="outline" size="lg" fullWidth>
                  {t.landing.nav.signIn}
                </Button>
              </a>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => {
                  setMenuOpen(false);
                  openInquiry();
                }}
              >
                {ctaPrimary}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------- hero (on gradient) -- */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(180deg,var(--surface-card) 0%,var(--surface-card) 38%,var(--blue-800) 74%,var(--brand-ink) 100%)",
        }}
      >
        <div
          aria-hidden="true"
          className="tj-hero-orb"
          style={{
            position: "absolute",
            left: "-8%",
            right: "-8%",
            top: "30%",
            bottom: 0,
            pointerEvents: "none",
            filter: "blur(72px)",
            background:
              "radial-gradient(40% 46% at 13% 32%,rgba(37,99,235,.9),transparent 66%),radial-gradient(34% 40% at 89% 14%,rgba(20,184,166,.55),transparent 68%),radial-gradient(46% 42% at 74% 60%,rgba(37,99,235,.6),transparent 70%),radial-gradient(38% 36% at 30% 78%,rgba(20,184,166,.28),transparent 70%)",
            WebkitMaskImage: "linear-gradient(180deg,transparent 0%,black 22%,black 100%)",
            maskImage: "linear-gradient(180deg,transparent 0%,black 22%,black 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="tj-hero-orb-alt"
          style={{
            position: "absolute",
            width: 280,
            height: 280,
            right: "8%",
            top: "18%",
            borderRadius: "50%",
            pointerEvents: "none",
            background: "radial-gradient(circle,rgba(20,184,166,.22),transparent 70%)",
            filter: "blur(40px)",
          }}
        />

        <section data-t="sect" style={{ position: "relative", padding: "76px 0 0", textAlign: "center" }}>
          <div data-t="pad" style={shell({ position: "relative" })}>
            <span data-anim="hero" data-d="1" style={{ display: "inline-flex" }}>
              <Badge tone="primary">{t.landing.hero.eyebrow}</Badge>
            </span>
            <h1
              data-anim="hero"
              data-d="2"
              style={{
                font: "var(--fw-extrabold) clamp(38px,5cqw,66px)/1.06 var(--font-sans)",
                letterSpacing: "-.035em",
                color: "var(--text-strong)",
                margin: "22px auto 0",
                maxWidth: "18ch",
                textWrap: "balance",
              }}
            >
              {t.landing.hero.title}
            </h1>
            <p
              data-anim="hero"
              data-d="3"
              style={{
                font: "var(--fw-regular) 18px/1.6 var(--font-sans)",
                color: "var(--text-muted)",
                margin: "22px auto 0",
                maxWidth: "62ch",
                textWrap: "pretty",
              }}
            >
              {t.landing.hero.body}
            </p>
            <div
              data-anim="hero"
              data-d="4"
              data-t="hero-ctas"
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 32,
              }}
            >
              <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={openInquiry}>
                {ctaPrimary}
              </Button>
              <a href="#tour" style={{ display: "flex" }}>
                <Button variant="outline" size="lg">
                  {t.landing.cta.seeHow}
                </Button>
              </a>
            </div>
            <p
              data-anim="hero"
              data-d="5"
              style={{
                font: "var(--fw-medium) 13.5px/1.6 var(--font-sans)",
                color: "var(--text-muted)",
                margin: "18px auto 0",
              }}
            >
              {heroMicro}
            </p>

            {/* ------------------------------- day calendar + phone mock -- */}
            <div
              data-anim="hero"
              data-d="6"
              className="tj-hero-cal"
              style={{ position: "relative", margin: "40px auto 0", maxWidth: 980, width: "100%" }}
            >
              <div
                className="tj-hero-cal-scale"
                style={{
                  position: "relative",
                  width: "100%",
                  transform: "scale(0.88)",
                  transformOrigin: "top center",
                  marginBottom: "-8%",
                }}
              >
              <div data-t="calwrap" style={{ position: "relative", display: "flex", paddingRight: 158 }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "var(--surface-card)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-xl) var(--radius-xl) 0 0",
                    boxShadow: "var(--shadow-xl)",
                    overflow: "hidden",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 18px",
                      borderBottom: "1px solid var(--border-subtle)",
                      background: "var(--surface-page)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <span
                        style={{
                          font: "var(--fw-bold) 14.5px/1.2 var(--font-sans)",
                          color: "var(--text-strong)",
                        }}
                      >
                        {t.landing.calendar.shopName}
                      </span>
                      <span
                        style={{
                          font: "var(--fw-medium) 11.5px/1 var(--font-sans)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {t.landing.calendar.shopMeta}
                      </span>
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 11px",
                        borderRadius: "var(--radius-pill)",
                        background: "var(--success-soft)",
                        color: "var(--success-soft-fg)",
                      }}
                    >
                      <span style={{ position: "relative", width: 6, height: 6, flexShrink: 0 }}>
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background: "var(--success)",
                          }}
                        />
                        <span
                          data-anim="1"
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background: "var(--success)",
                            animation: "tjPulse 2.6s ease-out infinite",
                          }}
                        />
                      </span>
                      <span style={{ font: "var(--fw-semibold) 11.5px/1 var(--font-sans)" }}>
                        {t.landing.calendar.openNow}
                      </span>
                    </span>
                    <Badge tone="neutral" size="sm">
                      {t.landing.calendar.day}
                    </Badge>
                  </div>

                  <div data-t="cal-scroll-x" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <div data-t="cal-scroll" style={{ minWidth: 600, paddingBottom: 12 }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "58px repeat(4,1fr)",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        <span />
                        {calCols.map((p) => (
                          <span
                            key={p.name}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 6,
                              padding: "12px 6px",
                              borderLeft: "1px solid var(--border-subtle)",
                            }}
                          >
                            <Avatar name={p.name} size="sm" />
                            <span
                              style={{
                                font: "var(--fw-semibold) 12px/1 var(--font-sans)",
                                color: "var(--text-body)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {p.name}
                            </span>
                          </span>
                        ))}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "58px repeat(4,1fr)" }}>
                        <div style={{ position: "relative", height: 624 }}>
                          {calHours.map((h) => (
                            <span
                              key={h.label}
                              style={{
                                position: "absolute",
                                right: 8,
                                top: h.top,
                                transform: "translateY(-6px)",
                                font: "var(--fw-medium) 10.5px/1.15 var(--font-sans)",
                                color: "var(--text-muted)",
                                textAlign: "right",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {h.label}
                            </span>
                          ))}
                        </div>
                        {calCols.map((p) => (
                          <div
                            key={p.name}
                            style={{
                              position: "relative",
                              height: 624,
                              borderLeft: "1px solid var(--border-subtle)",
                              background:
                                "repeating-linear-gradient(180deg,var(--border-subtle) 0 1px,transparent 1px 104px)",
                            }}
                          >
                            {p.appts.map((a) => (
                              <span
                                key={`${a.client}-${a.top}`}
                                style={{
                                  position: "absolute",
                                  left: 4,
                                  right: 4,
                                  top: a.top,
                                  height: a.height,
                                  borderRadius: "var(--radius-sm)",
                                  background: a.bg,
                                  color: a.fg,
                                  padding: "7px 9px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                  overflow: "hidden",
                                  animation: `tjUp .6s var(--ease-standard) ${a.delay} both`,
                                }}
                              >
                                <span
                                  style={{
                                    font: "var(--fw-medium) 10.5px/1.1 var(--font-sans)",
                                    fontVariantNumeric: "tabular-nums",
                                  }}
                                >
                                  {a.time}
                                </span>
                                <span
                                  style={{
                                    font: "var(--fw-bold) 12.5px/1.2 var(--font-sans)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {a.client}
                                </span>
                                <span
                                  style={{
                                    font: "var(--fw-medium) 11px/1.15 var(--font-sans)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {a.service}
                                </span>
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  data-t="calphone"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 44,
                    width: 214,
                    background: "var(--surface-card)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 22,
                    boxShadow: "var(--shadow-xl)",
                    padding: 10,
                    textAlign: "left",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                      padding: "8px 0 12px",
                    }}
                  >
                    <Avatar name={phoneDay.name} size="md" />
                    <span
                      style={{
                        font: "var(--fw-semibold) 12.5px/1 var(--font-sans)",
                        color: "var(--text-strong)",
                      }}
                    >
                      {phoneDay.name}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 1fr",
                      borderTop: "1px solid var(--border-subtle)",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ position: "relative", height: 352 }}>
                      {phoneDay.hours.map((ph) => (
                        <span
                          key={ph.label}
                          style={{
                            position: "absolute",
                            right: 6,
                            top: ph.top,
                            transform: "translateY(-5px)",
                            font: "var(--fw-medium) 9.5px/1.15 var(--font-sans)",
                            color: "var(--text-muted)",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {ph.label}
                        </span>
                      ))}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        height: 352,
                        borderLeft: "1px solid var(--border-subtle)",
                        background:
                          "repeating-linear-gradient(180deg,var(--border-subtle) 0 1px,transparent 1px 64px)",
                        overflow: "hidden",
                      }}
                    >
                      {phoneDay.appts.map((pa) => (
                        <span
                          key={pa.client}
                          style={{
                            position: "absolute",
                            left: 4,
                            right: 4,
                            top: pa.top,
                            height: pa.height,
                            borderRadius: "var(--radius-sm)",
                            background: pa.bg,
                            color: pa.fg,
                            padding: "6px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              font: "var(--fw-medium) 10px/1.1 var(--font-sans)",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {pa.time}
                          </span>
                          <span
                            style={{
                              font: "var(--fw-bold) 11.5px/1.2 var(--font-sans)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {pa.client}
                          </span>
                          <span
                            style={{
                              font: "var(--fw-medium) 10.5px/1.15 var(--font-sans)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {pa.service}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                      padding: "12px 10px 6px",
                      borderTop: "1px solid var(--border-subtle)",
                      marginTop: 8,
                    }}
                  >
                    {phoneNav.map((pn, i) => (
                      <span
                        key={`${pn.icon}-${i}`}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: "var(--radius-pill)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: pn.bg,
                          color: pn.fg,
                        }}
                      >
                        <Icon name={pn.icon} size={15} />
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </section>

        <section data-t="sect" style={{ position: "relative", padding: "56px 0 88px", textAlign: "center" }}>
          <div data-t="pad" style={shell()}>
            <p
              data-reveal="1"
              style={{
                font: "var(--fw-semibold) 16.5px/1.6 var(--font-sans)",
                color: "var(--text-on-brand)",
                margin: "0 auto",
                maxWidth: "56ch",
              }}
            >
              {t.landing.socialProof.line}
            </p>

            <div
              data-t="proof-signals"
              data-reveal="1"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "28px 20px",
                marginTop: 44,
                alignItems: "start",
              }}
            >
              {proofSignals.map((s) => (
                <div
                  key={s.name}
                  className="tj-proof-signal"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      font: "var(--fw-semibold) 14px/1.2 var(--font-sans)",
                      color: "rgba(255,255,255,.92)",
                      letterSpacing: ".01em",
                    }}
                  >
                    {s.name}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        font: "var(--fw-bold) 15px/1 var(--font-sans)",
                        color: "var(--text-on-brand)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {s.score}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <div
              data-t="proof-stats"
              data-reveal="1"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "32px 24px",
                marginTop: 56,
                paddingTop: 40,
                borderTop: "1px solid rgba(255,255,255,.18)",
              }}
            >
              {proofStats.map((st) => (
                <div
                  key={st.label}
                  className="tj-proof-stat"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      font: "var(--fw-extrabold) clamp(32px,4.2cqw,48px)/1 var(--font-sans)",
                      letterSpacing: "-.03em",
                      color: "var(--text-on-brand)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {st.value}
                  </span>
                  <span
                    style={{
                      font: "var(--fw-medium) 14px/1.35 var(--font-sans)",
                      color: "rgba(255,255,255,.78)",
                      maxWidth: "16ch",
                    }}
                  >
                    {st.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* --------------------------------------------------- industries -- */}
      <section id="industries" data-t="sect" style={{ padding: "88px 0", background: "var(--surface-card)" }}>
        <div data-t="pad" style={shell({ textAlign: "center" })}>
          <h2 data-reveal="1" style={{ ...h2Style, margin: "0 auto", maxWidth: "24ch" }}>
            {t.landing.industriesSection.title}
          </h2>
          <p data-reveal="1" style={{ ...leadStyle, margin: "16px auto 0", maxWidth: "64ch" }}>
            {t.landing.industriesSection.body}
          </p>
          <div
            data-t="ind"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 16,
              marginTop: 40,
              textAlign: "left",
            }}
          >
            {industries.map((i, idx) => (
              <PhotoWell
                key={i.name}
                n={i.n}
                title={i.name}
                caption={i.detail}
                numberSize={108}
                gradient="linear-gradient(140deg,var(--blue-100) 0%,var(--blue-50) 46%,var(--teal-100) 100%)"
                image={i.image}
                href={i.href}
                delayMs={(idx % 3) * 70}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ features -- */}
      <section
        id="product"
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-page)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <div style={{ textAlign: "center", maxWidth: "52ch", margin: "0 auto 48px" }}>
            <h2 data-reveal="1" style={h2Style}>{t.landing.features.title}</h2>
            <p data-reveal="1" style={{ ...leadStyle, margin: "16px 0 0" }}>{t.landing.features.body}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }} data-t="three">
            {features.map((f) => (
              <div
                key={f.head}
                data-reveal="1"
                className="tj-feat"
                style={{
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-xs)",
                  padding: 26,
                  display: "flex",
                  flexDirection: "column",
                  gap: 13,
                }}
              >
                <span
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "var(--radius-md)",
                    background: "var(--primary-soft)",
                    color: "var(--primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={f.icon} size={21} />
                </span>
                <span
                  style={{
                    font: "var(--fw-bold) 17.5px/1.3 var(--font-sans)",
                    color: "var(--text-strong)",
                    letterSpacing: "-.01em",
                  }}
                >
                  {f.head}
                </span>
                <span
                  style={{ font: "var(--fw-regular) 14.5px/1.6 var(--font-sans)", color: "var(--text-muted)" }}
                >
                  {f.body}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- booking -- */}
      <section
        id="booking"
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <div
            data-t="two"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}
          >
            <div style={{ minWidth: 0 }}>
              <span style={{ display: "inline-flex" }}>
                <Badge tone="primary">{t.landing.booking.eyebrow}</Badge>
              </span>
              <h2 style={h2SplitStyle}>{t.landing.booking.title}</h2>
              <p style={{ ...leadStyle, margin: "16px 0 0", maxWidth: "46ch" }}>{t.landing.booking.body}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
                {bookingBullets.map((b) => (
                  <Bullet key={b} color="var(--success)">
                    {b}
                  </Bullet>
                ))}
              </div>
            </div>

            <div
              className="tj-demo-card"
              style={{
                minWidth: 0,
                background: "var(--surface-page)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-xl)",
                padding: 24,
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <span style={eyebrowStyle}>{t.landing.booking.pickATime}</span>
              <div className="tj-slot-row" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "16px 0 20px" }}>
                {slots.map((s) => (
                  <span
                    key={s.time}
                    className="tj-slot-chip"
                    style={{
                      font: "var(--fw-semibold) 14.5px/1 var(--font-sans)",
                      fontVariantNumeric: "tabular-nums",
                      padding: "13px 18px",
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${s.border}`,
                      background: s.bg,
                      color: s.fg,
                    }}
                  >
                    {s.time}
                  </span>
                ))}
              </div>
              <Button variant="primary" fullWidth onClick={() => showToast(t.landing.toast.booking)}>
                {t.landing.booking.confirm}
              </Button>
              <div className="tj-demo-schedule" style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <span style={eyebrowStyle}>{t.landing.booking.yourSchedule}</span>
                  <Badge tone="success" dot size="sm">
                    {t.landing.booking.justBooked}
                  </Badge>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {scheduleRows.map((c) => (
                    <AppointmentCard
                      key={c.name}
                      name={c.name}
                      service={c.service}
                      time={c.time}
                      status={c.status}
                      style={c.style}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ walk-ins -- */}
      <section
        id="walkins"
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-page)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <div
            data-t="two"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}
          >
            <div data-reveal="1" className="tj-wait-copy" style={{ minWidth: 0, order: 2 }}>
              <span style={{ display: "inline-flex" }}>
                <Badge tone="secondary">{t.landing.walkins.eyebrow}</Badge>
              </span>
              <h2 style={h2SplitStyle}>{t.landing.walkins.title}</h2>
              <p style={{ ...leadStyle, margin: "16px 0 0", maxWidth: "46ch" }}>{t.landing.walkins.body}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
                {walkBullets.map((w) => (
                  <span key={w} className="tj-wait-bullet">
                    <Bullet color="var(--secondary)">
                      {w}
                    </Bullet>
                  </span>
                ))}
              </div>
            </div>

            <div
              data-reveal="1"
              className="tj-wait-board tj-demo-card"
              style={{
                minWidth: 0,
                order: 1,
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-xl)",
                padding: 24,
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                className="tj-wait-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  paddingBottom: 16,
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span
                  className="tj-wait-title"
                  style={{ font: "var(--fw-bold) 16px/1.2 var(--font-sans)", color: "var(--text-strong)" }}
                >
                  {t.landing.walkins.boardTitle}
                </span>
                <span className="tj-wait-eta">
                  <WaitTimeWidget
                    minutes={waitMinutes}
                    label={t.landing.walkins.estimatedWait}
                    tone="primary"
                  />
                </span>
              </div>
              <div className="tj-wait-list" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
                {waitRows.map((w, idx) => (
                  <div
                    key={w.name}
                    className={`tj-wait-row${walkInAdded && idx === waitRows.length - 1 ? " tj-wait-row-new" : ""}`}
                  >
                    <AppointmentCard
                      name={w.name}
                      service={w.service}
                      status={w.status}
                      position={w.position}
                      waitMinutes={w.waitMinutes}
                    />
                  </div>
                ))}
              </div>
              <span style={{ display: "block", marginTop: 16 }}>
                <Button variant="outline" fullWidth onClick={addWalkIn} disabled={walkInAdded}>
                  {t.landing.walkins.addWalkIn}
                </Button>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- clients -- */}
      <section
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <div
            data-t="two"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}
          >
            <div style={{ minWidth: 0 }}>
              <span style={{ display: "inline-flex" }}>
                <Badge tone="primary">{t.landing.clients.eyebrow}</Badge>
              </span>
              <h2 style={h2SplitStyle}>{t.landing.clients.title}</h2>
              <p style={{ ...leadStyle, margin: "16px 0 0", maxWidth: "46ch" }}>{t.landing.clients.body}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
                {clientBullets.map((c) => (
                  <Bullet key={c} color="var(--primary)">
                    {c}
                  </Bullet>
                ))}
              </div>
            </div>

            <div
              className="tj-demo-card tj-client-card"
              style={{
                minWidth: 0,
                background: "var(--surface-page)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-xl)",
                padding: 26,
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div
                className="tj-client-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  paddingBottom: 20,
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <Avatar name={client.name} size="lg" className="tj-client-avatar" />
                <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span
                    className="tj-client-name"
                    style={{ font: "var(--fw-bold) 18px/1.2 var(--font-sans)", color: "var(--text-strong)" }}
                  >
                    {client.name}
                  </span>
                  <span
                    className="tj-client-meta"
                    style={{ font: "var(--fw-medium) 13px/1.35 var(--font-sans)", color: "var(--text-muted)" }}
                  >
                    {client.meta}
                  </span>
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {client.rows.map((r) => (
                  <span
                    key={r.k}
                    className="tj-client-row"
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: "13px 0",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span
                      className="tj-client-k"
                      style={{ font: "var(--fw-medium) 13.5px/1 var(--font-sans)", color: "var(--text-muted)" }}
                    >
                      {r.k}
                    </span>
                    <span
                      className="tj-client-v"
                      style={{
                        font: "var(--fw-semibold) 14.5px/1.35 var(--font-sans)",
                        color: "var(--text-strong)",
                        textAlign: "right",
                      }}
                    >
                      {r.v}
                    </span>
                  </span>
                ))}
              </div>
              <div className="tj-client-actions" style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
                <Button variant="primary" size="sm" onClick={() => showToast(t.landing.toast.booking)}>
                  {t.landing.clients.rebook}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => showToast(t.landing.toast.history)}>
                  {t.landing.clients.viewHistory}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- steps -- */}
      <section
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-page)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell({ textAlign: "center" })}>
          <h2 data-reveal="1" style={{ ...h2Style, margin: "0 0 44px" }}>{t.landing.steps.title}</h2>
          <div
            data-t="steps"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24, textAlign: "left" }}
          >
            {steps.map((s, idx) => (
              <div
                key={s.n}
                data-reveal="1"
                className="tj-step"
                style={{ display: "flex", flexDirection: "column", gap: 12, transitionDelay: `${idx * 80}ms` }}
              >
                <span
                  className="tj-step-num"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "var(--radius-pill)",
                    background: "var(--brand-ink)",
                    color: "var(--text-on-brand)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "var(--fw-bold) 15px/1 var(--font-sans)",
                  }}
                >
                  {s.n}
                </span>
                <span
                  style={{
                    font: "var(--fw-bold) 19px/1.25 var(--font-sans)",
                    color: "var(--text-strong)",
                    letterSpacing: "-.01em",
                    marginTop: 4,
                  }}
                >
                  {s.head}
                </span>
                <span style={{ font: "var(--fw-regular) 15px/1.6 var(--font-sans)", color: "var(--text-muted)" }}>
                  {s.body}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- pricing -- */}
      <section
        id="pricing"
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <div style={{ textAlign: "center", maxWidth: "50ch", margin: "0 auto 40px" }}>
            <h2 data-reveal="1" style={h2Style}>{t.landing.pricing.title}</h2>
          </div>
          <div
            data-t="price"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 20,
              maxWidth: 1020,
              margin: "0 auto",
            }}
          >
            {plans.map((p, idx) => (
              <div
                key={p.name}
                data-reveal="1"
                className={`tj-plan${p.featured ? " tj-plan-featured" : ""}`}
                style={{
                  background: "var(--surface-card)",
                  border: p.border,
                  borderRadius: "var(--radius-xl)",
                  boxShadow: p.shadow,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  transitionDelay: `${idx * 100}ms`,
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                >
                  <span style={eyebrowStyle}>{p.name}</span>
                  {p.featured && (
                    <span className="tj-plan-badge">
                      <Badge tone="primary" size="sm">
                        {t.landing.pricing.mostPopular}
                      </Badge>
                    </span>
                  )}
                </span>
                <span className="tj-plan-price">
                  <span
                    style={{
                      font: "var(--fw-extrabold) 38px/1 var(--font-sans)",
                      letterSpacing: "-.035em",
                      color: "var(--text-strong)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {p.price}
                  </span>
                  <span style={{ font: "var(--fw-medium) 14px/1 var(--font-sans)", color: "var(--text-muted)" }}>
                    {p.per}
                  </span>
                </span>
                <span
                  style={{ font: "var(--fw-regular) 14.5px/1.5 var(--font-sans)", color: "var(--text-muted)" }}
                >
                  {p.who}
                </span>
                <span style={{ height: 1, background: "var(--border-subtle)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {p.feats.map((ft) => (
                    <span key={ft} className="tj-plan-feat" style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                      <span style={{ color: "var(--success)", flexShrink: 0, paddingTop: 1, display: "flex" }}>
                        <Icon name="check" size={15} />
                      </span>
                      <span
                        style={{ font: "var(--fw-regular) 14px/1.45 var(--font-sans)", color: "var(--text-body)" }}
                      >
                        {ft}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="tj-plan-cta">
                  <Button variant={p.variant} fullWidth onClick={openInquiry}>
                    {p.cta}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- faq -- */}
      <section
        id="faq"
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-page)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={{ maxWidth: 820, margin: "0 auto", padding: PAD }}>
          <h2 data-reveal="1" style={{ ...h2Style, margin: "0 0 28px" }}>{t.landing.faq.title}</h2>
          <div
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-xs)",
              overflow: "hidden",
            }}
          >
            {faqs.map((q, i) => {
              const open = faqOpen === i;
              return (
                <div key={q.q} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <button
                    type="button"
                    onClick={() => setFaqOpen(open ? null : i)}
                    aria-expanded={open}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: "20px 24px",
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      font: "var(--fw-semibold) 16px/1.4 var(--font-sans)",
                      color: "var(--text-strong)",
                    }}
                  >
                    {q.q}
                    <span
                      style={{
                        flexShrink: 0,
                        color: "var(--text-muted)",
                        display: "flex",
                        transform: open ? "rotate(45deg)" : "rotate(0deg)",
                        transition: "transform var(--dur-base) var(--ease-standard)",
                      }}
                    >
                      <Icon name="plus" size={19} />
                    </span>
                  </button>
                  {open && (
                    <p
                      className="tj-faq-answer"
                      style={{
                        margin: 0,
                        padding: "0 24px 22px",
                        font: "var(--fw-regular) 15.5px/1.65 var(--font-sans)",
                        color: "var(--text-muted)",
                        maxWidth: "64ch",
                        textWrap: "pretty",
                      }}
                    >
                      {q.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- product tour -- */}
      <section
        id="tour"
        data-t="sect"
        style={{ padding: "88px 0", background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <div style={{ textAlign: "center", maxWidth: "52ch", margin: "0 auto 36px" }}>
            <h2 data-reveal="1" style={h2Style}>{t.landing.tour.title}</h2>
            <p data-reveal="1" style={{ ...leadStyle, margin: "14px 0 0" }}>{t.landing.tour.body}</p>
          </div>
          <div data-reveal="1" style={{ maxWidth: 520, margin: "0 auto" }}>
            <ProductTour onToast={showToast} />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- close CTA -- */}
      <section data-t="sect" style={{ padding: 0, background: "var(--surface-page)" }}>
        <div
          style={{
            background:
              "linear-gradient(135deg,var(--brand-ink) 0%,var(--blue-900) 58%,var(--blue-800) 100%)",
            padding: "88px 0",
          }}
        >
          <div data-t="pad" style={shell({ textAlign: "center" })}>
            <h2
              style={{
                font: "var(--fw-extrabold) clamp(30px,3.8cqw,50px)/1.08 var(--font-sans)",
                letterSpacing: "-.035em",
                color: "var(--text-on-brand)",
                margin: "0 auto",
                maxWidth: "22ch",
              }}
            >
              {t.landing.close.title}
            </h2>
            <p
              style={{
                font: "var(--fw-regular) 17px/1.6 var(--font-sans)",
                color: "var(--text-on-brand)",
                margin: "20px auto 0",
                maxWidth: "52ch",
              }}
            >
              {t.landing.close.body}
            </p>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 32,
              }}
              data-t="hero-ctas"
            >
              <button
                type="button"
                className="tj-cta-light"
                onClick={openInquiry}
                style={{
                  border: 0,
                  cursor: "pointer",
                  background: "var(--text-on-brand)",
                  color: "var(--brand-ink)",
                  font: "var(--fw-semibold) 16px/1 var(--font-sans)",
                  padding: "0 26px",
                  height: 48,
                  borderRadius: "var(--radius-md)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  transition: "opacity var(--dur-fast) var(--ease-standard)",
                }}
              >
                {ctaPrimary}
                <span style={{ display: "flex" }}>
                  <Icon name="arrowRight" size={17} />
                </span>
              </button>
              <button
                type="button"
                className="tj-cta-outline"
                onClick={openInquiry}
                style={{
                  cursor: "pointer",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,.34)",
                  color: "var(--text-on-brand)",
                  font: "var(--fw-medium) 16px/1 var(--font-sans)",
                  padding: "0 24px",
                  height: 48,
                  borderRadius: "var(--radius-md)",
                  transition:
                    "border-color var(--dur-base) var(--ease-standard),background var(--dur-base) var(--ease-standard)",
                }}
              >
                {t.landing.cta.bookDemo}
              </button>
            </div>
            <p
              style={{
                font: "var(--fw-medium) 13.5px/1.6 var(--font-sans)",
                color: "var(--text-on-brand)",
                margin: "22px auto 0",
              }}
            >
              {t.landing.close.micro}
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- footer -- */}
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
              <div key={fc.head} className="tj-foot-col" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                <span className="tj-foot-head" style={eyebrowStyle}>{fc.head}</span>
                {fc.links.map((fl) => (
                  <a
                    key={fl.href + fl.label}
                    href={fl.href}
                    className="tj-footlink"
                    style={{
                      font: "var(--fw-medium) 14px/1.35 var(--font-sans)",
                      color: "var(--text-body)",
                      cursor: "pointer",
                    }}
                  >
                    {fl.label}
                  </a>
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
            <a
              href="#top"
              className="tj-logo-link"
              aria-label={t.brand.logoAlt}
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              style={{ display: "flex", cursor: "pointer" }}
            >
              <Logo height={40} />
            </a>
            <span
              style={{ font: "var(--fw-medium) 12.5px/1.5 var(--font-sans)", color: "var(--text-muted)" }}
            >
              {t.landing.footer.note}
            </span>
          </div>
        </div>
      </footer>

      {/* --------------------------------------------------------- toast -- */}
      {toast && (
        <div
          style={{
            // Fixed, not sticky: a sticky toast resolves to its flow position
            // once the page is scrolled to the end, which landed the pill on top
            // of the closing CTA buttons instead of above them.
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(28px + env(safe-area-inset-bottom, 0px))",
            zIndex: 90,
            display: "flex",
            justifyContent: "center",
            padding: "0 20px",
            pointerEvents: "none",
          }}
        >
          <div
            role="status"
            style={{
              padding: "13px 22px",
              borderRadius: "var(--radius-pill)",
              background: "var(--surface-inverse)",
              color: "var(--text-on-brand)",
              boxShadow: "var(--shadow-xl)",
              font: "var(--fw-semibold) 14px/1.35 var(--font-sans)",
              whiteSpace: "normal",
              maxWidth: "min(420px, calc(100vw - 40px))",
              textAlign: "center",
            }}
          >
            {toast}
          </div>
        </div>
      )}

      {/* ------------------------------------------------- inquiry modal -- */}
      {showInquiry && (
        <div
          className="tt-modal-backdrop"
          onClick={closeInquiry}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(15,23,42,.55)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            overflowY: "auto",
          }}
        >
          <div
            className="tt-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={t.landing.inquiry.title}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              background: "var(--surface-card)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-xl)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                padding: "26px 26px 0",
              }}
            >
              <div>
                <h3
                  style={{
                    font: "var(--fw-extrabold) 22px/1.2 var(--font-sans)",
                    letterSpacing: "-.02em",
                    color: "var(--text-strong)",
                    margin: 0,
                  }}
                >
                  {t.landing.inquiry.title}
                </h3>
                <p
                  style={{
                    font: "var(--fw-regular) var(--fs-body-sm)/1.5 var(--font-sans)",
                    color: "var(--text-muted)",
                    margin: "8px 0 0",
                  }}
                >
                  {t.landing.inquiry.subtitle}
                </p>
              </div>
              <button
                type="button"
                className="tt-close-btn"
                onClick={closeInquiry}
                aria-label={t.common.close}
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div style={{ padding: 26 }}>
              {submitted ? (
                <div style={{ textAlign: "center", paddingTop: 6 }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "var(--radius-pill)",
                      background: "var(--success-soft)",
                      color: "var(--success)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 16px",
                    }}
                  >
                    <Icon name="checkCircle" size={28} />
                  </div>
                  <h4
                    style={{
                      font: "var(--fw-bold) 19px/1.25 var(--font-sans)",
                      color: "var(--text-strong)",
                      margin: "0 0 8px",
                    }}
                  >
                    {t.landing.inquiry.successTitle}
                  </h4>
                  <p
                    style={{
                      font: "var(--fw-regular) var(--fs-body-md)/1.5 var(--font-sans)",
                      color: "var(--text-muted)",
                      margin: "0 0 22px",
                    }}
                  >
                    {t.landing.inquiry.successBody}
                  </p>
                  <Button variant="primary" fullWidth onClick={closeInquiry}>
                    {t.landing.inquiry.successDone}
                  </Button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                    {inquiryPerks.map((p) => (
                      <div
                        key={p}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 9px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--surface-page)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <span style={{ color: "var(--success)", display: "flex", flexShrink: 0 }}>
                          <Icon name="check" size={14} />
                        </span>
                        <span
                          style={{ font: "var(--fw-semibold) 11.5px/1.2 var(--font-sans)", color: "var(--text-body)" }}
                        >
                          {p}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 15 }}>
                    <Input
                      label={t.landing.inquiry.businessNameLabel}
                      placeholder={t.landing.inquiry.businessNamePlaceholder}
                      leadingIcon="building"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                  </div>
                  <div style={{ marginBottom: 15 }}>
                    <Input
                      label={t.landing.inquiry.addressLabel}
                      placeholder={t.landing.inquiry.addressPlaceholder}
                      leadingIcon="mapPin"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>
                  <label style={{ display: "block" }}>
                    <span
                      style={{
                        display: "block",
                        font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)",
                        color: "var(--text-body)",
                        marginBottom: 8,
                      }}
                    >
                      {t.landing.inquiry.phoneLabel}
                    </span>
                    <PhoneField
                      country={phoneCountry}
                      national={national}
                      onCountryChange={setPhoneCountry}
                      onNationalChange={setNational}
                      placeholder={t.landing.inquiry.phonePlaceholder}
                      marginBottom={0}
                    />
                  </label>

                  {formError && (
                    <div
                      style={{
                        font: "var(--fw-medium) 13px/1.3 var(--font-sans)",
                        color: "var(--error)",
                        marginTop: 14,
                      }}
                    >
                      {formError}
                    </div>
                  )}
                  <div style={{ marginTop: 22 }}>
                    <Button
                      variant="primary"
                      fullWidth
                      trailingIcon="arrowRight"
                      onClick={submitInquiry}
                      disabled={submitting}
                    >
                      {submitting ? t.landing.inquiry.submitting : t.landing.inquiry.submit}
                    </Button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      marginTop: 14,
                    }}
                  >
                    <span style={{ color: "var(--text-subtle)", display: "flex" }}>
                      <Icon name="checkCircle" size={14} />
                    </span>
                    <p
                      style={{
                        font: "var(--fw-regular) var(--fs-body-sm)/1.4 var(--font-sans)",
                        color: "var(--text-subtle)",
                        margin: 0,
                      }}
                    >
                      {t.landing.inquiry.privacyNote}{" "}
                      <Link href="/privacy" style={{ color: "var(--primary)" }}>
                        {t.landing.inquiry.privacyPolicy}
                      </Link>
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
