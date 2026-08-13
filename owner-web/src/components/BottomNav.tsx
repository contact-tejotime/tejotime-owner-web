"use client";

import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import { Icon, type IconName } from "@/components/Icon";
import { NavLink } from "@/components/NavLink";
import { can, type Module, type ModuleAccess } from "@/lib/roles";

const TABS: { href: string; label: string; match: string; icon: IconName; module: Module | null }[] = [
  { href: "/dashboard", label: t.bottomNav.home, match: "/dashboard", icon: "layoutDashboard", module: "dashboard" },
  { href: "/stats", label: t.bottomNav.reports, match: "/stats", icon: "star", module: "dashboard" },
  { href: "/appointments", label: t.bottomNav.appts, match: "/appointments", icon: "calendarCheck", module: "appointments" },
  { href: "/calendar", label: t.bottomNav.calendar, match: "/calendar", icon: "grid", module: "calendar" },
  { href: "/customers", label: t.bottomNav.clients, match: "/customers", icon: "user", module: "customers" },
  { href: "/settings", label: t.bottomNav.settings, match: "/settings", icon: "settings", module: null },
];

export function BottomNav({ access }: { access: ModuleAccess }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => {
    if (t.module === null) return true;
    if (t.href === "/dashboard") return can(access, "dashboard") || can(access, "queue");
    if (t.href === "/stats") return can(access, "dashboard");
    return can(access, t.module);
  });

  return (
    <nav className="bottom-nav" aria-label={t.bottomNav.primary}>
      {tabs.map((tab) => {
        const active =
          tab.match === "/dashboard"
            ? pathname === "/dashboard" || pathname === "/"
            : pathname === tab.match || pathname.startsWith(`${tab.match}/`);
        return (
          <NavLink
            key={tab.href}
            href={tab.href}
            className={`bottom-nav-item ${active ? "active" : ""}`}
          >
            <Icon name={tab.icon} size={22} strokeWidth={active ? 2.4 : 2} className="bottom-nav-icon" />
            <span className="bottom-nav-label">{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
