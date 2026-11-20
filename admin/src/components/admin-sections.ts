// The console's ten sections, in navigation order, with their fixed routes. No imports, so tests can
// load it. A section shows when the role may open at least one of its routes (roles.ts PAGE_PERMISSIONS).

export type AdminSection = {
  number: string;
  label: string;
  /** Icon name, mapped to a lucide icon in admin-navigation.tsx. */
  icon: "dashboard" | "users" | "workouts" | "nutrition" | "subscriptions" | "support" | "notifications" | "reports" | "security" | "settings";
  routes: ReadonlyArray<{ href: string; label: string }>;
};

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { number: "01", label: "Dashboard", icon: "dashboard", routes: [{ href: "/overview", label: "Overview" }] },
  { number: "02", label: "Users", icon: "users", routes: [{ href: "/users", label: "Users" }] },
  { number: "03", label: "Workouts", icon: "workouts", routes: [{ href: "/training", label: "Workouts" }] },
  { number: "04", label: "Nutrition", icon: "nutrition", routes: [{ href: "/nutrition", label: "Nutrition" }] },
  { number: "05", label: "Subscriptions", icon: "subscriptions", routes: [{ href: "/billing", label: "Subscriptions" }] },
  { number: "06", label: "Support", icon: "support", routes: [{ href: "/support", label: "Support" }] },
  {
    number: "07",
    label: "Notifications",
    icon: "notifications",
    routes: [{ href: "/notifications", label: "Notifications" }, { href: "/announcements", label: "Announcements" }],
  },
  { number: "08", label: "Reports", icon: "reports", routes: [{ href: "/reports", label: "Reports" }] },
  {
    number: "09",
    label: "Admin and security",
    icon: "security",
    routes: [{ href: "/access-control", label: "Access control" }, { href: "/audit", label: "Audit log" }, { href: "/security", label: "Security" }],
  },
  { number: "10", label: "Settings", icon: "settings", routes: [{ href: "/settings", label: "Settings" }] },
];

export type VisibleSection = AdminSection & { href: string; visibleRoutes: ReadonlyArray<{ href: string; label: string }> };

/** The sections a role may open, each linking to its first allowed route. */
export function visibleSections(allowed: readonly string[]): VisibleSection[] {
  return ADMIN_SECTIONS.flatMap((section) => {
    const visibleRoutes = section.routes.filter((route) => allowed.includes(route.href));
    return visibleRoutes.length ? [{ ...section, href: visibleRoutes[0].href, visibleRoutes }] : [];
  });
}

function under(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The section a path belongs to, or null (for /account). */
export function sectionForPath(pathname: string): AdminSection | null {
  return ADMIN_SECTIONS.find((section) => section.routes.some((route) => under(pathname, route.href))) ?? null;
}

export function isActiveRoute(pathname: string, href: string): boolean {
  return under(pathname, href);
}
