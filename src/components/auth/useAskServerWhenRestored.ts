import { useEffect } from "react";
import { loadedFromHistory, shouldAskServerAgain } from "@/lib/auth/restored-page";

/**
 * Back after signing in (bug 40): a sign-in page the browser shows from the tab's history, while this browser holds
 * FITX's signed-in hint, asks the server again by reloading, so the proxy sends a signed-in member on instead of leaving
 * an empty form on screen (src/lib/auth/restored-page.ts). Checked once on load (a page from the disk cache runs again)
 * and on every pageshow (a page kept whole in the back-forward cache runs no effect when it comes back).
 */
export function useAskServerWhenRestored(): void {
  useEffect(() => {
    const askIf = (restored: boolean) => {
      if (shouldAskServerAgain({ pathname: window.location.pathname, restored, cookie: document.cookie })) window.location.reload();
    };
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    askIf(loadedFromHistory(entry?.type));
    const onPageShow = (event: PageTransitionEvent) => askIf(event.persisted);
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}
