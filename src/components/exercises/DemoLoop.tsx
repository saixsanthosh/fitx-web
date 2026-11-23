"use client";

/**
 * DemoLoop: an exercise's two frames played as a looping demonstration (phases 12 and 13): the Free Exercise DB's
 * public-domain photos, or FITX's AI demonstration made from them (a male and a female model). They blend one into
 * the other and back, one repetition at a time, with Play/Pause, Replay, Loop and half speed. Each frame has its own
 * caption, which changes exactly when the frame does and is read out only while the loop is paused. It says plainly
 * what the pictures are and that no verified video exists. With both models, "Demonstration model" switches person.
 *
 * Motion is opacity and a slight scale only. It never starts on its own while the device asks for reduced motion
 * (Play still works, without the blend), and it pauses while off screen or while the tab is hidden.
 *
 *   <DemoLoop stills={media.stills} name="Push-Up" />                 the exercise page
 *   <DemoLoop stills={media.stills} name="Push-Up" size="compact" />  the live workout and sheets
 */
import Image from "next/image";
import { useEffect, useId, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Pause, Play, Repeat, RotateCcw, VideoOff } from "lucide-react";
import { usePageVisible, useReducedMotionSafe } from "@/components/motion";
import { SUPABASE_URL } from "@/lib/supabase/client";
import { DEMO_LABEL, isOptimizableImageUrl, mediaCreditLines, type DemoModelKey, type MediaItem } from "@/lib/training/media";
import { DEMO_MODEL_LABELS } from "@/lib/training/setup";
import { cn } from "@/lib/utils";
import {
  advanceDemo, blendDuration, frameInterval, frameLabel, initialDemoState, replayDemo, showFrame, togglePlay,
  type DemoSpeed, type DemoState,
} from "./demo-loop";
import styles from "./DemoLoop.module.css";

type Action = { type: "tick"; frames: number } | { type: "toggle"; frames: number } | { type: "replay"; frames: number }
  | { type: "loop" } | { type: "show"; frame: number; frames: number } | { type: "autoplay"; frames: number };

function reduce(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "tick": return advanceDemo(state, action.frames);
    case "toggle": return togglePlay(state, action.frames);
    case "replay": return replayDemo(state, action.frames);
    case "loop": return { ...state, loop: !state.loop };
    case "show": return showFrame(state, action.frame, action.frames);
    case "autoplay": return action.frames > 1 ? { ...state, playing: true } : state;
  }
}

function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setOnScreen(true); return; }
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, onScreen] as const;
}

type DemoLoopProps = {
  stills: readonly MediaItem[];
  name: string;
  size?: "full" | "compact";
  className?: string;
  /** Shown when every photo fails to load. */
  whenEmpty?: ReactNode;
  /** Called when a still fails to load (the player gives a failed AI demonstration way to the real photos). */
  onStillError?: (still: MediaItem) => void;
  /** The models this exercise's demonstration has; with both, the "Demonstration model" choice shows. */
  models?: readonly DemoModelKey[];
  /** The model on screen (checked in the choice). */
  model?: DemoModelKey | null;
  onModelChange?: (model: DemoModelKey) => void;
};

export function DemoLoop({ stills, name, size = "full", className, whenEmpty = null, models = [], model = null, onModelChange, onStillError }: DemoLoopProps) {
  const reducedMotion = useReducedMotionSafe();
  const radioName = useId();
  const [failed, setFailed] = useState<readonly string[]>([]);
  const shown = stills.filter((still) => !failed.includes(still.url));
  const frames = shown.length;
  const [state, dispatch] = useReducer(reduce, { frames }, (init) => initialDemoState({ autoplay: false, frames: init.frames }));
  const [speed, setSpeed] = useState<DemoSpeed>(1);
  const [stageRef, onScreen] = useOnScreen<HTMLDivElement>();
  const visible = usePageVisible();
  const autoplayed = useRef(false);
  const frame = frames ? Math.min(state.frame, frames - 1) : 0;
  const running = state.playing && onScreen && visible && frames > 1;

  // Starts once, when first on screen, unless the device asks for reduced motion.
  useEffect(() => {
    if (autoplayed.current || reducedMotion || !onScreen || frames < 2) return;
    autoplayed.current = true;
    dispatch({ type: "autoplay", frames });
  }, [reducedMotion, onScreen, frames]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => dispatch({ type: "tick", frames }), frameInterval(speed));
    return () => window.clearTimeout(timer);
  }, [running, state, frames, speed]);

  if (!frames) return <>{whenEmpty}</>;
  const blend = blendDuration(speed, reducedMotion);
  const credits = mediaCreditLines(shown);
  // The caption of the frame on screen: it changes exactly when the frame does.
  const caption = shown[frame]?.caption ?? null;
  const compact = size === "compact";
  const aiDemo = shown.some((still) => still.aiDemo);
  const chooser = onModelChange && models.length > 1;
  // The caption row stays in place for the whole loop, so a frame without a caption never makes the controls jump.
  const hasCaptions = shown.some((still) => still.caption);

  return (
    <figure className={cn("m-0", className)} aria-label={`${name}: ${aiDemo ? "AI demonstration" : "photo demonstration"}`}>
      <div ref={stageRef} className={cn(styles.stage, compact && styles.compact)}>
        {shown.map((still, index) => (
          <Image
            key={still.url}
            src={still.url}
            alt={index === frame ? still.alt : ""}
            aria-hidden={index === frame ? undefined : true}
            fill
            priority={!compact && index === 0}
            sizes={compact ? "(max-width: 768px) 92vw, 560px" : "(max-width: 768px) 100vw, (max-width: 1280px) 60vw, 760px"}
            unoptimized={!isOptimizableImageUrl(still.url, SUPABASE_URL)}
            className={cn(styles.frame, index === frame && styles.active, running && styles.drift)}
            style={{ "--demo-blend": `${blend}ms` } as CSSProperties}
            onError={() => {
              setFailed((current) => (current.includes(still.url) ? current : [...current, still.url]));
              onStillError?.(still);
            }}
          />
        ))}
        <span className={styles.badge}><VideoOff size={13} aria-hidden="true" />No verified video yet</span>
        {frames > 1 && (
          <span className={styles.counter} aria-hidden="true">{frame + 1}/{frames}</span>
        )}
      </div>
      {(hasCaptions || chooser) && (
        <div className={styles.lead}>
          {/* Every caption sits in the same cell (the others hidden), so the row is as tall as the longest one and the
              controls below never move when the frame changes, however each caption wraps. */}
          <div className={styles.frameCaption}>
            {shown.map((still, index) => (still.caption && index !== frame
              ? <span key={`sizer-${still.url}`} className={styles.captionSizer} aria-hidden="true">{still.caption}</span>
              : null))}
            <p className={styles.captionLine} data-demo-caption aria-live={state.playing ? "off" : "polite"} aria-atomic="true">
              {caption && <span key={`${frame}-${caption}`} className={styles.captionText}>{caption}</span>}
            </p>
          </div>
          {chooser && (
            <div role="radiogroup" aria-label="Demonstration model" className={styles.models}>
              {models.map((value) => (
                <label key={value} className={cn(styles.model, value === model && styles.modelOn)}>
                  <input type="radio" name={radioName} value={value} checked={value === model} onChange={() => onModelChange(value)} className={styles.modelInput} />
                  <span>{DEMO_MODEL_LABELS[value]}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {frames > 1 && (
        <div className={styles.controls} role="group" aria-label={`${name}: demonstration controls`}>
          <button type="button" className={cn(styles.control, styles.primary)} onClick={() => dispatch({ type: "toggle", frames })}
            aria-label={state.playing ? "Pause demonstration" : "Play demonstration"}>
            {state.playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
          </button>
          <button type="button" className={styles.control} onClick={() => dispatch({ type: "replay", frames })} aria-label="Replay demonstration">
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          <button type="button" className={cn(styles.control, state.loop && styles.on)} aria-pressed={state.loop} onClick={() => dispatch({ type: "loop" })} aria-label="Loop">
            <Repeat size={16} aria-hidden="true" />
          </button>
          <button type="button" className={cn(styles.control, styles.text, speed === 0.5 && styles.on)} aria-pressed={speed === 0.5}
            onClick={() => setSpeed((current) => (current === 1 ? 0.5 : 1))} aria-label="Half speed">0.5×</button>
          <span className={styles.dots}>
            {shown.map((still, index) => (
              <button key={still.url} type="button" className={styles.dot} aria-pressed={index === frame} aria-label={`Show photo ${index + 1}`}
                onClick={() => dispatch({ type: "show", frame: index, frames })}>
                <span className={cn(styles.dotMark, index === frame && styles.dotOn)} />
              </button>
            ))}
          </span>
          <span className="sr-only" aria-live={state.playing ? "off" : "polite"}>{frameLabel(frame, frames)}{state.playing ? "" : ", paused"}</span>
        </div>
      )}
      <figcaption className={styles.caption}>
        {aiDemo
          ? <span className="block">{DEMO_LABEL}.{compact ? "" : " A video demonstration is not available yet."}</span>
          : !compact && <span className="block">Real photos of the movement, played in order. A video demonstration is not available yet.</span>}
        {credits.map((line) => <span key={line} className="block text-[11px] text-fitx-text-disabled">{line}</span>)}
      </figcaption>
    </figure>
  );
}
