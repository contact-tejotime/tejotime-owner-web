"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useId, useMemo, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import PhoneField from "@/components/PhoneField";
import { Spinner } from "@/components/Skeleton";
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
import "@/styles/settings-a.css";

/**
 * Team logins: who can sign in to this business, and what each of them sees. The web twin of the
 * app's `settings/team.tsx` — same cards, same order, same chips, same wording.
 *
 * Three rules this screen exists to make obvious, all of which the backend enforces
 * independently:
 *   - the owner account cannot be edited or removed from here (it is the admin panel's),
 *   - a co-owner has the same access as the owner, so there is nothing to configure for one,
 *   - a staff login sees only the modules ticked here, and inside them only its own chair.
 *
 * Feedback is by toast, as on the app. It used to be an alert pinned above the list, which on a
 * long team was off-screen from the button that caused it.
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

/** Staff first, as on the app: it is the login an owner adds far more often. */
const ROLE_CHOICES = (["staff", "co_owner"] as const).map(
  (value) => CREATABLE_ROLES.find((r) => r.value === value)!,
);

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
  const idBase = useId();
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
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(errorFrom(json, fallback), "error");
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      showToast(t.team.networkError, "error");
      return false;
    } finally {
      setInFlight(false);
    }
  }

  function startAdd(role: "co_owner" | "staff") {
    if (role === "staff" && freeSeats.length === 0) {
      showToast(t.team.allSeatsLinked, "error");
      return;
    }
    setEditing(null);
    setAdding(true);
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

  function pickRole(role: "co_owner" | "staff") {
    if (role === "staff" && freeSeats.length === 0) {
      showToast(t.team.allSeatsLinked, "error");
      return;
    }
    setDraft((d) => ({
      ...d,
      role,
      staffId: role === "staff" ? d.staffId || freeSeats[0]?.id || "" : "",
      permissions: role === "staff" ? { ...staffDefaults } : {},
    }));
  }

  async function onCreate() {
    if (!draft.name.trim()) return showToast(t.team.errName, "error");
    if (!isValidNational(draft.national, draft.iso2)) {
      return showToast(t.team.errPhone, "error");
    }
    if (draft.password.length < 8) return showToast(t.team.errPassword, "error");
    if (draft.role === "staff" && !draft.staffId) {
      return showToast(t.team.errSeat, "error");
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
      showToast(t.team.okCreate, "success");
    }
  }

  function startEditPermissions(user: TeamUser) {
    setAdding(false);
    setEditing(user.id);
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
      showToast(t.team.okPermissions, "success");
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
   * looking at this list. Chips offer only real chairs, so there is no "unlink" to guard against.
   */
  async function onChangeSeat(user: TeamUser, staffId: string) {
    if (staffId === user.staffId) return;
    const ok = await send(`/api/users/${user.id}`, "PATCH", { staffId }, t.team.errChangeSeat);
    if (ok) showToast(t.team.okChangeSeat, "success");
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
    <div className="sa-team">
      <div className="sa-team-grid">
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          const locked = user.isSuperOwner || isSelf;
          const chairLabelId = `${idBase}-chair-${user.id}`;
          // Their own chair stays offered; every other taken or retired chair does not.
          const seatChoices = staff.filter(
            (s) => s.id === user.staffId || (s.isActive && !linkedSeatIds.has(s.id)),
          );
          const meta = [ROLE_LABELS[user.role], user.staffName, formatPhone(user.phone)]
            .filter(Boolean)
            .join(t.team.metaSeparator);

          return (
            <article key={user.id} className={`sa-member${user.isActive ? "" : " is-inactive"}`}>
              <div>
                <div className="sa-member-name">
                  <span className="sa-member-nm">{user.name ?? t.common.dash}</span>
                  {user.isSuperOwner ? <span className="sa-badge">{t.team.badgeOwnerAccount}</span> : null}
                  {isSelf && !user.isSuperOwner ? <span className="sa-badge">{t.team.badgeYou}</span> : null}
                  {!user.isActive ? (
                    <span className="sa-badge sa-badge--muted">{t.team.badgeTurnedOff}</span>
                  ) : null}
                  {user.role === "staff" && user.isActive && !user.staffId ? (
                    <span className="sa-badge sa-badge--warn">{t.team.badgeNoChair}</span>
                  ) : null}
                </div>
                <p className="sa-member-meta">{meta}</p>
              </div>

              {user.role === "staff" && !locked ? (
                <div className="sa-member-block">
                  <span id={chairLabelId} className="sa-mini-label">
                    {t.team.chair}
                  </span>
                  <div className="sa-chip-row" role="group" aria-labelledby={chairLabelId}>
                    {seatChoices.map((seat) => (
                      <button
                        key={seat.id}
                        type="button"
                        className={`sa-chip${user.staffId === seat.id ? " is-active" : ""}`}
                        aria-pressed={user.staffId === seat.id}
                        disabled={busy}
                        title={seat.name}
                        onClick={() => onChangeSeat(user, seat.id)}
                      >
                        <span className="sa-chip-text">{seat.name}</span>
                      </button>
                    ))}
                  </div>
                  {!user.staffId ? <p className="sa-warn-text">{t.team.pickChairWarn}</p> : null}
                </div>
              ) : null}

              {user.role === "staff" ? (
                editing === user.id ? (
                  <div className="sa-member-block">
                    <PermissionGrid value={permDraft} onChange={setPermDraft} disabled={busy} />
                    <div className="sa-actions">
                      <button
                        type="button"
                        className="sa-btn sa-btn--primary"
                        onClick={() => onSavePermissions(user.id)}
                        disabled={busy}
                      >
                        {busy ? <Spinner size={13} /> : null}
                        {t.team.savePermissions}
                      </button>
                      <button
                        type="button"
                        className="sa-btn sa-btn--secondary"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                      >
                        {t.team.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="sa-member-summary">{summarise(user.permissions)}</p>
                )
              ) : (
                <p className="sa-member-summary">
                  {user.isSuperOwner ? t.team.superOwnerSummary : t.team.coOwnerSummary}
                </p>
              )}

              {/* Under the card's content, as on the app — the actions act on everything above. */}
              {!locked ? (
                <div className="sa-actions">
                  {user.role === "staff" && editing !== user.id ? (
                    <button
                      type="button"
                      className="sa-btn sa-btn--secondary"
                      onClick={() => startEditPermissions(user)}
                      disabled={busy}
                    >
                      {t.team.permissions}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="sa-btn sa-btn--secondary"
                    onClick={() => onResetPassword(user)}
                    disabled={busy}
                  >
                    {t.team.resetPassword}
                  </button>
                  <button
                    type="button"
                    className="sa-btn sa-btn--secondary"
                    onClick={() => onToggleActive(user)}
                    disabled={busy}
                  >
                    {user.isActive ? t.team.turnOff : t.team.turnOn}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {adding ? (
        <section className="sa-add" aria-labelledby={`${idBase}-add`}>
          <h2 id={`${idBase}-add`} className="sa-add-title">
            {t.team.addTitle}
          </h2>

          <div className="sa-roles">
            {ROLE_CHOICES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`sa-role${draft.role === r.value ? " is-active" : ""}`}
                aria-pressed={draft.role === r.value}
                onClick={() => pickRole(r.value)}
              >
                <span className="sa-role-nm">{r.label}</span>
                <span className="sa-role-sub">{r.blurb}</span>
              </button>
            ))}
          </div>

          <div className="sa-add-fields">
            <div className="sa-field">
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

            <div className="sa-field">
              <label htmlFor="team-password">{t.team.passwordLabel}</label>
              <input
                id="team-password"
                type="text"
                value={draft.password}
                onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              />
              <p className="sa-hint">{t.team.passwordHint}</p>
            </div>
          </div>

          {draft.role === "staff" ? (
            <>
              <div className="sa-group">
                <span id={`${idBase}-seat`} className="sa-mini-label">
                  {t.team.seatLabel}
                </span>
                <div className="sa-chip-row" role="group" aria-labelledby={`${idBase}-seat`}>
                  {freeSeats.map((seat) => (
                    <button
                      key={seat.id}
                      type="button"
                      className={`sa-chip${draft.staffId === seat.id ? " is-active" : ""}`}
                      aria-pressed={draft.staffId === seat.id}
                      disabled={busy}
                      title={seat.name}
                      onClick={() => setDraft((d) => ({ ...d, staffId: seat.id }))}
                    >
                      <span className="sa-chip-text">{seat.name}</span>
                    </button>
                  ))}
                </div>
                <p className="sa-hint">{t.team.seatHint}</p>
              </div>

              <div className="sa-group">
                <span className="sa-mini-label">{t.team.permissionsLabel}</span>
                <PermissionGrid
                  value={draft.permissions}
                  onChange={(permissions) => setDraft((d) => ({ ...d, permissions }))}
                  disabled={busy}
                />
              </div>
            </>
          ) : (
            <p className="sa-hint">{t.team.coOwnerHint}</p>
          )}

          <div className="sa-actions">
            <button type="button" className="sa-btn sa-btn--primary" onClick={onCreate} disabled={busy}>
              {busy ? <Spinner size={13} /> : null}
              {t.team.createLogin}
            </button>
            <button
              type="button"
              className="sa-btn sa-btn--secondary"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
              }}
              disabled={busy}
            >
              {t.team.cancel}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="sa-add-cta">
            <button
              type="button"
              className="sa-btn sa-btn--md sa-btn--primary"
              onClick={() => startAdd("staff")}
              disabled={busy || freeSeats.length === 0}
              title={freeSeats.length === 0 ? t.team.noFreeSeatsTitle : undefined}
            >
              {t.team.addStaffLogin}
            </button>
            {/* Outline, not the filled secondary: adding a co-owner hands over everything the
                owner has, so it should not be the louder of the two (the app made the same call). */}
            <button
              type="button"
              className="sa-btn sa-btn--md sa-btn--outline"
              onClick={() => startAdd("co_owner")}
              disabled={busy}
            >
              {t.team.addCoOwner}
            </button>
          </div>
          {freeSeats.length === 0 ? <p className="sa-caption">{t.team.allSeatsLinked}</p> : null}
        </>
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

/**
 * A one-line "what they can see" for the collapsed card.
 *
 * Billing is counted here, unlike the app. The app never mentions billing (App Review rejected a
 * subscription reference with no In-App Purchase behind it); the web sells the plan, so an owner
 * granting it should see it.
 */
function summarise(access: ModuleAccess): string {
  const visible = GRANTABLE_MODULES.filter((m) => access[m] && access[m] !== "none");
  if (visible.length === 0) return t.team.noAccessYet;
  return format(t.team.canSee, { modules: visible.map((m) => MODULE_LABELS[m]).join(", ") });
}

function PermissionGrid({
  value,
  onChange,
  disabled,
}: {
  value: Partial<Record<Module, Access>>;
  onChange: (next: Partial<Record<Module, Access>>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sa-perm">
      <div className="sa-perm-list">
        {GRANTABLE_MODULES.map((mod) => (
          <div key={mod} className="sa-perm-row" role="group" aria-label={MODULE_LABELS[mod]}>
            <span className="sa-perm-label">{MODULE_LABELS[mod]}</span>
            <div className="sa-perm-options">
              {(["none", "view", "manage"] as Access[]).map((level) => {
                const active = (value[mod] ?? "none") === level;
                return (
                  <button
                    key={level}
                    type="button"
                    className={`sa-chip${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() => onChange({ ...value, [mod]: level })}
                  >
                    {ACCESS_LABELS[level]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
