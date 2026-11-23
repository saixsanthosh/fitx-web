"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { LogoutButton } from "@/components/app/LogoutButton";
import { Logo } from "@/components/ui/Logo";
import { ACCOUNT_NAV, NAV_GROUPS, isActivePath, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { AccountAvatar } from "./AccountMenu";
import { NavGlyph } from "./NavGlyph";
import { SkipLink } from "./SkipLink";
import { useAccountSummary } from "./useAccountSummary";

type Marker = { y: number; height: number; ready: boolean } | null;

/**
 * Tablets (768–1023 px) get a compact rail of icons with short labels; desktops (1024 px and up) get the
 * full sidebar, grouped (Home; Train; Track; Connect) with the account at the foot. Phones use the bottom bar
 * instead. On desktops the current page's highlight glides from the old item to the new one.
 */
export function Sidebar() {
  const pathname = usePathname();
  const summary = useAccountSummary();
  const nav = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState<Marker>(null);

  // Measures the current item so the highlight can move to it (and follow a resize). The first placement does
  // not animate; later ones glide.
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    const place = () => {
      const current = element.querySelector<HTMLElement>('a[aria-current="page"]');
      setMarker((before) => (current ? { y: current.offsetTop, height: current.offsetHeight, ready: before !== null } : null));
    };
    place();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [pathname]);

  return (
    // The notch inset (phones in landscape get the rail) is added to the width, never taken out of it.
    <aside className="fitx-safe-left sticky top-0 hidden h-dvh w-[calc(88px+env(safe-area-inset-left))] shrink-0 flex-col border-r border-fitx-divider bg-fitx-bg md:flex lg:w-[calc(248px+env(safe-area-inset-left))]">
      <SkipLink />
      <Link href="/dashboard" aria-label="FITX home" className="flex h-[72px] shrink-0 items-center justify-center lg:justify-start lg:px-6">
        <Logo size={30} markOnly className="lg:hidden" />
        <Logo size={32} className="hidden lg:inline-flex" />
      </Link>
      <nav ref={nav} aria-label="Main navigation" className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3 lg:px-3">
        {/* The desktop highlight: one surface that glides to the current item. */}
        {marker && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-3 top-0 hidden rounded-xl bg-fitx-surface shadow-[0_1px_2px_color-mix(in_srgb,var(--fitx-scrim)_8%,transparent),inset_0_0_0_1px_var(--fitx-border)] lg:block",
              marker.ready && "transition-[transform,height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]",
            )}
            style={{ transform: `translateY(${marker.y}px)`, height: marker.height }}
          >
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-[5px] -translate-y-1/2 rounded-full bg-fitx-primary" />
          </span>
        )}
        {NAV_GROUPS.map((group, index) => (
          <div key={group.id} className={cn(index > 0 && "mt-3 border-t border-fitx-divider pt-3 lg:mt-4 lg:border-t-0 lg:pt-0")}>
            {group.label && (
              <p id={`nav-group-${group.id}`} className="m-0 hidden px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary lg:block">
                {group.label}
              </p>
            )}
            <ul aria-labelledby={group.label ? `nav-group-${group.id}` : undefined} className="space-y-0.5">
              {group.items.map((item) => <li key={item.href}><SideLink item={item} active={isActivePath(pathname, item.href)} /></li>)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-fitx-divider px-2 py-3 lg:px-3">
        <Link href="/profile" className="mb-1 hidden min-h-14 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-fitx-hover lg:flex">
          <AccountAvatar summary={summary} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fitx-text">{summary?.name || "Your account"}</span>
            {summary?.email && <span className="block truncate text-xs text-fitx-text-secondary">{summary.email}</span>}
          </span>
        </Link>
        <ul aria-label="Account" className="space-y-0.5">
          {ACCOUNT_NAV.map((item) => <li key={item.href}><SideLink item={item} active={isActivePath(pathname, item.href)} quiet /></li>)}
        </ul>
        <div className="hidden px-3 lg:block"><LogoutButton className="w-full" /></div>
      </div>
    </aside>
  );
}

function SideLink({ item, active, quiet = false }: { item: NavItem; active: boolean; quiet?: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "fitx-nav-link group relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] leading-tight transition-colors duration-150 lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
        active ? "font-semibold text-fitx-text" : "text-fitx-text-secondary hover:text-fitx-text",
        // The main items' desktop highlight is the gliding surface; the account items keep their own.
        active && quiet ? "lg:bg-fitx-surface lg:shadow-[inset_0_0_0_1px_var(--fitx-border)]" : !active && "lg:hover:bg-fitx-hover",
      )}
    >
      {/* The rail draws the active state as a pill behind the icon; the full sidebar uses the gliding surface. */}
      <span className={cn(
        "grid h-8 w-12 place-items-center rounded-full transition-[background-color,box-shadow,transform] duration-200 lg:h-auto lg:w-auto lg:bg-transparent lg:shadow-none",
        active ? "bg-fitx-surface shadow-[inset_0_0_0_1px_var(--fitx-border)]" : "group-hover:bg-fitx-hover lg:group-hover:bg-transparent",
        active && !quiet ? "text-fitx-primary" : quiet ? "text-fitx-text-secondary group-hover:text-fitx-text" : "",
      )}>
        <NavGlyph icon={item.icon} size={quiet ? 18 : 20} active={active} />
      </span>
      <span className="max-w-full text-center lg:hidden">{item.shortLabel ?? item.label}</span>
      <span className="hidden truncate lg:inline">{item.label}</span>
    </Link>
  );
}
