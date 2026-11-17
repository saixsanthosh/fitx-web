"use client";

import type { Ref } from "react";
import { Camera, CircleAlert, RotateCcw, ShieldCheck } from "lucide-react";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { cameraHelp, detectPlatform } from "@/lib/pose/camera";
import type { EngineProblem } from "@/lib/pose/engine";
import { cn } from "@/lib/utils";
import { ExerciseGlyph } from "./ExerciseGlyph";
import type { FormCoachController } from "./useFormCoach";

const ENGINE_HELP: Record<EngineProblem, { title: string; body: string }> = {
  unsupported: { title: "This browser can't run the pose model", body: "Update to the latest Safari (iOS 16.4 or newer) or Chrome, then try again." },
  download: { title: "The pose model didn't download", body: "Check your connection and try again." },
  start: { title: "The pose model couldn't start on this device", body: "Close other apps and try again. Some older devices can't run it." },
  runtime: { title: "The pose model stopped", body: "Try again. If it keeps happening, close and reopen the browser." },
};

interface CoachSetupProps {
  rule: ExerciseRule;
  coach: FormCoachController;
  /** Shown above the tips in a workout (e.g. "Set 2 · target 12 reps"). */
  context?: string;
  onChangeExercise?: () => void;
  /** The Start / Try again button, focused when the live camera view closes onto this card. */
  actionRef?: Ref<HTMLButtonElement>;
}

/** Before the camera starts: what the coach checks, how to place the phone, voice, privacy and limits. */
export function CoachSetup({ rule, coach, context, onChangeExercise, actionRef }: CoachSetupProps) {
  const { stage } = coach;
  const problem = stage.name === "camera-error"
    ? cameraHelp(stage.problem, detectPlatform(navigator.userAgent, navigator.maxTouchPoints))
    : stage.name === "engine-error"
      ? ENGINE_HELP[stage.problem]
      : null;

  return (
    <section className="fitx-panel overflow-hidden" aria-labelledby={`coach-${rule.id}-title`}>
      <div className="flex items-start gap-4 border-b border-fitx-divider p-5 sm:p-6">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-primary">
          <ExerciseGlyph id={rule.id} className="h-10 w-10" />
        </div>
        <div className="min-w-0 flex-1">
          {context && <p className="text-xs font-medium text-fitx-text-secondary">{context}</p>}
          <h2 id={`coach-${rule.id}-title`} className="text-xl font-semibold tracking-tight text-fitx-text">{rule.name}</h2>
          <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">{rule.checks}</p>
        </div>
        {onChangeExercise && (
          <button type="button" onClick={onChangeExercise} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-fitx-primary-text hover:underline">
            Change
          </button>
        )}
      </div>

      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[1fr_.9fr]">
        <div>
          <h3 className="text-sm font-semibold text-fitx-text">Set up your camera</h3>
          <ol className="mt-3 space-y-3">
            {rule.setupTips.map((tip, index) => (
              <li key={tip} className="flex gap-3 text-sm leading-6 text-fitx-text-secondary">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fitx-surface-variant text-xs font-semibold text-fitx-text">{index + 1}</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-4">
          {coach.voice.supported && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-fitx-border bg-fitx-surface px-4 py-3">
              <div>
                <p id={`coach-${rule.id}-voice`} className="text-sm font-medium text-fitx-text">Speak counts and cues</p>
                <p className="text-xs leading-5 text-fitx-text-secondary">Handy when you can’t see the screen.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={coach.voice.enabled}
                aria-labelledby={`coach-${rule.id}-voice`}
                onClick={() => coach.voice.setEnabled(!coach.voice.enabled)}
                className="grid h-11 w-14 shrink-0 place-items-center"
              >
                <span className={cn("relative h-7 w-12 rounded-full transition-colors", coach.voice.enabled ? "bg-fitx-primary" : "bg-fitx-track")}>
                  <span className={cn("absolute top-1 h-5 w-5 rounded-full transition-[left]", coach.voice.enabled ? "left-6 bg-fitx-on-primary" : "left-1 bg-fitx-text-secondary")} />
                </span>
              </button>
            </div>
          )}

          {problem && (
            <div className="fitx-alert fitx-alert-danger flex gap-3" role="alert">
              <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{problem.title}</p>
                <p className="mt-0.5">{problem.body}</p>
              </div>
            </div>
          )}

          <button ref={actionRef} type="button" onClick={() => coach.start(rule)} className="fitx-button w-full">
            {problem ? <RotateCcw size={17} aria-hidden="true" /> : <Camera size={17} aria-hidden="true" />}
            {problem ? "Try again" : "Start camera"}
          </button>

          <div className="flex gap-3 rounded-xl bg-fitx-surface-variant px-4 py-3 text-xs leading-5 text-fitx-text-secondary">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-fitx-primary" aria-hidden="true" />
            <p>
              Runs on this device: the video is never uploaded or recorded, and only counts are kept. One camera gives a 2D view, so counts can be off in poor light, loose clothing or at awkward angles. {rule.limits} Guidance, not medical advice; stop if anything hurts.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
