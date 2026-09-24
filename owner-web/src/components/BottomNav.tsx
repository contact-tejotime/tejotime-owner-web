"use client";

import { usePathname } from "next/navigation";
import { t } from "@/i18n";
import { Icon, type IconName } from "@/components/Icon";
import { NavLink } from "@/components/NavLink";
import { can, type Module, type ModuleAccess } from "@/lib/roles";
import "@/styles/shell-sheets.css";

/**
 * The phone/tablet tab bar — the web twin of the app's `BottomNav`: same six tabs, same order,
 * same labels and glyphs, same permission rules. Its look (64px bar, 22px icons, 10px labels,
 * brand colour for the active tab, the row capped at 640px on a tablet) is in shell-sheets.css.
 */
const TABS: { href: string; label: string; match: string; icon: IconName; module: Module | null }[] = [
  // A house, not `layoutDashboard`: its four squares were indistinguishable from Calendar's `grid`.
  { href: "/dashboard", label: t.bottomNav.home, match: "/dashboard", icon: "home", module: "dashboard" },
  { href: "/stats", label: t.bottomNav.reports, match: "/stats", icon: "star", module: "dashboard" },
  // `calendar`, as on the app's tab bar and this app's own sidebar. It was `calendarCheck`, the
  // one glyph that differed between the phone app and the phone web.
  { href: "/appointments", label: t.bottomNav.appts, match: "/appointments", icon: "calendar", module: "appointments" },
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
