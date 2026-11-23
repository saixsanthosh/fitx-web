"use client";

import { useEffect } from "react";
import { welcomeReportPending, whenAccountFilmOpens } from "./accountFilm";
import { FILM_SEEN_KEY } from "./introKeys";

const report = () => {
  void fetch("/api/intro/complete", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
};

/**
 * When the account's one-time film starts (the head script opened it on this page, also later in a tab that
 * loaded hidden and is then shown), records that on the account. And (D1) when the welcome film started on this
 * device but its own report never got through, tries again on this page load.
 */
export function IntroCompletionReporter() {
  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(FILM_SEEN_KEY);
    } catch {
      seen = null;
    }
    if (welcomeReportPending(document.cookie, seen)) report();
    return whenAccountFilmOpens(report);
  }, []);
  return null;
}
