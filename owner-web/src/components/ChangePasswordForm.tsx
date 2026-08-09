"use client";

import { FormEvent, useState } from "react";
import { Spinner } from "@/components/Skeleton";

/**
 * Change your own password.
 *
 * Every login except the super owner's is created by somebody else, who therefore knows the
 * initial password — so this is the first thing a new co-owner or staff member should do. The
 * current password is required, so a borrowed unlocked screen cannot lock the real owner out.
 */
export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    if (newPassword.length < 8) return setError("Use at least 8 characters.");
    if (newPassword !== confirm) return setError("The two new passwords do not match.");

    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not change your password.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="section" onSubmit={onSubmit}>
      <h2>Change your password</h2>

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}
      {done ? (
        <div className="alert ok" role="status">
          Password changed.
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="cp-current">Current password</label>
        <input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="cp-new">New password</label>
        <input
          id="cp-new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <p className="field-hint">At least 8 characters.</p>
      </div>
      <div className="field">
        <label htmlFor="cp-confirm">Confirm new password</label>
        <input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <button type="submit" className="btn" disabled={busy}>
        {busy ? (
          <>
            <Spinner size={14} />
            Saving…
          </>
        ) : (
          "Change password"
        )}
      </button>
    </form>
  );
}
