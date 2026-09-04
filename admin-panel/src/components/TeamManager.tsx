"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminTeamMember } from "@/lib/types";
import { DEFAULT_DIAL_CODE, DEFAULT_ISO2, formatPhone } from "@/lib/phone";
import { t, format } from "@/i18n";
import PhoneField, { type PhoneValue } from "@/components/ui/PhoneField";
import Spinner from "@/components/ui/Spinner";

/**
 * The owner's view of who can sign in.
 *
 * Employees are added, renamed, password-reset and deactivated — never deleted. A store points
 * at its creator, so removing the row would either orphan those stores or cascade them away;
 * deactivating revokes the login and leaves the attribution intact.
 *
 * The owner row is rendered read-only. The backend refuses to edit it (there is no second
 * channel to recover a locked-out platform), so offering the buttons would only produce a 403.
 */
export default function TeamManager({ initialMembers }: { initialMembers: AdminTeamMember[] }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState<PhoneValue>({ dialCode: DEFAULT_DIAL_CODE, national: "", iso2: DEFAULT_ISO2 });
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim().length > 0 && phone.national.length >= 6 && password.length >= 6;

  function resetForm() {
    setName("");
    setPhone({ dialCode: DEFAULT_DIAL_CODE, national: "", iso2: DEFAULT_ISO2 });
    setPassword("");
  }

  async function send(url: string, method: "POST" | "PATCH", body: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? t.team.errGeneric);
    return json;
  }

  async function addEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created: AdminTeamMember = await send("/api/admins", "POST", {
        name: name.trim(),
        mobile: `${phone.dialCode}${phone.national}`,
        password,
      });
      setMembers((m) => [...m, created]);
      setNotice(format(t.team.added, { name: created.name }));
      resetForm();
      setAdding(false);
      // The sidebar store list is unaffected, but the server page's cached admin list is not.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.team.errGeneric);
    } finally {
      setSaving(false);
    }
  }

  async function patch(member: AdminTeamMember, body: Record<string, unknown>, done: string) {
    setBusyId(member.id);
    setError("");
    setNotice("");
    try {
      const updated: AdminTeamMember = await send(`/api/admins/${member.id}`, "PATCH", body);
      setMembers((m) => m.map((x) => (x.id === member.id ? { ...x, ...updated } : x)));
      setNotice(done);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.team.errGeneric);
    } finally {
      setBusyId(null);
    }
  }

  function toggleActive(member: AdminTeamMember) {
    if (member.isActive) {
      const ok = window.confirm(
        format(t.team.deactivateConfirm, { name: member.name, count: member.storesCount }),
      );
      if (!ok) return;
    }
    void patch(
      member,
      { isActive: !member.isActive },
      format(member.isActive ? t.team.deactivated : t.team.reactivated, { name: member.name }),
    );
  }

  function resetPassword(member: AdminTeamMember) {
    const next = window.prompt(format(t.team.resetPasswordPrompt, { name: member.name }));
    if (!next) return;
    void patch(member, { password: next }, format(t.team.resetPasswordDone, { name: member.name }));
  }

  return (
    <>
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>{t.team.title}</h1>
          <p>{t.team.subtitle}</p>
        </div>
        {!adding && (
          <button type="button" className="btn-add" onClick={() => setAdding(true)}>
            {t.team.addEmployee}
          </button>
        )}
      </div>

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="alert ok" role="status">
          {notice}
        </div>
      ) : null}

      {adding && (
        <section className="section">
          <h2>{t.team.formTitle}</h2>
          <p className="hint">{t.team.formHint}</p>
          <form onSubmit={addEmployee}>
            <div className="grid">
              <div className="field">
                <label htmlFor="tm-name">{t.team.fieldName}</label>
                <input
                  id="tm-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.team.fieldNamePlaceholder}
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <PhoneField id="tm-phone" label={t.team.fieldMobile} required value={phone} onChange={setPhone} />
              </div>
              <div className="field">
                <label htmlFor="tm-password">{t.team.fieldPassword}</label>
                <input
                  id="tm-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  maxLength={72}
                  required
                />
                <p className="hint">{t.team.fieldPasswordHint}</p>
              </div>
            </div>
            <div className="profile-actions" style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button type="submit" className="btn-primary" disabled={!canSubmit || saving} aria-busy={saving || undefined}>
                {saving ? <Spinner /> : null}
                {saving ? t.team.submitting : t.team.submit}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setAdding(false);
                  resetForm();
                }}
              >
                {t.team.cancel}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="section">
        <div className="table-wrap">
          <table className="store-table">
            <thead>
              <tr>
                <th>{t.team.colName}</th>
                <th>{t.team.colMobile}</th>
                <th>{t.team.colRole}</th>
                <th className="num">{t.team.colStores}</th>
                <th>{t.team.colStatus}</th>
                <th>{t.team.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-note">
                    {t.team.empty}
                  </td>
                </tr>
              )}
              {members.map((m) => {
                const isOwner = m.role === "owner";
                const busy = busyId === m.id;
                return (
                  <tr key={m.id}>
                    <td className="nm">{m.name}</td>
                    <td>{formatPhone(m.mobile)}</td>
                    <td>
                      <span className={`badge ${isOwner ? "badge-vip" : "badge-inactive"}`}>
                        {isOwner ? t.team.roleOwner : t.team.roleEmployee}
                      </span>
                    </td>
                    <td className="num">{m.storesCount}</td>
                    <td>{m.isActive ? t.team.statusActive : t.team.statusInactive}</td>
                    <td>
                      {isOwner ? (
                        <span className="hint">{t.team.ownerLocked}</span>
                      ) : (
                        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="btn-ghost" disabled={busy} onClick={() => resetPassword(m)}>
                            {t.team.resetPassword}
                          </button>
                          <button type="button" className="btn-ghost" disabled={busy} onClick={() => toggleActive(m)}>
                            {m.isActive ? t.team.deactivate : t.team.reactivate}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
