"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, Play, SwitchCamera, Volume2, VolumeX, X } from "lucide-react";
import { DemoPlayer } from "@/components/home-workout/DemoPlayer";
import { LiveFigure } from "@/components/home-workout/LiveFigure";
import type { CoachSnapshot } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { captionFor } from "@/lib/home-workout/captions";
import { homeExercise } from "@/lib/home-workout/catalog";
import { firstLoadMegabytes } from "@/lib/pose/assets";
import { cn } from "@/lib/utils";
import live from "@/components/home-workout/live.module.css";
import { lockScroll } from "./scroll-lock";
import type { CoachRefs, FormCoachController } from "./useFormCoach";

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const subscribeNothing = () => () => undefined;

interface CoachStageProps {
  rule: ExerciseRule;
  coach: FormCoachController;
  refs: CoachRefs;
  mode: "practice" | "workout";
  /** Target reps (or seconds, for a hold) for this set. */
  target?: number | null;
}

/**
 * The live camera view, full screen and always dark. The camera with its skeleton overlay and
 * count takes most of the room; beside it (under it on phones) the member's live figure, the
 * demonstration loop and the coach's words in captions large enough to read across a room. On
 * phones the captions sit over the video. Rendered into document.body, so nothing can trap it
 * below other layers.
 */
export function CoachStage({ rule, coach, refs: { video: videoRef, canvas: canvasRef, meter: meterRef, figure: figureRef }, mode, target }: CoachStageProps) {
  const { stage, snapshot, frame } = coach;
  const open = stage.name === "starting" || stage.name === "running" || stage.name === "paused";
  const titleId = useId();
  const finishRef = useRef<HTMLButtonElement>(null);
  const reps = rule.motion.kind === "reps";
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const exercise = homeExercise(rule.id);

  useEffect(() => {
    if (!open) return;
    finishRef.current?.focus({ preventScroll: true });
    return lockScroll();
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      coach.finish();
    } else if (event.key === "Tab") {
      // Keep focus inside the camera view while it is open.
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const ratio = frame ? `${frame.width} / ${frame.height}` : "4 / 3";
  const frameStyle: CSSProperties = { aspectRatio: ratio, width: `min(100cqw, calc(100cqh * ${ratio}))` };
  const running = stage.name === "running";
  const caption = captionFor(snapshot);

  if (!onClient) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      hidden={!open}
      onKeyDown={onKeyDown}
      className="fitx-inverse fixed inset-0 z-[110] flex flex-col bg-fitx-bg text-fitx-text"
    >
      <header className="flex items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)] sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{mode === "workout" ? "Camera count" : "Home workout"}</p>
          <h2 id={titleId} className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg">{rule.name}</h2>
        </div>
        <StatusChip coach={coach} />
        <button type="button" onClick={coach.finish} aria-label="End and see results" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-fitx-border text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-text">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {coach.notice && <p className="mx-4 mb-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-xs leading-5 text-fitx-text-secondary sm:mx-6">{coach.notice}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 sm:px-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-4 lg:pb-2 xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* The camera. The count and messages sit on the camera area, over the video when it fills the
            area and in the bars beside it when it doesn't (a landscape picture on an upright phone). */}
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 grid place-items-center [container-type:size]">
            <div className="relative overflow-hidden rounded-2xl bg-fitx-surface" style={frameStyle}>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                aria-label={`Camera view for ${rule.name}. Video stays on this device.`}
                className={cn("absolute inset-0 h-full w-full object-cover", coach.mirrored && "-scale-x-100")}
              />
              {/* Cropped like the video, so the skeleton stays on the body even while the box is catching up with a new picture size. */}
              <canvas ref={canvasRef} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover", coach.mirrored && "-scale-x-100")} />
              {running && reps && (
                <div className="absolute bottom-3 right-3 top-3 flex w-3 flex-col sm:right-4 sm:top-4" aria-hidden="true">
                  <div className="relative flex-1 overflow-hidden rounded-full bg-fitx-bg/70">
                    <div ref={meterRef} className="absolute inset-0 origin-bottom scale-y-0 rounded-full bg-fitx-primary transition-transform duration-100 ease-out" />
                  </div>
                </div>
              )}
            </div>
          </div>
          {running && <CountBlock rule={rule} snapshot={snapshot} target={mode === "workout" ? target : null} />}
          {running && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 lg:hidden" aria-hidden="true">
              <CaptionText caption={caption} compact />
            </div>
          )}
          {stage.name === "starting" && <StartingOverlay coach={coach} />}
          {stage.name === "paused" && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-fitx-bg/85 p-6 text-center backdrop-blur-sm">
              <div className="max-w-xs">
                <p className="text-lg font-semibold">Paused</p>
                <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">
                  {stage.detail ?? (stage.reason === "hidden" ? "The camera turned off while FITX was in the background." : "The camera stopped, perhaps because another app took it.")} Your count so far is kept.
                </p>
                <button type="button" onClick={coach.resume} className="fitx-button mt-5 w-full"><Play size={16} aria-hidden="true" />Resume camera</button>
              </div>
            </div>
          )}
        </div>

        {/* You, the demonstration and the captions. */}
        <aside aria-label="Coach" className="grid shrink-0 grid-cols-2 gap-2 lg:flex lg:min-h-0 lg:flex-col lg:gap-4">
          <figure className="relative h-28 overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface sm:h-36 lg:h-auto lg:min-h-0 lg:flex-1">
            <LiveFigure ref={figureRef} className="absolute inset-0" />
            <figcaption className="absolute left-2.5 top-2 text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary sm:left-3 sm:top-2.5">You</figcaption>
          </figure>
          <figure className="relative h-28 overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface sm:h-36 lg:h-auto lg:min-h-0 lg:flex-1">
            {exercise && open && <DemoPlayer exercise={exercise} size="sm" className="absolute inset-0" />}
            <figcaption className="absolute left-2.5 top-2 text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary sm:left-3 sm:top-2.5">Demo</figcaption>
          </figure>
          <div className="hidden min-h-[11rem] rounded-2xl border border-fitx-border bg-fitx-surface p-5 lg:block" aria-hidden="true">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">Coach</p>
            <div className="mt-2">{running ? <CaptionText caption={caption} /> : <p className="font-heading text-3xl font-bold tracking-tight text-fitx-text-secondary">{stage.name === "paused" ? "Paused" : "Starting"}</p>}</div>
          </div>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 sm:px-6">
        {coach.voice.supported && (
          <>
            <button
              type="button"
              aria-pressed={coach.voice.enabled}
              onClick={() => coach.voice.setEnabled(!coach.voice.enabled)}
              className={cn("inline-flex h-12 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors", coach.voice.enabled ? "border-fitx-primary/60 text-fitx-text" : "border-fitx-border text-fitx-text-secondary hover:text-fitx-text")}
            >
              {coach.voice.enabled ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
              <span>{coach.voice.enabled ? "Mute" : "Unmute"}</span>
            </button>
            <div role="radiogroup" aria-label="Coach voice" className="inline-flex h-12 items-center rounded-lg border border-fitx-border p-1">
              {(["female", "male"] as const).map((gender) => (
                <button
                  key={gender}
                  type="button"
                  role="radio"
                  aria-checked={coach.voice.gender === gender}
                  onClick={() => coach.voice.setGender(gender)}
                  className={cn("h-full min-w-11 rounded-md px-3 text-sm font-medium transition-colors", coach.voice.gender === gender ? "bg-fitx-surface-variant text-fitx-text" : "text-fitx-text-secondary hover:text-fitx-text")}
                >
                  {gender === "female" ? "Female" : "Male"}
                </button>
              ))}
            </div>
          </>
        )}
        {coach.cameraCount > 1 && (
          <button type="button" onClick={coach.switchCamera} disabled={stage.name !== "running"} className="inline-flex h-12 items-center gap-2 rounded-lg border border-fitx-border px-3.5 text-sm font-medium text-fitx-text-secondary transition-colors hover:text-fitx-text disabled:opacity-50">
            <SwitchCamera size={17} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Switch camera</span>
          </button>
        )}
        <button ref={finishRef} type="button" onClick={coach.finish} className="fitx-button ml-auto min-w-32">
          <Check size={17} aria-hidden="true" />
          {mode === "workout" ? "Done" : "Finish"}
        </button>
      </footer>
      <p className="sr-only" aria-live="polite">{coach.announcement}</p>
    </div>,
    document.body,
  );
}

function CaptionText({ caption, compact = false }: { caption: ReturnType<typeof captionFor>; compact?: boolean }) {
  return (
    <div className={cn(compact && "rounded-2xl bg-fitx-bg/80 px-4 py-3 backdrop-blur-md", compact && caption.tone === "cue" && "border-l-4 border-fitx-primary")}>
      <p
        key={caption.headline}
        className={cn(
          "font-heading font-bold leading-[1.02] tracking-[-.03em]",
          live.captionIn,
          compact ? "text-[clamp(1.6rem,7.4vw,2.6rem)]" : "text-[clamp(2.2rem,3.4vw,3.6rem)]",
          caption.tone === "cue" ? "text-fitx-primary" : "text-fitx-text",
        )}
      >
        {caption.headline}
      </p>
      {caption.detail && <p className={cn("mt-2 leading-snug text-fitx-text-secondary", compact ? "line-clamp-2 text-sm" : "text-base xl:text-lg")}>{caption.detail}</p>}
    </div>
  );
}

function StatusChip({ coach }: { coach: FormCoachController }) {
  const { stage, snapshot } = coach;
  let label = "Starting";
  let tone: "go" | "wait" | "quiet" = "quiet";
  if (stage.name === "paused") label = "Paused";
  else if (stage.name === "starting") label = stage.step === "camera" ? "Starting camera" : "Loading model";
  else if (!snapshot) label = "Warming up";
  else if (snapshot.status === "searching") label = "Looking for you";
  else if (snapshot.status === "unclear") {
    label = "Can't see you clearly";
    tone = "wait";
  } else if (snapshot.status === "position") {
    label = "Get in position";
    tone = "wait";
  } else if (snapshot.phase === "adjust") {
    label = "Timer paused";
    tone = "wait";
  } else {
    label = snapshot.phase === "holding" ? "Holding" : "Counting";
    tone = "go";
  }
  return (
    <span role="status" className="inline-flex max-w-[44vw] shrink-0 items-center gap-2 rounded-full border border-fitx-border px-3 py-1.5 text-xs font-medium text-fitx-text-secondary sm:max-w-none">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tone === "go" ? "bg-fitx-primary" : tone === "wait" ? "bg-fitx-warning" : "bg-fitx-text-disabled")} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function CountBlock({ rule, snapshot, target }: { rule: ExerciseRule; snapshot: CoachSnapshot | null; target?: number | null }) {
  const hold = rule.motion.kind === "hold";
  const value = hold ? formatClock((snapshot?.holdMs ?? 0) / 1000) : String(snapshot?.reps ?? 0);
  return (
    <div className="absolute left-3 top-3 min-w-28 rounded-2xl bg-fitx-bg/80 px-4 py-3 backdrop-blur-md sm:left-4 sm:top-4 sm:px-5 sm:py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{hold ? "Good-form hold" : "Reps"}</p>
      <p className="mt-1 font-heading text-6xl font-bold leading-none tracking-tight tabular-nums sm:text-7xl lg:text-8xl">
        <span key={value} className={cn("inline-block", live.countPop)}>{value}</span>
        {target ? <span className="ml-1 text-lg font-semibold text-fitx-text-secondary sm:text-xl">/ {hold ? formatClock(target) : target}</span> : null}
      </p>
      {!hold && (snapshot?.partials ?? 0) > 0 && <p className="mt-1.5 text-xs text-fitx-text-secondary">{snapshot?.partials} partial, not counted</p>}
    </div>
  );
}

function StartingOverlay({ coach }: { coach: FormCoachController }) {
  const stage = coach.stage;
  if (stage.name !== "starting") return null;
  const model = stage.step === "model";
  const percent = Math.round(stage.progress * 100);
  return (
    <div className="absolute inset-0 grid place-items-center rounded-2xl bg-fitx-bg/70 p-6 text-center backdrop-blur-sm" role="status">
      <div className="w-full max-w-xs">
        <LoaderCircle size={28} className="mx-auto animate-spin text-fitx-primary motion-reduce:animate-none" aria-hidden="true" />
        <p className="mt-3 text-base font-semibold">{model ? (stage.progress >= 1 ? "Preparing the pose model" : "Loading the pose model") : "Starting the camera"}</p>
        <p className="mt-1.5 text-sm leading-6 text-fitx-text-secondary">
          {!model
            ? "Allow camera access if your browser asks."
            : stage.progress >= 1
              ? "Getting it ready on this device. The first time can take a few seconds."
              : `The first time takes a moment (about ${firstLoadMegabytes("lite")}–${firstLoadMegabytes("full")} MB); after that it's saved on this device.`}
        </p>
        {model && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-fitx-track" role="progressbar" aria-label="Pose model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-fitx-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
