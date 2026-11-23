"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, m, useInView } from "framer-motion";
import { Pause, Play, Smartphone } from "lucide-react";
import { EASE, useReducedMotionSafe, usePageVisible } from "@/components/motion";
import { Logo } from "@/components/ui/Logo";
import type { LoginScene } from "./scene/login-scene";
import { follow, idleDrift, pointerLook, sceneVerdict, tiltLook, type Look } from "./scene/scene-math";
import s from "./auth.module.css";

const WORDS = ["Lift", "Train", "Fuel", "Recover"] as const;
const WORD_SECONDS = 2.6;

type Theme = "light" | "dark";
type Motion = "idle" | "loading" | "live" | "still";
type TiltAccess = "none" | "ask" | "on" | "denied";

const never = () => () => {};

/** Whether this device may run the live scene (read once on the client; "server" before hydration). */
function readVerdict() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return sceneVerdict({
    reducedMotion: false,
    saveData: nav.connection?.saveData === true,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    appleMobile: isAppleMobile(),
    workers: typeof Worker !== "undefined",
  });
}

/** How this phone shares its tilt: "ask" (iOS, on a tap), "auto" (Android), or "none" (laptops). */
function readTiltSupport(): "ask" | "auto" | "none" {
  const api = orientationApi();
  if (!api || !window.matchMedia("(pointer: coarse)").matches) return "none";
  // Only Safari on iPhone and iPad holds motion back until a tap; other browsers share it (or ask on their own).
  return typeof api.requestPermission === "function" && isAppleMobile() ? "ask" : "auto";
}

/** The page's effective theme (a saved choice on <html data-theme>, else the device's). */
function readTheme(): Theme {
  const saved = document.documentElement.dataset.theme;
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };
const orientationApi = () => (typeof window !== "undefined" && "DeviceOrientationEvent" in window ? (window.DeviceOrientationEvent as unknown as OrientationPermission) : null);
const isAppleMobile = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * The sign-in pages' stage: a live 3D scene from the FITX film (Dre's deadlift set in the film's gym) that turns
 * with the phone's tilt or follows the pointer, over a still frame of the same scene. The still is the first paint,
 * and it stays with reduced motion, Save-Data, low-end devices, or whenever WebGL, the worker or the frame rate
 * fail; the still then drifts gently with the same tilt and pointer (except with reduced motion, when nothing moves).
 * iOS asks before it shares motion: the "Tilt to look around" button asks, on a tap.
 */
export function AuthStage() {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const root = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const still = useRef<HTMLDivElement>(null);
  const scene = useRef<LoginScene | null>(null);
  const look = useRef<Look | null>(null);
  const started = useRef(false);
  const inView = useInView(root);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as Theme);
  const [paused, setPaused] = useState(false);
  const verdict = useSyncExternalStore(never, readVerdict, () => "server" as const);
  const tiltSupport = useSyncExternalStore(never, readTiltSupport, () => "none" as const);
  const [loaded, setLoaded] = useState<Motion>("idle");
  const [answer, setAnswer] = useState<"granted" | "denied" | null>(null);
  const motion: Motion = reduced || verdict === "server" ? "idle" : verdict !== "live" ? "still" : loaded;
  const tilt: TiltAccess = tiltSupport === "none" ? "none" : tiltSupport === "auto" || answer === "granted" ? "on" : answer === "denied" ? "denied" : "ask";
  const [word, setWord] = useState(0);
  const running = !reduced && !paused && visible && inView;

  // Start the live scene once the page is idle (the form is usable first), when the device can carry it.
  useEffect(() => {
    if (reduced || verdict !== "live" || started.current) return;
    started.current = true;
    let cancelled = false;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const begin = () => {
      setLoaded("loading");
      import("./scene/login-scene")
        .then(({ createLoginScene }) => {
          if (cancelled || !host.current) return;
          scene.current = createLoginScene(host.current, readTheme(), {
            onReady: () => !cancelled && setLoaded("live"),
            onUnsupported: () => {
              if (cancelled) return;
              setLoaded("still");
              // Give the GPU back as soon as the still frame takes over (after the scene's own failure path returns).
              queueMicrotask(() => {
                scene.current?.dispose();
                scene.current = null;
              });
            },
          });
        })
        .catch(() => !cancelled && setLoaded("still"));
    };
    const id = w.requestIdleCallback ? w.requestIdleCallback(begin, { timeout: 1500 }) : window.setTimeout(begin, 400);
    return () => {
      cancelled = true;
      started.current = false;
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else window.clearTimeout(id);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [reduced, verdict]);

  useEffect(() => {
    scene.current?.setRunning(running && motion === "live");
  }, [running, motion]);

  useEffect(() => {
    scene.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => scene.current?.resize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Where the viewer looks from: the pointer anywhere on the page (laptops) or the phone's tilt.
  const setLook = useCallback((next: Look | null) => {
    look.current = next;
    scene.current?.setLook(next);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const fine = window.matchMedia("(pointer: fine)");
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      setLook(pointerLook(event.clientX, event.clientY, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }));
    };
    const onLeave = () => setLook(null);
    if (!fine.matches) return;
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, setLook]);

  // Phones: Android shares orientation without asking; iOS needs a tap on our button first.
  useEffect(() => {
    if (reduced || tilt !== "on") return;
    let rest: { beta: number; gamma: number } | null = null;
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      if (!rest) rest = { beta: event.beta, gamma: event.gamma };
      setLook(tiltLook(event, rest, screen.orientation?.angle ?? 0));
    };
    const onTurn = () => { rest = null; };
    window.addEventListener("deviceorientation", onOrientation);
    screen.orientation?.addEventListener?.("change", onTurn);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      screen.orientation?.removeEventListener?.("change", onTurn);
      setLook(null);
    };
  }, [reduced, tilt, setLook]);

  const askTilt = async () => {
    const api = orientationApi();
    try {
      setAnswer((await api?.requestPermission?.()) === "granted" ? "granted" : "denied");
    } catch {
      setAnswer("denied");
    }
  };

  // The still frame's own drift (when the live scene is not drawing): transform only, eased per frame.
  useEffect(() => {
    if (!running || motion !== "still" || !still.current) return;
    const element = still.current;
    const eased = { x: 0, y: 0 };
    let frame = 0;
    let last = 0;
    let clock = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      const goal = look.current ?? idleDrift(clock);
      eased.x = follow(eased.x, goal.x, dt, 0.35);
      eased.y = follow(eased.y, goal.y, dt, 0.35);
      element.style.transform = `translate3d(${(-eased.x * 1.6).toFixed(3)}%, ${(eased.y * 1.2).toFixed(3)}%, 0) scale(1.06)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      element.style.transform = "";
    };
  }, [running, motion]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setWord((index) => (index + 1) % WORDS.length), WORD_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <section ref={root} className={`${s.stage} fitx-inverse`} data-running={running} data-scene={motion} aria-label="FITX">
      <div ref={still} className={s.still} aria-hidden="true" />
      <div ref={host} className={s.scene} aria-hidden="true" />
      <div className={s.scrim} aria-hidden="true" />
      <div className={s.stageTop}>
        <Link href="/" className={s.homeLink} aria-label="FITX home"><Logo size={30} /></Link>
        {tilt === "ask" && !reduced && (
          <button type="button" className={s.tilt} onClick={() => void askTilt()}>
            <Smartphone size={15} aria-hidden="true" />Tilt to look around
          </button>
        )}
      </div>

      <p className={s.headline}>
        <span className="sr-only">Train smarter.</span>
        <span className={s.wordSlot} aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span
              key={WORDS[word]}
              initial={reduced ? { opacity: 0 } : { y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE.out }}
            >
              {WORDS[word]}
            </m.span>
          </AnimatePresence>
        </span>
        <span className={s.wordRest} aria-hidden="true">smarter.</span>
      </p>

      {!reduced && (
        <button type="button" className={s.pause} onClick={() => setPaused((value) => !value)} aria-label={paused ? "Play animation" : "Pause animation"}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        </button>
      )}
    </section>
  );
}
