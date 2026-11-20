import { INTRO_PLAY_MAX_AGE } from "@/lib/auth/cookies";
import { ACCOUNT_FILM_STARTED_KEY, INTRO_PENDING_EVENT, VISITOR_FILM_SEEN_KEY } from "./introKeys";

/**
 * How long after this device started an account's film another "play" counts as a copy of the one it used:
 * as long as a "play" lives (a response that raced the first one sets a fresh one), and an hour more.
 */
const ACCOUNT_FILM_REPEAT_MS = (INTRO_PLAY_MAX_AGE + 60 * 60) * 1000;

/**
 * Runs inline in <head> (root layout) before the first paint. It
 *  - applies the saved site theme (`data-theme`),
 *  - marks signed-in visitors (`data-fitx-auth`, from the fitx_auth hint cookie) so static pages can
 *    show "Open dashboard" instead of "Log in" without a flash,
 *  - decides whether the intro film plays (`data-fitx-intro-gate` says why):
 *     - "replay": on request with `?intro=live|video|play`, on the home page or an app page;
 *     - "account": once per account, on the first app page after the server marked this device
 *       `fitx_intro=play` (at sign-in, or from the proxy for a device that was already signed in while
 *       the account had not seen the film; see src/proxy.ts). This script consumes it at once, so a
 *       reload or a new tab never replays it; IntroCompletionReporter records it on the account. A "play"
 *       that turns up again within a day of this device starting an account's film is consumed without
 *       playing: it is a copy the server sent to a page requested at the same time as the first one
 *       (tabs restored together). Signing out ends that (the next signed-out page load forgets it), so
 *       the next account on the device gets its own film. Pages that run this at the very same moment in
 *       several tabs can't see each other yet, so each leaves its claim (`window.__fitxAccountFilm`) and
 *       CinematicIntro plays only the latest one (accountFilmClaimedElsewhere);
 *     - "visitor": signed-out visitors, on the home page "/" and no other page, once per tab as on the
 *       old site (a new tab or window plays it again; CinematicIntro remembers it in sessionStorage when
 *       the film starts, and so does Skip or Escape here). It records nothing on any account and writes no
 *       cookie, so it never touches the account's film. Never for a signed-in visitor (fitx_auth hint),
 *       whom the proxy sends on to the dashboard anyway.
 *    It then marks `<html data-fitx-intro="pending" data-fitx-intro-theme="light|dark">`, which CSS
 *    turns into the full-screen overlay showing the film's first frame, preloads that frame, and
 *    announces it (INTRO_PENDING_EVENT),
 *  - waits while the page is hidden (a tab opened in the background, or prerendered): nothing is
 *    consumed, marked or preloaded until the page is first shown, and the film is chosen then, so a tab
 *    nobody has looked at never uses up or records the account's film,
 *  - otherwise, on a returning device (`fitx_intro=seen`), shows the short brand loader
 *    (`data-fitx-loader`) until the app hydrates: at least 0.56 s, gone by 1.08 s at most,
 *  - never shows either on a focus screen (a live workout, /workouts/active, or the activity recorder,
 *    /activity/record): the account's film waits for the next app page,
 *  - never plays the account's film on Help either, which an account still in setup can open (see
 *    src/lib/auth/before-onboarding.ts): the film waits for the first app page after setup, and someone
 *    asking for help is not shown it first. Help still gets the loader,
 *  - never plays any film with prefers-reduced-motion, and never shows the loader then either,
 *  - keeps Skip/Escape working before React hydrates, in the capture phase on the document, ahead of
 *    React's own listeners: until React has the code for a part of the page it has not hydrated yet
 *    (e.g. the overlay's chunk is still loading), it stops clicks and key presses aimed there,
 *  - while the film is pending, keeps keyboard focus on Skip: Tab and Shift+Tab go to it, and focus that
 *    reaches the page behind another way (Tab from the browser's toolbar, a screen reader moving focus)
 *    is sent back to it, so Enter can't follow a hidden link. It hides nothing: until the film starts
 *    and CinematicIntro makes the page inert, a screen reader can still read the page behind,
 *  - gives the page back if the app never starts the intro (e.g. its JavaScript failed to load) after
 *    8 seconds of the page being shown.
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
    var read = function (kind, key) {
      try { return window[kind].getItem(key); } catch (e) { return null; }
    };
    var write = function (kind, key, value) {
      try { if (value === null) window[kind].removeItem(key); else window[kind].setItem(key, value); } catch (e) {}
    };
    var still = function () { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; };
    var hidden = function () { return document.visibilityState === "hidden" || document.prerendering === true; };
    var place = function () {
      var path = window.location.pathname;
      var section = path.split("/")[1] || "";
      var focus = path.indexOf("/workouts/active") === 0 || path.indexOf("/activity/record") === 0;
      var app = ["dashboard", "workouts", "nutrition", "activity", "ai-coach", "progress", "goals", "planner", "profile", "settings", "exercises", "home-workout", "form-coach"].indexOf(section) !== -1 && !focus;
      return { path: path, focus: focus, app: app };
    };
    var signedIn = cookie("fitx_auth") === "1";
    if (signedIn) root.setAttribute("data-fitx-auth", "1");
    else if (read("localStorage", "${ACCOUNT_FILM_STARTED_KEY}") !== null) write("localStorage", "${ACCOUNT_FILM_STARTED_KEY}", null);
    var pick = function (here) {
      if (still()) return null;
      var asked = (window.location.search.match(/[?&]intro=([a-z]+)/) || [])[1];
      if ((here.path === "/" || here.app) && (asked === "live" || asked === "video" || asked === "play")) return "replay";
      if (here.app && cookie("fitx_intro") === "play") return "account";
      if (here.path === "/" && cookie("fitx_auth") !== "1" && read("sessionStorage", "${VISITOR_FILM_SEEN_KEY}") !== "1") return "visitor";
      return null;
    };
    var open = function (gate) {
      if (gate === "account") {
        document.cookie = "fitx_intro=seen; Path=/; Max-Age=34560000; SameSite=Lax" + (window.location.protocol === "https:" ? "; Secure" : "");
        var age = Date.now() - Number(read("localStorage", "${ACCOUNT_FILM_STARTED_KEY}"));
        if (age >= 0 && age < ${ACCOUNT_FILM_REPEAT_MS}) return false;
        var claim = String(Date.now() + Math.random());
        write("localStorage", "${ACCOUNT_FILM_STARTED_KEY}", claim);
        window.__fitxAccountFilm = claim;
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
      var release = function (skipped) {
        if (root.getAttribute("data-fitx-intro") !== "pending") return;
        root.removeAttribute("data-fitx-intro");
        if (skipped && gate === "visitor") write("sessionStorage", "${VISITOR_FILM_SEEN_KEY}", "1");
      };
      var pendingSkip = function () {
        return root.getAttribute("data-fitx-intro") === "pending" ? document.querySelector("[data-fitx-skip]") : null;
      };
      document.addEventListener("click", function (event) {
        var target = event.target;
        if (target && target.closest && target.closest("[data-fitx-skip]")) release(true);
      }, true);
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") release(true);
        var skip = event.key === "Tab" && pendingSkip();
        if (!skip) return;
        event.preventDefault();
        skip.focus({ preventScroll: true });
      }, true);
      document.addEventListener("focusin", function (event) {
        var skip = pendingSkip();
        var target = event.target;
        if (skip && target && target.closest && !target.closest("[data-fitx-intro-overlay]")) skip.focus({ preventScroll: true });
      }, true);
      var wait = function () {
        window.setTimeout(function () {
          if (!hidden()) return release(false);
          var back = function () {
            if (hidden()) return;
            document.removeEventListener("visibilitychange", back);
            wait();
          };
          document.addEventListener("visibilitychange", back);
        }, 8000);
      };
      wait();
      try { window.dispatchEvent(new Event("${INTRO_PENDING_EVENT}")); } catch (e) {}
      return true;
    };
    var here = place();
    var gate = pick(here);
    if (gate && hidden()) {
      var shown = function () {
        if (hidden()) return;
        document.removeEventListener("visibilitychange", shown);
        document.removeEventListener("prerenderingchange", shown);
        var later = pick(place());
        if (later) open(later);
      };
      document.addEventListener("visibilitychange", shown);
      document.addEventListener("prerenderingchange", shown);
      return;
    }
    if (gate && open(gate)) return;
    var intro = gate === "account" ? "seen" : cookie("fitx_intro");
    if (still() || intro !== "seen" || here.focus) return;
    root.setAttribute("data-fitx-loader", "on");
    var shownAt = Date.now();
    var gone = false;
    var hide = function () {
      if (gone) return;
      gone = true;
      root.setAttribute("data-fitx-loader", "leaving");
      window.setTimeout(function () { root.removeAttribute("data-fitx-loader"); }, 180);
    };
    window.__fitxReleaseLoader = function () { window.setTimeout(hide, Math.max(0, 560 - (Date.now() - shownAt))); };
    window.setTimeout(hide, 900);
  } catch (e) {}
})();`;
