import { useEffect, useRef } from "react";
import { drawCounter, restoredOnMount, shouldAskServerAgain } from "@/lib/auth/restored-page";

/** The sign-in pages this document has drawn: only its first, at its own address, is the server's answer. */
const firstDraw = drawCounter();

/**
 * Back after signing in (bug 40): a sign-in page shown from a copy (the tab's history, or what Next's router already had)
 * while this browser holds FITX's signed-in hint asks the server again by reloading, so the proxy sends a signed-in
 * member on instead of leaving an empty form on screen (src/lib/auth/restored-page.ts). Checked on every mount (a page
 * from the disk cache runs again, and the router draws a page again for Back or Forward inside the document, or for a
 * prefetched link) and on every pageshow (a page kept whole in the back-forward cache runs no effect when it comes back).
 */
export function useAskServerWhenRestored(): void {
  /** Whether this page is the document's first sign-in page, decided once (drawCounter). */
  const page = useRef<boolean | null>(null);
  useEffect(() => {
    const askIf = (restored: boolean) => {
      if (shouldAskServerAgain({ pathname: window.location.pathname, restored, cookie: document.cookie })) window.location.reload();
    };
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    askIf(restoredOnMount({ navigationType: entry?.type, firstDraw: firstDraw(page), documentAddress: entry?.name, address: window.location.href }));
    const onPageShow = (event: PageTransitionEvent) => askIf(event.persisted);
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}
