"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { LogoReveal } from "../logo/LogoReveal";
import { pickComposition, type FilmTheme } from "./compositions";
import { FilmVideo } from "./FilmVideo";
import { useFilmSound } from "./filmSound";
import { filmAllowed, manifestFor, posterIn, type FilmManifest } from "./manifest";
import { WELCOME_FILM_OVERLAY } from "./registry";
import { SoundControl } from "./SoundControl";
import { FILM_TIMING } from "./timing";
import {
  markFilmSeen,
  reportIntroComplete,
  WELCOME_EXIT_MS,
  WELCOME_STILL_MS,
  welcomeLine,
  welcomeMode,
  type WelcomeMode,
} from "./welcome-runtime";
import styles from "./WelcomeFilm.module.css";

/** How long the cut may take to start before the reveal plays instead (as the intro's 6 s). */
const READY_TIMEOUT_MS = 6000;
/** No stage change for this long while the film plays and the tab is visible: the film ends instead of covering the page. */
const WATCHDOG_MS = 8000;

type WelcomeFilmProps = {
  onEnd: () => void;
  firstName?: string | null;
  /**
   * D1: write the seen flag and POST /api/intro/complete when it starts (the onboarding document). CinematicIntro
   * passes false: there the account gate's IntroCompletionReporter records it, and a replay records nothing.
   */
  record?: boolean;
  /** Focus "Skip welcome film" as it appears (false when the page was not used from the keyboard). */
  focusSkip?: boolean;
};

function readTheme(): FilmTheme {
  const stored = document.documentElement.dataset.theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return stored === "dark" || (stored !== "light" && prefersDark) ? "dark" : "light";
}

/**
 * The welcome film (owner's phase 4; BRIEF-2 3.3 and D1), played once after onboarding, on the account gate and on
 * Replay. It brings its own "Skip welcome film" and "Sound" controls while the video plays, and exactly one Skip is in
 * the page at any time: LogoReveal "film-end" has none, and the reveal-only case uses LogoReveal's own. It ends on
 * the reveal locking over the igniting lines, fades its stage out over 300 ms and calls `onEnd`.
 */
export function WelcomeFilm({ onEnd, firstName = null, record = true, focusSkip = true }: WelcomeFilmProps) {
  const [manifest] = useState<FilmManifest | null>(() => (typeof document === "undefined" ? null : manifestFor("welcome")));
  const [mode, setMode] = useState<WelcomeMode | null>(null);
  const [theme, setTheme] = useState<FilmTheme>("dark");
  const [poster, setPoster] = useState("");
  const [stage, setStage] = useState(0);
  const [held, setHeld] = useState(false);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const ended = useRef(false);
  const exitTimer = useRef<number | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const onEndRef = useRef(onEnd);
  const sound = useFilmSound(mode === "film" ? video : null, mode === "film" ? manifest?.audio ?? null : null, { held, ending: leaving });

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  /** Straight on (the still, the reveal, no film). */
  const endNow = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    onEndRef.current();
  }, []);

  /** The film's end or Skip: the stage fades out over 300 ms, then `onEnd`. */
  const endFilm = useCallback(() => {
    if (ended.current || exitTimer.current !== null) return;
    setLeaving(true);
    exitTimer.current = window.setTimeout(endNow, WELCOME_EXIT_MS);
  }, [endNow]);

  // Decided in the browser, once: which case plays, and (D1) the device and the account remember it.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const chosen = welcomeMode({ hasManifest: manifest !== null, reduced, filmAllowed: filmAllowed() });
    if (chosen === "none") {
      endNow();
      return;
    }
    const filmTheme = readTheme();
    // The settings below follow the browser (theme, viewport): read once here, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(filmTheme);
    setPoster(manifest ? posterIn(manifest, filmTheme, pickComposition(window.innerWidth, window.innerHeight, manifest.comps)) : "");
    setMode(chosen);
    if (record) {
      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
      markFilmSeen(storage);
      void reportIntroComplete({ fetcher: (input, init) => fetch(input, init) });
    }
  }, [endNow, manifest, record]);

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  // Reduced motion: the still mark and the greeting for 2.0 s.
  useEffect(() => {
    if (mode !== "still") return;
    const timer = window.setTimeout(endNow, WELCOME_STILL_MS);
    return () => window.clearTimeout(timer);
  }, [mode, endNow]);

  // The film: the reveal takes over if the cut is not playing within 6 s; a stalled clock never covers the page.
  useEffect(() => {
    if (mode !== "film" || ready) return;
    const timer = window.setTimeout(() => setMode("reveal"), READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [mode, ready]);

  useEffect(() => {
    if (mode !== "film" || !ready || held || leaving) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(endFilm, WATCHDOG_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [mode, ready, held, leaving, stage, endFilm]);

  useEffect(() => {
    if (mode !== "film") return;
    if (focusSkip) skipRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") endFilm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, focusSkip, endFilm]);

  const onUnsupported = useCallback(() => {
    if (!ready) setMode("reveal");
    else endFilm();
  }, [ready, endFilm]);

  if (mode === null || mode === "none") return null;

  if (mode === "reveal") {
    // Save-Data, 2G or a video that cannot play: the reveal alone, with its own Skip (the only one).
    return (
      <div className={styles.reveal} data-welcome-film="reveal">
        <LogoReveal variant="welcome" onDone={endNow} />
      </div>
    );
  }

  if (mode === "still") {
    return (
      <div className={`${styles.stage} ${styles.still}`} role="dialog" aria-modal="true" aria-label="Welcome to FITX" data-welcome-film="still">
        <Logo size={76} className={styles.logo} />
        <p className={styles.line}>{welcomeLine(firstName)}</p>
      </div>
    );
  }

  const revealing = stage >= FILM_TIMING.welcome.revealStage;
  return (
    <div
      className={`${styles.stage} ${theme === "dark" ? styles.dark : styles.light} ${leaving ? styles.leaving : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to FITX"
      data-welcome-film="film"
      data-welcome-stage={stage}
    >
      {/* Frame 0 of the cut, under the video until its first frame plays over it. */}
      {!ready && <div className={styles.poster} style={poster ? { backgroundImage: `url("${poster}")` } : undefined} aria-hidden="true" />}
      <FilmVideo
        film="welcome"
        theme={theme}
        onStage={setStage}
        onHold={setHeld}
        onReady={() => setReady(true)}
        onEnd={endFilm}
        onUnsupported={onUnsupported}
        overlay={WELCOME_FILM_OVERLAY ?? undefined}
        firstName={firstName}
        onVideo={setVideo}
      />
      {revealing && (
        <div className={styles.end}>
          <LogoReveal variant="film-end" />
        </div>
      )}
      <div className={styles.topline}>
        <SoundControl sound={sound} />
        <button ref={skipRef} type="button" className={styles.skip} onClick={endFilm} aria-keyshortcuts="Escape" data-fitx-skip="">
          <span>Skip welcome film</span>
          <kbd aria-hidden="true">ESC</kbd>
        </button>
      </div>
    </div>
  );
}
