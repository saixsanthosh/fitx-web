"use client";

import { useEffect, useRef } from "react";
import { stageAt } from "./intro/timeline";
import type { Theme } from "./intro/types";
import styles from "./FitxIntroScene.module.css";

type Props = {
  theme: Theme;
  onStage: (stage: number) => void;
  onReady: () => void;
  onComplete: () => void;
  onUnsupported: () => void;
  /** Playback stalled (buffering) or resumed: the overlay pauses its CSS clocks to stay in sync. */
  onHold: (holding: boolean) => void;
};

/** Pre-rendered cuts of the same film (`intro/` rendered offline, deterministic), per theme and orientation. */
function filmSource(theme: Theme) {
  const orientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
  return `/brand/intro/fitx-intro-${theme}-${orientation}.mp4`;
}

/**
 * The FITX film as video, for devices that should not render it live (phones, tablets, Safari,
 * no WebGL): same picture, instant start, no shader compilation. Reports the same callbacks as
 * `FitxIntroScene`, driving the overlay's stages from the video clock.
 */
export function FitxIntroVideo({ theme, onStage, onReady, onComplete, onUnsupported, onHold }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onStage, onReady, onComplete, onUnsupported, onHold });
  const themeRef = useRef(theme);

  useEffect(() => {
    callbacks.current = { onStage, onReady, onComplete, onUnsupported, onHold };
  }, [onStage, onReady, onComplete, onUnsupported, onHold]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let stage = -1;
    let started = false;
    let finished = false;

    const track = () => {
      raf = 0;
      if (finished) return;
      const next = stageAt(video.currentTime);
      if (next !== stage) {
        stage = next;
        callbacks.current.onStage(next);
      }
      raf = requestAnimationFrame(track);
    };
    const onPlaying = () => {
      callbacks.current.onHold(false);
      if (!started) {
        started = true;
        video.style.visibility = "";
        callbacks.current.onReady();
      }
      if (!raf) raf = requestAnimationFrame(track);
    };
    const onWaiting = () => {
      if (started && !finished) callbacks.current.onHold(true);
    };
    const onEnded = () => {
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      callbacks.current.onComplete();
    };
    const onError = () => {
      if (!finished) callbacks.current.onUnsupported();
    };
    const onVisibility = () => {
      if (!started || finished) return;
      if (document.hidden) video.pause();
      else void video.play().catch(() => {});
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);

    // Hidden until the first frame plays, so the loading mark sits on the theme background.
    video.style.visibility = "hidden";
    video.muted = true;
    video.playsInline = true;
    video.src = filmSource(themeRef.current);
    // Autoplay can be refused (iOS Low Power Mode, data savers): fall back to the static mark.
    video.play().catch(() => {
      if (!started && !finished) callbacks.current.onUnsupported();
    });

    return () => {
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
      // Stop any download in flight.
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <div className={styles.canvas} aria-hidden="true">
      <video
        ref={videoRef}
        className={styles.surface}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        tabIndex={-1}
      />
    </div>
  );
}
