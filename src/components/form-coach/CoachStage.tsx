"use client";

import type { KeyboardEvent } from "react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle, Maximize2, Minimize2, Play, ScanLine, SunDim, SwitchCamera, Volume2, VolumeX, X } from "lucide-react";
import { DemoReel } from "@/components/form-check/DemoReel";
import type { CoachSnapshot } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { captionFor } from "@/lib/home-workout/captions";
import { homeExercise } from "@/lib/home-workout/catalog";
import { firstLoadMegabytes } from "@/lib/pose/assets";
import { cn } from "@/lib/utils";
import live from "@/components/home-workout/live.module.css";
import { SLOW_DEVICE_NOTICE } from "./coach-machine";
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
 * The live camera view, full screen and always dark. The camera takes most of the room: the picture
 * is zoomed and moved by the automatic framing (outside React, straight on the layer), with the
 * skeleton, the count and any positioning guidance over it. Beside it (under it on phones) sit the
 * demonstration, with its own timed captions, and the coach's words, large enough to read across a
 * room. When the view isn't good enough for reliable feedback it says so, and why. Rendered into
 * document.body, so nothing can trap it below other layers.
 */
export function CoachStage({ rule, coach, refs: { video: videoRef, canvas: canvasRef, meter: meterRef, viewport: viewportRef, layer: layerRef }, mode, target }: CoachStageProps) {
  const { stage, snapshot, view } = coach;
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

  const running = stage.name === "running";
  const caption = captionFor(snapshot);
  const guide = running && view.framing?.hint && view.framing.issue !== "no-body" ? view.framing : null;

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
      <header className={cn("flex items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)] sm:gap-3 sm:px-6", live.shortHeader)}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{mode === "workout" ? "Camera count" : "AI Form Check"}</p>
          <h2 id={titleId} className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg">{rule.name}</h2>
        </div>
        {view.picture && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-fitx-border px-2.5 py-1.5 text-xs font-medium text-fitx-text-secondary sm:inline-flex" title="The picture your camera delivers">
            {view.zoomed && <ScanLine size={13} className="text-fitx-primary" aria-hidden="true" />}
            <span><span className="sr-only">Camera picture </span>{view.picture}{view.zoomed && <span className="hidden md:inline">, auto-framed</span>}</span>
          </span>
        )}
        {running && view.light !== "ok" && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-fitx-border px-2.5 py-1.5 text-xs font-medium text-fitx-text-secondary">
            <SunDim size={13} className="text-fitx-warning" aria-hidden="true" />
            <span className="hidden sm:inline">{view.light === "dim" ? "Dim light" : "Low light"}</span>
            <span className="sr-only sm:hidden">{view.light === "dim" ? "Dim light" : "Low light"}</span>
          </span>
        )}
        <StatusChip coach={coach} />
        <button type="button" onClick={coach.finish} aria-label="End and see results" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-fitx-border text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-text">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {coach.notice && <p className="mx-4 mb-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-xs leading-5 text-fitx-text-secondary sm:mx-6">{coach.notice}</p>}

      <div className={cn("flex min-h-0 flex-1 flex-col gap-2 px-2 sm:px-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-4 lg:pb-2 xl:grid-cols-[minmax(0,1fr)_420px]", live.shortBody)}>
        {/* The camera. The layer holds the whole picture; the framing crop scales and moves it inside the viewport. */}
        <div className="relative min-h-0 flex-1">
          <div ref={viewportRef} className="absolute inset-0 overflow-hidden rounded-2xl bg-fitx-surface">
            <div ref={layerRef} className="absolute left-0 top-0 origin-top-left will-change-transform">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                aria-label={`Camera view for ${rule.name}. Video stays on this device.`}
                className={cn("absolute inset-0 h-full w-full object-fill", coach.mirrored && "-scale-x-100")}
              />
              <canvas ref={canvasRef} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full", coach.mirrored && "-scale-x-100")} />
            </div>
            {running && reps && (
              <div className="absolute bottom-3 right-3 top-3 flex w-3 flex-col sm:right-4 sm:top-4" aria-hidden="true">
                <div className="relative flex-1 overflow-hidden rounded-full bg-fitx-bg/70">
                  <div ref={meterRef} className="absolute inset-0 origin-bottom scale-y-0 rounded-full bg-fitx-primary transition-transform duration-100 ease-out" />
                </div>
              </div>
            )}
          </div>
          {running && <CountBlock rule={rule} snapshot={snapshot} target={mode === "workout" ? target : null} />}
          {guide && <FramingGuide hint={guide.hint ?? ""} move={guide.move} />}
          {running && !view.reliable && view.reason && (
            <div role="status" className={cn("absolute inset-x-3 bottom-3 flex items-start gap-2.5 rounded-2xl border border-fitx-warning/60 bg-fitx-bg/90 px-4 py-3 backdrop-blur-md sm:inset-x-auto sm:left-4 sm:max-w-md", live.shortVerdict)}>
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-fitx-warning" aria-hidden="true" />
              <p className="text-sm leading-5">
                <span className="block font-semibold">Not reliable right now</span>
                <span className="text-fitx-text-secondary">{view.reason}</span>
              </p>
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

        {/* The demonstration and the coach's words. */}
        <aside aria-label="Coach" className={cn("grid h-32 shrink-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 sm:h-40 lg:flex lg:h-auto lg:min-h-0 lg:flex-col lg:gap-4", live.shortAside)}>
          <div className={cn("relative min-h-0 overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface lg:flex-1", live.shortTile)}>
            {/* Capped well below the display rate, and slower still on a device already struggling, so it never takes frame time from the pose model. */}
            {exercise && open && <DemoReel exercise={exercise} size="sm" fit="contain" maxFps={coach.notice === SLOW_DEVICE_NOTICE ? 8 : 24} className="absolute inset-0" />}
          </div>
          <div className={cn("min-h-0 overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface p-3 sm:p-4 lg:min-h-[11rem] lg:p-5", live.shortTile)} aria-hidden="true">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">Coach</p>
            <div className="mt-1.5 lg:mt-2">{running ? <CaptionText caption={caption} /> : <p className="font-heading text-2xl font-bold tracking-tight text-fitx-text-secondary lg:text-3xl">{stage.name === "paused" ? "Paused" : "Starting"}</p>}</div>
          </div>
        </aside>
      </div>

      <footer className={cn("flex flex-wrap items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 sm:px-6", live.shortFooter)}>
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

const MOVE_ICON = { left: ArrowLeft, right: ArrowRight, back: Minimize2, closer: Maximize2 } as const;

/** Where to move, over the camera: an arrow that nudges the way to go, and the plain instruction. */
function FramingGuide({ hint, move }: { hint: string; move: "left" | "right" | "back" | "closer" | null }) {
  const Icon = move ? MOVE_ICON[move] : ScanLine;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-[5.5rem] flex justify-center sm:top-4 sm:inset-x-24">
      <p className="flex max-w-md items-center gap-2.5 rounded-full border border-fitx-border bg-fitx-bg/85 py-2 pl-2 pr-4 text-sm font-medium leading-5 backdrop-blur-md">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fitx-primary text-fitx-on-primary", move === "left" && live.nudgeLeft, move === "right" && live.nudgeRight)} aria-hidden="true">
          <Icon size={16} />
        </span>
        <span>{hint}</span>
      </p>
    </div>
  );
}

function CaptionText({ caption }: { caption: ReturnType<typeof captionFor> }) {
  return (
    <div className={cn(caption.tone === "cue" && "border-l-4 border-fitx-primary pl-3")}>
      <p
        key={caption.headline}
        className={cn(
          "font-heading font-bold leading-[1.02] tracking-[-.03em]",
          live.captionIn,
          "text-[clamp(1.35rem,6vw,2.2rem)] lg:text-[clamp(2.2rem,3.2vw,3.4rem)]",
          caption.tone === "cue" ? "text-fitx-primary" : "text-fitx-text",
        )}
      >
        {caption.headline}
      </p>
      {caption.detail && <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-fitx-text-secondary sm:text-sm lg:mt-2 lg:line-clamp-none lg:text-base">{caption.detail}</p>}
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
  } else if (snapshot.calibrating) {
    label = "Calibrating";
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
    <span role="status" className="inline-flex max-w-[40vw] shrink-0 items-center gap-2 rounded-full border border-fitx-border px-3 py-1.5 text-xs font-medium text-fitx-text-secondary sm:max-w-none">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tone === "go" ? "bg-fitx-primary" : tone === "wait" ? "bg-fitx-warning" : "bg-fitx-text-disabled")} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function CountBlock({ rule, snapshot, target }: { rule: ExerciseRule; snapshot: CoachSnapshot | null; target?: number | null }) {
  const hold = rule.motion.kind === "hold";
  const value = hold ? formatClock((snapshot?.holdMs ?? 0) / 1000) : String(snapshot?.reps ?? 0);
  return (
    <div className={cn("absolute left-3 top-3 min-w-24 rounded-2xl bg-fitx-bg/80 px-4 py-3 backdrop-blur-md sm:left-4 sm:top-4 sm:min-w-28 sm:px-5 sm:py-4", live.shortCount)}>
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{hold ? "Good-form hold" : "Reps"}</p>
      <p className={cn("mt-1 font-heading text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-7xl lg:text-8xl", live.shortValue)}>
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
