"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon, type IconName } from "@/components/Icon";
import { useAuth } from "@/lib/auth";
import { canAccessPath, ROLE_LABELS, type UserRole } from "@/lib/roles";

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

export default function SettingsPage() {
  const { session, setRole, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const role = session?.user.role ?? "staff";
  const biz = session?.business.name ?? "Sharp Cut";
  const [dark, setDark] = useState(false);

  function onLogout() {
    logout();
    router.replace("/login");
  }

  const avatar = biz
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="page-app">
      <AppPageHeader title="Settings" subtitle={biz} avatar={avatar} showSettings={false} />

      <p className="settings-group-label">Business</p>
      <div className="settings-card">
        <SettingsRow
          href="/settings/profile"
          icon="building"
          label="Business profile"
          sub={`${biz} · Andheri East`}
        />
        <SettingsRow
          href="/settings/hours"
          icon="clock"
          label="Working hours"
          sub="7 days a week · 9:00 AM – 6:00 PM"
        />
        <SettingsRow href="/settings/services" icon="scissors" label="Services & pricing" sub="3 services" />
        <SettingsRow href="/settings/staff" icon="users" label="Staff & seats" sub="4 seats" />
      </div>

      <p className="settings-group-label">Bookings & queue</p>
      <div className="settings-card">
        <SettingsRow icon="qrCode" label="Booking QR code" sub="tejotime.com/91…/card" />
        <SettingsRow
          href="/settings/notifications"
          icon="bell"
          label="Notifications & reminders"
          sub="3 of 4 on"
        />
      </div>

      <p className="settings-group-label">Account</p>
      <div className="settings-card">
        <SettingsRow
          href="/settings/subscription"
          icon="creditCard"
          label="Subscription"
          sub="Free trial · 8 days left"
          badge="Trial"
        />
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
          <label htmlFor="demo-role-mobile" className="settings-row-sub" style={{ margin: 0 }}>
            Demo role · {ROLE_LABELS[role]}
          </label>
          <select
            id="demo-role-mobile"
            value={role}
            onChange={(e) => {
              const next = e.target.value as UserRole;
              setRole(next);
              if (!canAccessPath(next, pathname)) router.replace("/dashboard");
            }}
          >
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
          </select>
          <button type="button" className="btn secondary block" onClick={onLogout}>
            <Icon name="logOut" size={16} />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
