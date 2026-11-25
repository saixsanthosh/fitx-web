"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { Logo } from "@/components/ui/Logo";
import { inSetupMode, onboardedFrom, SETUP_PATH } from "./setup-mode";
import { SkipLink } from "./SkipLink";

/**
 * Marks the page as in setup mode (setup-mode.ts) with a hidden element, which globals.css finds with :has(): the
 * app's menu, account menu and AI Coach button (.fitx-app-only) go, the setup header (.fitx-setup-only) comes. CSS
 * rather than state, so the page as the server sends it is already right. It reads the address's ?from=, so the
 * layout gives it its own Suspense boundary: static pages draw it in the browser only, and the rest of the shell
 * stays in their HTML.
 */
export function SetupModeMarker() {
  const pathname = usePathname();
  const from = useSearchParams().get("from");
  const context = useOptionalUserContext();
  return inSetupMode({ pathname, from, onboarded: onboardedFrom(context) }) ? <span hidden data-fitx-setup="" /> : null;
}

/** In setup mode, the header in place of the app's menu: FITX and the one way on from Help, back to setup. */
export function SetupHeader() {
  return (
    <div className="fitx-setup-only sticky top-0 z-30">
      <header className="fitx-safe-inline flex h-[60px] items-center justify-between gap-3 border-b border-fitx-divider bg-fitx-bg [--fitx-pad-inline:1rem] sm:[--fitx-pad-inline:1.5rem] md:h-16">
        <SkipLink />
        <span className="flex min-h-11 shrink-0 items-center"><Logo size={30} /></span>
        <Link href={SETUP_PATH} className="fitx-button fitx-button-secondary min-h-11 whitespace-nowrap px-4 text-sm">
          <ArrowLeft size={16} aria-hidden="true" />Back to setup
        </Link>
      </header>
    </div>
  );
}
