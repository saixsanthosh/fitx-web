"use client";

import { useCallback, useEffect, useState } from "react";
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
export function ReturningLogin() {
  const [active, setActive] = useState(true);

  const release = useCallback(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-fitx-loader") === WELCOME_LOADER) root.removeAttribute("data-fitx-loader");
    setActive(false);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-fitx-loader") !== WELCOME_LOADER) {
      setActive(false);
      return;
    }
    // Skip or Escape before the app started, or the head script's own time limit, already gave the page back.
    const observer = new MutationObserver(() => {
      if (root.getAttribute("data-fitx-loader") !== WELCOME_LOADER) setActive(false);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-fitx-loader"] });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey);
    };
  }, [release]);

  if (!active) return null;
  return (
    <div className={styles.returning} data-fitx-returning="">
      <LogoReveal variant="return" onDone={release} />
    </div>
  );
}
