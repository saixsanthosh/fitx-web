"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronRight, Ellipsis, X } from "lucide-react";
import { LogoutButton } from "@/components/app/LogoutButton";
import { ACCOUNT_NAV, MAIN_NAV, PHONE_MORE, PHONE_TAB_COUNT, PHONE_TABS, isActivePath } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { NavGlyph } from "./NavGlyph";

/** Focus screens that hide the bar: the live workout and the activity recorder. */
const FOCUS_SCREENS = new Set(["/workouts/active", "/activity/record"]);
const MORE_SECTIONS = MAIN_NAV.slice(PHONE_TAB_COUNT);

/**
 * Phones (under 768 px): a fixed bar with the four main sections and More. More opens a bottom sheet
 * (a modal <dialog>: focus stays inside, Escape or a tap outside closes it, focus returns to More).
 */
export function BottomNav() {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const moreActive = PHONE_MORE.some(({ href }) => isActivePath(pathname, href));

  if (FOCUS_SCREENS.has(pathname)) return null;

  function openSheet() {
    sheet.current?.showModal();
    setOpen(true);
  }
  function closeSheet() {
    sheet.current?.close();
  }

  const tab = "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none";
  const pill = "grid h-7 w-14 place-items-center rounded-full transition-colors duration-200";

  return (
    <>
      <nav aria-label="Main navigation" className="fitx-glass fitx-safe-inline fixed inset-x-0 bottom-0 z-40 border-t border-fitx-divider bg-fitx-nav pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 [--fitx-pad-inline:.25rem] md:hidden">
        <div className="mx-auto grid max-w-[520px] grid-cols-5">
          {PHONE_TABS.map(({ href, label, icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(tab, active ? "font-semibold text-fitx-primary-text" : "text-fitx-text-secondary")}>
                <span className={cn(pill, active && "bg-fitx-primary/10 text-fitx-primary")}><NavGlyph icon={icon} size={20} active={active} /></span>
                <span>{label}</span>
              </Link>
            );
          })}
          <button ref={moreButton} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={openSheet}
            className={cn(tab, moreActive || open ? "font-semibold text-fitx-primary-text" : "text-fitx-text-secondary")}>
            <span className={cn(pill, (moreActive || open) && "bg-fitx-primary/10 text-fitx-primary")}><Ellipsis size={20} strokeWidth={moreActive || open ? 2.2 : 1.8} aria-hidden="true" /></span>
            <span>More</span>
          </button>
        </div>
      </nav>
      <dialog
        ref={sheet}
        aria-labelledby="more-sheet-title"
        className="fitx-sheet"
        onClose={() => { setOpen(false); moreButton.current?.focus(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeSheet(); }}
      >
        <div className="fitx-sheet__panel">
          <span aria-hidden="true" className="mx-auto mb-1 block h-1 w-9 rounded-full bg-fitx-track" />
          <div className="flex items-center justify-between gap-3 px-2 pb-2">
            <h2 id="more-sheet-title" className="font-heading text-base font-semibold text-fitx-text">More</h2>
            <button type="button" onClick={closeSheet} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text"><X size={18} aria-hidden="true" /></button>
          </div>
          <ul className="grid grid-cols-2 gap-2 px-1">
            {MORE_SECTIONS.map(({ href, label, icon }) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href}>
                  <Link href={href} onClick={closeSheet} aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-[84px] flex-col justify-between gap-3 rounded-2xl border p-3.5 text-[15px] transition-colors",
                      active ? "border-fitx-primary/40 bg-fitx-primary/10 font-semibold text-fitx-primary-text" : "border-fitx-border bg-fitx-surface text-fitx-text hover:bg-fitx-hover")}>
                    <NavGlyph icon={icon} size={20} active={active} className={active ? "text-fitx-primary" : "text-fitx-text-secondary"} />
                    <span className="leading-tight">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <ul aria-label="Account" className="mt-3 overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface mx-1">
            {ACCOUNT_NAV.map(({ href, label, icon }, index) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href} className={index ? "border-t border-fitx-divider" : undefined}>
                  <Link href={href} onClick={closeSheet} aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-12 items-center gap-3 px-3.5 text-[15px]", active ? "font-semibold text-fitx-primary-text" : "text-fitx-text hover:bg-fitx-hover")}>
                    <NavGlyph icon={icon} size={18} active={active} className={active ? undefined : "text-fitx-text-secondary"} />
                    <span className="flex-1">{label}</span>
                    <ChevronRight size={16} aria-hidden="true" className="text-fitx-text-disabled" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 px-3"><LogoutButton className="w-full" /></div>
        </div>
      </dialog>
    </>
  );
}
