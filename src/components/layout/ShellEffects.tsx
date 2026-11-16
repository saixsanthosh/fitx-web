"use client";

import { useEffect } from "react";
import { syncBrowserThemeColor, THEME_EVENT } from "@/components/ui/theme";

type NetworkInformation = { saveData?: boolean; effectiveType?: string; addEventListener?: (type: "change", listener: () => void) => void; removeEventListener?: (type: "change", listener: () => void) => void };

/**
 * Page-wide effects every shell needs; renders nothing.
 * - Keeps the browser's theme colour on the chosen theme.
 * - In the signed-in app (`account`), applies the account's saved theme or pushes a choice this device
 *   could not save earlier.
 * - Marks `<html data-fitx-lite>` on Save-Data, 2G, low-memory (≤ 2 GB) or reduced-motion devices, which
 *   switches off decorative motion and backdrop blur (globals.css).
 */
export function ShellEffects({ account = false }: { account?: boolean }) {
  useEffect(() => {
    syncBrowserThemeColor();
    window.addEventListener(THEME_EVENT, syncBrowserThemeColor);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", syncBrowserThemeColor);

    const nav = navigator as Navigator & { connection?: NetworkInformation; deviceMemory?: number };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateLite = () => {
      const connection = nav.connection;
      const lite = connection?.saveData === true
        || /(^|-)2g$/.test(connection?.effectiveType ?? "")
        || (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2)
        || motion.matches;
      document.documentElement.toggleAttribute("data-fitx-lite", lite);
    };
    updateLite();
    motion.addEventListener("change", updateLite);
    nav.connection?.addEventListener?.("change", updateLite);

    let live = true;
    if (account) {
      void import("@/components/ui/accountTheme")
        .then(({ syncAccountTheme }) => (live ? syncAccountTheme() : undefined))
        .catch(() => undefined);
    }
    return () => {
      live = false;
      window.removeEventListener(THEME_EVENT, syncBrowserThemeColor);
      scheme.removeEventListener("change", syncBrowserThemeColor);
      motion.removeEventListener("change", updateLite);
      nav.connection?.removeEventListener?.("change", updateLite);
    };
  }, [account]);
  return null;
}
