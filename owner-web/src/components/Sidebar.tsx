"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { NavLink } from "@/components/NavLink";
import { Spinner } from "@/components/Skeleton";
import { SupportContact } from "@/components/SupportContact";
import { navItemsFor, ROLE_LABELS, type ModuleAccess } from "@/lib/roles";
import type { Me } from "@/lib/server-api";

/**
 * Desktop sidebar only — hidden on mobile/tablet (bottom nav used instead).
 *
 * The demo role <select> that used to live here is gone. It let anyone reassign their own role
 * from the browser, which was fine for a mock and would be an open door in a real deployment.
 * The role now arrives from the server and is not the user's to change.
 */
export function Sidebar({ me, access }: { me: Me; access: ModuleAccess }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const role = me.user.role;

  function isActive(href: string) {
    if (href === "/settings") return pathname.startsWith("/settings");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function onLogout() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <aside className="sidebar" id="app-sidebar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-logo" src="/logo.png" alt="TejoTime" />
      </div>

      <div className="biz-chip">
        <span className="nm">{me.business.name}</span>
        <span className="sub">{me.user.name ?? "—"}</span>
        <span className="role-badge">{ROLE_LABELS[role]}</span>
      </div>

      <nav aria-label="Primary" className="sidebar-nav">
        {navItemsFor(access).map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            className={`nav-link ${isActive(item.href) ? "active" : ""}`}
          >
            <span className="nav-ic" aria-hidden>
              <Icon name={item.icon} size={18} />
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="role-switcher">
        <SupportContact variant="sidebar" />
        <button type="button" className="logout-btn" onClick={onLogout} disabled={signingOut}>
          {signingOut ? (
            <>
              <Spinner size={14} />
              Signing out…
            </>
          ) : (
            "Log out"
          )}
        </button>
      </div>
    </aside>
  );
}
