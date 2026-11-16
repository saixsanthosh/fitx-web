"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { FILM_DURATION, STAGE, STAGE_START, stageAt } from "./intro/timeline";
import { BrandEndCard, DebugBackdrop, FilmGraphics } from "./IntroFilmOverlay";
import { clampStage, type FilmFreeze } from "./introOverlayTiming";
import styles from "./CinematicIntro.module.css";

type Playback = "idle" | "loading" | "three" | "static";
type Theme = "light" | "dark";
type IntroSceneComponent = typeof import("./FitxIntroScene")["FitxIntroScene"];
type DebugConfig = { freeze: FilmFreeze | null; image: string | null };

const SESSION_KEY = "fitx-cinematic-seen";
const REPLAY_EVENT = "fitx:intro:replay";
/**
 * How long the logo may hold while the film loads before the static brand takes over. Devices
 * without WebGL or below the film's requirements fall back immediately (onUnsupported); this only
 * bounds slow-but-capable ones (cold chunk download, slower CPUs generating the cast). Skip/Esc
 * stay available throughout.
 */
const READY_TIMEOUT_MS = 5000;
/**
 * Once the film plays, every stage change re-arms this; if none arrives for this long while the tab
 * is visible (a frame loop that died without reporting), the intro ends instead of covering the
 * page. Longer than any stage, including a full cast hold.
 */
const WATCHDOG_MS = 8000;

type NavigatorHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

/**
 * Cheap capability gates, checked before the ~250 KB scene chunk is fetched. They mirror the
 * non-GPU checks in `detectQuality` (which stays the final word once WebGL exists).
 */
function filmAllowed(): boolean {
  const nav = navigator as NavigatorHints;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) return false;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) return false;
  if (nav.connection?.saveData === true) return false;
  if (nav.connection?.effectiveType === "slow-2g" || nav.connection?.effectiveType === "2g") return false;
  return true;
}

/**
 * Makes everything outside `section` inert while the opaque overlay covers the page, so focus,
 * clicks and assistive tech cannot reach (or navigate through) controls nobody can see.
 * Returns the elements it changed, for `releaseInert`.
 */
function inertOutside(section: HTMLElement): HTMLElement[] {
  const marked: HTMLElement[] = [];
  let node: Element = section;
  while (node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE" || sibling.tagName === "LINK") continue;
      sibling.inert = true;
      marked.push(sibling);
    }
    node = node.parentElement;
  }
  return marked;
}

function releaseInert(marked: HTMLElement[]) {
  for (const element of marked) element.inert = false;
  marked.length = 0;
}

function readTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return stored === "dark" || (stored === "system" && prefersDark) ? "dark" : "light";
}

/**
 * Dev-only overlay review mode (compiled out of production builds):
 *   ?introDebug=overlay          play the overlay on timers from STAGE_START, without loading WebGL
 *   &introDebugStage=N           freeze every title/callout of stage N at its resting frame
 *   &introDebugTime=T            freeze the whole overlay at film time T (seconds)
 *   &introDebugBg=<url>          a still behind the overlay (same origin or 127.0.0.1/localhost)
 */
function readDebugConfig(): DebugConfig | null {
  if (process.env.NODE_ENV === "production") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("introDebug") !== "overlay") return null;
  const time = params.get("introDebugTime");
  const stage = params.get("introDebugStage");
  let freeze: FilmFreeze | null = null;
  if (time !== null && Number.isFinite(Number(time))) {
    freeze = { kind: "time", time: Math.min(Math.max(Number(time), 0), FILM_DURATION - 0.01) };
  } else if (stage !== null && Number.isFinite(Number(stage))) {
    freeze = { kind: "stage", stage: clampStage(Number(stage)) };
  }
  const background = params.get("introDebugBg");
  const image = background && /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)?\/[\w\-./%]*$/.test(background) ? background : null;
  return { freeze, image };
}

/** A session-once branded welcome layered over crawlable, server-rendered home content. */
export function CinematicIntro() {
  const [playback, setPlayback] = useState<Playback>("idle");
  const [stage, setStage] = useState(0);
  const [theme, setTheme] = useState<Theme>("light");
  const [leaving, setLeaving] = useState(false);
  // Keys every film graphic, so a replay restarts each CSS animation from scratch.
  const [run, setRun] = useState(0);
  const [debug, setDebug] = useState<DebugConfig | null>(null);
  const [IntroScene, setIntroScene] = useState<IntroSceneComponent | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const activeRef = useRef(false);
  const leaveTimer = useRef<number | null>(null);
  const readinessTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const fallbackStarted = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inertMarked = useRef<HTMLElement[]>([]);
  const focusSkipOnShow = useRef(false);
  const watchdogTimer = useRef<number | null>(null);
  const filmPlayingRef = useRef(false);
  const debugActive = useRef(false);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current !== null) window.clearTimeout(watchdogTimer.current);
    watchdogTimer.current = null;
  }, []);

  /** Gives the page back: root attributes (scroll lock, mode), inert siblings, the watchdog. */
  const releasePage = useCallback(() => {
    document.documentElement.removeAttribute("data-fitx-intro");
    document.documentElement.removeAttribute("data-fitx-intro-ready");
    releaseInert(inertMarked.current);
    clearWatchdog();
    filmPlayingRef.current = false;
  }, [clearWatchdog]);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    releasePage();
    // Hand focus back to where it was (e.g. the Replay button); never leave it on the hidden Skip.
    const section = sectionRef.current;
    const previous = returnFocus.current;
    returnFocus.current = null;
    if (previous && previous.isConnected && !section?.contains(previous)) {
      previous.focus({ preventScroll: true });
    } else if (section && document.activeElement instanceof HTMLElement && section.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setPlayback("idle");
    setLeaving(true);
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(false), 560);
  }, [releasePage]);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    if (!activeRef.current || !filmPlayingRef.current || debugActive.current || document.hidden) return;
    watchdogTimer.current = window.setTimeout(finish, WATCHDOG_MS);
  }, [clearWatchdog, finish]);

  const showStaticFallback = useCallback(() => {
    if (!activeRef.current || fallbackStarted.current) return;
    fallbackStarted.current = true;
    filmPlayingRef.current = false;
    clearWatchdog();
    setPlayback("static");
    document.documentElement.dataset.fitxIntroReady = "fallback";
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
  }, [clearWatchdog]);

  const begin = useCallback((force: boolean) => {
    if (activeRef.current) return;
    if (!force && document.documentElement.dataset.fitxIntro !== "pending") return;

    activeRef.current = true;
    fallbackStarted.current = false;
    filmPlayingRef.current = false;
    document.documentElement.dataset.fitxIntro = "active";
    document.documentElement.removeAttribute("data-fitx-intro-ready");
    // Modal while it covers the page: remember focus, shut the page behind, focus Skip once shown.
    const focused = document.activeElement;
    returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    releaseInert(inertMarked.current);
    if (sectionRef.current) inertMarked.current = inertOutside(sectionRef.current);
    focusSkipOnShow.current = true;
    setTheme(readTheme());
    setStage(0);
    setRun((value) => value + 1);
    setLeaving(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Devices the film can never run on (low memory/cores, Save-Data, 2G) get the static mark
    // straight away instead of downloading the scene chunk first.
    const film = !reduced && filmAllowed();
    setPlayback(film ? "loading" : "static");

    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // The intro still works; the root-level safety timer prevents a stuck overlay.
    }

    if (film) readinessTimer.current = window.setTimeout(showStaticFallback, READY_TIMEOUT_MS);
  }, [showStaticFallback]);

  const onSceneReady = useCallback(() => {
    if (!activeRef.current || fallbackStarted.current) return;
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
    document.documentElement.dataset.fitxIntroReady = "three";
    setStage(0);
    setPlayback("three");
    filmPlayingRef.current = true;
    armWatchdog();
  }, [armWatchdog]);

  const onFilmStage = useCallback((next: number) => {
    setStage(next);
    armWatchdog();
  }, [armWatchdog]);

  useEffect(() => {
    // Focus Skip once the overlay is visible (it is visibility:hidden while idle).
    if (playback === "idle" || !focusSkipOnShow.current) return;
    focusSkipOnShow.current = false;
    skipRef.current?.focus({ preventScroll: true });
  }, [playback]);

  useLayoutEffect(() => () => {
    // Unmounted mid-intro (client navigation, back gesture): release the page, or the scroll lock
    // and inert siblings would outlive the home page. Gated on activeRef so StrictMode's simulated
    // unmount (before begin) leaves the bootstrap's "pending" alone.
    if (!activeRef.current) return;
    activeRef.current = false;
    releasePage();
  }, [releasePage]);

  useEffect(() => {
    if (playback !== "loading" || IntroScene) return;
    if (process.env.NODE_ENV !== "production" && debug) {
      // Review mode: no WebGL. Behave as if the scene became ready after a short load.
      const timer = window.setTimeout(() => {
        onSceneReady();
        if (debug.freeze) setStage(debug.freeze.kind === "stage" ? debug.freeze.stage : stageAt(debug.freeze.time));
      }, 240);
      return () => window.clearTimeout(timer);
    }
    let mounted = true;
    import("./FitxIntroScene").then((module) => {
      if (mounted) setIntroScene(() => module.FitxIntroScene);
    }).catch((error: unknown) => {
      if (process.env.NODE_ENV !== "production") console.warn("[FITX intro] Scene chunk failed to load", error);
      if (mounted) showStaticFallback();
    });
    return () => { mounted = false; };
  }, [IntroScene, debug, onSceneReady, playback, showStaticFallback]);

  useEffect(() => {
    // Review mode stands in for the scene's onStage/onComplete with timers on the film clock.
    if (process.env.NODE_ENV === "production" || !debug || debug.freeze || playback !== "three") return;
    const timers = STAGE_START.slice(1).map((time, index) => window.setTimeout(() => setStage(index + 1), time * 1000));
    timers.push(window.setTimeout(finish, FILM_DURATION * 1000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [debug, finish, playback]);

  useEffect(() => {
    if (playback !== "static" || !activeRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const rect = brandRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      // A static mark has now committed and painted; only then may its short
      // readable hold end. A stalled 3D load never hides an empty overlay.
      fallbackTimer.current = window.setTimeout(finish, 900);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    };
  }, [finish, playback]);

  useEffect(() => {
    // The scene stops its film clock while the tab is hidden; the overlay's CSS clocks must stop too
    // or titles and callouts would run ahead of the picture on return.
    const syncVisibility = () => {
      sectionRef.current?.toggleAttribute("data-intro-paused", document.hidden);
      armWatchdog();
    };
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [armWatchdog]);

  useEffect(() => {
    const onReplay = () => begin(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeRef.current && event.key === "Escape") finish();
    };
    const onThemeChange = () => setTheme(readTheme());
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    const initialFrame = window.requestAnimationFrame(() => {
      const config = readDebugConfig();
      debugActive.current = config !== null;
      if (config) setDebug(config);
      begin(config !== null);
    });
    window.addEventListener(REPLAY_EVENT, onReplay);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("fitx-theme-change", onThemeChange);
    colorScheme.addEventListener("change", onThemeChange);

    return () => {
      window.removeEventListener(REPLAY_EVENT, onReplay);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("fitx-theme-change", onThemeChange);
      colorScheme.removeEventListener("change", onThemeChange);
      window.cancelAnimationFrame(initialFrame);
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
      if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
      if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
      clearWatchdog();
    };
  }, [begin, clearWatchdog, finish]);

  const filmStage = clampStage(stage);
  const filmPlaying = playback === "three";
  const brandStage = filmStage >= STAGE.brand;
  const freeze = debug?.freeze ?? null;
  const className = [
    styles.intro,
    playback !== "idle" ? styles.active : "",
    leaving ? styles.leaving : "",
    theme === "dark" ? styles.dark : styles.light,
    filmPlaying && !brandStage ? styles.cine : "",
  ].filter(Boolean).join(" ");
  return (
    <section
      ref={sectionRef}
      className={className}
      aria-label="FITX welcome"
      aria-hidden={playback === "idle" && !leaving}
      data-fitx-intro-overlay
      data-intro-playback={playback}
      data-intro-stage={filmStage}
      data-intro-debug={debug ? "overlay" : undefined}
    >
      {debug && <DebugBackdrop image={debug.image} theme={theme} />}
      {(playback === "loading" || filmPlaying) && IntroScene && !debug && (
        <IntroScene
          theme={theme}
          onStage={onFilmStage}
          onReady={onSceneReady}
          onComplete={finish}
          onUnsupported={showStaticFallback}
        />
      )}

      <div className={styles.ambient} aria-hidden="true" />
      {filmPlaying && <FilmGraphics key={`film-${run}`} stage={filmStage} theme={theme} freeze={freeze} />}
      {brandStage && (filmPlaying || leaving) && (
        <BrandEndCard key={`brand-${run}`} stage={filmStage} freeze={freeze} logoClassName={styles.logo} />
      )}

      <div className={styles.topline}>
        <button ref={skipRef} className={styles.skip} type="button" onClick={finish} aria-keyshortcuts="Escape">
          <span>Skip intro</span><kbd aria-hidden="true">ESC</kbd>
        </button>
      </div>

      <div className={styles.bootstrapBrand} aria-hidden="true">
        <Logo size={68} className={styles.logo} />
      </div>

      {playback === "static" ? (
        <div className={styles.staticBrand} ref={brandRef}>
          <Logo size={68} className={styles.logo} animateMark />
        </div>
      ) : playback === "loading" || (filmPlaying && filmStage === STAGE.coldOpen) ? (
        // The loading mark hands off to the film's first frame instead of cutting away.
        <div className={`${styles.staticBrand} ${filmPlaying ? styles.handoff : ""}`} ref={brandRef}>
          <Logo size={68} className={styles.logo} />
        </div>
      ) : null}
    </section>
  );
}
