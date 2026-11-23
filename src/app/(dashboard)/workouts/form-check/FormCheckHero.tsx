import { ArrowDown } from "lucide-react";
import { DemoReel } from "@/components/form-check/DemoReel";
import { HOME_EXERCISES, homeExercise } from "@/lib/home-workout/catalog";
import styles from "./form-check.module.css";

/** The page's dark stage: the name, one line, and a real demonstration inside the camera's framing marks. */
export function FormCheckHero() {
  const squat = homeExercise("bodyweight_squat");
  const holds = HOME_EXERCISES.filter((item) => item.rule.motion.kind === "hold").length;

  return (
    <section aria-labelledby="form-check-title" className="fitx-inverse relative overflow-hidden rounded-[28px] bg-fitx-bg text-fitx-text">
      <div className="grid items-stretch md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative z-10 flex flex-col justify-end p-6 pb-4 sm:p-10 md:pb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-fitx-primary">On-device coach</p>
          <h1 id="form-check-title" className="mt-3 font-heading text-[44px] font-bold leading-[.95] tracking-[-.045em] sm:text-[60px] lg:text-[72px]">AI Form Check</h1>
          <p className="mt-4 max-w-sm text-base leading-7 text-fitx-text-secondary">Your camera frames you, counts every rep and calls out your form.</p>
          <dl className="mt-7 grid max-w-sm grid-cols-3 gap-4 border-t border-fitx-border pt-5">
            <div>
              <dt className="text-xs text-fitx-text-secondary">Exercises</dt>
              <dd className="mt-1 font-heading text-2xl font-bold tabular-nums">{HOME_EXERCISES.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-fitx-text-secondary">Timed holds</dt>
              <dd className="mt-1 font-heading text-2xl font-bold tabular-nums">{holds}</dd>
            </div>
            <div>
              <dt className="text-xs text-fitx-text-secondary">Video uploaded</dt>
              <dd className="mt-1 font-heading text-2xl font-bold">Never</dd>
            </div>
          </dl>
          <a href="#exercises" className="fitx-button mt-7 w-fit">
            <ArrowDown size={17} aria-hidden="true" />
            Choose an exercise
          </a>
        </div>
        <div className="relative aspect-[4/5] w-full md:w-[min(40vw,400px)]">
          {squat && <DemoReel exercise={squat} size="sm" priority className="absolute inset-0" />}
          {/* The camera's framing marks, as the live view keeps them around the member. */}
          <span className={styles.frameMarks} aria-hidden="true">
            <span /><span /><span /><span />
          </span>
        </div>
      </div>
    </section>
  );
}
