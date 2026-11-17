"use client";

import { useEffect } from "react";
import { whenAccountFilmOpens } from "./accountFilm";

/**
 * When the account's one-time film starts (the head script opened it on this page, also later in a tab that
 * loaded hidden and is then shown), records that on the account.
 */
export function IntroCompletionReporter() {
  useEffect(() => whenAccountFilmOpens(() => {
    void fetch("/api/intro/complete", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
  }), []);
  return null;
}
