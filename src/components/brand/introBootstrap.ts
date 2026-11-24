import { INTRO_PLAY_MAX_AGE } from "@/lib/auth/cookies";
import { FILM_ATTR, FILM_CUT_ATTR } from "./films/compositions";
import { bootstrapFilms, PICK_COMPOSITION_ES5 } from "./films/bootstrap-twin";
import { FILM_MANIFESTS } from "@/components/brand/films/cuts.generated";
import { FIXTURE_COOKIE, FIXTURE_MANIFESTS } from "./films/fixture";
import type { FilmManifests } from "./films/manifest";
import {
  ACCOUNT_FILM_STARTED_KEY,
  FILM_HANDOFF_KEY,
  FILM_HANDOFF_MS,
  FILM_POSTER_VAR,
  FILM_SEEN_KEY,
  FILM_SEEN_MS,
  INTRO_PENDING_EVENT,
  RETURNING_WELCOME_COOKIE,
  VISITOR_FILM_SEEN_KEY,
} from "./introKeys";

/** How long a returning member's logo reveal may hold the page if the app never ends it (ms). */
export const WELCOME_FALLBACK_MS = 2600;

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
 *     - "replay": on request with `?intro=live|video|play` (the intro) or `?intro=welcome` (the welcome film, only when
 *       its cuts exist), on the home page or an app page;
 *     - "account": once per account, on the first app page after the server marked this device
 *       `fitx_intro=play` (at sign-in, or from the proxy for a device that was already signed in while
 *       the account had not seen the film; see src/proxy.ts). This script consumes it at once, so a
 *       reload or a new tab never replays it; IntroCompletionReporter records it on the account. A "play"
 *       that turns up again within a day of this device starting an account's film is consumed without
 *       playing: it is a copy the server sent to a page requested at the same time as the first one
 *       (tabs restored together). Signing out ends that (the next signed-out page load forgets it), so
 *       the next account on the device gets its own film. Pages that run this at the very same moment in
 *       several tabs can't see each other yet, so each leaves its claim (`window.__fitxAccountFilm`) and
 *       CinematicIntro plays only the latest one (accountFilmClaimedElsewhere). It plays the welcome film once its cuts
 *       exist (D1), the intro film until then. It is skipped (the cookie left as it is, for IntroCompletionReporter's
 *       retry) for 7 days after this device started the welcome film (localStorage FILM_SEEN_KEY), so a failed
 *       /api/intro/complete never replays it. That flag belongs to the session that played the film, not to the device:
 *       the next signed-out page load forgets it too, so another account signing in here still gets its own film
 *       (and is never recorded as having seen one it did not);
 *     - "visitor": signed-out visitors, on the home page "/" and no other page, once per device (first-time
 *       visitors only; CinematicIntro remembers it in localStorage when the film starts, and so does Skip or
 *       Escape here). It records nothing on any account and writes no cookie, so it never touches the
 *       account's film. Never for a signed-in visitor (fitx_auth hint), whom the proxy sends on to the
 *       dashboard anyway.
 *    It then marks `<html data-fitx-intro="pending" data-fitx-intro-theme="light|dark">`, which CSS
 *    turns into the full-screen overlay showing the film's first frame, plus `data-fitx-film="intro|welcome"` (the
 *    film claimed) and `data-fitx-film-cut="<composition>"` (the composition its cut is for, chosen by the viewport's
 *    aspect through the ES5 twin of pickComposition, films/bootstrap-twin.ts). It preloads that composition's poster
 *    from the manifest (and puts it in the --fitx-film-poster property the overlay's CSS reads), and announces it
 *    (INTRO_PENDING_EVENT),
 *  - waits while the page is hidden (a tab opened in the background, or prerendered): nothing is
 *    consumed, marked or preloaded until the page is first shown, and the film is chosen then, so a tab
 *    nobody has looked at never uses up or records the account's film,
 *  - on the first app page after a returning member signs in (cookie fitx_welcome=return, set at sign-in),
 *    consumes the cookie and marks `data-fitx-loader="welcome"`: the logo reveal (ReturningLogin) instead of
 *    the loader. Skip (`data-fitx-welcome-skip`) or Escape give the page back before React hydrates, and so does
 *    a 2.6 s limit if the app never ends it. A film that plays wins (it ends on the logo) and the cookie is
 *    consumed all the same; a page still hidden leaves it for the next one,
 *  - otherwise, on a returning device (`fitx_intro=seen`), shows the short brand loader
 *    (`data-fitx-loader`) until the app hydrates: at least 0.56 s, gone by 1.08 s at most,
 *  - but not on the first page after the sequence that follows onboarding ended on the FITX logo in this tab (its
 *    welcome film, or its logo; sessionStorage FILM_HANDOFF_KEY, used up by this page load): that page shows neither
 *    the loader nor the returning sign-in's logo, so there are never two logos in a row and the member goes straight
 *    to Home (D1),
 *  - never shows either on a focus screen (a live workout, /workouts/active, the AI Form Check camera
 *    /workouts/form-check, or the activity recorder,
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
export function buildIntroBootstrapScript({ manifests, fixture }: { manifests: FilmManifests; fixture: FilmManifests | null }): string {
  return `(function () {
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
      var focus = path.indexOf("/workouts/active") === 0 || path.indexOf("/activity/record") === 0 || path.indexOf("/workouts/form-check") === 0;
      var app = ["dashboard", "workouts", "nutrition", "activity", "ai-coach", "progress", "goals", "planner", "profile", "settings", "exercises", "home-workout", "form-coach", "explore"].indexOf(section) !== -1 && !focus;
      return { path: path, focus: focus, app: app };
    };
    var films = ${JSON.stringify(bootstrapFilms(manifests))};
    var fixture = ${fixture ? JSON.stringify(bootstrapFilms(fixture)) : "null"};
    if (fixture && cookie("${FIXTURE_COOKIE}") === "1") films = fixture;
    var pickComposition = ${PICK_COMPOSITION_ES5};
    var seenRecently = function () {
      var age = Date.now() - Date.parse(read("localStorage", "${FILM_SEEN_KEY}") || "");
      return age >= 0 && age < ${FILM_SEEN_MS};
    };
    var signedIn = cookie("fitx_auth") === "1";
    if (signedIn) root.setAttribute("data-fitx-auth", "1");
    else {
      if (read("localStorage", "${ACCOUNT_FILM_STARTED_KEY}") !== null) write("localStorage", "${ACCOUNT_FILM_STARTED_KEY}", null);
      if (read("localStorage", "${FILM_SEEN_KEY}") !== null) write("localStorage", "${FILM_SEEN_KEY}", null);
    }
    var pick = function (here) {
      if (still()) return null;
      var asked = (window.location.search.match(/[?&]intro=([a-z]+)/) || [])[1];
      if ((here.path === "/" || here.app) && (asked === "live" || asked === "video" || asked === "play")) return "replay";
      if ((here.path === "/" || here.app) && asked === "welcome") return films.welcome ? "replay" : null;
      if (here.app && cookie("fitx_intro") === "play" && !seenRecently()) return "account";
      if (here.path === "/" && cookie("fitx_auth") !== "1" && read("localStorage", "${VISITOR_FILM_SEEN_KEY}") !== "1") return "visitor";
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
      var asked = (window.location.search.match(/[?&]intro=([a-z]+)/) || [])[1];
      var film = (gate === "replay" && asked === "welcome") || (gate === "account" && films.welcome) ? "welcome" : "intro";
      var data = films[film] || { comps: [], posters: {} };
      var dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      var theme = dark ? "dark" : "light";
      var comp = pickComposition(window.innerWidth, window.innerHeight, data.comps);
      root.setAttribute("data-fitx-intro-theme", theme);
      root.setAttribute("${FILM_ATTR}", film);
      root.setAttribute("${FILM_CUT_ATTR}", comp);
      root.setAttribute("data-fitx-intro", "pending");
      var poster = data.posters[comp + "-" + theme] || "";
      if (poster) {
        try { root.style.setProperty("${FILM_POSTER_VAR}", 'url("' + poster + '")'); } catch (e) {}
        var link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = poster;
        link.setAttribute("fetchpriority", "high");
        document.head.appendChild(link);
      }
      var release = function (skipped) {
        if (root.getAttribute("data-fitx-intro") !== "pending") return;
        root.removeAttribute("data-fitx-intro");
        root.removeAttribute("${FILM_ATTR}");
        if (skipped && gate === "visitor") write("localStorage", "${VISITOR_FILM_SEEN_KEY}", "1");
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
    var handoffAt = read("sessionStorage", "${FILM_HANDOFF_KEY}");
    if (handoffAt !== null) write("sessionStorage", "${FILM_HANDOFF_KEY}", null);
    var handoffAge = Date.now() - Number(handoffAt);
    var handoff = handoffAt !== null && handoffAge >= 0 && handoffAge < ${FILM_HANDOFF_MS};
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
    var welcome = here.app && cookie("${RETURNING_WELCOME_COOKIE}") === "return";
    var forget = function () {
      document.cookie = "${RETURNING_WELCOME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax" + (window.location.protocol === "https:" ? "; Secure" : "");
    };
    if (gate && open(gate)) {
      if (welcome) forget();
      return;
    }
    if (welcome && !hidden()) {
      forget();
      if (!still() && !handoff) {
        root.setAttribute("data-fitx-loader", "welcome");
        var done = function () {
          if (root.getAttribute("data-fitx-loader") === "welcome") root.removeAttribute("data-fitx-loader");
        };
        document.addEventListener("click", function (event) {
          var target = event.target;
          if (target && target.closest && target.closest("[data-fitx-welcome-skip]")) done();
        }, true);
        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape") done();
        }, true);
        window.setTimeout(done, ${WELCOME_FALLBACK_MS});
        return;
      }
    }
    // The account's film was skipped because this device started the welcome film lately: as good as seen.
    var waived = here.app && cookie("fitx_intro") === "play" && seenRecently();
    var intro = gate === "account" || waived ? "seen" : cookie("fitx_intro");
    if (still() || intro !== "seen" || here.focus || handoff) return;
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
}

/**
 * The head script of this build: the generated manifests, plus the fixture's in an e2e build
 * (NEXT_PUBLIC_FITX_FILM_FIXTURE=1, taken only with the fitx_film_fixture=1 cookie; see films/fixture.ts).
 */
export const INTRO_BOOTSTRAP_SCRIPT = buildIntroBootstrapScript({
  manifests: FILM_MANIFESTS,
  fixture: process.env.NEXT_PUBLIC_FITX_FILM_FIXTURE === "1" ? FIXTURE_MANIFESTS : null,
});
