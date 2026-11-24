"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { Logo } from "@/components/ui/Logo";
import { firstName as firstNameOf } from "@/lib/onboarding/form";
import { FILM_DURATION, STAGE, STAGE_START, stageAt } from "./intro/timeline";
import { FitxIntroVideo } from "./FitxIntroVideo";
import { BrandEndCard, DebugBackdrop, FilmGraphics } from "./IntroFilmOverlay";
import { clampStage, type FilmFreeze } from "./introOverlayTiming";
import { accountFilmClaimedElsewhere } from "./accountFilm";
import { focusAfterFilm } from "./introFocus";
import { FILM_POSTER_VAR, INTRO_PENDING_EVENT, REPLAY_EVENT, VISITOR_FILM_SEEN_KEY } from "./introKeys";
import { FILM_ATTR, FILM_CUT_ATTR, pickComposition, type FilmId } from "./films/compositions";
import { filmAllowed, manifestFor, posterIn, type FilmAudio } from "./films/manifest";
import { useFilmSound } from "./films/filmSound";
import { SoundControl } from "./films/SoundControl";
import { RESIZE_SETTLE_MS } from "./films/timing";
import { WelcomeFilm } from "./films/WelcomeFilm";
import styles from "./CinematicIntro.module.css";

type Playback = "idle" | "loading" | "three" | "static";
/** Where the film comes from: rendered live (WebGL) or the pre-rendered cut of the same film. */
type FilmSource = "live" | "video";
type Theme = "light" | "dark";
type IntroSceneComponent = typeof import("./FitxIntroScene")["FitxIntroScene"];
type DebugConfig = { freeze: FilmFreeze | null; image: string | null };

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

/**
 * Which film a request plays: the one asked for (Replay's `detail.film`), else the one the head script claimed
 * (`data-fitx-film`). The welcome film only while its cuts exist; asking for it without them plays nothing.
 */
function filmToPlay(requested: FilmId | undefined): FilmId | null {
  const wanted: FilmId = requested ?? (document.documentElement.getAttribute(FILM_ATTR) === "welcome" ? "welcome" : "intro");
  if (wanted === "intro") return "intro";
  if (manifestFor("welcome")) return "welcome";
  return requested === "welcome" ? null : "intro";
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
 *   ?introDebug=overlay          play the overlay on timers from STAGE_START, without the film
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

/**
 * The branded films, layered over the page. The intro plays when the head script marked it pending
 * (a signed-out visit to the home page, once per device; once per account on an app page; or `?intro=…`),
 * also when a tab that loaded hidden is first shown, and on Replay. Once the welcome film's cuts exist (D1), the
 * account's film is the welcome film (WelcomeFilm, with its own Skip and Sound), and so are `?intro=welcome` and
 * "Replay welcome film". The intro's "Sound" control shows only when its manifest has sound.
 */
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
  const [film, setFilm] = useState<FilmId>("intro");
  const [welcomeFocus, setWelcomeFocus] = useState(false);
  const [introAudio, setIntroAudio] = useState<FilmAudio | null>(null);
  const [introVideo, setIntroVideo] = useState<HTMLVideoElement | null>(null);
  const user = useOptionalUserContext();
  const memberName = firstNameOf(user?.data?.profile?.name);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current !== null) window.clearTimeout(watchdogTimer.current);
    watchdogTimer.current = null;
  }, []);

  /** Gives the page back: root attributes (scroll lock, mode), inert siblings, the watchdog. */
  const releasePage = useCallback(() => {
    document.documentElement.removeAttribute("data-fitx-intro");
    document.documentElement.removeAttribute("data-fitx-intro-ready");
    document.documentElement.removeAttribute(FILM_ATTR);
    releaseInert(inertMarked.current);
    clearWatchdog();
    filmPlayingRef.current = false;
  }, [clearWatchdog]);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    releasePage();
    // Hand focus back to where it was (e.g. the Replay button); never leave it on the hidden Skip: from there a
    // keyboard user carries on from the top of the page (introFocus.ts).
    const section = sectionRef.current;
    const previous = returnFocus.current;
    returnFocus.current = null;
    if (previous && previous.isConnected && !section?.contains(previous)) {
      previous.focus({ preventScroll: true });
    } else if (section && document.activeElement instanceof HTMLElement && section.contains(document.activeElement)) {
      focusAfterFilm(document.activeElement);
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

  const begin = useCallback((force: boolean, requested?: FilmId) => {
    if (activeRef.current) return;
    if (!force && document.documentElement.dataset.fitxIntro !== "pending") return;
    const chosenFilm = filmToPlay(requested);
    if (!chosenFilm) return;
    // The account's film opened in several tabs at the same moment: only the tab that claimed it last plays it.
    if (!force && accountFilmClaimedElsewhere()) {
      document.documentElement.removeAttribute("data-fitx-intro");
      return;
    }

    activeRef.current = true;
    // The signed-out visitor’s film plays once per device, for first-time visitors (see introBootstrap.ts).
    if (document.documentElement.dataset.fitxIntroGate === "visitor") {
      try {
        window.localStorage.setItem(VISITOR_FILM_SEEN_KEY, "1");
      } catch {
        // Storage blocked: the visitor's film plays on each full load of the home page instead.
      }
    }
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
    // The film claimed, the composition its cut is for and that composition's poster (the head script does the same
    // for the films it opens; a replay comes here first).
    const manifest = manifestFor(chosenFilm);
    const comp = pickComposition(window.innerWidth, window.innerHeight, manifest?.comps);
    const poster = posterIn(manifest, startTheme, comp);
    document.documentElement.setAttribute(FILM_ATTR, chosenFilm);
    document.documentElement.setAttribute(FILM_CUT_ATTR, comp);
    if (poster) document.documentElement.style.setProperty(FILM_POSTER_VAR, `url("${poster}")`);
    setFilm(chosenFilm);
    setIntroAudio(chosenFilm === "intro" ? manifestFor("intro")?.audio ?? null : null);
    setTheme(startTheme);
    setStage(0);
    setRun((value) => value + 1);
    setLeaving(false);
    if (chosenFilm === "welcome") {
      // WelcomeFilm decides its own case (reduced motion, Save-Data, the film) and keeps its own clocks.
      setWelcomeFocus(focusSkipOnShow.current);
      focusSkipOnShow.current = false;
      sourceRef.current = "video";
      setSource("video");
      setPlayback("loading");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Save-Data and 2G get the static mark straight away instead of downloading the film.
    const film = !reduced && filmAllowed();
    // Review mode always runs the live path: it stands in for the scene with timers (no video).
    const chosen: FilmSource = debugActive.current ? "live" : chooseSource();
    sourceRef.current = chosen;
    holdRef.current = false;
    setSource(chosen);
    setPlayback(film ? "loading" : "static");

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

  // The live film (`?intro=live`) follows a resize with its camera at once. Once the resize settles, the composition it
  // now frames is marked again (with that composition's poster, by begin's rule), so the letterbox and the callouts,
  // which FilmGraphics keys on data-fitx-film-cut, follow it too. The pre-rendered cut marks its own swaps (FilmVideo).
  const liveFilm = film === "intro" && source === "live" && (playback === "loading" || playback === "three");
  useEffect(() => {
    if (!liveFilm) return;
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!activeRef.current || sourceRef.current !== "live") return;
        const root = document.documentElement;
        const manifest = manifestFor("intro");
        const comp = pickComposition(window.innerWidth, window.innerHeight, manifest?.comps);
        if (root.getAttribute(FILM_CUT_ATTR) === comp) return;
        root.setAttribute(FILM_CUT_ATTR, comp);
        const poster = posterIn(manifest, root.dataset.fitxIntroTheme === "dark" ? "dark" : "light", comp);
        if (poster) root.style.setProperty(FILM_POSTER_VAR, `url("${poster}")`);
      }, RESIZE_SETTLE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [liveFilm]);

  useEffect(() => {
    const onReplay = (event: Event) => {
      const requested = (event as CustomEvent<{ film?: FilmId } | null>).detail?.film;
      begin(true, requested === "welcome" ? "welcome" : undefined);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeRef.current && event.key === "Escape") finish();
    };
    const onThemeChange = () => setTheme(readTheme());
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    // A tab that loaded hidden gets its film marked pending only when it is first shown (introBootstrap.ts).
    // Usually that comes before the first frame below, which then starts it; if the frame already ran, the
    // announcement starts it.
    let firstFrameRan = false;
    const onPending = () => {
      if (firstFrameRan) begin(false);
    };
    const initialFrame = window.requestAnimationFrame(() => {
      firstFrameRan = true;
      const config = readDebugConfig();
      debugActive.current = config !== null;
      if (config) setDebug(config);
      begin(config !== null);
    });
    window.addEventListener(INTRO_PENDING_EVENT, onPending);
    window.addEventListener(REPLAY_EVENT, onReplay);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("fitx-theme-change", onThemeChange);
    colorScheme.addEventListener("change", onThemeChange);

    return () => {
      window.removeEventListener(INTRO_PENDING_EVENT, onPending);
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

  // The intro's sound (none until its manifest has some): muted by default, a stored "on" tried as the film starts.
  const sound = useFilmSound(film === "intro" && source === "video" ? introVideo : null, introAudio, { held: false, ending: leaving });
  const filmStage = clampStage(stage);
  const welcome = film === "welcome" && playback !== "idle";
  const filmPlaying = playback === "three" && !welcome;
  const brandStage = filmStage >= STAGE.brand;
  const freeze = debug?.freeze ?? null;
  const className = [
    styles.intro,
    playback !== "idle" ? styles.active : "",
    leaving ? styles.leaving : "",
    theme === "dark" ? styles.dark : styles.light,
    filmPlaying && !brandStage ? styles.cine : "",
  ].filter(Boolean).join(" ");
  // Until a film starts here (run 0), CSS alone keeps the overlay from assistive tech: it is visibility: hidden
  // unless the head script marked it pending, so screen readers reach the Skip that Tab focuses while it waits for
  // the app (introBootstrap.ts). After a film it is aria-hidden again as soon as it is idle: it stays
  // visibility: visible, fully transparent, for another 420 ms (the .intro transition).
  const ariaHidden = run === 0 ? undefined : playback === "idle" && !leaving;
  return (
    <section
      ref={sectionRef}
      className={className}
      aria-label="FITX welcome"
      aria-hidden={ariaHidden}
      data-fitx-intro-overlay
      data-intro-playback={playback}
      data-intro-stage={filmStage}
      data-intro-debug={debug ? "overlay" : undefined}
    >
      {debug && <DebugBackdrop image={debug.image} theme={theme} />}
      {/* The film's opening frame from the first paint (bootstrap "pending") until the film covers it. */}
      {!debug && <div className={styles.poster} aria-hidden="true" data-fitx-intro-poster="" />}
      {welcome && <WelcomeFilm onEnd={finish} firstName={memberName} record={false} focusSkip={welcomeFocus} />}
      {!welcome && (playback === "loading" || filmPlaying) && source === "live" && IntroScene && !debug && (
        <IntroScene
          theme={theme}
          onStage={onFilmStage}
          onReady={onSceneReady}
          onComplete={finish}
          onUnsupported={switchToVideo}
        />
      )}
      {!welcome && (playback === "loading" || filmPlaying) && source === "video" && !debug && (
        <FitxIntroVideo
          key={`video-${run}`}
          theme={theme}
          onStage={onFilmStage}
          onReady={onSceneReady}
          onComplete={finish}
          onUnsupported={showStaticFallback}
          onHold={onVideoHold}
          onVideo={setIntroVideo}
        />
      )}

      <div className={styles.ambient} aria-hidden="true" />
      {filmPlaying && <FilmGraphics key={`film-${run}`} stage={filmStage} theme={theme} freeze={freeze} />}
      {brandStage && (filmPlaying || leaving) && (
        <BrandEndCard key={`brand-${run}`} stage={filmStage} freeze={freeze} logoClassName={styles.logo} />
      )}

      {/* WelcomeFilm brings its own Skip: exactly one Skip control is in the page at any time. While the head script
          holds a claimed welcome film (before the app starts it), this one says so (CSS, from data-fitx-film). */}
      {!welcome && (
        <div className={styles.topline}>
          {!debug && (playback === "loading" || filmPlaying) && source === "video" && <SoundControl sound={sound} />}
          <button ref={skipRef} className={styles.skip} type="button" onClick={finish} aria-keyshortcuts="Escape" data-fitx-skip>
            <span className={styles.skipIntro}>Skip intro</span>
            <span className={styles.skipWelcome}>Skip welcome film</span>
            <kbd aria-hidden="true">ESC</kbd>
          </button>
        </div>
      )}

      {/* Only when the film cannot play (reduced motion, unsupported device): the static mark. */}
      {playback === "static" && (
        <div className={styles.staticBrand} ref={brandRef}>
          <Logo size={68} className={styles.logo} animateMark />
        </div>
      )}
    </section>
  );
}
