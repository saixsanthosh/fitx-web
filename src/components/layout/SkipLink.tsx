"use client";

import type { MouseEvent } from "react";

/**
 * "Skip to content" for keyboard and switch users: hidden until focused, then moves focus to the
 * page's main content (`#main-content`, or the first <main> when a page has no id). To show it only at
 * some widths, wrap it (e.g. <div className="md:hidden">): its styles are unlayered and beat utilities.
 */
export function SkipLink() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById("main-content") ?? document.querySelector("main");
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
    target.scrollIntoView({ block: "start" });
  }
  return <a href="#main-content" onClick={skip} className="fitx-skip-link">Skip to content</a>;
}
