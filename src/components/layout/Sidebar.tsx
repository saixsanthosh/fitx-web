"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/app/LogoutButton";
import { Logo } from "@/components/ui/Logo";
import { ACCOUNT_NAV, MAIN_NAV, isActivePath, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { AccountAvatar } from "./AccountMenu";
import { SkipLink } from "./SkipLink";
import { useAccountSummary } from "./useAccountSummary";

/**
 * Tablets (768–1023 px) get a compact rail of icons with short labels; desktops (1024 px and up) get the
 * full sidebar with an account footer. Phones use the bottom bar instead.
 */
export function Sidebar() {
  const pathname = usePathname();
  const summary = useAccountSummary();

  return (
    // The notch inset (phones in landscape get the rail) is added to the width, never taken out of it.
    <aside className="fitx-safe-left sticky top-0 hidden h-dvh w-[calc(88px+env(safe-area-inset-left))] shrink-0 flex-col border-r border-fitx-divider bg-fitx-surface md:flex lg:w-[calc(232px+env(safe-area-inset-left))]">
      <SkipLink />
      <Link href="/dashboard" aria-label="FITX home" className="flex h-[68px] shrink-0 items-center justify-center border-b border-fitx-divider lg:justify-start lg:px-6">
        <Logo size={30} markOnly className="lg:hidden" />
        <Logo size={36} className="hidden lg:inline-flex" />
      </Link>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-2 py-3 lg:px-3 lg:py-4">
        <ul className="space-y-1">
          {MAIN_NAV.map((item) => <li key={item.href}><SideLink item={item} active={isActivePath(pathname, item.href)} /></li>)}
        </ul>
      </nav>
      <div className="shrink-0 border-t border-fitx-divider px-2 py-3 lg:px-3">
        <p className="mb-1 hidden items-center gap-2.5 px-3 py-1 lg:flex">
          <AccountAvatar summary={summary} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fitx-text">{summary?.name || "Your account"}</span>
            {summary?.email && <span className="block truncate text-xs text-fitx-text-secondary">{summary.email}</span>}
          </span>
        </p>
        <ul aria-label="Account" className="space-y-1">
          {ACCOUNT_NAV.map((item) => <li key={item.href}><SideLink item={item} active={isActivePath(pathname, item.href)} /></li>)}
        </ul>
        <div className="hidden px-3 lg:block"><LogoutButton className="w-full" /></div>
      </div>
    </aside>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] leading-tight transition-colors lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
        active ? "bg-fitx-primary/10 font-medium text-fitx-primary-text" : "text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text",
      )}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-fitx-primary" />}
      <Icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
      <span className="max-w-full text-center lg:hidden">{item.shortLabel ?? item.label}</span>
      <span className="hidden lg:inline">{item.label}</span>
    </Link>
  );
}
