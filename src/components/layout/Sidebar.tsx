"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { NAV_GROUPS, isActivePath, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";
import { NavGlyph } from "./NavGlyph";
import { SkipLink } from "./SkipLink";
import { useAccountSummary } from "./useAccountSummary";

type Marker = { y: number; height: number; ready: boolean } | null;

/**
 * Tablets (768–1023 px) get a compact rail of icons with short labels; desktops (1024 px and up) get the
 * full sidebar, grouped (Home; Train; Track; Connect) with the account at the foot. Phones use the bottom bar
 * instead. On desktops the current page's highlight glides from the old item to the new one.
 *
 * Everything shows without scrolling on a 1366 x 768 laptop with the browser's bars (641 px of page) and up
 * (bug 73): the account is one row at the foot, its menu (Profile, Settings, Help and feedback, Log out) opening
 * above it, and tablets keep the account in the header beside the rail. On a shorter window the menu scrolls, and
 * shows it does (.fitx-scroll-cue).
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
    // Its width is --fitx-menu-width (globals.css: 88 px for the rail, 248 px from 1024 px), with the notch inset
    // (phones in landscape get the rail) added to it, never taken out of it. .fitx-menu-column tells the privacy
    // banner to keep beside it.
    <aside data-coach-edge="" className="fitx-app-only fitx-menu-column fitx-safe-left sticky top-0 hidden h-dvh w-[var(--fitx-menu-width)] shrink-0 flex-col border-r border-fitx-divider bg-fitx-bg md:flex">
      <SkipLink />
      <Link href="/dashboard" aria-label="FITX home" className="flex h-[72px] shrink-0 items-center justify-center lg:justify-start lg:px-6">
        <Logo size={30} markOnly className="lg:hidden" />
        <Logo size={32} className="hidden lg:inline-flex" />
      </Link>
      <nav ref={nav} aria-label="Main navigation" className="fitx-scroll-cue relative min-h-0 flex-1 scroll-py-3 overflow-y-auto px-2 pb-3 lg:px-3">
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
      {/* Desktops: the account's card, which opens its menu above it. Tablets have the same menu in the header. */}
      <div className="hidden shrink-0 border-t border-fitx-divider px-3 py-2 lg:block">
        <AccountMenu summary={summary} placement="sidebar" />
      </div>
    </aside>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "fitx-nav-link group relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] leading-tight transition-colors duration-150 lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
        active ? "font-semibold text-fitx-text" : "text-fitx-text-secondary hover:text-fitx-text",
        // The desktop highlight is the gliding surface.
        !active && "lg:hover:bg-fitx-hover",
      )}
    >
      {/* The rail draws the active state as a pill behind the icon; the full sidebar uses the gliding surface. */}
      <span className={cn(
        "grid h-8 w-12 place-items-center rounded-full transition-[background-color,box-shadow,transform] duration-200 lg:h-auto lg:w-auto lg:bg-transparent lg:shadow-none",
        active ? "bg-fitx-surface text-fitx-primary shadow-[inset_0_0_0_1px_var(--fitx-border)]" : "group-hover:bg-fitx-hover lg:group-hover:bg-transparent",
      )}>
        <NavGlyph icon={item.icon} size={20} active={active} />
      </span>
      <span className="max-w-full text-center lg:hidden">{item.shortLabel ?? item.label}</span>
      <span className="hidden truncate lg:inline">{item.label}</span>
    </Link>
  );
}
