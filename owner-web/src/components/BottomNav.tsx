"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

const TABS: { href: string; label: string; match: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Home", match: "/dashboard", icon: "layoutDashboard" },
  { href: "/queue", label: "Queue", match: "/queue", icon: "users" },
  { href: "/appointments", label: "Appts", match: "/appointments", icon: "calendarCheck" },
  { href: "/calendar", label: "Calendar", match: "/calendar", icon: "grid" },
  { href: "/customers", label: "Clients", match: "/customers", icon: "user" },
  { href: "/settings", label: "Settings", match: "/settings", icon: "settings" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((tab) => {
        const active =
          tab.match === "/dashboard"
            ? pathname === "/dashboard" || pathname === "/"
            : pathname === tab.match || pathname.startsWith(`${tab.match}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`bottom-nav-item ${active ? "active" : ""}`}
          >
            <Icon name={tab.icon} size={22} strokeWidth={active ? 2.4 : 2} className="bottom-nav-icon" />
            <span className="bottom-nav-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
