"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useId, useRef } from "react";
import { Check, LoaderCircle, Play, SwitchCamera, Volume2, VolumeX, X } from "lucide-react";
import type { CoachSnapshot } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { firstLoadMegabytes } from "@/lib/pose/assets";
import { cn } from "@/lib/utils";
import type { CoachRefs, FormCoachController } from "./useFormCoach";

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface CoachStageProps {
  rule: ExerciseRule;
  coach: FormCoachController;
  refs: CoachRefs;
  mode: "practice" | "workout";
  /** Target reps (or seconds, for a hold) for this set. */
  target?: number | null;
}

/**
 * The live camera view: full screen, always dark (the camera picture reads best on black), with
 * the skeleton overlay, the count, a range meter, the current cue and the controls.
 */
export function CoachStage({ rule, coach, refs: { video: videoRef, canvas: canvasRef, meter: meterRef }, mode, target }: CoachStageProps) {
  const { stage, snapshot, frame } = coach;
  const open = stage.name === "starting" || stage.name === "running" || stage.name === "paused";
  const titleId = useId();
  const finishRef = useRef<HTMLButtonElement>(null);
  const reps = rule.motion.kind === "reps";

  useEffect(() => {
    if (!open) return;
    finishRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
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

  return (
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
          <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-fitx-text-secondary">Form coach</p>
          <h2 id={titleId} className="truncate text-base font-semibold tracking-tight sm:text-lg">{rule.name}</h2>
        </div>
        <StatusChip coach={coach} />
        <button type="button" onClick={coach.finish} aria-label="End and see results" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-fitx-border text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-text">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {coach.notice && <p className="mx-4 mb-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-xs leading-5 text-fitx-text-secondary sm:mx-6">{coach.notice}</p>}

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-2 grid place-items-center [container-type:size] sm:inset-4">
          <div className="relative overflow-hidden rounded-2xl bg-fitx-surface" style={frameStyle}>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label={`Camera view for ${rule.name}. Video stays on this device.`}
              className={cn("absolute inset-0 h-full w-full object-cover", coach.mirrored && "-scale-x-100")}
            />
            <canvas ref={canvasRef} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full", coach.mirrored && "-scale-x-100")} />

            {stage.name === "running" && (
              <>
                <CountBlock rule={rule} snapshot={snapshot} target={mode === "workout" ? target : null} />
                {reps && (
                  <div className="absolute bottom-24 right-3 top-3 flex w-3 flex-col sm:right-4 sm:top-4" aria-hidden="true">
                    <div className="relative flex-1 overflow-hidden rounded-full bg-fitx-bg/70">
                      <div ref={meterRef} className="absolute inset-0 origin-bottom scale-y-0 rounded-full bg-fitx-primary transition-transform duration-100 ease-out" />
                    </div>
                  </div>
                )}
                <Banner snapshot={snapshot} />
              </>
            )}
            {stage.name === "starting" && <StartingOverlay coach={coach} />}
            {stage.name === "paused" && (
              <div className="absolute inset-0 grid place-items-center bg-fitx-bg/85 p-6 text-center backdrop-blur-sm">
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
        </div>
      </div>

      <footer className="flex items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 sm:px-6">
        {coach.voice.supported && (
          <button
            type="button"
            aria-pressed={coach.voice.enabled}
            onClick={() => coach.voice.setEnabled(!coach.voice.enabled)}
            className={cn("inline-flex h-12 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors", coach.voice.enabled ? "border-fitx-primary/60 text-fitx-text" : "border-fitx-border text-fitx-text-secondary hover:text-fitx-text")}
          >
            {coach.voice.enabled ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
            <span>Voice {coach.voice.enabled ? "on" : "off"}</span>
          </button>
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
    </div>
  );
}

function StatusChip({ coach }: { coach: FormCoachController }) {
  const { stage, snapshot } = coach;
  let label = "Starting";
  let tone: "go" | "wait" | "quiet" = "quiet";
  if (stage.name === "paused") label = "Paused";
  else if (stage.name === "starting") label = stage.step === "camera" ? "Starting camera" : "Loading model";
  else if (!snapshot || snapshot.status === "searching") label = "Looking for you";
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
    <span role="status" className="inline-flex max-w-[52vw] shrink-0 items-center gap-2 rounded-full border border-fitx-border px-3 py-1.5 text-xs font-medium text-fitx-text-secondary sm:max-w-none">
      <span className={cn("h-2 w-2 rounded-full", tone === "go" ? "bg-fitx-primary" : tone === "wait" ? "bg-fitx-warning" : "bg-fitx-text-disabled")} aria-hidden="true" />
      {label}
    </span>
  );
}

function CountBlock({ rule, snapshot, target }: { rule: ExerciseRule; snapshot: CoachSnapshot | null; target?: number | null }) {
  const hold = rule.motion.kind === "hold";
  return (
    <div className="absolute left-3 top-3 min-w-28 rounded-2xl bg-fitx-bg/80 px-4 py-3 backdrop-blur-md sm:left-4 sm:top-4 sm:px-5 sm:py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{hold ? "Good-form hold" : "Reps"}</p>
      <p className="mt-1 text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl">
        {hold ? formatClock((snapshot?.holdMs ?? 0) / 1000) : snapshot?.reps ?? 0}
        {target ? <span className="ml-1 text-lg font-semibold text-fitx-text-secondary sm:text-xl">/ {hold ? formatClock(target) : target}</span> : null}
      </p>
      {!hold && (snapshot?.partials ?? 0) > 0 && <p className="mt-1.5 text-xs text-fitx-text-secondary">{snapshot?.partials} partial, not counted</p>}
    </div>
  );
}

function Banner({ snapshot }: { snapshot: CoachSnapshot | null }) {
  if (!snapshot) {
    return <BannerText tone="info">Step into view so the camera can see your whole body.</BannerText>;
  }
  if (snapshot.cue) return <BannerText tone="cue">{snapshot.cue.text}</BannerText>;
  if (snapshot.status !== "active" || snapshot.phase === "adjust") return <BannerText tone="wait">{snapshot.guidance}</BannerText>;
  if (snapshot.guidance.startsWith("Ready")) return <BannerText tone="info">{snapshot.guidance}</BannerText>;
  return null;
}

function BannerText({ tone, children }: { tone: "cue" | "wait" | "info"; children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-3 bottom-3 flex justify-center sm:inset-x-4 sm:bottom-4">
      <p className={cn(
        "max-w-md rounded-xl bg-fitx-bg/85 px-4 py-3 text-center text-sm font-medium leading-6 backdrop-blur-md",
        tone === "cue" && "border-l-4 border-fitx-primary text-left",
        tone === "wait" && "border border-fitx-border",
      )}>
        {children}
      </p>
    </div>
  );
}

function StartingOverlay({ coach }: { coach: FormCoachController }) {
  const stage = coach.stage;
  if (stage.name !== "starting") return null;
  const model = stage.step === "model";
  const percent = Math.round(stage.progress * 100);
  return (
    <div className="absolute inset-0 grid place-items-center bg-fitx-bg/70 p-6 text-center backdrop-blur-sm" role="status">
      <div className="w-full max-w-xs">
        <LoaderCircle size={28} className="mx-auto animate-spin text-fitx-primary motion-reduce:animate-none" aria-hidden="true" />
        <p className="mt-3 text-base font-semibold">{model ? "Loading the pose model" : "Starting the camera"}</p>
        <p className="mt-1.5 text-sm leading-6 text-fitx-text-secondary">
          {model ? `The first time takes a moment (about ${firstLoadMegabytes("lite")}–${firstLoadMegabytes("full")} MB); after that it's saved on this device.` : "Allow camera access if your browser asks."}
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
