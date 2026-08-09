"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import {
  canAccessPath,
  NAV_ITEMS,
  ROLE_LABELS,
  type UserRole,
} from "@/lib/roles";

/** Desktop sidebar only — hidden on mobile/tablet (bottom nav used instead). */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout, setRole } = useAuth();
  if (!session) return null;

  const role = session.user.role;

  function isActive(href: string) {
    if (href === "/settings") return pathname.startsWith("/settings");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function onLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <aside className="sidebar" id="app-sidebar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-logo" src="/logo.png" alt="TejoTime" />
      </div>

      <div className="biz-chip">
        <span className="nm">{session.business.name}</span>
        <span className="sub">{session.user.name}</span>
        <span className="role-badge">{ROLE_LABELS[role]}</span>
      </div>

      <nav aria-label="Primary" className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${isActive(item.href) ? "active" : ""}`}
          >
            <span className="nav-ic" aria-hidden>
              <Icon name={item.icon} size={18} />
            </span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="role-switcher">
        <label htmlFor="demo-role">Demo role</label>
        <select
          id="demo-role"
          value={role}
          onChange={(e) => {
            const next = e.target.value as UserRole;
            setRole(next);
            if (!canAccessPath(next, pathname)) {
              router.replace("/dashboard");
            }
          }}
        >
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
        <button type="button" className="logout-btn" onClick={onLogout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
