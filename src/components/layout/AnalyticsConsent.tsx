"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";

const CONSENT_KEY = "fitx-cookie-consent";

export function AnalyticsConsent() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, () => null);
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
    {choice === null && <aside aria-label="Cookie and analytics choices" className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-3xl rounded-xl border border-fitx-border bg-[#101719] p-4 shadow-[0_20px_70px_rgba(0,0,0,.5)] sm:inset-x-6 sm:bottom-6 sm:flex sm:items-center sm:gap-6 sm:p-5">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Your privacy choices</h2><p className="mt-1 text-xs leading-5 text-fitx-text-secondary">FITX uses essential sign-in storage. Optional, anonymous page analytics stay off unless you allow them. <Link href="/cookies" className="text-fitx-primary underline underline-offset-2">Cookie details</Link></p></div>
      <div className="mt-3 flex shrink-0 flex-wrap gap-2 sm:mt-0"><button onClick={() => choose("essential")} className="fitx-button fitx-button-quiet px-3 text-xs">Essential only</button><button onClick={() => choose("all")} className="fitx-button px-3 text-xs">Allow analytics</button></div>
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
