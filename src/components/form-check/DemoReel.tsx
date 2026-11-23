"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pause, Play, Repeat, RotateCcw } from "lucide-react";
import { usePageVisible, useReducedMotionSafe } from "@/components/motion";
import type { DemoPhoto, HomeExercise } from "@/lib/home-workout/catalog";
import { demoScript, momentAt, phaseStart } from "@/lib/home-workout/demo-script";
import { DEMO_LABEL, demoForLibraryIds } from "@/lib/training/media";
import { useDemoIndexData, useDemoModel } from "@/lib/training/use-demo-model";
import { cn } from "@/lib/utils";
import styles from "./DemoReel.module.css";

interface DemoReelProps {
  exercise: HomeExercise;
  /** "lg": the exercise page (all controls, full captions); "sm": the live view's tile. */
  size?: "lg" | "sm";
  /** Draw at most this many frames a second (the live view, where the pose model needs the main thread). */
  maxFps?: number;
  /** Image loading priority (the page's first demonstration). */
  priority?: boolean;
  /** "contain" shows the whole photo in a box of another shape (the live view's tile); "cover" fills it. */
  fit?: "cover" | "contain";
  className?: string;
}

/**
 * The exercise's demonstration: its real photos, with captions timed to each moment of the movement.
 * With a photo of each end of the movement, the two cross-fade as the captions move from the start to
 * the turnaround and back; with one photo, it stays on screen labelled with the position it shows.
 * Play, pause, replay and loop are always at hand; it starts paused when reduced motion is asked for
 * (stepping through then cuts instead of fading), and it rests while off screen or in a hidden tab.
 * When FITX's AI demonstration exists for one of the exercise's library ids in the member's model
 * (public/media/demos/index.json), its start and end frames take the photos' place, labelled as an AI
 * demonstration; the timed captions stay the same.
 */
export function DemoReel({ exercise, size = "lg", maxFps, priority = false, fit = "cover", className }: DemoReelProps) {
  const script = useMemo(() => demoScript(exercise.id), [exercise.id]);
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const holder = useRef<HTMLDivElement>(null);
  const endLayer = useRef<HTMLDivElement>(null);
  const startLayer = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  /** null: follow the motion preference (play unless reduced motion); then the member's choice. */
  const [choice, setChoice] = useState<boolean | null>(null);
  const [loop, setLoop] = useState(true);
  const [index, setIndex] = useState(0);
  const [ended, setEnded] = useState(false);
  /** Which photo is mostly on screen, for its position label. */
  const [showsEnd, setShowsEnd] = useState(false);
  /** Milliseconds into the demonstration, kept across pauses. */
  const elapsed = useRef(0);
  const stepsId = useId();
  const large = size === "lg";
  const demos = useDemoIndexData();
  const model = useDemoModel();
  const demo = useMemo(() => demoForLibraryIds(demos, exercise.rule.libraryIds, model), [demos, exercise.rule.libraryIds, model]);
  const [demoFailed, setDemoFailed] = useState(false);
  const aiDemo = !!demo && !demoFailed;
  const { start, end } = useMemo((): { start: DemoPhoto | null; end: DemoPhoto | null } => {
    if (!demo || demoFailed) return exercise.photos;
    const frame = (src: string, which: "start" | "end"): DemoPhoto => ({
      image: { src, width: 1200, height: 900, alt: `${exercise.rule.name}, ${which} of the movement (${DEMO_LABEL.toLowerCase()})`, blurDataURL: "" },
      label: which === "start" ? "Start" : "End",
    });
    return { start: frame(demo.frames[0], "start"), end: frame(demo.frames[1], "end") };
  }, [demo, demoFailed, exercise.photos, exercise.rule.name]);
  const pair = !!start && !!end;
  const wantsPlay = choice ?? !reduced;
  const playing = !!script && wantsPlay && !ended && visible && inView;

  useEffect(() => {
    const element = holder.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Shows the moment `t` ms in: the photo mix is written to the DOM; React hears only phase changes. */
  const paint = useCallback((t: number, animate: boolean) => {
    if (!script) return;
    const moment = momentAt(script, t, loop);
    const mix = pair ? (animate ? moment.mix : moment.phase.frame === "end" ? 1 : 0) : 0;
    if (endLayer.current) {
      endLayer.current.style.opacity = String(mix);
      endLayer.current.style.transform = animate ? `scale(${(1.012 - 0.012 * mix).toFixed(4)})` : "";
    }
    if (startLayer.current) startLayer.current.style.transform = animate ? `scale(${(1 + 0.012 * mix).toFixed(4)})` : "";
    if (bar.current) bar.current.style.transform = `scaleX(${moment.progress.toFixed(3)})`;
    setIndex((current) => (current === moment.index ? current : moment.index));
    const end = mix >= 0.5;
    setShowsEnd((current) => (current === end ? current : end));
  }, [script, loop, pair]);

  useEffect(() => {
    if (!script) return;
    if (!playing) {
      paint(elapsed.current, false);
      return;
    }
    let raf = 0;
    let last: number | null = null;
    let painted = -Infinity;
    const gap = maxFps && maxFps > 0 ? 1000 / maxFps : 0;
    const tick = (now: number) => {
      if (last !== null) elapsed.current += Math.min(100, now - last);
      last = now;
      if (!loop && elapsed.current >= script.totalMs) {
        elapsed.current = script.totalMs - 1;
        paint(elapsed.current, !reduced);
        setEnded(true);
        return;
      }
      // A capped loop skips frames; the small tolerance keeps 24 fps from dropping to 20 on a 60 Hz screen.
      if (now - painted >= gap - 2) {
        painted = now;
        paint(elapsed.current, !reduced);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [script, playing, loop, maxFps, reduced, paint]);

  const togglePlay = () => {
    if (ended) {
      replay();
      return;
    }
    setChoice(!wantsPlay);
  };
  const replay = () => {
    elapsed.current = 0;
    setEnded(false);
    setChoice(true);
    paint(0, false);
  };
  const seek = (phase: number) => {
    if (!script) return;
    elapsed.current = phaseStart(script, phase);
    setEnded(false);
    paint(elapsed.current, false);
  };

  const phase = script?.phases[index] ?? null;
  const shownFrame = pair ? (showsEnd ? end : start) : start ?? end;
  const label = `How to do a ${exercise.rule.name.toLowerCase()}`;

  return (
    <figure ref={holder} aria-label={label} className={cn("fitx-inverse relative isolate h-full w-full overflow-hidden bg-fitx-bg text-fitx-text", className)}>
      {start && (
        <div ref={startLayer} className={styles.layer}>
          <Image src={start.image.src} alt={start.image.alt} fill sizes={large ? "(min-width: 1024px) 46vw, 100vw" : "240px"} {...imageSource(start, aiDemo, () => setDemoFailed(true))} priority={priority} className={fit === "cover" ? "object-cover object-[50%_35%]" : "object-contain"} />
        </div>
      )}
      {end && (
        <div ref={endLayer} className={styles.layer} style={{ opacity: start ? 0 : 1 }}>
          <Image src={end.image.src} alt={end.image.alt} fill sizes={large ? "(min-width: 1024px) 46vw, 100vw" : "240px"} {...imageSource(end, aiDemo, () => setDemoFailed(true))} priority={priority && !start} className={fit === "cover" ? "object-cover object-[50%_35%]" : "object-contain"} />
        </div>
      )}
      {!start && !end && (
        // No photo shows this move correctly yet: the captions lead, with the step they are on.
        <div className={styles.empty} aria-hidden="true">
          {script && (
            <span className={cn("absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 font-heading font-bold tabular-nums tracking-tight text-fitx-text/90", large ? "text-7xl sm:text-8xl" : "text-4xl")}>
              {String(index + 1).padStart(2, "0")}
              <span className={cn("text-fitx-text-secondary", large ? "text-2xl" : "text-base")}>/{String(script.phases.length).padStart(2, "0")}</span>
            </span>
          )}
        </div>
      )}
      <div className={styles.shade} aria-hidden="true" />

      {shownFrame && (
        <span className={cn("absolute left-3 top-3 rounded-full border border-fitx-border bg-fitx-bg/70 font-semibold backdrop-blur-sm", large ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]")}>
          {shownFrame.label}
        </span>
      )}
      {aiDemo && (
        <span className={cn("absolute right-3 top-3 rounded-full border border-fitx-border bg-fitx-bg/70 font-semibold backdrop-blur-sm", large ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]")}>
          <span aria-hidden="true">AI demo</span><span className="sr-only">{DEMO_LABEL}</span>
        </span>
      )}

      {phase && (
        <figcaption className={cn("absolute inset-x-0 bottom-0", large ? "p-4 sm:p-5" : "p-2.5")}>
          <span className="flex items-end justify-between gap-3">
            <span className="min-w-0" aria-hidden="true">
              <span key={`${index}-${phase.caption}`} className={cn(styles.caption, "block font-heading font-bold leading-tight tracking-tight", large ? "text-2xl sm:text-[28px]" : "truncate text-sm")}>
                {phase.caption}
              </span>
              {large && <span key={`d-${index}`} className={cn(styles.caption, "mt-1 block text-sm text-fitx-text-secondary")}>{phase.detail}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {large && (
                <button type="button" onClick={replay} aria-label="Replay demonstration" className={styles.control}>
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
              )}
              {large && (
                <button type="button" onClick={() => setLoop((value) => !value)} aria-pressed={loop} aria-label="Loop demonstration" className={cn(styles.control, loop && styles.controlOn)}>
                  <Repeat size={16} aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={togglePlay} aria-label={ended ? "Replay demonstration" : wantsPlay ? "Pause demonstration" : "Play demonstration"} className={cn(styles.control, !large && styles.controlSmall)}>
                <span aria-hidden="true">{ended ? <RotateCcw size={large ? 16 : 14} /> : wantsPlay ? <Pause size={large ? 16 : 14} /> : <Play size={large ? 16 : 14} />}</span>
              </button>
            </span>
          </span>
          {large && script && (
            <span className="mt-1 flex gap-1.5">
              {script.phases.map((step, i) => (
                <button
                  key={`${step.caption}-${i}`}
                  type="button"
                  onClick={() => seek(i)}
                  aria-label={`Show step ${i + 1}: ${step.caption}`}
                  aria-current={i === index ? "step" : undefined}
                  className={styles.step}
                >
                  <span className={styles.track} aria-hidden="true">
                    {i < index && <span className={styles.fill} />}
                    {i === index && <span ref={bar} className={cn(styles.fill, styles.live)} />}
                  </span>
                </button>
              ))}
            </span>
          )}
        </figcaption>
      )}

      {script && (
        <ol id={stepsId} className="sr-only">
          {script.phases.map((step, i) => (
            <li key={`${step.caption}-${i}`}>{step.caption}. {step.detail}.</li>
          ))}
        </ol>
      )}
    </figure>
  );
}

/**
 * next/image props for a frame: the checked photos are static imports with a blur placeholder; an AI demonstration
 * is a ready-sized WebP served as it is (`unoptimized`, no transformation), and a failed one gives way to the photos.
 */
function imageSource(photo: DemoPhoto, aiDemo: boolean, onDemoError: () => void) {
  return aiDemo
    ? { unoptimized: true, placeholder: "empty" as const, onError: onDemoError }
    : { placeholder: "blur" as const, blurDataURL: photo.image.blurDataURL };
}
