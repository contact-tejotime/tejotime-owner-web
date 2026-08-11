"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import PhoneField from "@/components/PhoneField";
import { SupportContact } from "@/components/SupportContact";
import {
  combineToDigits,
  DEFAULT_DIAL_CODE,
  DEFAULT_ISO2,
} from "@/lib/phone";

type AccountType = "owner" | "staff";

const COPY: Record<AccountType, { title: string; sub: string }> = {
  owner: {
    title: "Owner sign in",
    sub: "For the business owner and co-owners. Full access to the shop.",
  },
  staff: {
    title: "Staff sign in",
    sub: "For team members. You will see your own chair and whatever the owner has shared.",
  },
};

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
        setError(json?.error?.message ?? "Could not sign in. Check your number and password.");
        return;
      }
      // Where to land depends on what this account can open — a staff member with no
      // dashboard access would otherwise be bounced straight into a "No access" page.
      router.replace(typeof json?.landingPath === "string" ? json.landingPath : "/dashboard");
      // The (app) layout reads the session on the server, so the cache has to be dropped.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo.png" alt="TejoTime" />
        </div>

        <form onSubmit={onSubmit}>
          <div className="segmented" role="group" aria-label="Account type">
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
                {type === "owner" ? "Owner" : "Staff"}
              </button>
            ))}
          </div>

          <h1 className="login-title">{COPY[accountType].title}</h1>
          <p className="login-sub">{COPY[accountType].sub}</p>

          {error ? (
            <div className="alert err" role="alert">
              {error}
            </div>
          ) : null}

          <PhoneField
            id="phone"
            label="Mobile number"
            placeholder="Phone number"
            autoFocus
            value={{ dialCode: phoneCountry.dialCode, national, iso2: phoneCountry.iso2 }}
            onChange={(v) => {
              setPhoneCountry({ dialCode: v.dialCode, iso2: v.iso2 });
              setNational(v.national);
            }}
          />

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

          {accountType === "staff" ? (
            <p className="login-foot">
              Staff logins are created by your business owner. If you do not have one, ask them
              to add you under Settings → Team logins.
            </p>
          ) : null}

          <SupportContact variant="login" />
        </form>
      </div>
    </div>
  );
}
