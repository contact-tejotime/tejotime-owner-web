"use client";

import { useState, type ReactNode } from "react";
import { t } from "@/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon, type IconName } from "@/components/Icon";
import { can, isOwnerRole, type ModuleAccess, type UserRole } from "@/lib/roles";
import { SUPPORT } from "@/lib/support";

function SettingsRow({
  href,
  externalHref,
  icon,
  label,
  sub,
  badge,
  trailing,
}: {
  href?: string;
  /** mailto: / tel: — rendered as a plain anchor, not a Next.js route. */
  externalHref?: string;
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

  if (externalHref) {
    return (
      <a href={externalHref} className="settings-row">
        {body}
      </a>
    );
  }
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
      <AppPageHeader title={t.settings.title} subtitle={biz} avatar={avatar} showSettings={false} />

      {/* Single column on phone/tablet — the grid rule only exists at ≥1025px. */}
      <div className="settings-columns">

      {showBusinessGroup ? (
        <section className="settings-group">
          <p className="settings-group-label">{t.settings.groupBusiness}</p>
          <div className="settings-card">
            {can(access, "profile") ? (
              <SettingsRow
                href="/settings/profile"
                icon="building"
                label={t.settings.businessProfile}
                sub={biz}
              />
            ) : null}
            {can(access, "hours") ? (
              <SettingsRow
                href="/settings/hours"
                icon="clock"
                label={t.settings.workingHours}
                sub={t.settings.workingHoursSub}
              />
            ) : null}
            {can(access, "services") ? (
              <SettingsRow
                href="/settings/services"
                icon="scissors"
                label={t.settings.services}
                sub={t.settings.servicesSub}
              />
            ) : null}
            {can(access, "staff") ? (
              <SettingsRow href="/settings/staff" icon="users" label={t.settings.staff} sub={t.settings.staffSub} />
            ) : null}
          </div>
        </section>
      ) : null}

      {isOwnerRole(role) ? (
        <section className="settings-group">
          <p className="settings-group-label">{t.settings.groupTeam}</p>
          <div className="settings-card">
            <SettingsRow
              href="/settings/team"
              icon="users"
              label={t.settings.teamLogins}
              sub={t.settings.teamLoginsSub}
            />
          </div>
        </section>
      ) : null}

      {showBookingGroup ? (
        <section className="settings-group">
          <p className="settings-group-label">{t.settings.groupBookings}</p>
          <div className="settings-card">
            <SettingsRow
              href="/settings/notifications"
              icon="bell"
              label={t.settings.notifications}
              sub={t.settings.notificationsSub}
            />
          </div>
        </section>
      ) : null}

      <section className="settings-group">
      <p className="settings-group-label">{t.settings.groupAccount}</p>
      <div className="settings-card">
        <SettingsRow
          href="/settings/profile"
          icon="user"
          label={t.settings.account}
          sub={t.settings.accountSub}
        />
        {can(access, "billing") ? (
          <SettingsRow
            href="/settings/subscription"
            icon="creditCard"
            label={t.settings.subscription}
            sub={t.settings.subscriptionSub}
          />
        ) : null}
        <SettingsRow
          icon="settings"
          label={t.settings.darkMode}
          sub={t.settings.darkModeSub}
          trailing={
            <button
              type="button"
              className={`toggle ${dark ? "on" : ""}`}
              aria-pressed={dark}
              aria-label={t.settings.darkMode}
              onClick={() => setDark((v) => !v)}
            />
          }
        />
      </div>

      </section>

      <section className="settings-group">
        <p className="settings-group-label">{t.settings.groupSupport}</p>
        <div className="settings-card">
          <SettingsRow
            externalHref={`mailto:${SUPPORT.email}`}
            icon="mail"
            label={t.settings.emailSupport}
            sub={SUPPORT.email}
          />
          <SettingsRow
            externalHref={`tel:${SUPPORT.phoneTel}`}
            icon="phone"
            label={t.settings.callSupport}
            sub={SUPPORT.phoneDisplay}
          />
        </div>
      </section>

      <section className="settings-group settings-logout">
        {/* The demo role picker that lived here is gone: a user cannot choose their own role.
            It comes from the server with the session. */}
        <button type="button" className="btn secondary block" onClick={onLogout}>
          <Icon name="logOut" size={16} />
          {t.settings.logout}
        </button>
      </section>
      </div>
    </div>
  );
}
