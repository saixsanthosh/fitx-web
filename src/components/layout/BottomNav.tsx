"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronRight, Ellipsis, X } from "lucide-react";
import { LogoutButton } from "@/components/app/LogoutButton";
import { ACCOUNT_NAV, PHONE_MORE_GROUPS, PHONE_TAB_COUNT, PHONE_TABS, isActivePath, phoneSlot } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { NavGlyph } from "./NavGlyph";

/** Focus screens that hide the bar: the live workout and the activity recorder. */
const FOCUS_SCREENS = new Set(["/workouts/active", "/activity/record"]);
const SLOTS = PHONE_TAB_COUNT + 1;
const MORE_SECTIONS = PHONE_MORE_GROUPS.flatMap((group) => group.items.map((item) => ({ item, group })));

/**
 * Phones (under 768 px): a fixed bar with the four main sections and More. An ember line glides along the top
 * edge to the current tab and the tab's pill fills in. More opens a bottom sheet with the other sections in
 * their groups (a modal <dialog>: focus stays inside, Escape or a tap outside closes it, focus returns to More).
 */
export function BottomNav() {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const slot = open ? PHONE_TAB_COUNT : phoneSlot(pathname);
  const moreActive = slot === PHONE_TAB_COUNT;

  if (FOCUS_SCREENS.has(pathname)) return null;

  function openSheet() {
    sheet.current?.showModal();
    setOpen(true);
  }
  function closeSheet() {
    sheet.current?.close();
  }

  const tab = "fitx-nav-link flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none outline-offset-[-2px]";
  const pill = "grid h-7 w-14 place-items-center rounded-full transition-[background-color,transform] duration-300 ease-[cubic-bezier(.22,1,.36,1)]";

  return (
    <>
      <nav aria-label="Main navigation" data-coach-avoid="" className="fitx-glass fitx-safe-inline fixed inset-x-0 bottom-0 z-40 border-t border-fitx-divider bg-fitx-nav pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 [--fitx-pad-inline:.25rem] md:hidden">
        <div className="relative mx-auto grid max-w-[520px] grid-cols-5">
          {/* The current tab's marker: a short ember line on the bar's top edge that glides between tabs. */}
          <span aria-hidden="true" className="pointer-events-none absolute -top-1.5 left-0 flex h-[2px] justify-center transition-[transform,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
            style={{ width: `${100 / SLOTS}%`, transform: `translateX(${Math.max(slot, 0) * 100}%)`, opacity: slot < 0 ? 0 : 1 }}>
            <span className="h-full w-7 rounded-b-full bg-fitx-primary" />
          </span>
          {PHONE_TABS.map(({ href, label, icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(tab, active ? "font-semibold text-fitx-primary-text" : "text-fitx-text-secondary")}>
                <span className={cn(pill, active ? "scale-100 bg-fitx-primary/10 text-fitx-primary" : "scale-90")}><NavGlyph icon={icon} size={20} active={active} /></span>
                <span>{label}</span>
              </Link>
            );
          })}
          <button ref={moreButton} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={openSheet}
            className={cn(tab, "fitx-nav-more", moreActive ? "font-semibold text-fitx-primary-text" : "text-fitx-text-secondary")}>
            <span className={cn(pill, moreActive ? "scale-100 bg-fitx-primary/10 text-fitx-primary" : "scale-90")}><Ellipsis size={20} strokeWidth={moreActive ? 2.2 : 1.8} aria-hidden="true" className="fitx-navglyph" /></span>
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
          <div className="flex items-center justify-between gap-3 px-2 pb-1">
            <h2 id="more-sheet-title" className="font-heading text-base font-semibold text-fitx-text">More</h2>
            <button type="button" onClick={closeSheet} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text"><X size={18} aria-hidden="true" /></button>
          </div>
          {/* The sections not in the bar, each card carrying its group's name (Train, Track, Connect). */}
          <ul aria-label="Sections" className={cn("grid gap-2 px-1", MORE_SECTIONS.length % 3 === 0 ? "grid-cols-3" : "grid-cols-2")}>
            {MORE_SECTIONS.map(({ item: { href, label, shortLabel, icon }, group }) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href}>
                  <Link href={href} onClick={closeSheet} aria-current={active ? "page" : undefined} aria-label={label}
                    className={cn("fitx-nav-link flex h-full min-h-[104px] flex-col justify-between gap-2 rounded-2xl border p-3 transition-colors",
                      active ? "border-fitx-primary/40 bg-fitx-primary/10 text-fitx-primary-text" : "border-fitx-border bg-fitx-surface text-fitx-text hover:bg-fitx-hover")}>
                    <span data-nav-group={group.id} className="text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{group.label}</span>
                    <NavGlyph icon={icon} size={22} active={active} className={active ? "text-fitx-primary" : "text-fitx-text-secondary"} />
                    <span className={cn("text-[14px] leading-tight", active && "font-semibold")}>{shortLabel && MORE_SECTIONS.length % 3 === 0 ? shortLabel : label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <ul aria-label="Account" className="mx-1 mt-3 overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface">
            {ACCOUNT_NAV.map(({ href, label, icon }, index) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href} className={index ? "border-t border-fitx-divider" : undefined}>
                  <Link href={href} onClick={closeSheet} aria-current={active ? "page" : undefined}
                    className={cn("fitx-nav-link flex min-h-12 items-center gap-3 px-3.5 text-[15px]", active ? "font-semibold text-fitx-primary-text" : "text-fitx-text hover:bg-fitx-hover")}>
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
