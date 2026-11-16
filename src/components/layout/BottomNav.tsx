"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Ellipsis, X } from "lucide-react";
import { LogoutButton } from "@/components/app/LogoutButton";
import { PHONE_MORE, PHONE_TABS, isActivePath } from "@/config/navigation";
import { cn } from "@/lib/utils";

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

  if (pathname === "/workouts/active") return null;

  function openSheet() {
    sheet.current?.showModal();
    setOpen(true);
  }
  function closeSheet() {
    sheet.current?.close();
  }

  return (
    <>
      <nav aria-label="Main navigation" className="fitx-glass fitx-safe-inline fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-fitx-divider bg-fitx-nav pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 [--fitx-pad-inline:.25rem] md:hidden">
        {PHONE_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[11px]", active ? "font-medium text-fitx-primary-text" : "text-fitx-text-secondary")}>
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
        <button ref={moreButton} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={openSheet}
          className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[11px]", moreActive || open ? "font-medium text-fitx-primary-text" : "text-fitx-text-secondary")}>
          <Ellipsis size={20} strokeWidth={moreActive || open ? 2.2 : 1.8} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
      <dialog
        ref={sheet}
        aria-labelledby="more-sheet-title"
        className="fitx-sheet"
        onClose={() => { setOpen(false); moreButton.current?.focus(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeSheet(); }}
      >
        <div className="fitx-sheet__panel">
          <div className="flex items-center justify-between gap-3 px-2 pb-2">
            <h2 id="more-sheet-title" className="text-base font-semibold text-fitx-text">More</h2>
            <button type="button" onClick={closeSheet} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text"><X size={18} aria-hidden="true" /></button>
          </div>
          <ul className="space-y-1">
            {PHONE_MORE.map(({ href, label, icon: Icon }) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href}>
                  <Link href={href} onClick={closeSheet} aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px]", active ? "bg-fitx-primary/10 font-medium text-fitx-primary-text" : "text-fitx-text hover:bg-fitx-hover")}>
                    <Icon size={19} aria-hidden="true" className={active ? undefined : "text-fitx-text-secondary"} />{label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 border-t border-fitx-divider px-3 pt-1"><LogoutButton className="w-full" /></div>
        </div>
      </dialog>
    </>
  );
}
