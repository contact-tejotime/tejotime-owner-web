"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PhoneField from "@/components/PhoneField";
import { Icon } from "@/components/Icon";
import { format, t } from "@/i18n";
import { SUPPORT } from "@/lib/support";
import {
  combineToDigits,
  DEFAULT_DIAL_CODE,
  DEFAULT_ISO2,
} from "@/lib/phone";

type AccountType = "owner" | "staff";

type SlideRow = { name: string; line: string; badge: string; tone: string };
type Slide = { badge: string; headline: string; sub: string; meta: string; rows: SlideRow[] };

const COPY: Record<AccountType, { title: string; sub: string }> = {
  owner: { title: t.auth.ownerTitle, sub: t.auth.ownerSubtitle },
  staff: { title: t.auth.staffTitle, sub: t.auth.staffSubtitle },
};

/** Three angles on the same demo shop, rotated so the panel shows the product's range. */
const SLIDES = t.auth.slides as Slide[];
const SLIDE_MS = 4800;
const FADE_MS = 260;

/** "Sarah Johnson" → "SJ". Two letters max, so the circle never has to shrink its type. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/** Avatar tint keyed off the name, so a row keeps the same colour every time it comes round. */
function avatarClass(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return `av-${sum % 5}`;
}

/**
 * Sign-in for both kinds of account.
 *
 * The Owner/Staff switch is a guard rail, not a second credential — the password still decides
 * everything, and the backend re-checks the choice against the account's real role only AFTER
 * the password verifies. Its whole job is to turn a confusing "invalid credentials" into
 * "that's an owner login, pick Owner", which is the mistake people actually make once a shop
 * has both kinds.
 */
export default function LoginPage() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>("owner");
  const [phoneCountry, setPhoneCountry] = useState({
    dialCode: DEFAULT_DIAL_CODE,
    iso2: DEFAULT_ISO2,
  });
  const [national, setNational] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Brand panel carousel. It is decoration, so it never blocks the form: paused on hover,
  // and switched off entirely for anyone who asked for reduced motion.
  const [slide, setSlide] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((next: number) => {
    setFading(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setSlide(next);
      setFading(false);
    }, FADE_MS);
  }, []);

  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (paused) return;
    const id = setInterval(() => goTo((slide + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [goTo, paused, slide]);

  useEffect(() => () => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Bare digits (`<cc><national>`) match app_user.phone; the route strips non-digits too.
      const phone = combineToDigits(phoneCountry.dialCode, national);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, password, accountType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? t.auth.signInFailed);
        return;
      }
      // Where to land depends on what this account can open — a staff member with no
      // dashboard access would otherwise be bounced straight into a "No access" page.
      router.replace(typeof json?.landingPath === "string" ? json.landingPath : "/dashboard");
      // The (app) layout reads the session on the server, so the cache has to be dropped.
      router.refresh();
    } catch {
      setError(t.auth.networkError);
    } finally {
      setBusy(false);
    }
  }

  const current = SLIDES[slide];

  return (
    <div className="login-split">
      <aside
        className="login-brandpanel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <span className="login-dots-bg" aria-hidden />
        <span className="login-orb login-orb--top" aria-hidden />
        <span className="login-orb login-orb--bottom" aria-hidden />

        <span className="login-logochip login-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={t.auth.brandAlt} />
        </span>

        <div className="login-pitch">
          <div className="login-slide" style={{ opacity: fading ? 0 : 1 }}>
            <span className="login-eyebrow">
              <span className="login-eyebrow-dot" aria-hidden />
              {current.badge}
            </span>

            <h1 className="login-headline">{current.headline}</h1>
            <p className="login-subhead">{current.sub}</p>

            <div className="login-preview">
              <div className="login-preview-top">
                <span className="login-preview-store">{t.auth.slideStore}</span>
                <span className="login-preview-meta">
                  <span className="login-preview-meta-dot" aria-hidden />
                  {current.meta}
                </span>
              </div>
              {current.rows.map((row, i) => (
                <div className="login-preview-row" key={`${slide}-${i}`}>
                  <span className={`login-avatar ${avatarClass(row.name)}`} aria-hidden>
                    {initials(row.name)}
                  </span>
                  <span className="login-preview-who">
                    <span className="login-preview-name">{row.name}</span>
                    <span className="login-preview-line">{row.line}</span>
                  </span>
                  <span className={`login-badge tone-${row.tone}`}>{row.badge}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="login-dots">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`login-dot${i === slide ? " active" : ""}`}
                onClick={() => (i === slide ? undefined : goTo(i))}
                aria-label={format(t.auth.slideDot, { n: i + 1, total: SLIDES.length })}
              />
            ))}
          </div>
        </div>

        <div className="login-tagline login-in">
          <span aria-hidden />
          <p>{t.auth.brandFoot}</p>
          <span aria-hidden />
        </div>
      </aside>

      <main className="login-formcol">
        <div className="login-form">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login-formlogo login-in" src="/logo.png" alt={t.auth.brandAlt} />

          <form onSubmit={onSubmit}>
            <div className="segmented login-in" role="group" aria-label={t.auth.accountTypeLabel}>
              {(["owner", "staff"] as AccountType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`segmented-btn ${accountType === type ? "active" : ""}`}
                  aria-pressed={accountType === type}
                  onClick={() => {
                    setAccountType(type);
                    setError("");
                  }}
                >
                  {type === "owner" ? t.auth.owner : t.auth.staff}
                </button>
              ))}
            </div>

            <h2 className="login-title login-in">{COPY[accountType].title}</h2>
            <p className="login-sub login-in">{COPY[accountType].sub}</p>

            {error ? (
              <div className="alert err" role="alert">
                {error}
              </div>
            ) : null}

            <div className="login-fields login-in">
              <PhoneField
                id="phone"
                label={t.auth.phoneLabel}
                placeholder={t.auth.phonePlaceholder}
                autoFocus
                value={{ dialCode: phoneCountry.dialCode, national, iso2: phoneCountry.iso2 }}
                onChange={(v) => {
                  setPhoneCountry({ dialCode: v.dialCode, iso2: v.iso2 });
                  setNational(v.national);
                }}
              />

              <div className="field">
                <label htmlFor="password">{t.auth.passwordLabel}</label>
                <div className="password-field">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder={t.auth.passwordPlaceholder}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
                  </button>
                </div>
              </div>

              <button type="submit" className="btn block login-submit" disabled={busy}>
                {busy ? t.auth.signingIn : t.auth.signIn}
              </button>
            </div>

            <p
              className={"login-foot" + (accountType === "staff" ? " is-visible" : "")}
              aria-hidden={accountType !== "staff"}
            >
              {t.auth.staffFoot}
            </p>

            <div className="login-help login-in">
              <p className="login-help-title">{t.auth.helpTitle}</p>
              <div className="login-help-links">
                <a className="login-help-link" href={`mailto:${SUPPORT.email}`}>
                  <Icon name="mail" size={15} />
                  <span>{SUPPORT.email}</span>
                </a>
                <a className="login-help-link" href={`tel:${SUPPORT.phoneTel}`}>
                  <Icon name="phone" size={15} />
                  <span>{SUPPORT.phoneDisplay}</span>
                </a>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
