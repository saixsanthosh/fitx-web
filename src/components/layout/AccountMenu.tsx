"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { LogoutButton } from "@/components/app/LogoutButton";
import { ACCOUNT_NAV } from "@/config/navigation";
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

/** The avatar button in the app header: Profile, Settings and Log out. */
export function AccountMenu({ summary }: { summary: AccountSummary | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocus = (event: FocusEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
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
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-2 rounded-full pl-1 pr-1 transition-colors hover:bg-fitx-hover md:pr-2.5"
      >
        <AccountAvatar summary={summary} size={34} />
        <span className="hidden max-w-32 truncate text-sm text-fitx-text-secondary md:block">{summary?.name}</span>
        <ChevronDown size={15} aria-hidden="true" className="hidden text-fitx-text-secondary md:block" />
      </button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-fitx-border bg-fitx-elevated p-2 shadow-[0_24px_60px_color-mix(in_srgb,var(--fitx-scrim)_18%,transparent)]"
      >
        {summary && (
          <div className="flex items-center gap-3 border-b border-fitx-divider px-2 pb-3 pt-1">
            <AccountAvatar summary={summary} size={38} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fitx-text">{summary.name || "Your account"}</p>
              {summary.email && <p className="truncate text-xs text-fitx-text-secondary">{summary.email}</p>}
            </div>
          </div>
        )}
        <ul className="py-1">
          {ACCOUNT_NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-fitx-text transition-colors hover:bg-fitx-hover">
                <Icon size={17} aria-hidden="true" className="text-fitx-text-secondary" />{label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-fitx-divider px-3 pt-1">
          <LogoutButton className="w-full" />
        </div>
      </div>
    </div>
  );
}
