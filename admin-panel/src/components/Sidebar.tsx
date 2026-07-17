"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { StoreListItem } from "@/lib/types";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import Spinner from "@/components/ui/Spinner";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? "https://www.tejotime.com";

const NAV_ICON = 18;

export function Sidebar({ stores }: { stores: StoreListItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin-auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails, fall through to /login — the proxy (src/proxy.ts)
      // will bounce back if the cookie somehow survived.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <img src="/logo.png" alt={t.common.brandAlt} />
        </span>
        <span className="brand-name">
          {t.nav.brandName}
          <span className="brand-sub">{t.nav.brandBadge}</span>
        </span>
      </div>

      {/* display:contents keeps these links as direct flex children of .sidebar
          while still exposing a navigation landmark. */}
      <nav aria-label={t.nav.primary} style={{ display: "contents" }}>
        <Link
          href="/dashboard"
          className={`nav-link ${pathname === "/dashboard" ? "active" : ""}`}
          aria-current={pathname === "/dashboard" ? "page" : undefined}
        >
          <Icon name="layoutDashboard" size={NAV_ICON} className="nav-ic" /> {t.nav.dashboard}
        </Link>

        <Link
          href="/"
          className={`nav-link create ${pathname === "/" ? "active" : ""}`}
          aria-current={pathname === "/" ? "page" : undefined}
        >
          <Icon name="plus" size={NAV_ICON} className="nav-ic" /> {t.nav.createStore}
        </Link>

        <a href={`${FRONTEND_URL}/demo-store`} target="_blank" rel="noreferrer" className="nav-link">
          <Icon name="externalLink" size={NAV_ICON} className="nav-ic" /> {t.nav.viewDemoStore}
        </a>

        <div className="side-label">{t.nav.platform}</div>

        <Link
          href="/stores"
          className={`nav-link ${pathname === "/stores" ? "active" : ""}`}
          aria-current={pathname === "/stores" ? "page" : undefined}
        >
          <Icon name="building" size={NAV_ICON} className="nav-ic" /> {t.nav.allStores}
        </Link>

        <Link
          href="/customers"
          className={`nav-link ${pathname === "/customers" ? "active" : ""}`}
          aria-current={pathname === "/customers" ? "page" : undefined}
        >
          <Icon name="users" size={NAV_ICON} className="nav-ic" /> {t.nav.customers}
        </Link>

        <Link
          href="/billing"
          className={`nav-link ${pathname === "/billing" ? "active" : ""}`}
          aria-current={pathname === "/billing" ? "page" : undefined}
        >
          <Icon name="creditCard" size={NAV_ICON} className="nav-ic" /> {t.nav.billing}
        </Link>

        <Link
          href="/reports"
          className={`nav-link ${pathname === "/reports" ? "active" : ""}`}
          aria-current={pathname === "/reports" ? "page" : undefined}
        >
          <Icon name="trendingUp" size={NAV_ICON} className="nav-ic" /> {t.nav.reports}
        </Link>

        {/* Broadcasts and Team & roles are parked in (protected)/_broadcasts and _team
            (private folders, not routed) until their backends exist. */}

        <div className="side-label">{format(t.nav.storesGroup, { count: stores.length })}</div>
        {stores.length === 0 && <div className="side-empty">{t.nav.noStoresYet}</div>}
        {stores.map((s) => {
          // Store links stay highlighted on hub tabs (/stores/[id]/customers etc).
          const base = `/stores/${s.id}`;
          const active = pathname === base || pathname.startsWith(`${base}/`);
          return (
            <Link
              key={s.id}
              href={`/stores/${s.id}`}
              className={`store-item ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="nm">{s.name || t.common.unnamed}</span>
              <span className="sub">
                /{s.phoneFull}
                {s.category ? ` · ${s.category}` : ""}
              </span>
            </Link>
          );
        })}
      </nav>

      <button type="button" className="logout-btn" onClick={logout} disabled={loggingOut} aria-busy={loggingOut || undefined}>
        {loggingOut ? <Spinner /> : <Icon name="logOut" size={NAV_ICON} className="nav-ic" />}
        {loggingOut ? t.nav.loggingOut : t.nav.logout}
      </button>
    </aside>
  );
}
