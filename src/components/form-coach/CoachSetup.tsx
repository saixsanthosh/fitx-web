"use client";

import type { Ref } from "react";
import { ArrowLeft, Camera, CircleAlert, RotateCcw, ShieldCheck, Volume2 } from "lucide-react";
import { DemoPlayer } from "@/components/home-workout/DemoPlayer";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { exerciseFacts, homeExercise } from "@/lib/home-workout/catalog";
import { cameraHelp, detectPlatform } from "@/lib/pose/camera";
import type { EngineProblem } from "@/lib/pose/engine";
import { cn } from "@/lib/utils";
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
  /** Shown above the name in a workout (e.g. "Set 2 · target 12 reps"). */
  context?: string;
  onChangeExercise?: () => void;
  /** The Start / Try again button, focused when the live camera view closes onto this card. */
  actionRef?: Ref<HTMLButtonElement>;
}

/**
 * Before the camera starts: the looping demonstration with its key cues, then how to place the
 * phone, the coach's voice, the privacy promise and the Start button.
 */
export function CoachSetup({ rule, coach, context, onChangeExercise, actionRef }: CoachSetupProps) {
  const { stage } = coach;
  const exercise = homeExercise(rule.id);
  const facts = exerciseFacts(rule);
  const problem = stage.name === "camera-error"
    ? cameraHelp(stage.problem, detectPlatform(navigator.userAgent, navigator.maxTouchPoints))
    : stage.name === "engine-error"
      ? ENGINE_HELP[stage.problem]
      : null;
  const voiceChoice = !coach.voice.enabled ? "off" : coach.voice.gender;

  return (
    <section aria-labelledby={`coach-${rule.id}-title`} className="grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:gap-8">
      {/* The demonstration: a dark stage in every theme. */}
      <div className="fitx-inverse relative overflow-hidden rounded-3xl bg-fitx-bg text-fitx-text lg:sticky lg:top-6 lg:self-start">
        <div className="aspect-[4/3] w-full">
          {exercise && <DemoPlayer exercise={exercise} />}
        </div>
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-1.5 sm:left-5 sm:top-5">
          <Tag>{facts.counting}</Tag>
          <Tag>{facts.facing}</Tag>
          {exercise?.equipment && <Tag>{exercise.equipment}</Tag>}
        </div>
      </div>

      <div className="min-w-0">
        {onChangeExercise && (
          <button type="button" onClick={onChangeExercise} className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fitx-text-secondary hover:text-fitx-text">
            <ArrowLeft size={16} aria-hidden="true" />
            All exercises
          </button>
        )}
        {context && <p className="text-xs font-semibold uppercase tracking-[.14em] text-fitx-primary-text">{context}</p>}
        <h2 id={`coach-${rule.id}-title`} className="font-heading text-[30px] font-bold leading-[1.05] tracking-[-.035em] text-fitx-text sm:text-[38px]">{rule.name}</h2>
        {exercise && <p className="mt-1.5 text-sm text-fitx-text-secondary">{exercise.works}</p>}

        {exercise && (
          <ol className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {exercise.cues.map((cue, index) => (
              <li key={cue} className="flex items-baseline gap-2.5 rounded-xl border border-fitx-border bg-fitx-surface px-3.5 py-3 text-sm font-medium leading-5 text-fitx-text">
                <span className="font-heading text-xs font-bold tabular-nums text-fitx-primary-text">{String(index + 1).padStart(2, "0")}</span>
                {cue}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-7">
          <h3 className="text-sm font-semibold text-fitx-text">Set up your camera</h3>
          <ol className="mt-3 space-y-2.5">
            {rule.setupTips.map((tip, index) => (
              <li key={tip} className="flex gap-3 text-sm leading-6 text-fitx-text-secondary">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fitx-surface-variant text-xs font-semibold text-fitx-text">{index + 1}</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-5 text-fitx-text-secondary">{rule.checks}</p>
        </div>

        {coach.voice.supported && (
          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`coach-${rule.id}-voice`} className="text-sm font-semibold text-fitx-text">Coach voice</h3>
              <button
                type="button"
                onClick={coach.voice.preview}
                disabled={voiceChoice === "off"}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fitx-primary-text hover:underline disabled:opacity-50 disabled:hover:no-underline"
              >
                <Volume2 size={16} aria-hidden="true" />
                Hear it
              </button>
            </div>
            <div role="radiogroup" aria-labelledby={`coach-${rule.id}-voice`} className="mt-2 grid grid-cols-3 gap-1 rounded-[14px] border border-fitx-border bg-fitx-surface-variant p-1">
              {(["female", "male", "off"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={voiceChoice === choice}
                  onClick={() => {
                    if (choice === "off") coach.voice.setEnabled(false);
                    else {
                      coach.voice.setGender(choice);
                      coach.voice.setEnabled(true);
                    }
                  }}
                  className={cn(
                    "min-h-11 rounded-lg px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200",
                    voiceChoice === choice ? "bg-fitx-surface text-fitx-text shadow-sm" : "text-fitx-text-secondary hover:text-fitx-text",
                  )}
                >
                  {choice === "female" ? "Female" : choice === "male" ? "Male" : "Off"}
                </button>
              ))}
            </div>
            {voiceChoice !== "off" && !coach.voice.matched && (
              <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">This device has no {voiceChoice} English voice, so its own voice is used.</p>
            )}
          </div>
        )}

        {problem && (
          <div className="fitx-alert fitx-alert-danger mt-6 flex gap-3" role="alert">
            <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{problem.title}</p>
              <p className="mt-0.5">{problem.body}</p>
            </div>
          </div>
        )}

        <button ref={actionRef} type="button" onClick={() => coach.start(rule)} className="fitx-button mt-6 min-h-14 w-full text-base">
          {problem ? <RotateCcw size={18} aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
          {problem ? "Try again" : "Start camera"}
        </button>

        <div className="mt-4 flex gap-3 rounded-xl bg-fitx-surface-variant px-4 py-3 text-xs leading-5 text-fitx-text-secondary">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-fitx-primary" aria-hidden="true" />
          <p>Runs on this device: the video is never uploaded or recorded, and only counts are kept. Guidance, not medical advice; stop if anything hurts.</p>
        </div>
        <details className="group mt-2 text-xs leading-5 text-fitx-text-secondary">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-fitx-text-secondary hover:text-fitx-text">What one camera can&rsquo;t see</summary>
          <p className="pb-2">One camera gives a 2D view, so counts can be off in poor light, loose clothing or at awkward angles. {rule.limits}</p>
        </details>
      </div>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-fitx-border bg-fitx-bg/70 px-2.5 py-1 text-[11px] font-semibold text-fitx-text backdrop-blur-sm">{children}</span>;
}
