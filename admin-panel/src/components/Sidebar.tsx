"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StoreListItem } from "@/lib/types";

export function Sidebar({ stores }: { stores: StoreListItem[] }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" />
        TejoTime Admin
      </div>

      <Link href="/" className={`nav-link create ${pathname === "/" ? "active" : ""}`}>
        ＋ Create store
      </Link>

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
    </aside>
  );
}
