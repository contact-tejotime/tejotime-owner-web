"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PhoneField from "@/components/ui/PhoneField";
import { combineToDigits, DEFAULT_DIAL_CODE, DEFAULT_ISO2, formatPhone } from "@/lib/phone";
import { t } from "@/i18n";
import { Icon } from "@/components/icons";
import Spinner from "@/components/ui/Spinner";

type Step = "mobile" | "otp";

/** Pull a human-readable message out of the backend's { error: { message } } envelope. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("mobile");
  const [phoneCountry, setPhoneCountry] = useState({ dialCode: DEFAULT_DIAL_CODE, iso2: DEFAULT_ISO2 });
  const [national, setNational] = useState("");
  // Combined bare digits (`<cc><national>`), matched against admins.mobile on the backend.
  const mobile = combineToDigits(phoneCountry.dialCode, national);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin-auth/request-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, t.login.otpSendError));
        return;
      }
      setStep("otp");
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch {
      setError(t.login.networkError);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin-auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile, otp }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, t.login.otpVerifyError));
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
          <span className="brand-mark">
            <img src="/logo.png" alt={t.common.brandAlt} />
          </span>
          <span className="brand-name">
            {t.nav.brandName}
            <span className="brand-sub">{t.nav.brandBadge}</span>
          </span>
        </div>

        {step === "mobile" ? (
          <form onSubmit={requestOtp}>
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
            <button className="btn-primary login-btn" type="submit" disabled={busy || !national.trim()} aria-busy={busy || undefined}>
              {busy && <Spinner className="btn-spinner" />}
              {busy ? t.login.sending : t.login.sendOtp}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <h1 className="login-title">{t.login.enterCode}</h1>
            <p className="login-sub">
              {t.login.otpSentTo} <strong>{formatPhone(mobile)}</strong>.
            </p>
            {error && (
              <div className="alert err" role="alert">
                {error}
              </div>
            )}
            <label htmlFor="otp">{t.login.otpLabel}</label>
            <input
              id="otp"
              ref={otpRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={t.login.otpPlaceholder}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              required
            />
            {process.env.NODE_ENV !== "production" && (
              <div className="hint">
                {t.login.demoOtpLabel} <code>{t.login.demoOtpCode}</code>
              </div>
            )}
            <button className="btn-primary login-btn" type="submit" disabled={busy || otp.length < 4} aria-busy={busy || undefined}>
              {busy && <Spinner className="btn-spinner" />}
              {busy ? t.login.verifying : t.login.verify}
            </button>
            <button
              type="button"
              className="login-link"
              onClick={() => {
                setStep("mobile");
                setOtp("");
                setError("");
              }}
            >
              <Icon name="chevronLeft" size={15} style={{ display: "inline-block", verticalAlign: "-0.15em" }} />{" "}
              {t.login.useDifferentNumber}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
