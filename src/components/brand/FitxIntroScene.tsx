"use client";

import { useEffect, useRef } from "react";
import { createIntroDirector, type IntroDirector } from "./intro/director/director";
import type { Theme } from "./intro/types";
import styles from "./FitxIntroScene.module.css";

type Props = {
  theme: Theme;
  onStage: (stage: number) => void;
  onReady: () => void;
  onComplete: () => void;
  onUnsupported: () => void;
};

/**
 * The FITX film: procedural athletes, sets and camera work rendered live with three.js.
 * All orchestration lives in `intro/director`; this component only owns the canvas and
 * forwards the overlay's callbacks.
 */
export function FitxIntroScene({ theme, onStage, onReady, onComplete, onUnsupported }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onStage, onReady, onComplete, onUnsupported });
  const themeRef = useRef(theme);
  const directorRef = useRef<IntroDirector | null>(null);

  useEffect(() => {
    callbacks.current = { onStage, onReady, onComplete, onUnsupported };
  }, [onStage, onReady, onComplete, onUnsupported]);

  useEffect(() => {
    themeRef.current = theme;
    directorRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      callbacks.current.onUnsupported();
      return;
    }

    // A fresh canvas per mount: disposing the director releases its WebGL context for good
    // (forceContextLoss), and a lost context cannot be recreated on the same element — which
    // would break React's development double-mount and any remount for "Replay intro".
    const canvas = document.createElement("canvas");
    canvas.className = styles.surface;
    host.appendChild(canvas);

    const director = createIntroDirector({
      canvas,
      theme: themeRef.current,
      callbacks: {
        onStage: (stage) => callbacks.current.onStage(stage),
        onReady: () => callbacks.current.onReady(),
        onComplete: () => callbacks.current.onComplete(),
        onUnsupported: () => callbacks.current.onUnsupported(),
      },
    });
    directorRef.current = director;

    // Dev hook for frame-accurate review; never present in production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as Window & { __fitxIntro?: IntroDirector }).__fitxIntro = director;
    }

    const onReducedMotion = () => {
      if (!reducedMotion.matches) return;
      director.pause();
      callbacks.current.onUnsupported();
    };
    reducedMotion.addEventListener("change", onReducedMotion);

    return () => {
      reducedMotion.removeEventListener("change", onReducedMotion);
      director.dispose();
      directorRef.current = null;
      canvas.remove();
      if (process.env.NODE_ENV !== "production") {
        delete (window as Window & { __fitxIntro?: IntroDirector }).__fitxIntro;
      }
    };
  }, []);

  return <div ref={hostRef} className={styles.canvas} aria-hidden="true" />;
}
