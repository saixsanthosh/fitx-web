"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { useBottomInsetRef } from "./useBottomInsetRef";

const CONSENT_KEY = "fitx-cookie-consent";

/**
 * Page analytics (only with consent) and the privacy banner until a choice is made. The banner floats at the bottom
 * (above the phone's bar, .fitx-consent in globals.css) and, while open, sets --fitx-inset-consent: the page keeps
 * that much clear when a control is scrolled into view and gets that much room at its end, so no control reached
 * with Tab stays under the banner.
 */
export function AnalyticsConsent() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const banner = useBottomInsetRef("consent");
  function choose(value: "all" | "essential") {
    try { window.localStorage.setItem(CONSENT_KEY, value); } catch { return; }
    window.dispatchEvent(new Event("fitx-cookie-consent-change"));
  }
  return <>
    <Analytics beforeSend={(event) => {
      try {
        if (window.localStorage.getItem(CONSENT_KEY) !== "all") return null;
        const url = new URL(event.url);
        event.url = `${url.origin}${url.pathname}`;
        return event;
      } catch { return null; }
    }} />
    {choice === null && <aside ref={banner} aria-label="Cookie and analytics choices" data-coach-avoid="" className="fitx-consent fixed inset-x-3 z-[100] mx-auto max-w-3xl rounded-xl border border-fitx-border bg-fitx-surface p-3 shadow-2xl sm:inset-x-6 sm:flex sm:items-center sm:gap-6 sm:p-5">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Your privacy choices</h2><p className="mt-1 text-xs leading-5 text-fitx-text-secondary">FITX uses essential sign-in storage. Optional, anonymous page analytics stay off unless you allow them. <Link href="/cookies" prefetch={false} className="text-fitx-primary-text underline underline-offset-2">Cookie details</Link></p></div>
      <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 sm:mt-0 sm:flex sm:flex-nowrap"><button onClick={() => choose("essential")} className="fitx-button fitx-button-quiet min-h-11 min-w-0 whitespace-nowrap px-3 text-sm">Essential only</button><button onClick={() => choose("all")} className="fitx-button min-h-11 min-w-0 whitespace-nowrap px-3 text-sm">Allow analytics</button></div>
    </aside>}
  </>;
}

function subscribe(onChange: () => void) {
  window.addEventListener("fitx-cookie-consent-change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("fitx-cookie-consent-change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): "all" | "essential" | null {
  try {
    const saved = window.localStorage.getItem(CONSENT_KEY);
    return saved === "all" || saved === "essential" ? saved : null;
  } catch { return "essential"; }
}
