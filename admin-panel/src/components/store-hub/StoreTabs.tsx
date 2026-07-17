"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/i18n";

const TABS = [
  { segment: "", label: t.storeHub.tabOverview },
  { segment: "customers", label: t.storeHub.tabCustomers },
  { segment: "visits", label: t.storeHub.tabVisits },
  { segment: "settings", label: t.storeHub.tabSettings },
];

export default function StoreTabs({ storeId }: { storeId: string }) {
  const pathname = usePathname();
  const base = `/stores/${storeId}`;

  return (
    <nav className="tab-nav">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        // Overview owns the bare hub route; other tabs match their own subtree.
        const active = tab.segment ? pathname.startsWith(href) : pathname === base;
        return (
          <Link key={tab.label} href={href} className={`tab-link ${active ? "active" : ""}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
