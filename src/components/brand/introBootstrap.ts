/**
 * Runs inline in <head> (root layout) before the first paint. It
 *  - applies the saved site theme (`data-theme`),
 *  - marks signed-in visitors (`data-fitx-auth`, from the fitx_auth hint cookie) so static pages can
 *    show "Open dashboard" instead of "Log in" without a flash,
 *  - decides whether the intro film plays: once per account, on the first app page after that
 *    account's first sign-in (the server sets `fitx_intro=play`; this script consumes it at once, so a
 *    reload or a new tab never replays it), or on request with `?intro=live|video|play`. It then marks
 *    `<html data-fitx-intro="pending" data-fitx-intro-theme="light|dark">`, which CSS turns into the
 *    full-screen overlay showing the film's first frame, and preloads that frame,
 *  - otherwise, on a returning device (`fitx_intro=seen`), shows the short brand loader
 *    (`data-fitx-loader`) until the app hydrates, for at most about a second,
 *  - never shows either on a focus screen (a live workout, /workouts/active, or the activity recorder,
 *    /activity/record): the account's film waits for the next app page,
 *  - keeps Skip/Escape working before React hydrates, and gives the page back if the app never
 *    starts the intro (e.g. its JavaScript failed to load).
 * Keep it tiny, dependency-free and ES5-safe: it blocks parsing while it runs. No backslashes in it:
 * this is a template literal.
 */
export const INTRO_BOOTSTRAP_SCRIPT = `(function () {
  var root = document.documentElement;
  var mode = "system";
  try {
    var stored = window.localStorage.getItem("fitx-theme");
    if (stored === "light" || stored === "dark" || stored === "system") mode = stored;
  } catch (e) {}
  root.setAttribute("data-theme", mode);
  try {
    var cookie = function (name) {
      var parts = (document.cookie || "").split(";");
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^ +/, "");
        if (part.indexOf(name + "=") === 0) return part.slice(name.length + 1);
      }
      return null;
    };
    if (cookie("fitx_auth") === "1") root.setAttribute("data-fitx-auth", "1");
    var path = window.location.pathname;
    var section = path.split("/")[1] || "";
    var focus = path.indexOf("/workouts/active") === 0 || path.indexOf("/activity/record") === 0;
    var appPath = ["dashboard", "workouts", "nutrition", "activity", "ai-coach", "progress", "goals", "planner", "profile", "settings", "exercises", "form-coach", "help"].indexOf(section) !== -1 && !focus;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var intro = cookie("fitx_intro");
    var asked = (window.location.search.match(/[?&]intro=([a-z]+)/) || [])[1];
    var forced = (path === "/" || appPath) && (asked === "live" || asked === "video" || asked === "play");
    var gate = reduce ? null : forced ? "replay" : intro === "play" && appPath ? "account" : null;
    if (!gate) {
      if (reduce || intro !== "seen" || focus) return;
      root.setAttribute("data-fitx-loader", "on");
      var shownAt = Date.now();
      var hidden = false;
      var hide = function () {
        if (hidden) return;
        hidden = true;
        root.setAttribute("data-fitx-loader", "leaving");
        window.setTimeout(function () { root.removeAttribute("data-fitx-loader"); }, 220);
      };
      window.__fitxReleaseLoader = function () { window.setTimeout(hide, Math.max(0, 650 - (Date.now() - shownAt))); };
      window.setTimeout(hide, 1000);
      return;
    }
    if (gate === "account") {
      document.cookie = "fitx_intro=seen; Path=/; Max-Age=34560000; SameSite=Lax" + (window.location.protocol === "https:" ? "; Secure" : "");
    }
    root.setAttribute("data-fitx-intro-gate", gate);
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
    var release = function () {
      if (root.getAttribute("data-fitx-intro") !== "pending") return;
      root.removeAttribute("data-fitx-intro");
    };
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.closest && target.closest("[data-fitx-skip]")) release();
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") release(); });
    window.setTimeout(release, 8000);
  } catch (e) {}
})();`;
