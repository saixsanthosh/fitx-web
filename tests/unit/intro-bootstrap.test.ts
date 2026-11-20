import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { INTRO_BOOTSTRAP_SCRIPT } from "@/components/brand/introBootstrap";
import { ACCOUNT_FILM_STARTED_KEY, INTRO_PENDING_EVENT, VISITOR_FILM_SEEN_KEY } from "@/components/brand/introKeys";

type Listener = (event: unknown) => void;
type Run = {
  attrs: Map<string, string>;
  cookieWrites: string[];
  /** localStorage / sessionStorage writes and removals, as "<storage>.<key>". */
  storageWrites: string[];
  /** What localStorage and sessionStorage hold now. */
  local: Map<string, string>;
  session: Map<string, string>;
  /** What the script listens for on `document` (Skip clicks, Escape, Tab, focus, the page being shown). */
  listeners: Map<string, Listener[]>;
  /** The listeners among those registered for the capture phase. */
  capture: Set<Listener>;
  /** Each time the script moved focus to the overlay's Skip button, whether it asked not to scroll. */
  focused: Array<{ preventScroll: boolean }>;
  window: Record<string, unknown>;
  preloads: string[];
  /** Timers the script started, in order; call `fn` to let one run out. */
  timers: Array<{ ms: number; fn: () => void }>;
  /** Events the script dispatched on `window`. */
  events: string[];
  /** What document.cookie reads from now on (another tab, or a response, changed the cookie jar). */
  setCookie: (value: string) => void;
  /** The page is shown (a background tab is switched to, a prerendered page is opened). */
  show: () => void;
  /** The page is hidden (the user switches to another tab). */
  hide: () => void;
};

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function run({
  path = "/",
  search = "",
  cookie = "",
  reduce = false,
  theme = null as string | null,
  hidden = false,
  prerendering = false,
  local = {} as Record<string, string>,
  session = {} as Record<string, string>,
  now = NOW,
  /** Whether the page has the overlay's Skip button (server-rendered by CinematicIntro). */
  skipButton = true,
} = {}): Run {
  const attrs = new Map<string, string>();
  const cookieWrites: string[] = [];
  const storageWrites: string[] = [];
  const listeners = new Map<string, Listener[]>();
  const capture = new Set<Listener>();
  const focused: Run["focused"] = [];
  const skip = { focus: (options?: { preventScroll?: boolean }) => void focused.push({ preventScroll: options?.preventScroll === true }) };
  const preloads: string[] = [];
  const timers: Run["timers"] = [];
  const events: string[] = [];
  let jar = cookie;
  const root = {
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
  const document = {
    documentElement: root,
    visibilityState: hidden ? "hidden" : "visible",
    prerendering,
    get cookie() { return jar; },
    set cookie(value: string) { cookieWrites.push(value); },
    createElement: () => ({ setAttribute() {}, set href(value: string) { preloads.push(value); } }),
    head: { appendChild() {} },
    querySelector: (selector: string) => (skipButton && selector === "[data-fitx-skip]" ? skip : null),
    addEventListener: (type: string, listener: Listener, options?: boolean | { capture?: boolean }) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      if (options === true || (typeof options === "object" && options.capture === true)) capture.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => void listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener)),
  };
  const stores = { localStorage: new Map(Object.entries(local)), sessionStorage: new Map(Object.entries(session)) };
  const storage = (name: keyof typeof stores) => ({
    getItem: (key: string) => (name === "localStorage" && key === "fitx-theme" ? theme : stores[name].get(key) ?? null),
    setItem: (key: string, value: string) => {
      stores[name].set(key, String(value));
      storageWrites.push(`${name}.${key}`);
    },
    removeItem: (key: string) => {
      stores[name].delete(key);
      storageWrites.push(`${name}.${key}`);
    },
  });
  const window: Record<string, unknown> = {
    localStorage: storage("localStorage"),
    sessionStorage: storage("sessionStorage"),
    matchMedia: (query: string) => ({ matches: query.includes("reduced-motion") ? reduce : false }),
    location: { pathname: path, search, protocol: "https:" },
    setTimeout: (fn: () => void, ms: number) => timers.push({ ms, fn }),
    dispatchEvent: (event: { type: string }) => Boolean(events.push(event.type)),
  };
  class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  }
  vm.runInNewContext(INTRO_BOOTSTRAP_SCRIPT, { window, document, Date: { now: () => now }, Event });
  const fire = (type: string) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener({});
  };
  return {
    attrs,
    cookieWrites,
    storageWrites,
    local: stores.localStorage,
    session: stores.sessionStorage,
    listeners,
    capture,
    focused,
    window,
    preloads,
    timers,
    events,
    setCookie: (value) => {
      jar = value;
    },
    show: () => {
      document.visibilityState = "visible";
      if (document.prerendering) {
        document.prerendering = false;
        fire("prerenderingchange");
      }
      fire("visibilitychange");
    },
    hide: () => {
      document.visibilityState = "hidden";
      fire("visibilitychange");
    },
  };
}

const dispatch = ({ listeners }: Run, type: string, event: unknown) => {
  for (const listener of listeners.get(type) ?? []) listener(event);
};
/**
 * The event as far as React lets it go while it holds events for a part of the page it has not hydrated yet (the
 * overlay's chunk still loading): React listens on the document too and stops the event there, in the capture
 * phase. Only capture listeners on the document registered before React's, as the head script's are, still run.
 */
const dispatchUntilReactStopsIt = ({ listeners, capture }: Run, type: string, event: unknown) => {
  for (const listener of listeners.get(type) ?? []) if (capture.has(listener)) listener(event);
};
/** A click on the overlay's Skip button (`data-fitx-skip`), as the script sees it; Enter or Space on it clicks it too. */
const skipClick = { target: { closest: (selector: string) => (selector === "[data-fitx-skip]" ? {} : null) } };
/** Focus arriving on an element (focusin): one on the page behind the overlay, or the overlay's own Skip. */
const focusOn = (where: "page" | "overlay") => ({
  target: { closest: (selector: string) => (where === "overlay" && (selector === "[data-fitx-intro-overlay]" || selector === "[data-fitx-skip]") ? {} : null) },
});

/** The claim the head script stored when it opened the account's film: when it did (ms), unique to the page. */
const claimOf = (page: Run) => {
  const claim = page.local.get(ACCOUNT_FILM_STARTED_KEY);
  assert.ok(claim, "a claim is stored");
  assert.ok(Number(claim) >= NOW && Number(claim) < NOW + 1, `claimed now (${claim})`);
  assert.equal(page.window.__fitxAccountFilm, claim, "and left on the page for CinematicIntro");
  return claim;
};

test("plays the account's one-time film on the first app page and consumes the cookie at once", () => {
  const page = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" });
  const { attrs, cookieWrites, preloads, events, timers } = page;
  assert.equal(attrs.get("data-fitx-intro"), "pending");
  assert.equal(attrs.get("data-fitx-intro-gate"), "account");
  assert.equal(attrs.get("data-fitx-auth"), "1");
  assert.match(cookieWrites[0] ?? "", /^fitx_intro=seen; Path=\/; Max-Age=34560000; SameSite=Lax; Secure$/);
  assert.deepEqual(preloads, ["/brand/intro/fitx-intro-light-landscape.webp"]);
  assert.deepEqual(events, [INTRO_PENDING_EVENT]);
  assert.deepEqual(timers.map((timer) => timer.ms), [8000], "gives the page back if the app never starts it");
  claimOf(page);
  // Two pages opening it at the same moment leave different claims.
  assert.notEqual(claimOf(run({ path: "/workouts", cookie: "fitx_auth=1; fitx_intro=play" })), claimOf(page));
});

test("plays it on the first page of any app section, the newer ones included", () => {
  for (const path of ["/activity", "/activity/1b4e28ba-2fa1-41d2-883f-0016d3cca427", "/ai-coach", "/home-workout", "/form-coach", "/workouts", "/exercises/bench_press"]) {
    const { attrs, cookieWrites } = run({ path, cookie: "fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), "pending", path);
    assert.equal(attrs.get("data-fitx-intro-gate"), "account", path);
    assert.equal(cookieWrites.length, 1, path);
  }
});

test("never plays it on onboarding, during a live workout or on the activity recorder", () => {
  for (const path of ["/onboarding", "/workouts/active", "/activity/record"]) {
    const { attrs, cookieWrites } = run({ path, cookie: "fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), undefined, path);
    assert.equal(cookieWrites.length, 0, `${path} leaves the film for the next app page`);
  }
});

test("Help never plays the account's film, which waits for the first app page after setup, but gets the loader", () => {
  // An account still in setup may open Help (src/lib/auth/before-onboarding.ts).
  for (const search of ["", "?from=%2Fonboarding"]) {
    const { attrs, cookieWrites } = run({ path: "/help", search, cookie: "fitx_auth=1; fitx_intro=play" });
    assert.equal(attrs.get("data-fitx-intro"), undefined, search);
    assert.equal(cookieWrites.length, 0, "the film's cookie is left for the next app page");
  }
  assert.equal(run({ path: "/dashboard", cookie: "fitx_intro=play" }).attrs.get("data-fitx-intro-gate"), "account", "where it then plays");
  assert.equal(run({ path: "/help", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on");
});

test("focus screens get no brand loader either", () => {
  for (const path of ["/workouts/active", "/activity/record"]) {
    const { attrs } = run({ path, cookie: "fitx_intro=seen" });
    assert.equal(attrs.get("data-fitx-loader"), undefined, path);
  }
  assert.equal(run({ path: "/activity", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on", "the Activity hub still gets it");
});

test("?intro= replays the film on the newer sections, but not on a focus screen", () => {
  assert.equal(run({ path: "/ai-coach", search: "?intro=live", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-intro-gate"), "replay");
  assert.equal(run({ path: "/home-workout", search: "?intro=play", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-intro-gate"), "replay");
  assert.equal(run({ path: "/activity/record", search: "?intro=live", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-intro"), undefined);
});

test("the script stays free of backslashes (it is a template literal)", () => {
  assert.equal(INTRO_BOOTSTRAP_SCRIPT.includes(String.fromCharCode(92)), false);
});

test("returning devices get the short brand loader instead", () => {
  const { attrs, window } = run({ path: "/nutrition", cookie: "fitx_intro=seen" });
  assert.equal(attrs.get("data-fitx-loader"), "on");
  assert.equal(attrs.get("data-fitx-intro"), undefined);
  assert.equal(typeof window.__fitxReleaseLoader, "function");
});

// Until 2026-11-17 a signed-out home page played no film; the owner asked for it on every visit again, as the old
// site played it: once per tab (its sessionStorage "fitx-cinematic-seen").
test("signed-out visitors get the film on the home page once per tab, as the old site did, and it records nothing", () => {
  // A first visit, a device that was signed in before (seen), and one whose account film is still pending (play).
  for (const cookie of ["", "fitx_intro=seen", "fitx_intro=play"]) {
    for (const search of ["", "?utm_source=newsletter"]) {
      const label = `${cookie || "no cookies"}${search}`;
      // A new tab or window: nothing in its sessionStorage yet.
      const first = run({ path: "/", search, cookie });
      assert.equal(first.attrs.get("data-fitx-intro"), "pending", label);
      assert.equal(first.attrs.get("data-fitx-intro-gate"), "visitor", label);
      assert.equal(first.attrs.get("data-fitx-loader"), undefined, `${label}: the film, not the loader`);
      assert.equal(first.attrs.get("data-fitx-auth"), undefined, label);
      assert.deepEqual(first.preloads, ["/brand/intro/fitx-intro-light-landscape.webp"], label);
      // No cookie, so a pending account film is left alone; the tab is remembered by CinematicIntro once the film starts.
      assert.deepEqual(first.cookieWrites, [], label);
      assert.deepEqual(first.storageWrites, [], label);
      // The same tab again (a reload, or another full load of "/") after the film started there: no film.
      const again = run({ path: "/", search, cookie, session: { [VISITOR_FILM_SEEN_KEY]: "1" } });
      assert.equal(again.attrs.get("data-fitx-intro"), undefined, `${label}, same tab`);
      assert.equal(again.attrs.get("data-fitx-intro-gate"), undefined, `${label}, same tab`);
      assert.deepEqual(again.cookieWrites, [], `${label}, same tab`);
      assert.deepEqual(again.storageWrites, [], `${label}, same tab`);
      // As on any cold load, a device that was signed in before gets the short loader there.
      assert.equal(again.attrs.get("data-fitx-loader"), cookie === "fitx_intro=seen" ? "on" : undefined, `${label}, same tab`);
    }
  }
});

test("Skip and Escape give the page back before React hydrates, the visitor's film included", () => {
  for (const [type, event] of [["keydown", { key: "Escape" }], ["click", skipClick]] as const) {
    for (const options of [{ path: "/" }, { path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" }]) {
      const page = run(options);
      assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${options.path} ${type}`);
      dispatch(page, type, type === "keydown" ? { key: "Enter" } : { target: { closest: () => null } });
      assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${options.path}: another key or click keeps it`);
      dispatch(page, type, event);
      assert.equal(page.attrs.get("data-fitx-intro"), undefined, `${options.path} ${type}`);
      // Skipping the visitor's film counts as having seen it in this tab, as on the old site.
      assert.equal(page.session.get(VISITOR_FILM_SEEN_KEY), options.path === "/" ? "1" : undefined, `${options.path} ${type}`);
    }
  }
  // When the app never starts the film, the page is given back after 8 s, and the next load of the tab tries again.
  const failed = run({ path: "/" });
  failed.timers[0].fn();
  assert.equal(failed.attrs.get("data-fitx-intro"), undefined);
  assert.equal(failed.session.has(VISITOR_FILM_SEEN_KEY), false);
});

test("Skip and Escape still give the page back while React holds events for an overlay it has not hydrated yet", () => {
  // React attached to the page, the overlay's chunk still loading (a slow or lost request): React stops a click on
  // Skip (or Enter / Space on it) and Escape in the capture phase. Otherwise the film would start once the chunk arrives.
  const pages = [{ path: "/" }, { path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" }, { path: "/", search: "?intro=play" }];
  for (const [type, event] of [["keydown", { key: "Escape" }], ["click", skipClick]] as const) {
    for (const options of pages) {
      const label = `${options.path}${options.search ?? ""} ${type}`;
      const page = run(options);
      dispatchUntilReactStopsIt(page, type, type === "keydown" ? { key: "Enter" } : { target: { closest: () => null } });
      assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${label}: another key or click keeps it`);
      dispatchUntilReactStopsIt(page, type, event);
      assert.equal(page.attrs.get("data-fitx-intro"), undefined, label);
      assert.equal(page.session.get(VISITOR_FILM_SEEN_KEY), options.path === "/" && !options.search ? "1" : undefined, label);
    }
  }
  // Each of the script's click, key and focus listeners runs in the capture phase, once.
  const page = run({ path: "/" });
  for (const type of ["click", "keydown", "focusin"]) {
    const listeners = page.listeners.get(type) ?? [];
    assert.equal(listeners.length, 1, type);
    assert.ok(listeners.every((listener) => page.capture.has(listener)), `${type}: capture phase`);
  }
});

/** A key press as the script sees it; `prevented` says whether the script cancelled what the browser does with it. */
const key = (name: string, shiftKey = false) => {
  const event = { key: name, shiftKey, prevented: false, preventDefault: () => { event.prevented = true; } };
  return event;
};

test("Tab and Shift+Tab stay on Skip while the film waits for the app, and only then", () => {
  // Until React starts the film and makes the page inert, Tab would reach the page's links hidden behind the overlay.
  const shownLater = run({ path: "/", hidden: true });
  shownLater.show();
  const pending = {
    visitor: run({ path: "/" }),
    account: run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" }),
    replay: run({ path: "/", search: "?intro=play" }),
    "visitor, a background tab once shown": shownLater,
  };
  for (const [gate, page] of Object.entries(pending)) {
    assert.equal(page.attrs.get("data-fitx-intro"), "pending", gate);
    for (const shiftKey of [false, true, false, true]) {
      const tab = key("Tab", shiftKey);
      dispatch(page, "keydown", tab);
      assert.equal(tab.prevented, true, `${gate}: ${shiftKey ? "Shift+Tab" : "Tab"} doesn't move focus into the page`);
    }
    assert.equal(page.focused.length, 4, `${gate}: each press puts focus on Skip`);
    assert.ok(page.focused.every((call) => call.preventScroll), `${gate}: without scrolling the page behind`);
    assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${gate}: Tab alone never skips the film`);
    // Caught in the capture phase, before anything on the page (or React) can stop it; other keys are left alone.
    const tab = key("Tab");
    dispatchUntilReactStopsIt(page, "keydown", tab);
    assert.equal(tab.prevented, true, gate);
    const enter = key("Enter");
    dispatch(page, "keydown", enter);
    assert.equal(enter.prevented, false, gate);
    assert.equal(page.focused.length, 5, gate);
  }

  const untouched = (page: Run, label: string) => {
    for (const shiftKey of [false, true]) {
      const tab = key("Tab", shiftKey);
      dispatch(page, "keydown", tab);
      assert.equal(tab.prevented, false, `${label}: ${shiftKey ? "Shift+Tab" : "Tab"} works as usual`);
    }
    dispatch(page, "focusin", focusOn("page"));
    assert.deepEqual(page.focused, [], `${label}: focus is left alone`);
  };
  // No film: another page, the same tab again, reduced motion, a returning device's loader, a tab nobody has shown yet.
  const none = {
    "/features": run({ path: "/features" }),
    "same tab": run({ path: "/", session: { [VISITOR_FILM_SEEN_KEY]: "1" } }),
    "reduced motion": run({ path: "/", reduce: true }),
    loader: run({ path: "/nutrition", cookie: "fitx_intro=seen" }),
    "hidden tab": run({ path: "/", hidden: true }),
  };
  for (const [label, page] of Object.entries(none)) {
    assert.equal(page.attrs.get("data-fitx-intro"), undefined, label);
    untouched(page, label);
  }
  // The page given back here: Skip, Escape, or the 8 s fallback.
  const skipped = run({ path: "/" });
  dispatch(skipped, "click", skipClick);
  const escaped = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" });
  dispatch(escaped, "keydown", key("Escape"));
  const failed = run({ path: "/" });
  failed.timers[0].fn();
  for (const [label, page] of Object.entries({ "after Skip": skipped, "after Escape": escaped, "after the 8 s fallback": failed })) {
    assert.equal(page.attrs.get("data-fitx-intro"), undefined, label);
    untouched(page, label);
  }
  // Once the app has started the film, CinematicIntro owns focus (the page behind is inert), and then gives the page back.
  const app = run({ path: "/" });
  app.attrs.set("data-fitx-intro", "active");
  untouched(app, "active");
  app.attrs.delete("data-fitx-intro");
  untouched(app, "given back by the app");
  // No Skip button on the page: nothing to keep focus on, so Tab works as usual.
  const bare = run({ path: "/", skipButton: false });
  assert.equal(bare.attrs.get("data-fitx-intro"), "pending");
  untouched(bare, "no Skip button");
});

test("focus that reaches the page behind the waiting film without a Tab press goes back to Skip", () => {
  // Tab from the browser's toolbar into the page, or a screen reader moving focus, sends the page no Tab key press;
  // Enter on a hidden link would follow it. The film's own Skip keeps focus, and so does a focus with no element.
  const shownLater = run({ path: "/", hidden: true });
  shownLater.show();
  const pending = {
    visitor: run({ path: "/" }),
    account: run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" }),
    replay: run({ path: "/", search: "?intro=play" }),
    "visitor, a background tab once shown": shownLater,
  };
  for (const [gate, page] of Object.entries(pending)) {
    assert.equal(page.attrs.get("data-fitx-intro"), "pending", gate);
    dispatch(page, "focusin", focusOn("overlay"));
    dispatch(page, "focusin", { target: null });
    dispatch(page, "focusin", { target: {} });
    assert.deepEqual(page.focused, [], `${gate}: focus on Skip itself stays`);
    dispatch(page, "focusin", focusOn("page"));
    // Before React can stop it, also on a part of the page React has not hydrated yet.
    dispatchUntilReactStopsIt(page, "focusin", focusOn("page"));
    assert.deepEqual(page.focused, [{ preventScroll: true }, { preventScroll: true }], `${gate}: sent to Skip, without scrolling`);
    assert.equal(page.attrs.get("data-fitx-intro"), "pending", `${gate}: it never skips the film`);
  }
  // In every other state focus is left alone: see "Tab and Shift+Tab stay on Skip while the film waits for the app".
});

test("a signed-in visitor never gets the visitor's film on the home page", () => {
  // The proxy sends a signed-in "/" to the dashboard; the fitx_auth hint guards the page if it ever renders.
  for (const cookie of ["fitx_auth=1", "fitx_auth=1; fitx_intro=seen", "fitx_auth=1; fitx_intro=play"]) {
    const { attrs, cookieWrites } = run({ path: "/", cookie });
    assert.equal(attrs.get("data-fitx-intro"), undefined, cookie);
    assert.equal(attrs.get("data-fitx-intro-gate"), undefined, cookie);
    assert.equal(attrs.get("data-fitx-auth"), "1", cookie);
    assert.deepEqual(cookieWrites, [], `${cookie}: the account's film waits for an app page`);
  }
  assert.equal(run({ path: "/", cookie: "fitx_auth=1; fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on", "the loader, as on any cold load");
});

test("no other public page plays a film, signed out or not", () => {
  const pages = ["/features", "/pricing", "/about", "/for-gyms", "/privacy", "/terms", "/cookies", "/refunds", "/signin", "/signup", "/forgot-password", "/reset-password", "/helpful-tips"];
  for (const path of pages) {
    for (const [cookie, search] of [["", ""], ["fitx_intro=play", ""], ["fitx_auth=1; fitx_intro=play", ""], ["", "?intro=play"]]) {
      const { attrs, cookieWrites } = run({ path, search, cookie });
      assert.equal(attrs.get("data-fitx-intro"), undefined, `${path}${search} ${cookie}`);
      assert.equal(attrs.get("data-fitx-intro-gate"), undefined, `${path}${search} ${cookie}`);
      assert.deepEqual(cookieWrites, [], `${path}${search} ${cookie}`);
    }
  }
  assert.equal(run({ path: "/pricing", cookie: "fitx_intro=seen" }).attrs.get("data-fitx-loader"), "on", "returning devices keep the loader there");
});

test("reduced motion gets neither the film nor the loader, on the home page either", () => {
  for (const [path, search] of [["/dashboard", ""], ["/", ""], ["/", "?intro=play"], ["/dashboard", "?intro=live"]]) {
    for (const cookie of ["", "fitx_intro=play", "fitx_intro=seen", "fitx_auth=1; fitx_intro=play"]) {
      for (const hidden of [false, true]) {
        const label = `${path}${search} ${cookie}${hidden ? " (hidden)" : ""}`;
        const page = run({ path, search, cookie, reduce: true, hidden });
        page.show();
        assert.equal(page.attrs.get("data-fitx-intro"), undefined, label);
        assert.equal(page.attrs.get("data-fitx-intro-gate"), undefined, label);
        assert.equal(page.attrs.get("data-fitx-loader"), undefined, label);
        assert.deepEqual(page.cookieWrites, [], `${label}: a pending account film waits`);
      }
    }
  }
});

test("?intro= still plays the film on request without touching the cookie", () => {
  const { attrs, cookieWrites } = run({ path: "/", search: "?intro=live", cookie: "fitx_intro=seen" });
  assert.equal(attrs.get("data-fitx-intro"), "pending");
  assert.equal(attrs.get("data-fitx-intro-gate"), "replay");
  assert.equal(cookieWrites.length, 0);
});

test("a tab that loads hidden (in the background, or prerendered) waits until it is first shown", () => {
  // Nothing may be used up or recorded for a page nobody has looked at: the app's frame loop doesn't run in a
  // hidden tab, so a film marked now would be over (given back after 8 s) before anyone switched to it.
  const cases = [
    ["account", { path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" }],
    ["visitor", { path: "/" }],
    ["replay", { path: "/workouts", search: "?intro=video", cookie: "fitx_auth=1; fitx_intro=seen" }],
  ] as const;
  for (const [gate, options] of cases) {
    for (const how of ["in the background", "prerendered"] as const) {
      const label = `${gate}, ${how}`;
      const page = run({ ...options, hidden: how === "in the background", prerendering: how === "prerendered" });
      dispatch(page, "visibilitychange", {});
      assert.equal(page.attrs.get("data-fitx-intro"), undefined, label);
      assert.equal(page.attrs.get("data-fitx-intro-gate"), undefined, label);
      assert.equal(page.attrs.get("data-fitx-loader"), undefined, `${label}: no loader either`);
      assert.deepEqual(page.cookieWrites, [], `${label}: the account's "play" is still there`);
      assert.deepEqual(page.storageWrites, [], label);
      assert.deepEqual(page.preloads, [], label);
      assert.equal(page.timers.length, 0, `${label}: no 8 s release running while nobody looks`);
      assert.deepEqual(page.events, [], label);

      page.show();
      assert.equal(page.attrs.get("data-fitx-intro"), "pending", label);
      assert.equal(page.attrs.get("data-fitx-intro-gate"), gate, label);
      assert.deepEqual(page.events, [INTRO_PENDING_EVENT], `${label}: the app, already running, is told`);
      assert.deepEqual(page.preloads, ["/brand/intro/fitx-intro-light-landscape.webp"], label);
      assert.deepEqual(page.timers.map((timer) => timer.ms), [8000], label);
      assert.equal(page.cookieWrites.length, gate === "account" ? 1 : 0, label);
      // Hidden and shown again later: it happens once.
      page.hide();
      page.show();
      assert.deepEqual(page.events, [INTRO_PENDING_EVENT], label);
      assert.equal(page.cookieWrites.length, gate === "account" ? 1 : 0, label);
    }
  }
});

test("a hidden tab shown after another tab used the account's film shows nothing", () => {
  const page = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play", hidden: true });
  page.setCookie("fitx_auth=1; fitx_intro=seen");
  page.show();
  assert.equal(page.attrs.get("data-fitx-intro"), undefined);
  assert.equal(page.attrs.get("data-fitx-intro-gate"), undefined);
  assert.equal(page.attrs.get("data-fitx-loader"), undefined, "the page loaded long ago: no loader");
  assert.deepEqual(page.cookieWrites, []);
  assert.deepEqual(page.events, []);
});

test("a page hidden before the app starts its film keeps it until shown again, then gives it 8 s", () => {
  const page = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play" });
  assert.equal(page.attrs.get("data-fitx-intro"), "pending");
  page.hide();
  page.timers[0].fn();
  assert.equal(page.attrs.get("data-fitx-intro"), "pending", "8 s in a background tab don't give it up");
  page.show();
  assert.deepEqual(page.timers.map((timer) => timer.ms), [8000, 8000], "counted again from when it is shown");
  page.timers[1].fn();
  assert.equal(page.attrs.get("data-fitx-intro"), undefined, "the app never started it: the page is given back");
});

test("a play that turns up again within a day of this device starting the account's film is used up, not played twice", () => {
  // Tabs restored together each asked the server before any answer came back, so each answer says "play":
  // one that arrives after another tab started the film puts the cookie back.
  for (const ago of [MINUTE, 5 * HOUR, 24 * HOUR]) {
    const label = `${ago / MINUTE} minutes after`;
    const again = run({ path: "/workouts", cookie: "fitx_auth=1; fitx_intro=play", local: { [ACCOUNT_FILM_STARTED_KEY]: String(NOW - ago) } });
    assert.equal(again.attrs.get("data-fitx-intro"), undefined, label);
    assert.equal(again.attrs.get("data-fitx-intro-gate"), undefined, `${label}: nothing for IntroCompletionReporter to record`);
    assert.match(again.cookieWrites[0] ?? "", /^fitx_intro=seen;/, `${label}: the copy is used up`);
    assert.equal(again.attrs.get("data-fitx-loader"), "on", `${label}: a returning device's loader instead`);
    assert.deepEqual(again.events, [], label);
    assert.equal(again.local.get(ACCOUNT_FILM_STARTED_KEY), String(NOW - ago), label);
  }
  // A tab that loaded hidden finds the copy when it is shown.
  const hidden = run({ path: "/nutrition", cookie: "fitx_auth=1; fitx_intro=play", hidden: true, local: { [ACCOUNT_FILM_STARTED_KEY]: String(NOW - MINUTE) } });
  hidden.show();
  assert.equal(hidden.attrs.get("data-fitx-intro"), undefined);
  assert.match(hidden.cookieWrites[0] ?? "", /^fitx_intro=seen;/);
  // After that a "play" can only be a new one (a copy lives a day): it plays.
  const later = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play", local: { [ACCOUNT_FILM_STARTED_KEY]: String(NOW - 26 * HOUR) } });
  assert.equal(later.attrs.get("data-fitx-intro-gate"), "account");
  claimOf(later);
  // The visitor's film and replays claim nothing.
  for (const options of [{ path: "/" }, { path: "/dashboard", search: "?intro=play", cookie: "fitx_auth=1; fitx_intro=seen" }]) {
    const other = run(options);
    assert.equal(other.attrs.get("data-fitx-intro"), "pending");
    assert.equal(other.local.has(ACCOUNT_FILM_STARTED_KEY), false);
    assert.equal(other.window.__fitxAccountFilm, undefined);
  }
});

test("signing out forgets that, so the next account on the device gets its own film", () => {
  const remembered = { [ACCOUNT_FILM_STARTED_KEY]: String(NOW - MINUTE) };
  // Log out lands on /signin?signed_out=1 without the fitx_auth hint; so does every signed-out page.
  const signedOut = run({ path: "/signin", search: "?signed_out=1", local: remembered });
  assert.equal(signedOut.local.has(ACCOUNT_FILM_STARTED_KEY), false);
  const next = run({ path: "/dashboard", cookie: "fitx_auth=1; fitx_intro=play", local: Object.fromEntries(signedOut.local) });
  assert.equal(next.attrs.get("data-fitx-intro-gate"), "account", "the next account's film plays");
  // Signed-in pages keep it, and a signed-out device without it writes nothing.
  const signedIn = run({ path: "/pricing", cookie: "fitx_auth=1; fitx_intro=seen", local: remembered });
  assert.equal(signedIn.local.get(ACCOUNT_FILM_STARTED_KEY), String(NOW - MINUTE));
  assert.deepEqual(signedIn.storageWrites, []);
  assert.deepEqual(run({ path: "/pricing" }).storageWrites, []);
});

test("applies the saved theme before first paint", () => {
  assert.equal(run({ theme: "dark" }).attrs.get("data-theme"), "dark");
  assert.equal(run({ theme: "light" }).attrs.get("data-theme"), "light");
  // Visitors who never chose a theme (or whose saved value is unreadable) match their device.
  assert.equal(run({ theme: "bogus" }).attrs.get("data-theme"), "system");
  assert.equal(run().attrs.get("data-theme"), "system");
});
