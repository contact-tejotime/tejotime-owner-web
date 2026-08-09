"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon, type IconName } from "@/components/Icon";
import { can, isOwnerRole, type ModuleAccess, type UserRole } from "@/lib/roles";

function SettingsRow({
  href,
  icon,
  label,
  sub,
  badge,
  trailing,
}: {
  href?: string;
  icon: IconName;
  label: string;
  sub: string;
  badge?: string;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      <span className="settings-row-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="settings-row-text">
        <span className="settings-row-label">
          {label}
          {badge ? <span className="pill-badge">{badge}</span> : null}
        </span>
        <span className="settings-row-sub">{sub}</span>
      </span>
      {trailing ?? <Icon name="chevronRight" size={18} className="settings-row-chevron" />}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="settings-row">
        {body}
      </Link>
    );
  }
  return <div className="settings-row">{body}</div>;
}

/**
 * Every row is gated on the permission map from `/auth/me`. A staff member with only queue
 * access sees a settings screen with just their own account on it — the rows are not disabled,
 * they are absent, because a greyed-out "Subscription" row is an invitation to ask why.
 *
 * `Team logins` is gated on the ROLE, not a permission, mirroring the backend: creating logins
 * is the one thing an owner cannot delegate, because whoever can do it can grant themselves
 * everything else.
 */
export function SettingsScreen({
  role,
  access,
  businessName,
}: {
  role: UserRole;
  access: ModuleAccess;
  businessName: string;
}) {
  const router = useRouter();
  const biz = businessName;
  const [dark, setDark] = useState(false);
  const showBusinessGroup =
    can(access, "profile") || can(access, "hours") || can(access, "services") || can(access, "staff");
  const showBookingGroup = can(access, "notifications");

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const avatar = biz
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="page-app">
      <AppPageHeader title="Settings" subtitle={biz} avatar={avatar} showSettings={false} />

      {showBusinessGroup ? (
        <>
          <p className="settings-group-label">Business</p>
          <div className="settings-card">
            {can(access, "profile") ? (
              <SettingsRow
                href="/settings/profile"
                icon="building"
                label="Business profile"
                sub={biz}
              />
            ) : null}
            {can(access, "hours") ? (
              <SettingsRow
                href="/settings/hours"
                icon="clock"
                label="Working hours"
                sub="Weekly opening times"
              />
            ) : null}
            {can(access, "services") ? (
              <SettingsRow
                href="/settings/services"
                icon="scissors"
                label="Services & pricing"
                sub="Services and durations"
              />
            ) : null}
            {can(access, "staff") ? (
              <SettingsRow href="/settings/staff" icon="users" label="Staff & seats" sub="Chairs and providers" />
            ) : null}
          </div>
        </>
      ) : null}

      {isOwnerRole(role) ? (
        <>
          <p className="settings-group-label">Team</p>
          <div className="settings-card">
            <SettingsRow
              href="/settings/team"
              icon="users"
              label="Team logins"
              sub="Co-owners, staff and what each can see"
            />
          </div>
        </>
      ) : null}

      {showBookingGroup ? (
        <>
          <p className="settings-group-label">Bookings & queue</p>
          <div className="settings-card">
            <SettingsRow
              href="/settings/notifications"
              icon="bell"
              label="Notifications & reminders"
              sub="Alerts and reminders"
            />
          </div>
        </>
      ) : null}

      <p className="settings-group-label">Account</p>
      <div className="settings-card">
        <SettingsRow
          href="/settings/profile"
          icon="user"
          label="Your account"
          sub="Your name and password"
        />
        {can(access, "billing") ? (
          <SettingsRow
            href="/settings/subscription"
            icon="creditCard"
            label="Subscription"
            sub="Plan and billing"
          />
        ) : null}
        <SettingsRow
          icon="settings"
          label="Dark mode"
          sub="Easier on the eyes at night"
          trailing={
            <button
              type="button"
              className={`toggle ${dark ? "on" : ""}`}
              aria-pressed={dark}
              aria-label="Dark mode"
              onClick={() => setDark((v) => !v)}
            />
          }
        />
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-row settings-row-stack">
          {/* The demo role picker that lived here is gone: a user cannot choose their own role.
              It comes from the server with the session. */}
          <button type="button" className="btn secondary block" onClick={onLogout}>
            <Icon name="logOut" size={16} />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
