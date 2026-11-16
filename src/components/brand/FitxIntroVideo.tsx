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
 * Rough downlink in Mbit/s: the Network Information API where it exists (Chrome/Android), else the
 * opening-frame image's own download (Safari/iOS has no such API; the image was fetched moments ago).
 */
function downlinkMbps(posterPath: string): number | null {
  const connection = (navigator as NavigatorHints).connection;
  if (typeof connection?.downlink === "number" && connection.downlink > 0) return connection.downlink;
  const entry = performance.getEntriesByType("resource").find((item) => item.name.endsWith(posterPath)) as PerformanceResourceTiming | undefined;
  if (!entry || entry.transferSize < 20_000) return null; // cached or too small to measure
  const ms = entry.responseEnd - entry.responseStart;
  return ms > 0 ? (entry.transferSize * 8) / (ms * 1000) : null;
}

/** Low-end hardware or a slow connection: the light cut plays smoothly where the full one would stall. */
function wantsLite(posterPath: string): boolean {
  const nav = navigator as NavigatorHints;
  const effective = nav.connection?.effectiveType;
  if (effective === "slow-2g" || effective === "2g" || effective === "3g") return true;
  const mbps = downlinkMbps(posterPath);
  if (mbps !== null && mbps < 3) return true;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 3) return true;
  const android = /Android/i.test(nav.userAgent);
  return android && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
}

/** The best cut this device can decode smoothly (Media Capabilities), else the light one. */
async function chooseVariant(theme: Theme, orientation: Orientation): Promise<Variant> {
  const { full, lite, poster } = variantsFor(theme, orientation);
  if (wantsLite(poster)) return lite;
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
    return variant;
  }
  return lite;
}

/** Resolves once the browser expects to play through without stalling, or after `capMs`. */
function bufferAhead(video: HTMLVideoElement, capMs: number) {
  return new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      resolve();
      return;
    }
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("canplaythrough", done);
      resolve();
    };
    const timer = window.setTimeout(done, capMs);
    video.addEventListener("canplaythrough", done);
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

    // Hidden until its first frame plays over the identical opening-frame poster.
    video.style.visibility = "hidden";
    video.muted = true;
    video.playsInline = true;

    const orientation: Orientation = window.innerHeight > window.innerWidth ? "portrait" : "landscape";
    void (async () => {
      const variant = await chooseVariant(themeRef.current, orientation);
      if (finished) return;
      video.dataset.variant = variant.src.split("/").pop();
      video.src = variant.src;
      video.load();
      // A short head start so playback does not stall in its first seconds (the poster covers it).
      await bufferAhead(video, 1500);
      if (finished) return;
      try {
        await video.play();
      } catch {
        // Autoplay refused (iOS Low Power Mode, data savers): fall back to the static mark.
        if (!started && !finished) callbacks.current.onUnsupported();
      }
    })();

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
