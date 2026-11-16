"use client";

import { useEffect } from "react";

/** When the account's one-time film starts (the head script marked it), records that on the account. */
export function IntroCompletionReporter() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.fitxIntroGate !== "account") return;
    delete root.dataset.fitxIntroGate;
    void fetch("/api/intro/complete", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => undefined);
  }, []);
  return null;
}
