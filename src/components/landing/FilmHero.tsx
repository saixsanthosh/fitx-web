"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import { useInView } from "framer-motion";
import { useReducedMotionSafe, usePageVisible } from "@/components/motion";
import { IntroReplayControl } from "@/components/brand/IntroReplayControl";
import { CHAPTERS, POSTER_SECONDS, afterLoadAndIdle, chapterAt, chapterProgress, reelAllowed, reelSource, shapeFor, type FilmShape } from "./film";
import { useSiteTheme } from "./useSiteTheme";
import styles from "./landing.module.css";

const never = () => () => {};
const readSaveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
function subscribeShape(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const readShape = (): FilmShape => shapeFor(window.innerWidth, window.innerHeight);

/**
 * The opening frame: FITX's own film, from the sprint start to the team walk, playing muted behind the headline.
 * Its chapters (Run, Ride, Lift, Fuel, Progress) sit on a rail: each fills as it plays, says what FITX does for it,
 * and jumps the film there when chosen. With reduced motion or Save-Data the film's still frame stays and the rail
 * is a plain list. The film stops while it is off screen or the tab is hidden, and has its own pause control.
 * The still comes first: the reel is fetched only after the page's `load` event and an idle moment (film.ts
 * afterLoadAndIdle), so it never competes with the first screen, and only once the real viewport is known, so a phone
 * fetches only the phone cut. The still is the reel POSTER_SECONDS in, and the reel starts playing there.
 */
export function FilmHero() {
  const reduced = useReducedMotionSafe();
  const saveData = useSyncExternalStore(never, readSaveData, () => false);
  const theme = useSiteTheme();
  const shape = useSyncExternalStore(subscribeShape, readShape, () => "landscape" as FilmShape);
  const visible = usePageVisible();
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const rail = useRef<HTMLOListElement>(null);
  const inView = useInView(root, { amount: 0.2 });
  const [paused, setPaused] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState(false);
  // Where the reel starts: on the still's own frame, so the fade-in never jumps the film back; a chapter chosen
  // before the reel has loaded replaces it.
  const startAt = useRef(POSTER_SECONDS);
  const allowed = reelAllowed({ reducedMotion: reduced, saveData });
  const live = allowed && theme !== null;
  const source = settled && theme && allowed ? reelSource(theme, shape) : null;

  useEffect(() => {
    if (!allowed) return;
    return afterLoadAndIdle(window, () => setSettled(true));
  }, [allowed]);
  const shouldPlay = allowed && !paused && visible && inView;

  // Swap the file when the theme or the shape changes, keeping the place in the film.
  useEffect(() => {
    const element = video.current;
    if (!element || !source) return;
    if (element.getAttribute("src") === source) return;
    const at = element.currentTime || startAt.current;
    element.src = source;
    element.load();
    const resume = () => {
      if (at) element.currentTime = at;
    };
    element.addEventListener("loadedmetadata", resume, { once: true });
    return () => element.removeEventListener("loadedmetadata", resume);
  }, [source]);

  useEffect(() => {
    const element = video.current;
    if (!element || !source) return;
    if (shouldPlay) element.play().catch(() => setPlaying(false));
    else element.pause();
  }, [shouldPlay, source]);

  // The rail follows the film: chapter changes re-render; the fill is written straight to a CSS variable.
  useEffect(() => {
    const element = video.current;
    if (!element || !source || !playing) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      const t = element.currentTime;
      const index = chapterAt(t);
      if (index !== last) {
        last = index;
        setChapter(index);
      }
      rail.current?.querySelectorAll<HTMLElement>("[data-chapter]").forEach((item, i) => {
        item.style.setProperty("--fill", String(i < index ? 1 : i === index ? chapterProgress(i, t) : 0));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source]);

  const jump = (index: number) => {
    setChapter(index);
    const element = video.current;
    if (paused) setPaused(false);
    if (!element || !source) {
      startAt.current = CHAPTERS[index].start + 0.01;
      return;
    }
    element.currentTime = CHAPTERS[index].start + 0.01;
  };

  // "still": no film at all (reduced motion, Save-Data); "poster": the still while the reel waits for the page to load.
  const filmState = !live ? "still" : playing ? "playing" : source ? "ready" : "poster";

  return (
    <section ref={root} className={styles.hero} aria-labelledby="hero-title" data-film={filmState} data-reel={source ? shape : undefined}>
      <div className={styles.heroStill} aria-hidden="true" />
      {source && (
        <video
          ref={video}
          className={styles.heroFilm}
          data-on={playing}
          muted
          playsInline
          loop
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}
      <div className={styles.heroShade} aria-hidden="true" />

      <div className={styles.heroInner}>
        <p className={`${styles.eyebrow} ${styles.stageEyebrow}`}>Train · Eat · Move · Progress</p>
        <h1 id="hero-title" className={styles.heroTitle}>
          <span className={styles.heroLine}><span>Train smart.</span></span>
          <span className={styles.heroLine}><span>Live fit.</span></span>
        </h1>
        <div className={styles.heroActions}>
          <Link href="/signup" prefetch={false} className={`${styles.primary} fitx-when-signed-out`}>
            Start training <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/dashboard" prefetch={false} className={`${styles.primary} fitx-when-signed-in`}>
            Open dashboard <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <a href="#capabilities" className={styles.ghost}>What FITX does</a>
        </div>

        <div className={styles.chapters}>
          <ol ref={rail} className={styles.rail} aria-label="Film chapters">
            {CHAPTERS.map((item, index) => (
              <li key={item.id} data-chapter={item.id} data-current={live && index === chapter} style={{ "--fill": live ? 0 : 1 } as CSSProperties}>
                {live ? (
                  <button type="button" onClick={() => jump(index)} aria-current={index === chapter ? "step" : undefined} aria-label={`${item.label}: ${item.line}`}>
                    <span className={styles.railBar} aria-hidden="true"><i /></span>
                    <span className={styles.railLabel}>{item.label}</span>
                    <span className={styles.railLine}>{item.line}</span>
                  </button>
                ) : (
                  <div className={styles.railStatic}>
                    <span className={styles.railLabel}>{item.label}</span>
                    <span className={styles.railLine}>{item.line}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {live && <p className={styles.railNow} aria-hidden="true"><b>{CHAPTERS[chapter].label}</b> {CHAPTERS[chapter].line}</p>}
          <div className={styles.heroMeta}>
            {live && (
              <button type="button" className={styles.filmToggle} onClick={() => setPaused((value) => !value)} aria-label={paused ? "Play film" : "Pause film"}>
                {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
              </button>
            )}
            <IntroReplayControl className={styles.replay} />
          </div>
        </div>
      </div>
    </section>
  );
}
