"use client";

import type { MouseEvent } from "react";

/**
 * "Skip to content" for keyboard and switch users: hidden until focused, then moves focus to the
 * page's main content (`#main-content`, or the first <main> when a page has no id).
 */
export function SkipLink({ className = "" }: { className?: string }) {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById("main-content") ?? document.querySelector("main");
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
    target.scrollIntoView({ block: "start" });
  }
  return <a href="#main-content" onClick={skip} className={`fitx-skip-link ${className}`}>Skip to content</a>;
}
