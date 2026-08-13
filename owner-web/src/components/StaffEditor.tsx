"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { useState, useTransition } from "react";

import { Icon } from "@/components/Icon";
import type { StaffRow } from "@/lib/server-api";
import { Spinner } from "@/components/Skeleton";

/**
 * Team members. Each staff row is a QUEUE SEAT, not a login — creating one here does not create
 * an account, and the microsite shows them as bookable. Logins arrive with the multi-user work.
 *
 * Removing 409s while the seat still has live queue entries; that message is surfaced as-is
 * rather than second-guessed, because the backend is the one that knows.
 */
export function StaffEditor({ staff }: { staff: StaffRow[] }) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [error, setError] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  async function send(url: string, method: string, body?: unknown) {
    setError("");
    setInFlight(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? t.common.thatDidntWork);
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError(t.staffEditor.networkError);
      return false;
    } finally {
      setInFlight(false);
    }
  }

  async function add() {
    if (!name.trim()) return setError(t.staffEditor.errName);
    const ok = await send("/api/staff", "POST", {
      name: name.trim(),
      roleLabel: roleLabel.trim() || undefined,
    });
    if (ok) {
      setName("");
      setRoleLabel("");
    }
  }

  return (
    <div className="section">
      <h2>{t.staffEditor.title}</h2>
      {staff.length === 0 ? (
        <p className="empty">{t.staffEditor.empty}</p>
      ) : (
        <ul className="home-queue-list">
          {staff.map((s) => (
            <li key={s.id} className="home-queue-card">
              <div className="title">{s.name}</div>
              <div className="meta">
                {[s.roleLabel, s.acceptsWalkIns ? t.staffEditor.takesWalkIns : t.staffEditor.appointmentsOnly]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <button
                type="button"
                className="btn secondary btn-sm"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={() => send(`/api/staff/${s.id}`, "DELETE")}
              >
                <Icon name="trash" size={14} /> {t.staffEditor.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 24 }}>{t.staffEditor.addTitle}</h2>
      <div className="field">
        <label htmlFor="st-name">{t.staffEditor.nameLabel}</label>
        <input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.staffEditor.namePlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="st-role">{t.staffEditor.roleLabel}</label>
        <input
          id="st-role"
          value={roleLabel}
          onChange={(e) => setRoleLabel(e.target.value)}
          placeholder={t.staffEditor.rolePlaceholder}
        />
      </div>

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}

      <button type="button" className="btn" onClick={add} disabled={busy}>
        {busy ? (
          <>
            <Spinner size={14} />
            {t.common.savingEllipsis}
          </>
        ) : (
          t.staffEditor.add
        )}
      </button>
    </div>
  );
}
