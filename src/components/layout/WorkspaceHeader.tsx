"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { AccountMenu } from "./AccountMenu";
import { ShellEffects } from "./ShellEffects";
import { SkipLink } from "./SkipLink";
import { useAccountSummary } from "./useAccountSummary";

/**
 * The signed-in app's top bar on phones and tablets: the logo (phones; tablets have it in the rail) and
 * the account menu. It is clear at the top of the page and picks up a frosted surface once the page
 * scrolls. Desktops have the account at the foot of the sidebar, so the bar is hidden there. Search lives
 * where it belongs (the Exercise library and Nutrition); the theme lives in Settings.
 */
export function WorkspaceHeader() {
  // The shared user context's name and photo link when the layout provides one, else its own fetch.
  const summary = useAccountSummary();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <ShellEffects account />
      <header
        data-scrolled={scrolled || undefined}
        className={`${scrolled ? "fitx-glass " : ""}fitx-safe-inline sticky top-0 z-30 flex h-[60px] items-center justify-between gap-3 border-b border-transparent transition-[background-color,border-color] duration-200 [--fitx-pad-inline:1rem] data-[scrolled]:border-fitx-divider data-[scrolled]:bg-fitx-nav sm:[--fitx-pad-inline:1.5rem] md:h-16 lg:hidden`}
      >
        {/* On tablets and desktops the sidebar holds the first skip link. */}
        <div className="md:hidden"><SkipLink /></div>
        <Link href="/dashboard" aria-label="FITX home" className="flex min-h-11 shrink-0 items-center md:hidden"><Logo size={30} /></Link>
        <div className="ml-auto flex items-center"><AccountMenu summary={summary} /></div>
      </header>
    </>
  );
}
