"use client";

import { useSyncExternalStore } from "react";

/** The page's effective theme: a saved choice on <html data-theme>, else the device's preference. */
function readTheme(): "light" | "dark" {
  const saved = document.documentElement.dataset.theme;
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

/** `null` on the server and during hydration, so nothing theme-specific is fetched before the theme is known. */
export function useSiteTheme(): "light" | "dark" | null {
  return useSyncExternalStore(subscribe, readTheme, () => null);
}
