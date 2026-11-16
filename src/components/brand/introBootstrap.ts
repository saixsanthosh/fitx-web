/**
 * Runs inline in <head> (root layout) before the first paint, so the intro's opening frame is the
 * first thing a visitor sees: no flash of the page underneath, no logo. It
 *  - applies the saved site theme (`data-theme`),
 *  - decides whether the intro plays (home page, first visit this tab, motion allowed) and marks
 *    `<html data-fitx-intro="pending" data-fitx-intro-theme="light|dark">`, which CSS turns into the
 *    full-screen overlay showing the film's first frame,
 *  - preloads that first-frame image for the current theme and orientation,
 *  - keeps Skip/Escape working before React hydrates, and gives the page back if the app never
 *    starts the intro (e.g. its JavaScript failed to load).
 * Keep it tiny, dependency-free and ES5-safe: it blocks parsing while it runs.
 */
export const INTRO_BOOTSTRAP_SCRIPT = `(function () {
  var root = document.documentElement;
  var mode = "light";
  try {
    var stored = window.localStorage.getItem("fitx-theme");
    if (stored === "light" || stored === "dark" || stored === "system") mode = stored;
  } catch (e) {}
  root.setAttribute("data-theme", mode);
  try {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var seen = false;
    try { seen = window.sessionStorage.getItem("fitx-cinematic-seen") === "1"; } catch (e) {}
    if (window.location.pathname !== "/" || reduce || seen) return;
    var dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var theme = dark ? "dark" : "light";
    var orientation = window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
    root.setAttribute("data-fitx-intro-theme", theme);
    root.setAttribute("data-fitx-intro", "pending");
    var link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = "/brand/intro/fitx-intro-" + theme + "-" + orientation + ".webp";
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
    var release = function (remember) {
      if (root.getAttribute("data-fitx-intro") !== "pending") return;
      root.removeAttribute("data-fitx-intro");
      if (remember) { try { window.sessionStorage.setItem("fitx-cinematic-seen", "1"); } catch (e) {} }
    };
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.closest && target.closest("[data-fitx-skip]")) release(true);
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") release(true); });
    window.setTimeout(function () { release(false); }, 8000);
  } catch (e) {}
})();`;
