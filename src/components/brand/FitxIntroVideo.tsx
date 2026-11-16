"use client";

import { useEffect, useRef } from "react";
import { STAGE_START, stageAt } from "./intro/timeline";
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

type Orientation = "landscape" | "portrait";

/** One encoded cut of the film (rendered offline from `intro/`, frame-exact with the live film). */
type Variant = { src: string; type: string; width: number; height: number; framerate: number; bitrate: number };

type NavigatorHints = Navigator & {
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number };
};

/**
 * The cuts for one theme/orientation, best first: 60 fps HEVC (half the bytes; hardware-decoded on
 * Apple devices and most recent phones/PCs), 60 fps H.264 (decodes everywhere), and a light 30 fps
 * H.264 for low-end devices and slow connections.
 */
function variantsFor(theme: Theme, orientation: Orientation) {
  const base = `/brand/intro/fitx-intro-${theme}-${orientation}`;
  const [width, height] = orientation === "landscape" ? [1920, 1080] : [1080, 1920];
  const [liteWidth, liteHeight] = orientation === "landscape" ? [960, 540] : [540, 960];
  const full: Variant[] = [
    { src: `${base}-60.hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L123.B0"', width, height, framerate: 60, bitrate: 1_900_000 },
    { src: `${base}-60.mp4`, type: 'video/mp4; codecs="avc1.64002A"', width, height, framerate: 60, bitrate: 3_400_000 },
  ];
  const lite: Variant = { src: `${base}-30.mp4`, type: 'video/mp4; codecs="avc1.64001E"', width: liteWidth, height: liteHeight, framerate: 30, bitrate: 750_000 };
  return { full, lite, poster: `${base}.webp` };
}

/**
 * Low-end hardware: start on the light cut. Bandwidth is measured while the chosen cut buffers (see
 * `bufferAhead`) rather than taken from the browser's guesses: Chrome's `downlink` starts out
 * unreliable, and its "3g" effectiveType is driven by latency (a fast but far-away connection reads
 * as 3g), which says little about whether a video can stream.
 */
function prefersLite(): boolean {
  const nav = navigator as NavigatorHints;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 3) return true;
  const android = /Android/i.test(nav.userAgent);
  return android && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
}

/** The best cut this device can decode smoothly (Media Capabilities), plus the light fallback. */
async function chooseVariants(theme: Theme, orientation: Orientation): Promise<{ first: Variant; lite: Variant }> {
  const { full, lite } = variantsFor(theme, orientation);
  if (prefersLite()) return { first: lite, lite };
  const probe = document.createElement("video");
  for (const variant of full) {
    if (probe.canPlayType(variant.type) === "") continue;
    if (navigator.mediaCapabilities?.decodingInfo) {
      try {
        const info = await navigator.mediaCapabilities.decodingInfo({
          type: "file",
          video: { contentType: variant.type, width: variant.width, height: variant.height, bitrate: variant.bitrate, framerate: variant.framerate },
        });
        if (!info.supported || !info.smooth) continue;
      } catch {
        continue;
      }
    }
    return { first: variant, lite };
  }
  return { first: lite, lite };
}

type BufferResult = "ready" | "slow" | "timeout";

/**
 * Buffers ahead of playback. "ready" once the browser expects to play through; "slow" if media is
 * arriving slower than ~1.1x real time, so playing this cut would stall; "timeout" after `capMs`
 * (e.g. browsers that only fetch once playing). The rate is averaged from the first buffered data
 * over at least 1.5 s, so latency and bursty delivery never read as a slow connection (fast
 * connections reach "ready" long before that).
 */
function bufferAhead(video: HTMLVideoElement, capMs: number) {
  return new Promise<BufferResult>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      resolve("ready");
      return;
    }
    let firstAt = 0;
    let firstAhead = 0;
    let settled = false;
    const settle = (result: BufferResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      video.removeEventListener("canplaythrough", onEnough);
      resolve(result);
    };
    const onEnough = () => settle("ready");
    const timer = window.setTimeout(() => settle("timeout"), capMs);
    const poll = window.setInterval(() => {
      if (video.buffered.length === 0) return;
      const ahead = video.buffered.end(video.buffered.length - 1);
      const now = performance.now();
      if (!firstAt) {
        firstAt = now;
        firstAhead = ahead;
        return;
      }
      const span = (now - firstAt) / 1000;
      if (span < 1.5 || ahead >= 5) return;
      if ((ahead - firstAhead) / span < 1.1) settle("slow");
    }, 125);
    video.addEventListener("canplaythrough", onEnough);
  });
}

/**
 * The FITX film as video: same picture as the live render, instant start, smooth on any device.
 * Reports the same callbacks as `FitxIntroScene`, driving the overlay's stages from the video clock.
 * The opening-frame poster (CinematicIntro) shows until the first frame plays over it.
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
    let timer = 0;
    let stage = -1;
    let started = false;
    let finished = false;
    // The clock reading at the last check, to tell a running clock from one that lags behind.
    let lastTime = 0;
    let lastAt = 0;
    let slowChecks = 0;

    const stop = () => {
      window.clearTimeout(timer);
      timer = 0;
    };
    /**
     * Reports stage changes from the video clock without a per-frame loop (polling every frame would
     * wake the main thread for the whole film): one timer per stage boundary, re-armed from the clock
     * whenever it fires, so a stall or a late timer can only delay a stage change, never run it early.
     *
     * A timer that finds the clock moved less than half as far as the time that passed does not trust
     * it to say how far the boundary is: WebKit (every iPhone browser) keeps reporting nearly the paused
     * time for up to ~0.15 s after playback resumes, and a decoder can stall without a `waiting`
     * event. Such a clock is checked every frame for about half a second (catching a resume within a
     * frame), then four times a second (so a silent stall costs a few wake-ups, not a loop).
     */
    const sync = (fromTimer: boolean) => {
      stop();
      if (finished) return;
      const time = video.currentTime;
      const at = performance.now();
      const rate = video.playbackRate;
      const next = stageAt(time);
      if (next !== stage) {
        stage = next;
        callbacks.current.onStage(next);
      }
      // Events (playing, seeked, ratechange) start a new reference instead of judging the clock.
      const lagging = fromTimer && time - lastTime < ((at - lastAt) / 1000) * rate * 0.5;
      slowChecks = lagging ? slowChecks + 1 : 0;
      lastTime = time;
      lastAt = at;
      const boundary = STAGE_START[next + 1];
      // Paused or rate 0: the `playing` / `ratechange` events re-sync once the clock runs again.
      if (boundary === undefined || video.paused || !(rate > 0)) return;
      const delay = lagging ? (slowChecks <= 30 ? 16 : 250) : Math.max(4, ((boundary - time) / rate) * 1000);
      timer = window.setTimeout(sync, delay, true);
    };
    const onPlaying = () => {
      callbacks.current.onHold(false);
      if (!started) {
        started = true;
        video.style.visibility = "";
        callbacks.current.onReady();
      }
      sync(false);
    };
    const onWaiting = () => {
      stop();
      if (started && !finished) callbacks.current.onHold(true);
    };
    const onEnded = () => {
      finished = true;
      stop();
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

    // Re-sync the stage timer whenever the clock jumps or changes speed; a paused clock needs none.
    const onClockChange = () => {
      if (started) sync(false);
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", onClockChange);
    video.addEventListener("ratechange", onClockChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);

    // Hidden until its first frame plays over the identical opening-frame poster.
    video.style.visibility = "hidden";
    video.muted = true;
    video.playsInline = true;

    const orientation: Orientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
    const load = (variant: Variant) => {
      video.dataset.variant = variant.src.split("/").pop();
      video.src = variant.src;
      video.load();
    };
    void (async () => {
      const { first, lite } = await chooseVariants(themeRef.current, orientation);
      if (finished) return;
      load(first);
      // A short head start so the opening seconds never stall (the opening frame covers it). If the
      // connection cannot keep up with this cut, switch to the light one before anything plays.
      const result = await bufferAhead(video, 3000);
      if (finished) return;
      if (result === "slow" && first !== lite) {
        load(lite);
        await bufferAhead(video, 2500);
        if (finished) return;
      }
      try {
        await video.play();
      } catch {
        // Autoplay refused (iOS Low Power Mode, data savers): fall back to the static mark.
        if (!started && !finished) callbacks.current.onUnsupported();
      }
    })();

    return () => {
      finished = true;
      stop();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", onClockChange);
      video.removeEventListener("ratechange", onClockChange);
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
