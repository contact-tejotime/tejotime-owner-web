"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";

import { Spinner } from "@/components/Skeleton";
import { showToast } from "@/lib/toast";
import "@/styles/settings-a.css";

/**
 * Change your own password — the app's `settings/password.tsx`: three fields and one full-width
 * button, with feedback by toast.
 *
 * Every login except the super owner's is created by somebody else, who therefore knows the
 * initial password — so this is the first thing a new co-owner or staff member should do. The
 * current password is required, so a borrowed unlocked screen cannot lock the real owner out.
 *
 * Mounted by /settings/account (the hub's "Your account" row) and Profile's account fold.
 *   variant="section" (default) → a `.section` card with its own heading; stays put after a
 *                       success with the fields cleared.
 *   variant="page"    → bare fields for a page whose header already names it, as the app's
 *                       password screen does; a success goes to `returnTo`, as the app pops back.
 */
export function ChangePasswordForm({
  variant = "section",
  returnTo,
}: {
  variant?: "page" | "section";
  returnTo?: string;
}) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) return showToast(t.password.tooShort, "error");
    if (newPassword !== confirm) return showToast(t.password.mismatch, "error");

    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json?.error?.message ?? t.password.errChange, "error");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      showToast(t.password.changed, "success");
      if (variant === "page" && returnTo) router.push(returnTo);
    } catch {
      showToast(t.password.networkError, "error");
    } finally {
      setBusy(false);
    }
  }

  const page = variant === "page";

  return (
    <form className={page ? "sa-pw" : "section sa-pw"} onSubmit={onSubmit} noValidate>
      {page ? null : <h2>{t.password.title}</h2>}

      <div className="sa-field">
        <label htmlFor="cp-current">{t.password.current}</label>
        <input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="sa-field">
        <label htmlFor="cp-new">{t.password.new}</label>
        <input
          id="cp-new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={busy}
        />
        <p className="sa-hint">{t.password.hint}</p>
      </div>
      <div className="sa-field">
        <label htmlFor="cp-confirm">{t.password.confirm}</label>
        <input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
      </div>

      <button
        type="submit"
        className="sa-btn sa-btn--lg sa-btn--primary sa-btn--block"
        disabled={busy}
      >
        {busy ? <Spinner size={16} /> : null}
        {t.password.submit}
      </button>
    </form>
  );
}
