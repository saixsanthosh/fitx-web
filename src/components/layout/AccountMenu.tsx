"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronsUpDown, UserRound } from "lucide-react";
import { LogoutButton } from "@/components/app/LogoutButton";
import { ACCOUNT_NAV, isActivePath } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { menuOpenOn, type MenuOpenOn } from "./account-menu-open";
import type { AccountSummary } from "./useAccountSummary";

export function AccountAvatar({ summary, size = 36 }: { summary: AccountSummary | null; size?: number }) {
  // A photo that fails to load (an external Google picture, an expired link) falls back to the icon.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = summary?.avatarUrl;
  if (src && src !== failedSrc) {
    return <Image src={src} alt="" width={size} height={size} unoptimized onError={() => setFailedSrc(src)} className="shrink-0 rounded-full border border-fitx-border object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-full border border-fitx-border bg-fitx-surface-variant text-fitx-text-secondary" style={{ width: size, height: size }}>
      <UserRound size={Math.round(size * 0.47)} aria-hidden="true" />
    </span>
  );
}

/**
 * The account menu: Profile, Settings, Help and feedback, and Log out, in a panel that opens from its button (a
 * disclosure: focus moves into the panel, Escape or a press or focus outside closes it, Escape gives focus back).
 *  - "header": the avatar button in the phone and tablet header; the panel drops down below it, under the name.
 *  - "sidebar": the account's card at the foot of the desktop sidebar (photo, name, email); the panel opens above
 *    it. One row instead of the old card, three links and Log out (265 px), so the whole menu fits on a 1366 x 768
 *    laptop screen, browser bars and all (bug 73).
 * The page the member is on is marked in the panel, and the sidebar's card shows it holds the current page.
 */
export function AccountMenu({ summary, placement = "header" }: { summary: AccountSummary | null; placement?: "header" | "sidebar" }) {
  const pathname = usePathname();
  // Open on the page it was opened on: a page change closes it, however the page changed (a link in the panel, the
  // browser's Back or Forward, a swipe), and forgets that page there and then, so only the button opens it again
  // (account-menu-open.ts). Reset while rendering, not in an effect, so the panel never shows on the new page, not
  // even for one paint.
  const [openOn, setOpenOn] = useState<MenuOpenOn>(null);
  const settled = menuOpenOn(openOn, pathname);
  if (settled !== openOn) setOpenOn(settled);
  const open = settled !== null;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const sidebar = placement === "sidebar";
  const onAccountPage = ACCOUNT_NAV.some(({ href }) => isActivePath(pathname, href));

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenOn(null);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpenOn(null);
    };
    const onFocus = (event: FocusEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={summary?.name ? `Account: ${summary.name}` : "Account"}
        onClick={() => setOpen(!open)}
        className={sidebar
          ? cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-fitx-hover", (open || onAccountPage) && "bg-fitx-surface shadow-[inset_0_0_0_1px_var(--fitx-border)]")
          : "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full pl-1 pr-1 transition-colors hover:bg-fitx-hover md:pr-2.5"}
      >
        {sidebar ? (
          <>
            <AccountAvatar summary={summary} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fitx-text">{summary?.name || "Your account"}</span>
              {summary?.email && <span className="block truncate text-xs text-fitx-text-secondary">{summary.email}</span>}
            </span>
            <ChevronsUpDown size={16} aria-hidden="true" className="shrink-0 text-fitx-text-secondary" />
          </>
        ) : (
          <>
            <AccountAvatar summary={summary} size={34} />
            <span className="hidden max-w-32 truncate text-sm text-fitx-text-secondary md:block">{summary?.name}</span>
            <ChevronDown size={15} aria-hidden="true" className="hidden text-fitx-text-secondary md:block" />
          </>
        )}
      </button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        className={cn(
          "absolute z-50 rounded-2xl border border-fitx-border bg-fitx-elevated p-2 shadow-[0_24px_60px_color-mix(in_srgb,var(--fitx-scrim)_18%,transparent)]",
          sidebar ? "inset-x-0 bottom-full mb-2" : "right-0 top-full mt-2 w-64",
        )}
      >
        {summary && !sidebar && (
          <div className="flex items-center gap-3 border-b border-fitx-divider px-2 pb-3 pt-1">
            <AccountAvatar summary={summary} size={38} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fitx-text">{summary.name || "Your account"}</p>
              {summary.email && <p className="truncate text-xs text-fitx-text-secondary">{summary.email}</p>}
            </div>
          </div>
        )}
        <ul className="py-1">
          {ACCOUNT_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-fitx-hover", active ? "font-semibold text-fitx-primary-text" : "text-fitx-text")}>
                  <Icon size={17} aria-hidden="true" className={active ? "text-fitx-primary" : "text-fitx-text-secondary"} />{label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-fitx-divider px-3 pt-1">
          <LogoutButton className="w-full" />
        </div>
      </div>
    </div>
  );
}
