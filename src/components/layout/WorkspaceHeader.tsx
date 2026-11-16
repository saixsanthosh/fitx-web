"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { AccountMenu } from "./AccountMenu";
import { ShellEffects } from "./ShellEffects";
import { SkipLink } from "./SkipLink";
import { useAccountSummary } from "./useAccountSummary";

/** The signed-in app's top bar: exercise search and the account menu. The theme lives in Settings. */
export function WorkspaceHeader() {
  const router = useRouter();
  // The shared user context's name and photo link when the layout provides one, else its own fetch.
  const summary = useAccountSummary();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value) {
      router.push(`/exercises?q=${encodeURIComponent(value)}`);
      setSearchOpen(false);
    }
  }

  return (
    <header className="fitx-glass fitx-safe-inline sticky top-0 z-30 flex min-h-[60px] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-fitx-divider bg-background/95 py-2 [--fitx-pad-inline:.75rem] sm:h-[68px] sm:min-h-[68px] sm:flex-nowrap sm:gap-x-4 sm:py-0 sm:[--fitx-pad-inline:1.5rem] lg:[--fitx-pad-inline:2rem]">
      {/* On tablets and desktops the sidebar holds the first skip link. */}
      <div className="md:hidden"><SkipLink /></div>
      <ShellEffects account />
      <Link href="/dashboard" aria-label="FITX home" className="flex min-h-11 shrink-0 items-center md:hidden"><Logo size={32} /></Link>
      <form id="workspace-search" onSubmit={search} role="search" className={`${searchOpen ? "flex" : "hidden"} order-3 h-11 w-full basis-full items-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface pl-3 focus-within:border-fitx-primary sm:order-none sm:flex sm:w-full sm:max-w-[360px] sm:basis-auto`}>
        <Search size={16} aria-hidden="true" className="shrink-0 text-fitx-text-disabled" />
        <input type="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search exercises" placeholder="Search exercises…" className="h-10 w-full min-w-0 bg-transparent text-sm text-fitx-text outline-none placeholder:text-fitx-text-disabled" />
        <button type="submit" aria-label="Search the exercise library" className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-r-lg text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-primary-text"><ArrowRight size={16} aria-hidden="true" /></button>
      </form>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
        <button type="button" aria-label={searchOpen ? "Close search" : "Search exercises"} aria-expanded={searchOpen} aria-controls="workspace-search" onClick={() => setSearchOpen((open) => !open)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text sm:hidden">
          {searchOpen ? <X size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
        </button>
        <AccountMenu summary={summary} />
      </div>
    </header>
  );
}
