"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { PUBLIC_NAV } from "./publicNav";
import styles from "./PublicHeader.module.css";

/** Phones: the public pages' menu as a top sheet (a modal <dialog>, closed by Escape or a tap outside). */
export function PublicMobileMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();

  return (
    <>
      <button ref={opener} type="button" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { dialog.current?.showModal(); setOpen(true); }}
        className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text hover:bg-fitx-hover md:hidden">
        <Menu size={20} aria-hidden="true" />
      </button>
      <dialog ref={dialog} aria-label="Menu" className="fitx-sheet fitx-sheet--top"
        onClose={() => { setOpen(false); opener.current?.focus(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="fitx-sheet__panel fitx-scroll-cue">
          <div className="flex items-center justify-between gap-3 pb-2 pl-2">
            <Link href="/" onClick={close} aria-label="FITX home" className="flex min-h-11 items-center"><Logo size={30} /></Link>
            <button type="button" onClick={close} aria-label="Close menu" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text"><X size={20} aria-hidden="true" /></button>
          </div>
          <nav aria-label="Site">
            <ul className="space-y-1">
              {PUBLIC_NAV.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} onClick={close} className="flex min-h-12 items-center justify-between rounded-lg px-3 text-base font-medium text-fitx-text hover:bg-fitx-hover">
                    {label}<ArrowRight size={16} aria-hidden="true" className="text-fitx-text-secondary" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-3 grid gap-2 border-t border-fitx-divider pt-4">
            <span className={styles.signedOutStack}>
              <Link href="/signup" prefetch={false} onClick={close} className="fitx-button w-full">Create account</Link>
              <Link href="/signin" prefetch={false} onClick={close} className="fitx-button fitx-button-secondary w-full">Log in</Link>
            </span>
            <span className={styles.signedInStack}>
              <Link href="/dashboard" prefetch={false} onClick={close} className="fitx-button w-full">Open dashboard</Link>
            </span>
          </div>
        </div>
      </dialog>
    </>
  );
}
