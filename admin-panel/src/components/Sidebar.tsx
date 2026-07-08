"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { StoreListItem } from "@/lib/types";

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
        <span className="dot" />
        TejoTime Admin
      </div>

      <Link href="/" className={`nav-link create ${pathname === "/" ? "active" : ""}`}>
        ＋ Create store
      </Link>

      <a href={`${FRONTEND_URL}/demo-store`} target="_blank" rel="noreferrer" className="nav-link">
        🔗 View demo store
      </a>

      <div className="side-label">Stores ({stores.length})</div>
      {stores.length === 0 && <div className="side-empty">No stores yet</div>}
      {stores.map((s) => {
        const active = pathname === `/stores/${s.id}`;
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

      <button type="button" className="logout-btn" onClick={logout} disabled={loggingOut}>
        <span aria-hidden>⎋</span>
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </aside>
  );
}
