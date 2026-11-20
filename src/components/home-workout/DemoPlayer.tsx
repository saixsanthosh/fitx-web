"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotionSafe, usePageVisible } from "@/components/motion";
import { DEMONSTRATIONS } from "@/lib/home-workout/demos";
import type { HomeExercise } from "@/lib/home-workout/catalog";
import { demoBounds, place, sampleDemo } from "@/lib/home-workout/figure";
import { cn } from "@/lib/utils";
import type { FigureHandle } from "./FigureSvg";
import { FigureSvg } from "./FigureSvg";

interface DemoPlayerProps {
  exercise: HomeExercise;
  /** "lg": the exercise page (caption, step dots, angle); "sm": the live view's corner. */
  size?: "lg" | "sm";
  /** Paused from outside (a reel with its own control); hides the built-in button. */
  paused?: boolean;
  className?: string;
}

/** The index of the most telling pose: the turnaround of a rep, or the hold itself. */
function turnaroundIndex(exercise: HomeExercise): number {
  return Math.min(1, DEMONSTRATIONS[exercise.id].keyframes.length - 1);
}

/**
 * A looping, code-drawn demonstration of the exercise. It plays only while on screen, with the tab
 * visible and motion allowed; with reduced motion it shows the turnaround pose, still. A visible
 * button pauses it.
 */
export function DemoPlayer({ exercise, size = "lg", paused: pausedOutside, className }: DemoPlayerProps) {
  const demo = DEMONSTRATIONS[exercise.id];
  const box = useMemo(() => demoBounds(demo, 4 / 3, size === "lg" ? 30 : 24, size === "lg" ? 400 : 340), [demo, size]);
  const ghost = useMemo(() => {
    const frame = demo.keyframes[turnaroundIndex(exercise)];
    return place(demo, frame.pose, frame.at ?? demo.at);
  }, [demo, exercise]);
  const figure = useRef<FigureHandle>(null);
  const holder = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const dots = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const controlled = pausedOutside !== undefined;
  const playing = !reduced && visible && inView && !(controlled ? pausedOutside : paused);
  const large = size === "lg";

  useEffect(() => {
    const element = holder.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Each frame is drawn straight into the SVG; React renders nothing per frame.
  const shown = useRef({ label: "", index: -1 });
  useEffect(() => {
    const paint = (t: number) => {
      const frame = sampleDemo(demo, t);
      figure.current?.draw(frame.points);
      if (frame.label !== shown.current.label && caption.current) caption.current.textContent = frame.label ?? "";
      if (frame.index !== shown.current.index && dots.current) {
        [...dots.current.children].forEach((dot, index) => dot.toggleAttribute("data-on", index === frame.index));
      }
      shown.current = { label: frame.label ?? "", index: frame.index };
    };
    if (!playing) {
      // Still: the turnaround pose (the start of its hold), with its caption.
      const index = turnaroundIndex(exercise);
      const until = demo.keyframes.slice(0, index + 1).reduce((total, frame, i) => total + frame.moveMs + (i < index ? frame.holdMs ?? 0 : 0), 0);
      paint(until);
      return;
    }
    let raf = 0;
    let origin: number | null = null;
    const tick = (now: number) => {
      origin ??= now;
      paint(now - origin);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [demo, exercise, playing]);

  return (
    <div ref={holder} className={cn("relative h-full w-full", className)}>
      {/* The figure stands clear of the caption bar on the page; in the live view it fills its corner. */}
      <div className={large ? "absolute inset-x-0 bottom-20 top-0 sm:bottom-24" : "absolute inset-0"}>
        <FigureSvg
          ref={figure}
          box={box}
          angle={large ? exercise.angle : null}
          ghost={large ? ghost : null}
          weights={exercise.equipment === "Light dumbbells"}
          wallX={exercise.id === "wall_sit" ? demo.at.x - 64 - 12 : null}
          label={`How to do a ${exercise.rule.name.toLowerCase()}`}
        />
      </div>
      <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3", large ? "p-4 sm:p-5" : "p-2")}>
        <span className="min-w-0">
          {large && (
            <span ref={dots} className="mb-2 flex gap-1.5" aria-hidden="true">
              {demo.keyframes.map((frame, index) => (
                <span key={`${frame.label}-${index}`} className="h-1 w-5 rounded-full bg-fitx-text/25 transition-colors duration-300 data-[on]:bg-fitx-primary" />
              ))}
            </span>
          )}
          <span ref={caption} aria-hidden="true" className={cn("block truncate font-heading font-semibold tracking-tight text-fitx-text", large ? "text-lg sm:text-xl" : "text-xs")} />
        </span>
        {!reduced && !controlled && (
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? "Play demonstration" : "Pause demonstration"}
            className={cn(
              "pointer-events-auto grid shrink-0 place-items-center rounded-full border border-fitx-border bg-fitx-bg/70 text-fitx-text backdrop-blur-sm transition-colors hover:bg-fitx-hover",
              large ? "h-11 w-11" : "h-11 w-11 scale-90",
            )}
          >
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}
