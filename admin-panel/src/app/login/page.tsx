"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PhoneField from "@/components/ui/PhoneField";
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from "@/lib/phone";
import { format, t } from "@/i18n";
import Spinner from "@/components/ui/Spinner";
import { Icon } from "@/components/icons";
import { SUPPORT } from "@/lib/support";

type SlideRow = { name: string; line: string; badge: string; tone: string };
type Slide = { badge: string; headline: string; sub: string; card: string; meta: string; rows: SlideRow[] };

/** Three angles on the console, rotated so the sign-in screen shows what's behind it. */
const SLIDES = t.login.slides as Slide[];
const SLIDE_MS = 4800;
const FADE_MS = 260;

/** Pull a human-readable message out of the backend's { error: { message } } envelope. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? fallback;
}

/** "Glow Salon & Spa" → "GS". Two letters max, so the circle never has to shrink its type. */
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

export default function LoginPage() {
  const router = useRouter();
  const [phoneCountry, setPhoneCountry] = useState({ dialCode: DEFAULT_DIAL_CODE, iso2: DEFAULT_ISO2 });
  const [national, setNational] = useState("");
  // Combined bare digits (`<cc><national>`), matched against admins.mobile on the backend.
  const mobile = combineToDigits(phoneCountry.dialCode, national);
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

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin-auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile, password }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, t.login.loginError));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t.login.networkError);
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
          <img src="/logo.png?v=2" alt={t.common.brandAlt} />
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
                <span className="login-preview-store">{current.card}</span>
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
                aria-label={format(t.login.slideDot, { n: i + 1, total: SLIDES.length })}
              />
            ))}
          </div>
        </div>

        <div className="login-tagline login-in">
          <span aria-hidden />
          <p>{t.login.brandFoot}</p>
          <span aria-hidden />
        </div>
      </aside>

      <main className="login-formcol">
        <div className="login-form">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login-formlogo login-in" src="/logo.png?v=2" alt={t.common.brandAlt} />

          <form onSubmit={signIn}>
            <h1 className="login-title login-in">{t.login.title}</h1>
            <p className="login-sub login-in">{t.login.subtitle}</p>

            {error && (
              <div className="alert err" role="alert">
                {error}
              </div>
            )}

            <div className="login-fields login-in">
              <PhoneField
                id="mobile"
                label={t.login.mobileLabel}
                placeholder={t.login.mobilePlaceholder}
                autoFocus
                value={{ dialCode: phoneCountry.dialCode, national, iso2: phoneCountry.iso2 }}
                onChange={(v) => {
                  setPhoneCountry({ dialCode: v.dialCode, iso2: v.iso2 });
                  setNational(v.national);
                }}
              />

              <div className="field">
                <label htmlFor="password">{t.login.passwordLabel}</label>
                <div className="password-field">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder={t.login.passwordPlaceholder}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
                  </button>
                </div>
              </div>

              <button
                className="btn-primary login-submit"
                type="submit"
                disabled={busy || !national.trim() || !password}
                aria-busy={busy || undefined}
              >
                {busy && <Spinner className="btn-spinner" />}
                {busy ? t.login.signingIn : t.login.continue}
              </button>
            </div>

            <div className="login-help login-in">
              <p className="login-help-title">{t.login.helpTitle}</p>
              <div className="login-help-links">
                <a className="login-help-link" href={`mailto:${SUPPORT.email}`} aria-label={t.login.supportEmail}>
                  <Icon name="mail" size={15} />
                  <span>{SUPPORT.email}</span>
                </a>
                <a className="login-help-link" href={`tel:${SUPPORT.phoneTel}`} aria-label={t.login.supportCall}>
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
