"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Step = "mobile" | "otp";

/** Pull a human-readable message out of the backend's { error: { message } } envelope. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
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
        setError(await errorMessage(res, "Could not send OTP. Try again."));
        return;
      }
      setStep("otp");
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch {
      setError("Network error. Is the backend running?");
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
        setError(await errorMessage(res, "Incorrect OTP. Try again."));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand login-brand">
          <span className="dot" />
          TejoTime Admin
        </div>

        {step === "mobile" ? (
          <form onSubmit={requestOtp}>
            <h1 className="login-title">Sign in</h1>
            <p className="login-sub">Enter your registered mobile number to receive a one-time code.</p>
            {error && <div className="alert err">{error}</div>}
            <label htmlFor="mobile">Mobile number</label>
            <input
              id="mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 9399385943"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              required
              autoFocus
            />
            <button className="btn-primary login-btn" type="submit" disabled={busy || !mobile.trim()}>
              {busy ? "Sending…" : "Send OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <h1 className="login-title">Enter code</h1>
            <p className="login-sub">
              We sent a one-time code to <strong>{mobile}</strong>.
            </p>
            {error && <div className="alert err">{error}</div>}
            <label htmlFor="otp">One-time code</label>
            <input
              id="otp"
              ref={otpRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="4-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              required
            />
            <div className="hint">Demo OTP: <code>1234</code></div>
            <button className="btn-primary login-btn" type="submit" disabled={busy || otp.length < 4}>
              {busy ? "Verifying…" : "Verify & sign in"}
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
              ← Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
