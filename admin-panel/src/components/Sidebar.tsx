"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { StoreListItem } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? "https://www.tejotime.com";

export function Sidebar({ stores }: { stores: StoreListItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin-auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails, fall through to /login — the middleware will
      // bounce back if the cookie somehow survived.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/logo.png" alt="TejoTime" className="dot" />
        TejoTime Admin
      </div>

      <Link href="/dashboard" className={`nav-link ${pathname === "/dashboard" ? "active" : ""}`}>
        📊 Dashboard
      </Link>

      <Link href="/" className={`nav-link create ${pathname === "/" ? "active" : ""}`}>
        ＋ Create store
      </Link>

      <a href={`${FRONTEND_URL}/demo-store`} target="_blank" rel="noreferrer" className="nav-link">
        🔗 View demo store
      </a>

      <div className="side-label">Platform</div>

      <Link href="/stores" className={`nav-link ${pathname === "/stores" ? "active" : ""}`}>
        🏬 All stores
      </Link>

      <Link href="/customers" className={`nav-link ${pathname === "/customers" ? "active" : ""}`}>
        👥 Customers
      </Link>

      <Link href="/billing" className={`nav-link ${pathname === "/billing" ? "active" : ""}`}>
        💳 Billing
      </Link>

      <Link href="/reports" className={`nav-link ${pathname === "/reports" ? "active" : ""}`}>
        📄 Reports
      </Link>

      {/* Broadcasts and Team & roles are parked in (protected)/_broadcasts and _team
          (private folders, not routed) until their backends exist. */}

      <div className="side-label">Stores ({stores.length})</div>
      {stores.length === 0 && <div className="side-empty">No stores yet</div>}
      {stores.map((s) => {
        // Store links stay highlighted on hub tabs (/stores/[id]/customers etc).
        const base = `/stores/${s.id}`;
        const active = pathname === base || pathname.startsWith(`${base}/`);
        return (
          <Link key={s.id} href={`/stores/${s.id}`} className={`store-item ${active ? "active" : ""}`}>
            <span className="nm">{s.name || "(unnamed)"}</span>
            <span className="sub">
              /{s.phoneFull}
              {s.category ? ` · ${s.category}` : ""}
            </span>
          </Link>
        );
      })}

      <button type="button" className="logout-btn" onClick={logout} disabled={loggingOut} aria-busy={loggingOut || undefined}>
        {loggingOut ? <Spinner /> : <span aria-hidden>⎋</span>}
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </aside>
  );
}
