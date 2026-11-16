"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Apple, ChartNoAxesCombined, CircleHelp, CreditCard, LayoutDashboard, Megaphone, ScrollText, Settings2, Shield, Users } from "lucide-react";

const workspace = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/users", label: "People", icon: Users },
  { href: "/support", label: "Support", icon: CircleHelp },
  { href: "/training", label: "Training", icon: Activity },
  { href: "/nutrition", label: "Nutrition", icon: Apple },
];

const platform = [
  { href: "/announcements", label: "Announcements", icon: Megaphone },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/access-control", label: "Access", icon: Shield },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

/** Shows only the pages the member's role allows; the server checks each page again. */
export function AdminNavigation({ mobile = false, allowed }: { mobile?: boolean; allowed: readonly string[] }) {
  const pathname = usePathname();
  const visible = (items: typeof workspace) => items.filter((item) => allowed.includes(item.href));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const platformItems = visible(platform);
  return (
    <nav aria-label="Admin navigation" className={mobile ? "nav-list nav-list-mobile" : "nav-list"}>
      <p className="nav-section-label">Workspace</p>
      {visible(workspace).map(({ href, label, icon: Icon }) => <NavItem key={href} href={href} label={label} icon={Icon} active={isActive(href)} mobile={mobile} />)}
      {platformItems.length > 0 && <p className="nav-section-label nav-section-spaced">Platform</p>}
      {platformItems.map(({ href, label, icon: Icon }) => <NavItem key={href} href={href} label={label} icon={Icon} active={isActive(href)} mobile={mobile} />)}
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
