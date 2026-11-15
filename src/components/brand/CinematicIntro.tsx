"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import styles from "./CinematicIntro.module.css";

type Playback = "idle" | "loading" | "three" | "static";
type Theme = "light" | "dark";
type IntroSceneComponent = typeof import("./FitxIntroScene")["FitxIntroScene"];

const SESSION_KEY = "fitx-cinematic-seen";
const REPLAY_EVENT = "fitx:intro:replay";

function readTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return stored === "dark" || (stored === "system" && prefersDark) ? "dark" : "light";
}

/** A session-once branded welcome layered over crawlable, server-rendered home content. */
export function CinematicIntro() {
  const [playback, setPlayback] = useState<Playback>("idle");
  const [stage, setStage] = useState(0);
  const [theme, setTheme] = useState<Theme>("light");
  const [leaving, setLeaving] = useState(false);
  const [IntroScene, setIntroScene] = useState<IntroSceneComponent | null>(null);
  const activeRef = useRef(false);
  const leaveTimer = useRef<number | null>(null);
  const readinessTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const fallbackStarted = useRef(false);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    document.documentElement.removeAttribute("data-fitx-intro");
    document.documentElement.removeAttribute("data-fitx-intro-ready");
    setPlayback("idle");
    setLeaving(true);
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(false), 560);
  }, []);

  const showStaticFallback = useCallback(() => {
    if (!activeRef.current || fallbackStarted.current) return;
    fallbackStarted.current = true;
    setPlayback("static");
    document.documentElement.dataset.fitxIntroReady = "fallback";
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
  }, []);

  const begin = useCallback((force: boolean) => {
    if (activeRef.current) return;
    if (!force && document.documentElement.dataset.fitxIntro !== "pending") return;

    activeRef.current = true;
    fallbackStarted.current = false;
    document.documentElement.dataset.fitxIntro = "active";
    document.documentElement.removeAttribute("data-fitx-intro-ready");
    setTheme(readTheme());
    setStage(0);
    setLeaving(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlayback(reduced ? "static" : "loading");

    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // The intro still works; the root-level safety timer prevents a stuck overlay.
    }

    if (!reduced) readinessTimer.current = window.setTimeout(showStaticFallback, 2400);
  }, [showStaticFallback]);

  const onSceneReady = useCallback(() => {
    if (!activeRef.current || fallbackStarted.current) return;
    if (readinessTimer.current !== null) window.clearTimeout(readinessTimer.current);
    document.documentElement.dataset.fitxIntroReady = "three";
    setStage(0);
    setPlayback("three");
  }, []);

  useEffect(() => {
    if (playback !== "loading" || IntroScene) return;
    let mounted = true;
    import("./FitxIntroScene").then((module) => {
      if (mounted) setIntroScene(() => module.FitxIntroScene);
    }).catch((error: unknown) => {
      if (process.env.NODE_ENV !== "production") console.warn("[FITX intro] Scene chunk failed to load", error);
      if (mounted) showStaticFallback();
    });
    return () => { mounted = false; };
  }, [IntroScene, playback, showStaticFallback]);

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
    const onReplay = () => begin(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeRef.current && event.key === "Escape") finish();
    };
    const onThemeChange = () => setTheme(readTheme());
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    const initialFrame = window.requestAnimationFrame(() => begin(false));
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
    };
  }, [begin, finish]);

  const className = [
    styles.intro,
    playback !== "idle" ? styles.active : "",
    leaving ? styles.leaving : "",
    theme === "dark" ? styles.dark : styles.light,
  ].filter(Boolean).join(" ");
  return (
    <section
      className={className}
      aria-label="FITX welcome"
      aria-hidden={playback === "idle" && !leaving}
      data-fitx-intro-overlay
    >
      {(playback === "loading" || playback === "three") && IntroScene && (
        <IntroScene
          theme={theme}
          onStage={setStage}
          onReady={onSceneReady}
          onComplete={finish}
          onUnsupported={showStaticFallback}
        />
      )}

      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.topline}>
        <button className={styles.skip} type="button" onClick={finish}>
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
      ) : stage === 3 ? (
        <div className={styles.brandReveal}>
          <Logo size={68} className={styles.logo} animateMark />
        </div>
      ) : playback === "loading" ? (
        <div className={styles.staticBrand} ref={brandRef}>
          <Logo size={68} className={styles.logo} />
        </div>
      ) : null}
    </section>
  );
}
