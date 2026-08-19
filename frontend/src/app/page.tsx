"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/landing/Icon";
import { Logo } from "@/components/landing/Logo";
import { Button, Input } from "@/components/landing/ui";
import PhoneField from "@/components/ui/PhoneField";
import { t } from "@/i18n";
import { publicApi } from "@/lib/api";
import { combineToE164, DEFAULT_DIAL_CODE, DEFAULT_ISO2, isValidNational } from "@/lib/phone";
import {
  bookingBullets,
  bookingDays,
  features,
  footerCols,
  industries,
  inquiryPerks,
  kpis,
  marquee,
  ownerBullets,
  queueMock,
  slots,
  stats,
  testimonials,
} from "@/components/landing/landingData";

const MAX = 1200;

export default function Home() {
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

  const openInquiry = () => {
    setSubmitted(false);
    setBusinessName("");
    setAddress("");
    setPhoneCountry({ dialCode: DEFAULT_DIAL_CODE, iso2: DEFAULT_ISO2 });
    setNational("");
    setFormError("");
    setShowInquiry(true);
  };
  const closeInquiry = () => setShowInquiry(false);

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

  // Lock scroll while the modal is open.
  useEffect(() => {
    document.body.style.overflow = showInquiry ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showInquiry]);

  // Scroll reveal, count-up, feature tilt and the custom site cursor.
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" }
    );
    document.querySelectorAll<HTMLElement>(".reveal").forEach((el, i) => {
      el.style.transitionDelay = (i % 4) * 70 + "ms";
      io.observe(el);
    });

    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          cio.unobserve(el);
          const to = parseFloat(el.getAttribute("data-count") || "0") || 0;
          const dur = 1400;
          const start = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            const v = to * eased;
            el.textContent =
              to >= 100 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(1);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.5 }
    );
    document
      .querySelectorAll<HTMLElement>("[data-count]")
      .forEach((el) => cio.observe(el));

    // Feature cards: cursor spotlight + subtle 3D tilt.
    const featCleanups: (() => void)[] = [];
    document.querySelectorAll<HTMLElement>(".tt-feat").forEach((el) => {
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        el.style.setProperty("--mx", x + "px");
        el.style.setProperty("--my", y + "px");
        if (reduce) return;
        const rx = (0.5 - y / r.height) * 7;
        const ry = (x / r.width - 0.5) * 9;
        el.style.transform = `perspective(820px) rotateX(${rx.toFixed(
          2
        )}deg) rotateY(${ry.toFixed(2)}deg) translateY(-6px)`;
      };
      const onLeave = () => {
        el.style.transform = "";
      };
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", onLeave);
      featCleanups.push(() => {
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
      });
    });

    // Custom site cursor: arrow + trailing ring (fine pointers only).
    let cursorCleanup: (() => void) | undefined;
    if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
      const ring = document.createElement("div");
      ring.id = "tt-cur-ring";
      const arrow = document.createElement("div");
      arrow.id = "tt-cur-arrow";
      arrow.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"><path d="M3 2 L3 18.5 L7.4 14.4 L10.3 20.8 L13 19.6 L10.1 13.4 L16 13.2 Z"/></svg>';
      document.body.appendChild(ring);
      document.body.appendChild(arrow);
      document.documentElement.classList.add("tt-cursor-on");

      let mx = window.innerWidth / 2;
      let my = window.innerHeight / 2;
      let rx = mx;
      let ry = my;
      let raf = 0;
      const hovSel =
        "a,button,[role=button],.tt-feat,.tt-chip,input,label,img";

      const onMove = (e: MouseEvent) => {
        mx = e.clientX;
        my = e.clientY;
        arrow.style.transform = `translate(${mx}px,${my}px)`;
        const t = e.target as HTMLElement;
        const hit = !!(t.closest && t.closest(hovSel));
        ring.classList.toggle("is-hover", hit);
        arrow.classList.toggle("is-hover", hit);
      };
      const onDown = () => ring.classList.add("is-down");
      const onUp = () => ring.classList.remove("is-down");
      const onLeave = () => {
        ring.style.opacity = "0";
        arrow.style.opacity = "0";
      };
      const onEnter = () => {
        ring.style.opacity = "1";
        arrow.style.opacity = "1";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      document.addEventListener("mouseleave", onLeave);
      document.addEventListener("mouseenter", onEnter);

      const loop = () => {
        rx += (mx - rx) * 0.2;
        ry += (my - ry) * 0.2;
        ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
        raf = requestAnimationFrame(loop);
      };
      loop();

      cursorCleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mousedown", onDown);
        window.removeEventListener("mouseup", onUp);
        document.removeEventListener("mouseleave", onLeave);
        document.removeEventListener("mouseenter", onEnter);
        document.documentElement.classList.remove("tt-cursor-on");
        ring.remove();
        arrow.remove();
      };
    }

    return () => {
      io.disconnect();
      cio.disconnect();
      featCleanups.forEach((fn) => fn());
      cursorCleanup?.();
    };
  }, []);

  return (
    <div style={{ overflowX: "hidden" }}>
      {/* ===================== NAV ===================== */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "saturate(1.4) blur(10px)",
          background: "rgba(255,255,255,.82)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            maxWidth: MAX,
            margin: "0 auto",
            height: 68,
            padding: "0 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 42 }}>
            <Logo height={48} />
            <div
              className="tt-nav-links"
              style={{ display: "flex", gap: 28, alignItems: "center" }}
            >
              <a href="#features" className="tt-nav-link">{t.landing.nav.features}</a>
              <a href="#industries" className="tt-nav-link">{t.landing.nav.industries}</a>
              <a href="#vision" className="tt-nav-link">{t.landing.nav.vision}</a>
            </div>
          </div>
          <Button variant="primary" trailingIcon="arrowRight" onClick={openInquiry}>
            {t.landing.nav.getStarted}
          </Button>
        </div>
      </div>

      {/* ===================== HERO ===================== */}
      <div style={{ position: "relative", overflow: "hidden", background: "var(--surface-card)" }}>
        <div
          className="tt-blob"
          style={{
            position: "absolute",
            top: -120,
            right: -80,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "radial-gradient(circle at 30% 30%,var(--blue-100),transparent 70%)",
            pointerEvents: "none",
          }}
        />
        <div
          className="tt-blob"
          style={{
            position: "absolute",
            bottom: -160,
            left: -120,
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: "radial-gradient(circle at 60% 40%,var(--teal-100),transparent 70%)",
            pointerEvents: "none",
            animationDelay: "-6s",
          }}
        />

        <div
          className="tt-hero-grid"
          style={{
            position: "relative",
            maxWidth: MAX,
            margin: "0 auto",
            padding: "72px 28px 84px",
            display: "grid",
            gridTemplateColumns: "1.05fr .95fr",
            gap: 56,
            alignItems: "center",
          }}
        >
          <div>
            <div
              className="tt-row"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderRadius: 999,
                background: "var(--primary-soft)",
                border: "1px solid var(--blue-200)",
                marginBottom: 22,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--secondary)" }} />
              <span
                style={{
                  font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)",
                  color: "var(--primary-soft-fg)",
                  letterSpacing: ".01em",
                }}
              >
                {t.landing.hero.eyebrow}
              </span>
            </div>
            <h1
              className="tt-hero-h1"
              style={{
                font: "var(--fw-extrabold) 54px/1.04 var(--font-sans)",
                letterSpacing: "-.03em",
                color: "var(--text-strong)",
                margin: "0 0 20px",
              }}
            >
              {t.landing.hero.titleLead}{" "}
              <span className="tt-grad-text">{t.landing.hero.titleAccent}</span>
            </h1>
            <p
              style={{
                font: "var(--fw-regular) var(--fs-body-lg)/1.55 var(--font-sans)",
                color: "var(--text-body)",
                maxWidth: 520,
                margin: "0 0 16px",
              }}
            >
              {t.landing.hero.body}
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 26, flexWrap: "wrap" }}>
              <span className="tt-cta-pulse" style={{ display: "inline-flex", borderRadius: "var(--radius-md)" }}>
                <Button variant="primary" size="lg" trailingIcon="arrowRight" onClick={openInquiry}>
                  {t.landing.hero.getStarted}
                </Button>
              </span>
              <Button variant="outline" size="lg" onClick={openInquiry}>
                {t.landing.hero.requestDemo}
              </Button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28 }}>
              <div style={{ display: "flex" }}>
                <span style={avatarStyle("var(--blue-200)", "var(--blue-700)", 0)}>SC</span>
                <span style={avatarStyle("var(--teal-200)", "var(--teal-700)", -10)}>DR</span>
                <span style={avatarStyle("var(--amber-200)", "var(--amber-700)", -10)}>CW</span>
              </div>
              <div
                style={{
                  font: "var(--fw-medium) var(--fs-body-sm)/1.4 var(--font-sans)",
                  color: "var(--text-muted)",
                }}
              >
                {t.landing.hero.lovedByLine1}
                <br />{t.landing.hero.lovedByLine2}
              </div>
            </div>
          </div>

          {/* animated product mock */}
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            <div
              className="tt-float"
              style={{
                width: 340,
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-xl)",
                boxShadow: "var(--shadow-xl)",
                padding: 18,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ font: "var(--fw-bold) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-strong)" }}>
                    {t.landing.mock.liveQueue}
                  </div>
                  <div style={{ font: "var(--fw-regular) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 4 }}>
                    {t.landing.mock.storeToday}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999, background: "var(--success-soft)" }}>
                  <span className="tt-pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
                  <span style={{ font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--success-soft-fg)" }}>{t.landing.mock.open}</span>
                </div>
              </div>
              {queueMock.map((q) => (
                <div
                  key={q.token}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 12px",
                    borderRadius: "var(--radius-md)",
                    background: q.bg,
                    border: `1px solid ${q.border}`,
                    marginBottom: 9,
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: q.tokBg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)",
                      color: q.tokFg,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {q.token}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "var(--fw-semibold) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-strong)" }}>{q.name}</div>
                    <div style={{ font: "var(--fw-regular) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 3 }}>{q.service}</div>
                  </div>
                  <div style={{ font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)", color: q.statusFg, whiteSpace: "nowrap" }}>{q.status}</div>
                </div>
              ))}
              <Button variant="secondary" fullWidth leadingIcon="plus" onClick={openInquiry}>
                {t.landing.mock.addWalkIn}
              </Button>
            </div>

            {/* floating toast */}
            <div
              className="tt-float2"
              style={{
                position: "absolute",
                top: -30,
                left: -44,
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-lg)",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                animationDelay: "-2s",
                zIndex: 2,
              }}
            >
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="checkCircle" size={18} />
              </span>
              <div>
                <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-strong)" }}>{t.landing.mock.newBooking}</div>
                <div style={{ font: "var(--fw-regular) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 3 }}>{t.landing.mock.newBookingSub}</div>
              </div>
            </div>

            {/* floating stat */}
            <div
              className="tt-float2"
              style={{
                position: "absolute",
                bottom: -20,
                right: -22,
                background: "var(--brand-ink)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-lg)",
                padding: "13px 16px",
                animationDelay: "-3.5s",
              }}
            >
              <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "#fff", fontVariantNumeric: "tabular-nums" }}>{t.landing.mock.waitValue}</div>
              <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--blue-200)", marginTop: 5 }}>{t.landing.mock.waitLabel}</div>
            </div>
          </div>
        </div>

        {/* trust marquee */}
        <div
          style={{
            position: "relative",
            borderTop: "1px solid var(--border-subtle)",
            padding: "18px 0",
            overflow: "hidden",
            WebkitMaskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)",
            maskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)",
          }}
        >
          <div className="tt-marquee-track">
            {marquee.map((m, i) => (
              <span
                key={i}
                style={{
                  font: "var(--fw-semibold) var(--fs-body-md)/1 var(--font-sans)",
                  color: "var(--text-subtle)",
                  whiteSpace: "nowrap",
                  padding: "0 28px",
                }}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ===================== FEATURES ===================== */}
      <div id="features" style={{ maxWidth: MAX, margin: "0 auto", padding: "84px 28px 40px" }}>
        <div className="reveal" style={{ textAlign: "center", maxWidth: 680, margin: "0 auto 48px" }}>
          <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>
            {t.landing.features.eyebrow}
          </div>
          <h2 style={{ font: "var(--fw-extrabold) 38px/1.1 var(--font-sans)", letterSpacing: "-.025em", color: "var(--text-strong)", margin: "0 0 14px" }}>
            {t.landing.features.title}
          </h2>
          <p style={{ font: "var(--fw-regular) var(--fs-body-lg)/1.55 var(--font-sans)", color: "var(--text-body)", margin: 0 }}>
            {t.landing.features.body}
          </p>
        </div>
        <div className="tt-features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {features.map((f) => (
            <div
              key={f.title}
              className="reveal tt-feat"
              style={{
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-xs)",
                padding: "26px 24px",
              }}
            >
              <span className="tt-feat-arrow">
                <Icon name="arrowRight" size={18} />
              </span>
              <div
                className="tt-feat-icon"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 13,
                  background: f.iconBg,
                  color: f.iconFg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 18,
                }}
              >
                <Icon name={f.icon} size={24} />
              </div>
              <h3 style={{ font: "var(--fw-bold) var(--fs-h5)/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 9px" }}>{f.title}</h3>
              <p style={{ font: "var(--fw-regular) var(--fs-body-md)/1.55 var(--font-sans)", color: "var(--text-body)", margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ===================== DETAIL ROWS ===================== */}
      <div style={{ maxWidth: MAX, margin: "0 auto", padding: "50px 28px" }}>
        {/* Online booking */}
        <div className="reveal tt-detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center", marginBottom: 60 }}>
          <div>
            <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--secondary)", marginBottom: 12 }}>
              {t.landing.booking.eyebrow}
            </div>
            <h3 style={{ font: "var(--fw-extrabold) 30px/1.15 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 14px" }}>
              {t.landing.booking.title}
            </h3>
            <p style={{ font: "var(--fw-regular) var(--fs-body-lg)/1.55 var(--font-sans)", color: "var(--text-body)", margin: "0 0 20px" }}>
              {t.landing.booking.body}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {bookingBullets.map((b) => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={bulletIconStyle("var(--success-soft)", "var(--success)")}>
                    <Icon name="check" size={15} />
                  </span>
                  <span style={{ font: "var(--fw-medium) var(--fs-body-md)/1.4 var(--font-sans)", color: "var(--text-body)" }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="tt-panel" style={{ background: "linear-gradient(160deg,var(--blue-50),var(--teal-50))", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xl)", padding: 26, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xs)", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, background: "linear-gradient(135deg,var(--brand-ink),var(--primary))", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "var(--fw-extrabold) var(--fs-body-md)/1 var(--font-sans)", flexShrink: 0 }}>SC</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--fw-bold) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-strong)" }}>{t.landing.booking.storeName}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
                    <span style={{ color: "var(--amber-500)", display: "flex" }}><Icon name="star" size={13} fill="currentColor" /></span>
                    <span style={{ font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-body)" }}>{t.landing.booking.storeRating}</span>
                    <span style={{ font: "var(--fw-regular) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)" }}>{t.landing.booking.storeMeta}</span>
                  </div>
                </div>
                <span style={{ padding: "5px 11px", borderRadius: 999, background: "var(--success-soft)", color: "var(--success-soft-fg)", font: "var(--fw-semibold) 11px/1 var(--font-sans)" }}>{t.landing.booking.open}</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", borderRadius: "var(--radius-md)", border: "1.5px solid var(--primary)", background: "var(--primary-soft)" }}>
                <div>
                  <div style={{ font: "var(--fw-semibold) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-strong)" }}>{t.landing.booking.serviceName}</div>
                  <div style={{ font: "var(--fw-regular) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{t.landing.booking.serviceDuration}</div>
                </div>
                <div style={{ font: "var(--fw-extrabold) var(--fs-body-lg)/1 var(--font-sans)", color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{t.landing.booking.servicePrice}</div>
              </div>

              <div>
                <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-strong)", marginBottom: 10 }}>{t.landing.booking.selectDate}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 7 }}>
                  {bookingDays.map((d) => (
                    <div key={d.d} style={{ textAlign: "center", padding: "9px 0", borderRadius: "var(--radius-md)", border: `1px solid ${d.border}`, background: d.bg }}>
                      <div style={{ font: "var(--fw-semibold) 10px/1 var(--font-sans)", color: d.subFg, textTransform: "uppercase", letterSpacing: ".04em" }}>{d.d}</div>
                      <div style={{ font: "var(--fw-bold) var(--fs-body-md)/1 var(--font-sans)", color: d.fg, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{d.n}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-strong)", marginBottom: 10 }}>{t.landing.booking.chooseTime}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9 }}>
                  {slots.map((s) => (
                    <div key={s.t} style={{ textAlign: "center", padding: "10px 0", borderRadius: "var(--radius-md)", border: `1px solid ${s.border}`, background: s.bg, color: s.fg, font: "var(--fw-semibold) var(--fs-body-sm)/1 var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>{s.t}</div>
                  ))}
                </div>
              </div>

              <Button variant="primary" size="lg" fullWidth onClick={openInquiry}>
                {t.landing.booking.confirm}
              </Button>
            </div>
          </div>
        </div>

        {/* Owner app */}
        <div className="reveal tt-detail-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div className="tt-panel" style={{ order: 1, background: "linear-gradient(160deg,var(--teal-50),var(--blue-50))", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xl)", padding: 26, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {kpis.map((k) => (
                <div key={k.label} style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xs)", padding: 16 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: k.bg, color: k.fg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 11 }}>
                    <Icon name={k.icon} size={18} />
                  </div>
                  <div style={{ font: "var(--fw-extrabold) var(--fs-h4)/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                  <div style={{ font: "var(--fw-medium) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ order: 2 }}>
            <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>
              {t.landing.ownerApp.eyebrow}
            </div>
            <h3 style={{ font: "var(--fw-extrabold) 30px/1.15 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 14px" }}>
              {t.landing.ownerApp.title}
            </h3>
            <p style={{ font: "var(--fw-regular) var(--fs-body-lg)/1.55 var(--font-sans)", color: "var(--text-body)", margin: "0 0 20px" }}>
              {t.landing.ownerApp.body}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ownerBullets.map((b) => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={bulletIconStyle("var(--primary-soft)", "var(--primary)")}>
                    <Icon name="check" size={15} />
                  </span>
                  <span style={{ font: "var(--fw-medium) var(--fs-body-md)/1.4 var(--font-sans)", color: "var(--text-body)" }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ===================== STATS BAND ===================== */}
      <div className="tt-hero-grad" style={{ margin: "40px 0", padding: "64px 28px" }}>
        <div className="tt-stats-grid" style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 30, textAlign: "center" }}>
          {stats.map((st) => (
            <div key={st.label} className="reveal">
              <div style={{ font: "var(--fw-extrabold) 46px/1 var(--font-sans)", color: "#fff", fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em" }}>
                <span data-count={st.to}>0</span>
                {st.suffix}
              </div>
              <div style={{ font: "var(--fw-medium) var(--fs-body-md)/1.3 var(--font-sans)", color: "rgba(255,255,255,.85)", marginTop: 10 }}>{st.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ===================== INDUSTRIES ===================== */}
      <div id="industries" style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 28px", textAlign: "center" }}>
        <div className="reveal" style={{ marginBottom: 38 }}>
          <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>
            {t.landing.industries.eyebrow}
          </div>
          <h2 style={{ font: "var(--fw-extrabold) 38px/1.1 var(--font-sans)", letterSpacing: "-.025em", color: "var(--text-strong)", margin: 0 }}>
            {t.landing.industries.title}
          </h2>
        </div>
        <div className="reveal" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          {industries.map((ind) => (
            <span key={ind} className="tt-chip" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", font: "var(--fw-semibold) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-body)", boxShadow: "var(--shadow-xs)" }}>{ind}</span>
          ))}
        </div>
      </div>

      {/* ===================== VISION ===================== */}
      <div id="vision" style={{ maxWidth: 900, margin: "0 auto", padding: "64px 28px", textAlign: "center" }}>
        <div className="reveal">
          <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--secondary)", marginBottom: 18 }}>
            {t.landing.vision.eyebrow}
          </div>
          <h2 style={{ font: "var(--fw-extrabold) 44px/1.18 var(--font-sans)", letterSpacing: "-.025em", color: "var(--text-strong)", margin: "0 0 22px" }}>
            {t.landing.vision.titleLead}{" "}
            <span className="tt-grad-text">{t.landing.vision.titleAccent}</span>
          </h2>
          <p style={{ font: "var(--fw-regular) var(--fs-body-lg)/1.6 var(--font-sans)", color: "var(--text-body)", margin: "0 auto", maxWidth: 640 }}>
            {t.landing.vision.body}
          </p>
        </div>
      </div>

      {/* ===================== TESTIMONIALS ===================== */}
      <div style={{ maxWidth: MAX, margin: "0 auto", padding: "30px 28px 64px" }}>
        <div className="tt-testimonials-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {testimonials.map((t) => (
            <div key={t.name} className="reveal tt-lift" style={{ position: "relative", display: "flex", flexDirection: "column", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xs)", padding: "30px 28px 26px", overflow: "hidden" }}>
              <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 20, font: "var(--fw-extrabold) 96px/1 Georgia,serif", color: "var(--primary)", opacity: 0.08, pointerEvents: "none" }}>&rdquo;</span>
              <div style={{ display: "flex", gap: 3, color: "var(--amber-500)", marginBottom: 16 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Icon key={i} name="star" size={16} fill="currentColor" />
                ))}
              </div>
              <p style={{ flex: 1, font: "var(--fw-medium) var(--fs-body-md)/1.65 var(--font-sans)", color: "var(--text-body)", margin: "0 0 22px", position: "relative" }}>{t.quote}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
                <span style={{ width: 44, height: 44, borderRadius: "50%", background: t.avBg, color: t.avFg, display: "flex", alignItems: "center", justifyContent: "center", font: "var(--fw-bold) var(--fs-body-sm) var(--font-sans)", flexShrink: 0 }}>{t.initials}</span>
                <div>
                  <div style={{ font: "var(--fw-bold) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-strong)" }}>{t.name}</div>
                  <div style={{ font: "var(--fw-regular) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===================== CTA BAND ===================== */}
      <div style={{ maxWidth: MAX, margin: "0 auto", padding: "0 28px 70px" }}>
        <div className="reveal tt-hero-grad" style={{ borderRadius: "var(--radius-xl)", padding: "60px 40px", textAlign: "center", position: "relative", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}>
          <h2 style={{ font: "var(--fw-extrabold) 40px/1.1 var(--font-sans)", letterSpacing: "-.025em", color: "#fff", margin: "0 0 14px" }}>
            {t.landing.cta.title}
          </h2>
          <p style={{ font: "var(--fw-regular) var(--fs-body-lg)/1.5 var(--font-sans)", color: "rgba(255,255,255,.9)", margin: "0 auto 28px", maxWidth: 520 }}>
            {t.landing.cta.body}
          </p>
          <div style={{ display: "inline-flex" }}>
            <Button variant="outline" size="lg" onDark trailingIcon="arrowRight" onClick={openInquiry}>
              {t.landing.cta.button}
            </Button>
          </div>
        </div>
      </div>

      {/* ===================== FOOTER ===================== */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
        <div className="tt-footer-grid" style={{ maxWidth: MAX, margin: "0 auto", padding: "48px 28px 28px", display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", gap: 40 }}>
          <div>
            <div style={{ marginBottom: 14 }}>
              <Logo height={48} />
            </div>
            <p style={{ font: "var(--fw-regular) var(--fs-body-md)/1.5 var(--font-sans)", color: "var(--text-muted)", margin: 0, maxWidth: 260 }}>
              {t.landing.footer.blurb}
            </p>
          </div>
          {footerCols.map((col) => (
            <div key={col.title}>
              <div style={{ font: "var(--fw-bold) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-strong)", marginBottom: 14, textTransform: "uppercase", letterSpacing: ".05em" }}>{col.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map((lk) => (
                  <span key={lk} style={{ font: "var(--fw-regular) var(--fs-body-md)/1 var(--font-sans)", color: "var(--text-muted)", cursor: "pointer" }}>{lk}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ maxWidth: MAX, margin: "0 auto", padding: "18px 28px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, font: "var(--fw-regular) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-subtle)" }}>
            <span>{t.landing.footer.copyright}</span>
            <span style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Link href="/privacy" style={{ color: "inherit" }}>
                {t.landing.footer.privacy}
              </Link>
              <span aria-hidden="true">·</span>
              <span>{t.landing.footer.terms}</span>
              <span aria-hidden="true">·</span>
              <a href={t.landing.footer.contactMailto} style={{ color: "inherit" }}>
                {t.landing.footer.contact}
              </a>
            </span>
          </div>
        </div>
      </div>

      {/* ===================== INQUIRY MODAL ===================== */}
      {showInquiry && (
        <div
          onClick={closeInquiry}
          className="tt-modal-backdrop"
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="tt-modal-card"
            style={{ width: 480, maxWidth: "100%", background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-xl)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column" }}
          >
            {/* gradient header */}
            <div className="tt-mhead-grad" style={{ position: "relative", padding: "26px 28px 22px", overflow: "hidden", flexShrink: 0 }}>
              <div className="tt-blob" style={{ position: "absolute", top: -46, right: -34, width: 170, height: 170, borderRadius: "50%", background: "rgba(255,255,255,.1)" }} />
              <div className="tt-blob" style={{ position: "absolute", bottom: -50, left: -20, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,.07)", animationDelay: "-4s" }} />
              <div onClick={closeInquiry} className="tt-close-btn" style={{ position: "absolute", top: 18, right: 18, width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 2 }}>
                <Icon name="x" size={18} />
              </div>
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 13 }}>
                <div className="tt-float" style={{ width: 46, height: 46, borderRadius: 13, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
                  <Icon name="calendar" size={24} />
                </div>
                <div>
                  <h3 style={{ font: "var(--fw-extrabold) var(--fs-h4)/1.1 var(--font-sans)", color: "#fff", margin: 0, letterSpacing: "-.02em" }}>{t.landing.inquiry.title}</h3>
                  <p style={{ font: "var(--fw-regular) var(--fs-body-sm)/1.35 var(--font-sans)", color: "rgba(255,255,255,.85)", margin: "5px 0 0" }}>{t.landing.inquiry.subtitle}</p>
                </div>
              </div>
            </div>

            <div style={{ padding: "22px 28px 26px", overflow: "auto" }}>
              {submitted ? (
                <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
                  <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 18px" }}>
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--success)", animation: "ttRingPop 1.1s ease-out infinite" }} />
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--success)", animation: "ttRingPop 1.1s ease-out .4s infinite" }} />
                    <div style={{ position: "relative", width: 72, height: 72, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", animation: "ttPopBadge .5s cubic-bezier(.34,1.5,.5,1) both" }}>
                      <Icon name="checkCircle" size={36} />
                    </div>
                  </div>
                  <h3 style={{ font: "var(--fw-bold) var(--fs-h5)/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 8px" }}>{t.landing.inquiry.successTitle}</h3>
                  <p style={{ font: "var(--fw-regular) var(--fs-body-md)/1.5 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 22px" }}>
                    {t.landing.inquiry.successBody}
                  </p>
                  <Button variant="primary" fullWidth onClick={closeInquiry}>
                    {t.landing.inquiry.successDone}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="tt-stagger" style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                      {inquiryPerks.map((p) => (
                        <div key={p} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "8px 9px", borderRadius: "var(--radius-md)", background: "var(--surface-page)", border: "1px solid var(--border-subtle)" }}>
                          <span style={{ color: "var(--success)", display: "flex", flexShrink: 0 }}><Icon name="check" size={14} /></span>
                          <span style={{ font: "var(--fw-semibold) 11.5px/1.2 var(--font-sans)", color: "var(--text-body)" }}>{p}</span>
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
                    <div>
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
                    </div>
                  </div>
                  {formError && (
                    <div style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--error)", marginTop: 14 }}>
                      {formError}
                    </div>
                  )}
                  <div style={{ marginTop: 22 }}>
                    <Button variant="primary" fullWidth trailingIcon="arrowRight" onClick={submitInquiry} disabled={submitting}>
                      {submitting ? t.landing.inquiry.submitting : t.landing.inquiry.submit}
                    </Button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14 }}>
                    <span style={{ color: "var(--text-subtle)", display: "flex" }}><Icon name="checkCircle" size={14} /></span>
                    <p style={{ font: "var(--fw-regular) var(--fs-body-sm)/1.4 var(--font-sans)", color: "var(--text-subtle)", margin: 0 }}>
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

function avatarStyle(bg: string, fg: string, ml: number): React.CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: bg,
    border: "2px solid #fff",
    marginLeft: ml,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "var(--fw-bold) 12px var(--font-sans)",
    color: fg,
  };
}

function bulletIconStyle(bg: string, fg: string): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: bg,
    color: fg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}
