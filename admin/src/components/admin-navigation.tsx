"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Apple, Bell, ChartNoAxesCombined, CircleHelp, CreditCard, LayoutDashboard, ScrollText, Settings2, Shield, Users } from "lucide-react";

const navigation = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/users", label: "People", icon: Users },
  { href: "/training", label: "Training", icon: Activity },
  { href: "/nutrition", label: "Nutrition", icon: Apple },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/support", label: "Support", icon: CircleHelp },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/access-control", label: "Access", icon: Shield },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function AdminNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin navigation" className={mobile ? "nav-list nav-list-mobile" : "nav-list"}>
      <p className="nav-section-label">Workspace</p>
      {navigation.slice(0, 4).map(({ href, label, icon: Icon }) => <NavItem key={href} href={href} label={label} icon={Icon} active={pathname === href} mobile={mobile} />)}
      <p className="nav-section-label nav-section-spaced">Platform</p>
      {navigation.slice(4).map(({ href, label, icon: Icon }) => <NavItem key={href} href={href} label={label} icon={Icon} active={pathname === href} mobile={mobile} />)}
    </nav>
  );
}

function NavItem({ href, label, icon: Icon, active, mobile }: { href: string; label: string; icon: typeof LayoutDashboard; active: boolean; mobile: boolean }) {
  return <Link aria-current={active ? "page" : undefined} className={`nav-link${active ? " nav-link-active" : ""}`} href={href} onClick={(event) => {
    if (mobile) event.currentTarget.closest("details")?.removeAttribute("open");
  }}>
    <Icon aria-hidden="true" size={18} strokeWidth={1.8} /><span>{label}</span>
  </Link>;
}
