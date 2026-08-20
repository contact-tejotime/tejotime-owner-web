"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PhoneField from "@/components/ui/PhoneField";
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from "@/lib/phone";
import { t } from "@/i18n";
import Spinner from "@/components/ui/Spinner";
import { Icon } from "@/components/icons";
import { SUPPORT } from "@/lib/support";

/** Pull a human-readable message out of the backend's { error: { message } } envelope. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? fallback;
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

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand login-brand">
          <img className="brand-logo" src="/logo.png?v=2" alt={t.common.brandAlt} />
        </div>

        <form onSubmit={signIn}>
          <h1 className="login-title">{t.login.signIn}</h1>
          <p className="login-sub">{t.login.mobilePrompt}</p>
          {error && (
            <div className="alert err" role="alert">
              {error}
            </div>
          )}
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
          <label htmlFor="password" className="password-label">
            {t.login.passwordLabel}
          </label>
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
              <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
            </button>
          </div>
          <button
            className="btn-primary login-btn"
            type="submit"
            disabled={busy || !national.trim() || !password}
            aria-busy={busy || undefined}
          >
            {busy && <Spinner className="btn-spinner" />}
            {busy ? t.login.signingIn : t.login.continue}
          </button>
        </form>
      </div>
      <div className="login-support">
        <p className="login-support-label">{t.login.needHelp}</p>
        <div className="login-support-links">
          <a href={`mailto:${SUPPORT.email}`} aria-label={t.login.supportEmail}>
            {SUPPORT.email}
          </a>
          <span aria-hidden="true">·</span>
          <a href={`tel:${SUPPORT.phoneTel}`} aria-label={t.login.supportCall}>
            {SUPPORT.phoneDisplay}
          </a>
        </div>
      </div>
    </div>
  );
}
