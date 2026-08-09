"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, session, ready } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace("/dashboard");
  }, [ready, session, router]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const result = login(phone, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo.png" alt="TejoTime" />
        </div>

        <form onSubmit={onSubmit}>
          <h1 className="login-title">Sign in</h1>
          <p className="login-sub">Business login — same account as the TejoTime owner app.</p>

          {error ? (
            <div className="alert err" role="alert">
              {error}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button type="submit" className="btn block" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="hint">UI demo: any phone (10+ digits) and password (4+ chars) works.</p>
        </form>
      </div>
    </div>
  );
}
