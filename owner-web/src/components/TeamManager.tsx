"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useMemo, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import PhoneField from "@/components/PhoneField";
import {
  ACCESS_LABELS,
  CREATABLE_ROLES,
  GRANTABLE_MODULES,
  MODULE_LABELS,
  ROLE_LABELS,
  type Access,
  type Module,
  type ModuleAccess,
} from "@/lib/roles";
import {
  combineToDigits,
  DEFAULT_DIAL_CODE,
  DEFAULT_ISO2,
  formatPhone,
  isValidNational,
} from "@/lib/phone";
import type { StaffRow, TeamUser } from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import { Spinner } from "@/components/Skeleton";

/**
 * Team logins: who can sign in to this business, and what each of them sees.
 *
 * Three rules this screen exists to make obvious, all of which the backend enforces
 * independently:
 *   - the owner account cannot be edited or removed from here (it is the admin panel's),
 *   - a co-owner has the same access as the owner, so there is nothing to configure for one,
 *   - a staff login sees only the modules ticked here, and inside them only its own chair.
 */

type Draft = {
  name: string;
  dialCode: string;
  iso2: string;
  national: string;
  password: string;
  role: "co_owner" | "staff";
  staffId: string;
  permissions: Partial<Record<Module, Access>>;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  dialCode: DEFAULT_DIAL_CODE,
  iso2: DEFAULT_ISO2,
  national: "",
  password: "",
  role: "staff",
  staffId: "",
  permissions: {},
};

function errorFrom(json: unknown, fallback: string) {
  const message = (json as { error?: { message?: string } })?.error?.message;
  return message ?? fallback;
}

/**
 * The permission payload the API accepts: every grantable module, and nothing else.
 *
 * Both halves matter. Sending the full set means a module reset to its default disappears
 * from `user_permission` instead of lingering as a stale override. Sending *only* grantable
 * modules keeps `team` out — it is owner-role-only, so it is not a valid key and the whole
 * request is rejected if it appears.
 */
function toPermissionPayload(draft: Partial<Record<Module, Access>>): Record<string, Access> {
  return Object.fromEntries(GRANTABLE_MODULES.map((m) => [m, draft[m] ?? "none"]));
}

export function TeamManager({
  users,
  staff,
  staffDefaults,
  currentUserId,
}: {
  users: TeamUser[];
  staff: StaffRow[];
  /**
   * The role defaults a new staff login starts from, straight from the backend catalogue.
   * Grantable modules only — `team` is owner-role-only and is never part of a draft.
   */
  staffDefaults: Partial<Record<Module, Access>>;
  currentUserId: string;
}) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<string | null>(null);
  const [permDraft, setPermDraft] = useState<Partial<Record<Module, Access>>>({});
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Which custom dialog is open, if any. Replaces window.confirm / window.prompt. */
  const [dialog, setDialog] = useState<{ kind: "deactivate" | "password"; user: TeamUser } | null>(
    null,
  );

  // A chair that already backs a login cannot back another — the database has a unique index
  // on it, so offering a taken seat would only produce a 409 after the form was filled in.
  const linkedSeatIds = useMemo(
    () => new Set(users.map((u) => u.staffId).filter(Boolean) as string[]),
    [users],
  );
  const freeSeats = staff.filter((s) => s.isActive && !linkedSeatIds.has(s.id));

  async function send(url: string, method: string, body?: unknown, fallback = t.team.genericError) {
    setInFlight(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorFrom(json, fallback));
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError(t.team.networkError);
      return false;
    } finally {
      setInFlight(false);
    }
  }

  function startAdd(role: "co_owner" | "staff") {
    if (role === "staff" && freeSeats.length === 0) {
      setError(t.team.noFreeSeats);
      return;
    }
    setEditing(null);
    setAdding(true);
    setError("");
    setNotice("");
    // Pre-fill a staff draft with the role's own defaults, so the owner is adjusting a
    // sensible starting point rather than ticking eleven boxes from nothing.
    // Staff must pick a chair — default to the first free one so the form is valid.
    setDraft({
      ...EMPTY_DRAFT,
      role,
      staffId: role === "staff" ? (freeSeats[0]?.id ?? "") : "",
      permissions: role === "staff" ? { ...staffDefaults } : {},
    });
  }

  async function onCreate() {
    if (!draft.name.trim()) return setError(t.team.errName);
    if (!isValidNational(draft.national, draft.iso2)) {
      return setError(t.team.errPhone);
    }
    if (draft.password.length < 8) return setError(t.team.errPassword);
    if (draft.role === "staff" && !draft.staffId) {
      return setError(t.team.errSeat);
    }

    const ok = await send(
      "/api/users",
      "POST",
      {
        name: draft.name.trim(),
        phone: combineToDigits(draft.dialCode, draft.national),
        password: draft.password,
        role: draft.role,
        staffId: draft.role === "staff" ? draft.staffId : null,
        ...(draft.role === "staff" ? { permissions: toPermissionPayload(draft.permissions) } : {}),
      },
      t.team.errCreate,
    );
    if (ok) {
      setAdding(false);
      setDraft(EMPTY_DRAFT);
      setNotice(t.team.okCreate);
    }
  }

  function startEditPermissions(user: TeamUser) {
    setAdding(false);
    setEditing(user.id);
    setError("");
    setNotice("");
    setPermDraft({ ...user.permissions });
  }

  async function onSavePermissions(userId: string) {
    const ok = await send(
      `/api/users/${userId}/permissions`,
      "PUT",
      { permissions: toPermissionPayload(permDraft) },
      t.team.errPermissions,
    );
    if (ok) {
      setEditing(null);
      setNotice(t.team.okPermissions);
    }
  }

  async function onToggleActive(user: TeamUser) {
    if (user.isActive) {
      // Confirmed through our own dialog — see ConfirmDialog for why window.confirm is not
      // acceptable for something that signs a person out everywhere.
      setDialog({ kind: "deactivate", user });
      return;
    }
    await send(`/api/users/${user.id}`, "PATCH", { isActive: true }, t.team.errReactivate);
  }

  /**
   * Link or move a staff login's chair.
   *
   * This exists because without it the team screen could create a stranded account and offer no
   * way back: an unlinked staff login matches no queue entries and no appointments, so every
   * screen it can open is permanently empty, and the only person who can fix that is the owner
   * looking at this list.
   */
  async function onChangeSeat(user: TeamUser, staffId: string) {
    if (!staffId) {
      setError(t.team.errSeatRequired);
      return;
    }
    const ok = await send(
      `/api/users/${user.id}`,
      "PATCH",
      { staffId },
      t.team.errChangeSeat,
    );
    if (ok) {
      setNotice(t.team.okChangeSeat);
    }
  }

  function onResetPassword(user: TeamUser) {
    setDialog({ kind: "password", user });
  }

  /** Runs whichever dialog is open. Kept in one place so both paths close the same way. */
  async function onDialogConfirm(value: string) {
    if (!dialog) return;
    if (dialog.kind === "deactivate") {
      const ok = await send(
        `/api/users/${dialog.user.id}`,
        "DELETE",
        undefined,
        t.team.errDeactivate,
      );
      if (ok) {
        setDialog(null);
        showToast(format(t.team.turnedOffToast, { name: dialog.user.name ?? t.team.thatLogin }), "success");
      }
      return;
    }
    const ok = await send(
      `/api/users/${dialog.user.id}/password`,
      "POST",
      { password: value },
      t.team.errResetPassword,
    );
    if (ok) {
      setDialog(null);
      showToast(t.team.okResetPassword, "success");
    }
  }

  return (
    <div className="team-manager">
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

      <div className="team-list">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          const locked = user.isSuperOwner || isSelf;
          return (
            <article key={user.id} className={`team-card ${user.isActive ? "" : "inactive"}`}>
              <div className="team-card-top">
                <div>
                  <div className="nm">
                    {user.name ?? "—"}
                    {user.isSuperOwner ? <span className="pill-badge">{t.team.badgeOwnerAccount}</span> : null}
                    {isSelf && !user.isSuperOwner ? <span className="pill-badge">{t.team.badgeYou}</span> : null}
                    {!user.isActive ? <span className="pill-badge muted">{t.team.badgeTurnedOff}</span> : null}
                    {user.role === "staff" && user.isActive && !user.staffId ? (
                      <span className="pill-badge warn">{t.team.badgeNoChair}</span>
                    ) : null}
                  </div>
                  <div className="meta">
                    {ROLE_LABELS[user.role]}
                    {user.staffName ? ` ${format(t.team.metaChair, { name: user.staffName })}` : ""}
                    {user.phone ? ` ${format(t.team.metaPhone, { phone: formatPhone(user.phone) })}` : ""}
                  </div>
                </div>
                {!locked ? (
                  <div className="team-card-actions">
                    {user.role === "staff" ? (
                      <button
                        type="button"
                        className="btn small secondary"
                        onClick={() => startEditPermissions(user)}
                        disabled={busy}
                      >
                        {t.team.permissions}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn small secondary"
                      onClick={() => onResetPassword(user)}
                      disabled={busy}
                    >
                      {t.team.resetPassword}
                    </button>
                    <button
                      type="button"
                      className="btn small secondary"
                      onClick={() => onToggleActive(user)}
                      disabled={busy}
                    >
                      {user.isActive ? t.team.turnOff : t.team.turnOn}
                    </button>
                  </div>
                ) : null}
              </div>

              {user.role === "staff" && !locked ? (
                <div className={`seat-link ${user.staffId ? "" : "warn"}`}>
                  <label htmlFor={`seat-${user.id}`}>{t.team.chair}</label>
                  <select
                    id={`seat-${user.id}`}
                    value={user.staffId ?? ""}
                    onChange={(e) => onChangeSeat(user, e.target.value)}
                    disabled={busy}
                    required
                  >
                    {!user.staffId ? (
                      <option value="" disabled>
                        {t.team.pickChair}
                      </option>
                    ) : null}
                    {/* Their own chair stays in the list; every other taken chair does not. */}
                    {staff
                      .filter((s) => s.id === user.staffId || (s.isActive && !linkedSeatIds.has(s.id)))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  {!user.staffId ? (
                    <span className="seat-link-warn">
                      {t.team.pickChairWarn}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {user.role === "staff" ? (
                editing === user.id ? (
                  <div className="perm-editor">
                    <PermissionGrid value={permDraft} onChange={setPermDraft} />
                    <div className="perm-editor-actions">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => onSavePermissions(user.id)}
                        disabled={busy}
                      >
                        {busy ? (
                          <>
                            <Spinner size={13} />
                            {t.team.saving}
                          </>
                        ) : (
                          t.team.savePermissions
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn small secondary"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                      >
                        {t.team.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="team-card-summary">{summarise(user.permissions)}</p>
                )
              ) : (
                <p className="team-card-summary">
                  {user.isSuperOwner
                    ? t.team.superOwnerSummary
                    : t.team.coOwnerSummary}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {adding ? (
        <div className="team-add">
          <h2>{t.team.addTitle}</h2>

          <div className="role-choice">
            {CREATABLE_ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`role-choice-btn ${draft.role === r.value ? "active" : ""}`}
                onClick={() => {
                  if (r.value === "staff" && freeSeats.length === 0) {
                    setError(t.team.noFreeSeatsShort);
                    return;
                  }
                  setDraft((d) => ({
                    ...d,
                    role: r.value,
                    staffId:
                      r.value === "staff" ? d.staffId || freeSeats[0]?.id || "" : "",
                    permissions: r.value === "staff" ? { ...staffDefaults } : {},
                  }));
                }}
              >
                <span className="nm">{r.label}</span>
                <span className="sub">{r.blurb}</span>
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="team-name">{t.team.nameLabel}</label>
            <input
              id="team-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>

          <PhoneField
            id="team-phone"
            label={t.team.phoneLabel}
            placeholder={t.team.phonePlaceholder}
            value={{
              dialCode: draft.dialCode,
              national: draft.national,
              iso2: draft.iso2,
            }}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                dialCode: v.dialCode,
                national: v.national,
                iso2: v.iso2,
              }))
            }
            hint={<p className="field-hint">{t.team.phoneHint}</p>}
          />

          <div className="field">
            <label htmlFor="team-password">{t.team.passwordLabel}</label>
            <input
              id="team-password"
              type="text"
              value={draft.password}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
            />
            <p className="field-hint">{t.team.passwordHint}</p>
          </div>

          {draft.role === "staff" ? (
            <>
              <div className="field">
                <label htmlFor="team-seat">{t.team.seatLabel}</label>
                <select
                  id="team-seat"
                  value={draft.staffId}
                  onChange={(e) => setDraft((d) => ({ ...d, staffId: e.target.value }))}
                  required
                >
                  {freeSeats.length === 0 ? (
                    <option value="">{t.team.noFreeChairsOption}</option>
                  ) : (
                    freeSeats.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
                <p className="field-hint">
                  {t.team.seatHint}
                </p>
              </div>

              <div className="field">
                <label>{t.team.permissionsLabel}</label>
                <PermissionGrid
                  value={draft.permissions}
                  onChange={(permissions) => setDraft((d) => ({ ...d, permissions }))}
                />
              </div>
            </>
          ) : (
            <p className="field-hint">
              {t.team.coOwnerHint}
            </p>
          )}

          <div className="perm-editor-actions">
            <button type="button" className="btn" onClick={onCreate} disabled={busy}>
              {busy ? (
                <>
                  <Spinner size={14} />
                  {t.team.creating}
                </>
              ) : (
                t.team.createLogin
              )}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
              disabled={busy}
            >
              {t.team.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="team-add-actions">
          <button
            type="button"
            className="btn"
            onClick={() => startAdd("staff")}
            disabled={busy || freeSeats.length === 0}
            title={
              freeSeats.length === 0
                ? t.team.noFreeSeatsTitle
                : undefined
            }
          >
            <Icon name="user" size={16} color="#fff" />
            {t.team.addStaffLogin}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => startAdd("co_owner")}
            disabled={busy}
          >
            {t.team.addCoOwner}
          </button>
          {freeSeats.length === 0 ? (
            <p className="field-hint" style={{ width: "100%", margin: 0 }}>
              {t.team.allSeatsLinked}
            </p>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        key={dialog ? `${dialog.kind}:${dialog.user.id}` : "none"}
        open={!!dialog}
        title={dialog?.kind === "password" ? t.team.dlgResetTitle : t.team.dlgDeactivateTitle}
        body={
          dialog?.kind === "password"
            ? format(t.team.dlgResetBody, { name: dialog.user.name ?? t.team.them })
            : format(t.team.dlgDeactivateBody, { name: dialog?.user.name ?? t.team.them })
        }
        confirmLabel={dialog?.kind === "password" ? t.team.dlgConfirmReset : t.team.dlgConfirmDeactivate}
        destructive={dialog?.kind === "deactivate"}
        input={
          dialog?.kind === "password"
            ? { label: t.team.dlgNewPassword, type: "text", hint: t.team.dlgNewPasswordHint, minLength: 8 }
            : undefined
        }
        busy={busy}
        onConfirm={onDialogConfirm}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

/** A one-line "what they can see" for the collapsed card. */
function summarise(access: ModuleAccess): string {
  const visible = GRANTABLE_MODULES.filter((m) => access[m] && access[m] !== "none");
  if (visible.length === 0) return t.team.noAccessYet;
  return format(t.team.canSee, { modules: visible.map((m) => MODULE_LABELS[m]).join(", ") });
}

function PermissionGrid({
  value,
  onChange,
}: {
  value: Partial<Record<Module, Access>>;
  onChange: (next: Partial<Record<Module, Access>>) => void;
}) {
  return (
    <div className="perm-grid">
      {GRANTABLE_MODULES.map((mod) => (
        <div key={mod} className="perm-row">
          <span className="perm-row-label">{MODULE_LABELS[mod]}</span>
          <div className="perm-row-options">
            {(["none", "view", "manage"] as Access[]).map((level) => (
              <button
                key={level}
                type="button"
                className={`perm-chip ${(value[mod] ?? "none") === level ? "active" : ""}`}
                aria-pressed={(value[mod] ?? "none") === level}
                onClick={() => onChange({ ...value, [mod]: level })}
              >
                {ACCESS_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
