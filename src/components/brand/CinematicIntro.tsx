"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { FILM_DURATION, STAGE, STAGE_START, stageAt } from "./intro/timeline";
import { FitxIntroVideo } from "./FitxIntroVideo";
import { BrandEndCard, DebugBackdrop, FilmGraphics } from "./IntroFilmOverlay";
import { clampStage, type FilmFreeze } from "./introOverlayTiming";
import styles from "./CinematicIntro.module.css";

type Playback = "idle" | "loading" | "three" | "static";
/** Where the film comes from: rendered live (WebGL) or the pre-rendered cut of the same film. */
type FilmSource = "live" | "video";
type Theme = "light" | "dark";
type IntroSceneComponent = typeof import("./FitxIntroScene")["FitxIntroScene"];
type DebugConfig = { freeze: FilmFreeze | null; image: string | null };

const SESSION_KEY = "fitx-cinematic-seen";
const REPLAY_EVENT = "fitx:intro:replay";
/**
 * How long the logo may hold while the live film prepares before the intro switches to the
 * pre-rendered cut (Chrome on a recent laptop is ready in ~2 s; slower GPUs/drivers are not).
 */
const LIVE_READY_TIMEOUT_MS = 4500;
/** How long the pre-rendered cut may take to start playing before the static brand takes over. */
const VIDEO_READY_TIMEOUT_MS = 6000;
/**
 * Once the film plays, every stage change re-arms this; if none arrives for this long while the tab
 * is visible (a frame loop that died without reporting), the intro ends instead of covering the
 * page. Longer than any stage, including a full cast hold.
 */
const WATCHDOG_MS = 8000;

type NavigatorHints = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
};

/**
 * Whether to play the film at all. The video plays smoothly on any device (low-end phones get the
 * light cut), so only an explicit "save data" request or a 2G connection skips it: the static mark
 * shows instead. The live render (`?intro=live`) has its own device checks (`detectQuality`) and
 * falls back to the video.
 */
function filmAllowed(): boolean {
  const connection = (navigator as NavigatorHints).connection;
  if (connection?.saveData === true) return false;
  return !(connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g");
}

/**
 * Every device plays the pre-rendered cut of the film: hardware video decoding is smooth on any
 * phone or laptop, starts in a fraction of a second and costs no GPU/battery, while rendering the
 * film live needs a strong GPU (and Safari takes ~10 s to compile its shaders). `?intro=live`
 * renders it live instead (it falls back to the video if it cannot start); `?intro=video` is the
 * default, explicit.
 */
function chooseSource(): FilmSource {
  return new URLSearchParams(window.location.search).get("intro") === "live" ? "live" : "video";
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
  const [source, setSource] = useState<FilmSource>("live");
  const sourceRef = useRef<FilmSource>("live");
  const holdRef = useRef(false);
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

  /**
   * The live film could not start (no WebGL, device below its requirements, or not ready in time):
   * play the pre-rendered cut instead. Once the live film is already playing, a failure falls back
   * to the static mark rather than restarting the film.
   */
  const switchToVideo = useCallback(() => {
    if (!activeRef.current || fallbackStarted.current) return;
    if (sourceRef.current === "video" || filmPlayingRef.current) {
      showStaticFallback();
      return;
    }
    sourceRef.current = "video";
    setSource("video");
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
    readinessTimer.current = window.setTimeout(showStaticFallback, VIDEO_READY_TIMEOUT_MS);
  }, [showStaticFallback]);

  const begin = useCallback((force: boolean) => {
    if (activeRef.current) return;
    if (!force && document.documentElement.dataset.fitxIntro !== "pending") return;

    activeRef.current = true;
    fallbackStarted.current = false;
    filmPlayingRef.current = false;
    document.documentElement.dataset.fitxIntro = "active";
    document.documentElement.removeAttribute("data-fitx-intro-ready");
    // Modal while it covers the page: remember focus and shut the page behind (Skip is then the
    // only Tab stop). Move focus to Skip only for keyboard users (e.g. Replay pressed with Enter):
    // programmatic focus on first load would draw a focus ring over the film for everyone.
    const focused = document.activeElement;
    returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    focusSkipOnShow.current = returnFocus.current?.matches(":focus-visible") ?? false;
    releaseInert(inertMarked.current);
    if (sectionRef.current) inertMarked.current = inertOutside(sectionRef.current);
    const startTheme = readTheme();
    // The opening-frame poster (CSS) follows this, also on Replay.
    document.documentElement.dataset.fitxIntroTheme = startTheme;
    setTheme(startTheme);
    setStage(0);
    setRun((value) => value + 1);
    setLeaving(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Save-Data and 2G get the static mark straight away instead of downloading the film.
    const film = !reduced && filmAllowed();
    const chosen = chooseSource();
    sourceRef.current = chosen;
    holdRef.current = false;
    setSource(chosen);
    setPlayback(film ? "loading" : "static");

    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // The intro still works; the root-level safety timer prevents a stuck overlay.
    }

    if (film) readinessTimer.current = window.setTimeout(chosen === "live" ? switchToVideo : showStaticFallback, chosen === "live" ? LIVE_READY_TIMEOUT_MS : VIDEO_READY_TIMEOUT_MS);
  }, [showStaticFallback, switchToVideo]);

  const onSceneReady = useCallback(() => {
    if (!activeRef.current || fallbackStarted.current) return;
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
    document.documentElement.dataset.fitxIntroReady = sourceRef.current === "video" ? "video" : "three";
    setStage(0);
    setPlayback("three");
    filmPlayingRef.current = true;
    armWatchdog();
  }, [armWatchdog]);

  const onFilmStage = useCallback((next: number) => {
    setStage(next);
    armWatchdog();
  }, [armWatchdog]);

  /** The pre-rendered cut is buffering: hold the overlay's CSS clocks with it. */
  const onVideoHold = useCallback((holding: boolean) => {
    holdRef.current = holding;
    sectionRef.current?.toggleAttribute("data-intro-paused", document.hidden || holding);
  }, []);

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
    if (playback !== "loading" || IntroScene || source !== "live") return;
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
      if (mounted) switchToVideo();
    });
    return () => { mounted = false; };
  }, [IntroScene, debug, onSceneReady, playback, source, switchToVideo]);

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
      sectionRef.current?.toggleAttribute("data-intro-paused", document.hidden || holdRef.current);
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
      {/* The film's opening frame from the first paint (bootstrap "pending") until the film covers it. */}
      {!debug && <div className={styles.poster} aria-hidden="true" />}
      {(playback === "loading" || filmPlaying) && source === "live" && IntroScene && !debug && (
        <IntroScene
          theme={theme}
          onStage={onFilmStage}
          onReady={onSceneReady}
          onComplete={finish}
          onUnsupported={switchToVideo}
        />
      )}
      {(playback === "loading" || filmPlaying) && source === "video" && !debug && (
        <FitxIntroVideo
          key={`video-${run}`}
          theme={theme}
          onStage={onFilmStage}
          onReady={onSceneReady}
          onComplete={finish}
          onUnsupported={showStaticFallback}
          onHold={onVideoHold}
        />
      )}

      <div className={styles.ambient} aria-hidden="true" />
      {filmPlaying && <FilmGraphics key={`film-${run}`} stage={filmStage} theme={theme} freeze={freeze} />}
      {brandStage && (filmPlaying || leaving) && (
        <BrandEndCard key={`brand-${run}`} stage={filmStage} freeze={freeze} logoClassName={styles.logo} />
      )}

      <div className={styles.topline}>
        <button ref={skipRef} className={styles.skip} type="button" onClick={finish} aria-keyshortcuts="Escape" data-fitx-skip>
          <span>Skip intro</span><kbd aria-hidden="true">ESC</kbd>
        </button>
      </div>

      {/* Only when the film cannot play (reduced motion, unsupported device): the static mark. */}
      {playback === "static" && (
        <div className={styles.staticBrand} ref={brandRef}>
          <Logo size={68} className={styles.logo} animateMark />
        </div>
      )}
    </section>
  );
}
