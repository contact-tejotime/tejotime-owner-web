export type UserRole = "owner" | "manager" | "staff";

export type SessionUser = {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
};

export type SessionBusiness = {
  id: string;
  name: string;
  slug: string;
};

export type Session = {
  user: SessionUser;
  business: SessionBusiness;
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

/** Path access — staff cannot open most settings (profile allowed). */
export function canAccessPath(role: UserRole, path: string): boolean {
  if (!path.startsWith("/settings")) return true;
  if (path === "/settings" || path === "/settings/profile") return true;
  return role === "owner" || role === "manager";
}

export const NAV_ITEMS: { href: string; label: string; icon: "layoutDashboard" | "users" | "calendar" | "grid" | "user" | "settings" }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layoutDashboard" },
  { href: "/queue", label: "Queue", icon: "users" },
  { href: "/appointments", label: "Appointments", icon: "calendar" },
  { href: "/calendar", label: "Calendar", icon: "grid" },
  { href: "/customers", label: "Customers", icon: "user" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function settingsTilesForRole(role: UserRole) {
  const all: {
    href: string;
    title: string;
    desc: string;
    roles: UserRole[];
  }[] = [
    {
      href: "/settings/profile",
      title: "Profile",
      desc: "Your name and password",
      roles: ["owner", "manager", "staff"],
    },
    {
      href: "/settings/staff",
      title: "Staff",
      desc: "Seats and team members",
      roles: ["owner", "manager"],
    },
    {
      href: "/settings/services",
      title: "Services",
      desc: "Services and durations",
      roles: ["owner", "manager"],
    },
    {
      href: "/settings/hours",
      title: "Hours",
      desc: "Weekly opening hours",
      roles: ["owner", "manager"],
    },
    {
      href: "/settings/notifications",
      title: "Notifications",
      desc: "Alerts and reminders",
      roles: ["owner", "manager"],
    },
    {
      href: "/settings/subscription",
      title: "Subscription",
      desc: "Plan and billing",
      roles: ["owner", "manager"],
    },
  ];
  return all.filter((t) => t.roles.includes(role));
}
