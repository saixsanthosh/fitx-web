"use client";

import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { FILM_CUT_ATTR, pickComposition, type FilmComposition, type FilmId, type FilmOverlayProps, type FilmTheme } from "./compositions";
import { cutBitrate, cutsIn, cutType, isLite, manifestFor, posterIn, type FilmCut, type FilmManifest } from "./manifest";
import { FILM_TIMING, filmStageAt, RESIZE_SETTLE_MS, swapAllowed } from "./timing";
import { FILM_POSTER_VAR } from "../introKeys";
import styles from "../FitxIntroScene.module.css";
import frameStyles from "./FilmVideo.module.css";

export type FilmVideoProps = {
  film: FilmId;
  theme: FilmTheme;
  onStage: (stage: number) => void;
  /** Playback stalled (buffering, a rotation swap) or resumed: overlays pause their CSS clocks to stay in sync. */
  onHold: (holding: boolean) => void;
  onEnd: () => void;
  /** No cut this browser can play, or both the chosen cut and the light one failed, or autoplay was refused. */
  onUnsupported: () => void;
  /** The first frame is playing (the poster under it can go). */
  onReady?: () => void;
  overlay?: ComponentType<FilmOverlayProps>;
  firstName?: string | null;
  /** The playing `<video>`, for the sound player (null on unmount). */
  onVideo?: (video: HTMLVideoElement | null) => void;
};

type BufferResult = "ready" | "slow" | "timeout";

/** How often an overlay hears the film clock while it plays (stage changes are reported at once). */
const OVERLAY_TICK_MS = 250;

/**
 * Buffers ahead of playback. "ready" once the browser expects to play through; "slow" if media is
 * arriving slower than ~1.1x real time, so playing this cut would stall; "timeout" after `capMs`
 * (e.g. browsers that only fetch once playing). The rate is averaged from the first buffered data
 * over at least 1.5 s, so latency and bursty delivery never read as a slow connection (fast
 * connections reach "ready" long before that). Unchanged from wave 1.
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

/** The best cut this device can decode smoothly (Media Capabilities), plus the light rung. */
async function chooseCut(manifest: FilmManifest, theme: FilmTheme, comp: FilmComposition, lite: boolean): Promise<{ first: FilmCut | null; light: FilmCut | null }> {
  const light = cutsIn(manifest, theme, comp, true)[0] ?? null;
  if (lite) return { first: light, light };
  const probe = document.createElement("video");
  for (const cut of cutsIn(manifest, theme, comp, false)) {
    if (cut.rung === "avc30") break;
    const type = cutType(cut);
    if (probe.canPlayType(type) === "") continue;
    if (navigator.mediaCapabilities?.decodingInfo) {
      try {
        const info = await navigator.mediaCapabilities.decodingInfo({
          type: "file",
          video: { contentType: type, width: cut.width, height: cut.height, bitrate: cutBitrate(cut, manifest.duration), framerate: cut.fps },
        });
        if (!info.supported || !info.smooth) continue;
      } catch {
        continue;
      }
    }
    return { first: cut, light };
  }
  return { first: light, light };
}

/** Marks <html> with the composition being served and its poster (the overlay's CSS reads both). */
function markComposition(manifest: FilmManifest, theme: FilmTheme, comp: FilmComposition) {
  const root = document.documentElement;
  root.setAttribute(FILM_CUT_ATTR, comp);
  const poster = posterIn(manifest, theme, comp);
  if (poster) root.style.setProperty(FILM_POSTER_VAR, `url("${poster}")`);
}

/**
 * A film as video (BRIEF-2 3.1), for any film in the manifest: the composition picked from the viewport's aspect
 * (never the user agent), HEVC 60 first and the light AVC 30 rung on low-end hardware, small phones and slow
 * connections. Reports stages from the video clock, swaps to the new composition's cut at the same time on
 * rotation (not in the first 1 s or the last 1.5 s), and retries the light cut once on an error before giving up.
 * Above 2.20:1 the desktop picture keeps a centred 2.20:1 box with side bars, the scope matte (FilmVideo.module.css),
 * dark from the first frame to the film's reveal stage.
 * Unchanged from wave 1: the 3 s buffer with the 1.1× real-time switch to the light cut, and the stage timer.
 */
export function FilmVideo({ film, theme, onStage, onHold, onEnd, onUnsupported, onReady, overlay: Overlay, firstName = null, onVideo }: FilmVideoProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onStage, onHold, onEnd, onUnsupported, onReady, onVideo });
  const themeRef = useRef(theme);
  const [clock, setClock] = useState({ stage: 0, time: 0, held: false, comp: "laptop" as FilmComposition });
  const overlayOn = Boolean(Overlay);

  useEffect(() => {
    callbacks.current = { onStage, onHold, onEnd, onUnsupported, onReady, onVideo };
  }, [onStage, onHold, onEnd, onUnsupported, onReady, onVideo]);

  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    const manifest = manifestFor(film);
    if (!video) return;
    callbacks.current.onVideo?.(video);
    const filmTheme = themeRef.current;
    const timing = FILM_TIMING[film];
    let timer = 0;
    let tick = 0;
    let resizeTimer = 0;
    let stage = -1;
    let started = false;
    let finished = false;
    let retried = false;
    let held = false;
    let tail = false;
    let current: FilmCut | null = null;
    let light: FilmCut | null = null;
    let comp: FilmComposition = "laptop";
    // The clock reading at the last check, to tell a running clock from one that lags behind.
    let lastTime = 0;
    let lastAt = 0;
    let slowChecks = 0;

    const report = () => {
      if (overlayOn) setClock({ stage: Math.max(stage, 0), time: video.currentTime, held, comp });
    };
    const hold = (next: boolean) => {
      if (held === next) return;
      held = next;
      callbacks.current.onHold(next);
      report();
    };
    const stop = () => {
      window.clearTimeout(timer);
      timer = 0;
    };
    /**
     * Reports stage changes from the video clock without a per-frame loop: one timer per stage boundary (and one for
     * the film's tail), re-armed from the clock whenever it fires, so a stall or a late timer can only delay a change,
     * never run it early. A clock that moved less than half as far as the time that passed (WebKit reports nearly the
     * paused time for up to ~0.15 s after a resume) is checked every frame for about half a second, then four times a
     * second.
     */
    const sync = (fromTimer: boolean) => {
      stop();
      if (finished) return;
      const time = video.currentTime;
      const at = performance.now();
      const rate = video.playbackRate;
      const next = filmStageAt(film, time);
      if (next !== stage) {
        stage = next;
        callbacks.current.onStage(next);
        report();
      }
      // From the film's tail its picture clears to the page, and the scope matte's bars clear with it (as long and on
      // the same curve: the frame's --film-tail-ms and --film-tail-ease).
      if (!tail && time >= timing.tail.at) {
        tail = true;
        frame?.setAttribute("data-film-tail", "");
      }
      const lagging = fromTimer && time - lastTime < ((at - lastAt) / 1000) * rate * 0.5;
      slowChecks = lagging ? slowChecks + 1 : 0;
      lastTime = time;
      lastAt = at;
      const stageBoundary = timing.stageStart[next + 1];
      const boundary = !tail && (stageBoundary === undefined || timing.tail.at < stageBoundary) ? timing.tail.at : stageBoundary;
      if (boundary === undefined || video.paused || !(rate > 0)) return;
      const delay = lagging ? (slowChecks <= 30 ? 16 : 250) : Math.max(4, ((boundary - time) / rate) * 1000);
      timer = window.setTimeout(sync, delay, true);
    };
    const onPlaying = () => {
      hold(false);
      if (!started) {
        started = true;
        video.style.visibility = "";
        // The scope matte's bars turn dark with the first frame (FilmVideo.module.css).
        frame?.setAttribute("data-film-playing", "");
        callbacks.current.onReady?.();
      }
      sync(false);
    };
    const onWaiting = () => {
      stop();
      if (started && !finished) hold(true);
    };
    const onEnded = () => {
      finished = true;
      stop();
      callbacks.current.onEnd();
    };
    const load = (cut: FilmCut, at = 0) => {
      current = cut;
      video.dataset.variant = cut.src.split("/").pop();
      video.src = cut.src;
      video.load();
      if (at > 0) {
        const seek = () => {
          video.removeEventListener("loadedmetadata", seek);
          try {
            video.currentTime = at;
          } catch {
            // Seeking before the metadata is in: the film restarts from where the new cut can play.
          }
        };
        video.addEventListener("loadedmetadata", seek);
      }
    };
    const onError = () => {
      if (finished) return;
      // One retry on the light cut, from where the film was, before giving up on the video.
      if (!retried && light && current && current.src !== light.src) {
        retried = true;
        const at = started ? video.currentTime : 0;
        load(light, at);
        void video.play().catch(() => {
          if (!started && !finished) callbacks.current.onUnsupported();
        });
        return;
      }
      callbacks.current.onUnsupported();
    };
    const onVisibility = () => {
      if (!started || finished) return;
      if (document.hidden) video.pause();
      else void video.play().catch(() => {});
    };
    const onClockChange = () => {
      if (started) sync(false);
    };
    /** Rotation or a resized window: the new composition's cut at the same time, inside the swap window only. */
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (!manifest || !started || finished || !current) return;
        const next = pickComposition(window.innerWidth, window.innerHeight, manifest.comps);
        if (next === comp) return;
        if (!swapAllowed(video.currentTime, manifest.duration)) return;
        const same = cutsIn(manifest, filmTheme, next, current.rung === "avc30");
        const cut = same.find((candidate) => candidate.rung === current?.rung && candidate.codecs === current?.codecs) ?? same[same.length - 1];
        if (!cut) return;
        comp = next;
        markComposition(manifest, filmTheme, next);
        report();
        // Two compositions served by one file (a manifest may share one; S6's never do): nothing to swap.
        if (cut.src === current.src) return;
        const at = video.currentTime;
        load(cut, at);
        void video.play().catch(() => {});
      }, RESIZE_SETTLE_MS);
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", onClockChange);
    video.addEventListener("ratechange", onClockChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);

    // Hidden until its first frame plays over the identical opening-frame poster.
    video.style.visibility = "hidden";
    video.muted = true;
    video.playsInline = true;

    if (overlayOn) {
      tick = window.setInterval(() => {
        if (started && !finished && !video.paused) report();
      }, OVERLAY_TICK_MS);
    }

    void (async () => {
      if (!manifest) {
        callbacks.current.onUnsupported();
        return;
      }
      comp = pickComposition(window.innerWidth, window.innerHeight, manifest.comps);
      markComposition(manifest, filmTheme, comp);
      const chosen = await chooseCut(manifest, filmTheme, comp, isLite());
      if (finished) return;
      light = chosen.light;
      if (!chosen.first) {
        callbacks.current.onUnsupported();
        return;
      }
      load(chosen.first);
      // A short head start so the opening seconds never stall (the opening frame covers it). If the connection
      // cannot keep up with this cut, switch to the light one before anything plays.
      const result = await bufferAhead(video, 3000);
      if (finished) return;
      if (result === "slow" && light && chosen.first !== light) {
        load(light);
        await bufferAhead(video, 2500);
        if (finished) return;
      }
      try {
        await video.play();
      } catch {
        // Autoplay refused (iOS Low Power Mode, data savers): the caller falls back to its still.
        if (!started && !finished) callbacks.current.onUnsupported();
      }
    })();

    return () => {
      finished = true;
      stop();
      window.clearInterval(tick);
      window.clearTimeout(resizeTimer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", onClockChange);
      video.removeEventListener("ratechange", onClockChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      callbacks.current.onVideo?.(null);
      video.pause();
      // Stop any download in flight.
      video.removeAttribute("src");
      video.load();
    };
  }, [film, overlayOn]);

  const tail = FILM_TIMING[film].tail;
  const frameStyle = { "--film-tail-ms": `${tail.ms}ms`, "--film-tail-ease": tail.ease } as CSSProperties;
  return (
    <>
      <div ref={frameRef} className={`${styles.canvas} ${frameStyles.frame}`} style={frameStyle} aria-hidden="true">
        <video
          ref={videoRef}
          className={`${styles.surface} ${frameStyles.video}`}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          data-fitx-film-video={film}
        />
        <i className={`${frameStyles.matte} ${frameStyles.matteLeft}`} />
        <i className={`${frameStyles.matte} ${frameStyles.matteRight}`} />
      </div>
      {Overlay && <Overlay film={film} stage={clock.stage} time={clock.time} held={clock.held} comp={clock.comp} firstName={firstName} />}
    </>
  );
}
