"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AdminRole, StoreDraftListItem, StoreListItem } from "@/lib/types";
import { frontendUrl } from "@/lib/frontend-url";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import Spinner from "@/components/ui/Spinner";

const FRONTEND_URL = frontendUrl();

const NAV_ICON = 18;

/** "just now" / "5m ago" / "3h ago" / "2d ago" for the Drafts list. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t.storeDraft.justNow;
  if (mins < 60) return format(t.storeDraft.minutesAgo, { n: mins });
  if (mins < 60 * 24) return format(t.storeDraft.hoursAgo, { n: Math.floor(mins / 60) });
  return format(t.storeDraft.daysAgo, { n: Math.floor(mins / (60 * 24)) });
}

/**
 * @param role hides the platform-wide sections an employee has no access to. This is UX only —
 *   the backend 403s those endpoints regardless, so a hand-typed /billing URL still gets an
 *   empty page rather than someone else's data.
 */
export function Sidebar({
  stores,
  drafts,
  role,
}: {
  stores: StoreListItem[];
  drafts: StoreDraftListItem[];
  role: AdminRole;
}) {
  const isOwner = role === "owner";
  const pathname = usePathname();
  // A draft opens on the Create store route itself (`/?draft=<id>`), so which item is "current"
  // is a query-string question, and "Create store" must not light up alongside it.
  const openDraftId = useSearchParams().get("draft");
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
        <img className="brand-logo" src="/logo.png?v=2" alt={t.common.brandAlt} />
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
          className={`nav-link create ${pathname === "/" && !openDraftId ? "active" : ""}`}
          aria-current={pathname === "/" && !openDraftId ? "page" : undefined}
        >
          <Icon name="plus" size={NAV_ICON} className="nav-ic" /> {t.nav.createStore}
        </Link>

        {FRONTEND_URL ? (
          <a href={`${FRONTEND_URL}/demo-store`} target="_blank" rel="noreferrer" className="nav-link">
            <Icon name="externalLink" size={NAV_ICON} className="nav-ic" /> {t.nav.viewDemoStore}
          </a>
        ) : null}

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

        {isOwner && (
          <>
            <Link
              href="/inquiries"
              className={`nav-link ${pathname === "/inquiries" ? "active" : ""}`}
              aria-current={pathname === "/inquiries" ? "page" : undefined}
            >
              <Icon name="list" size={NAV_ICON} className="nav-ic" /> {t.nav.inquiries}
            </Link>

            <Link
              href="/billing"
              className={`nav-link ${pathname === "/billing" ? "active" : ""}`}
              aria-current={pathname === "/billing" ? "page" : undefined}
            >
              <Icon name="creditCard" size={NAV_ICON} className="nav-ic" /> {t.nav.billing}
            </Link>
          </>
        )}

        <Link
          href="/reports"
          className={`nav-link ${pathname === "/reports" ? "active" : ""}`}
          aria-current={pathname === "/reports" ? "page" : undefined}
        >
          <Icon name="trendingUp" size={NAV_ICON} className="nav-ic" /> {t.nav.reports}
        </Link>

        {isOwner && (
          <Link
            href="/team"
            className={`nav-link ${pathname === "/team" ? "active" : ""}`}
            aria-current={pathname === "/team" ? "page" : undefined}
          >
            <Icon name="users" size={NAV_ICON} className="nav-ic" /> {t.nav.team}
          </Link>
        )}

        {/* Broadcasts is still parked in (protected)/_broadcasts (a private folder, not
            routed) until its backend exists. */}

        {drafts.length > 0 && (
          <>
            <div className="side-label">{format(t.nav.draftsGroup, { count: drafts.length })}</div>
            {drafts.map((d) => {
              const active = pathname === "/" && openDraftId === d.id;
              return (
                <Link
                  key={d.id}
                  href={`/?draft=${d.id}`}
                  className={`store-item draft ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="nm">{d.name || t.storeDraft.untitled}</span>
                  {/* Relative time differs between the server render and the browser's first
                      paint by up to a minute; that is not a bug worth a hydration error. */}
                  <span className="sub" suppressHydrationWarning>
                    {format(t.storeDraft.sub, { when: ago(d.updatedAt) })}
                  </span>
                </Link>
              );
            })}
          </>
        )}

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
