"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { activeSting } from "../films/manifest";
import { playReturnSting } from "../films/sting";
import { LogoReveal } from "./LogoReveal";
import styles from "./ReturningLogin.module.css";

/** The head script's mark for a returning member's sign-in (see introBootstrap.ts). */
export const WELCOME_LOADER = "welcome";

/**
 * A returning member's sign-in: the logo reveal before the dashboard, in place of the plain brand loader. Mounted
 * once by the root layout. It is in the server HTML, hidden, so that when the head script marks
 * `<html data-fitx-loader="welcome">` (cookie fitx_welcome=return, see introBootstrap.ts) the reveal plays from the
 * first paint. On any other page load it removes itself as soon as the app starts. Skip, Escape or the end of the
 * reveal give the page back; the head script also gives it back on its own after 2.6 s if the app never starts.
 */
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-fitx-loader"] });
  return () => observer.disconnect();
};
const welcoming = () => document.documentElement.getAttribute("data-fitx-loader") === WELCOME_LOADER;
// The server cannot know: it renders the reveal (hidden by CSS unless the head script marks the page).
const onServer = () => true;

export function ReturningLogin() {
  // Follows the head script's mark: gone once Skip, Escape, the end of the reveal or the script's own limit clear it.
  const active = useSyncExternalStore(subscribe, welcoming, onServer);

  const release = useCallback(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-fitx-loader") === WELCOME_LOADER) root.removeAttribute("data-fitx-loader");
  }, []);

  // The sting (BRIEF-2 3.4): once, as the reveal starts, only with film sound turned on (a build without one: silent).
  useEffect(() => {
    // Hydration renders with the server's guess (active); only a page the head script really marked plays it.
    if (!active || !welcoming()) return;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    playReturnSting({
      sting: activeSting(),
      storage,
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      createAudio: (src) => {
        const audio = new Audio(src);
        audio.preload = "auto";
        return audio;
      },
    });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, release]);

  if (!active) return null;
  return (
    <div className={styles.returning} data-fitx-returning="">
      <LogoReveal variant="return" onDone={release} />
    </div>
  );
}
