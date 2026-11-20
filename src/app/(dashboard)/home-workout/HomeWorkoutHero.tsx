"use client";

import { useEffect, useState } from "react";
import { ArrowDown, Pause, Play } from "lucide-react";
import { DemoPlayer } from "@/components/home-workout/DemoPlayer";
import { useReducedMotionSafe, usePageVisible } from "@/components/motion";
import { HOME_EXERCISES } from "@/lib/home-workout/catalog";
import styles from "./home-workout.module.css";

/** Exercises the reel cycles through: a mix of standing, floor and front-on moves. */
const REEL = ["bodyweight_squat", "push_up", "jumping_jack", "glute_bridge", "shoulder_press", "mountain_climber", "reverse_lunge", "side_plank"]
  .map((id) => HOME_EXERCISES.find((exercise) => exercise.id === id))
  .filter((exercise) => exercise !== undefined);
const REEL_MS = 5200;

/** The page's dark stage: title, one line, and the figure working through exercises. */
export function HomeWorkoutHero() {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const running = !reduced && visible && !paused;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % REEL.length), REEL_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const exercise = REEL[index];
  const holds = HOME_EXERCISES.filter((item) => item.rule.motion.kind === "hold").length;

  return (
    <section aria-labelledby="home-workout-title" className="fitx-inverse relative overflow-hidden rounded-[28px] bg-fitx-bg text-fitx-text">
      <div className="grid items-stretch md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="relative z-10 flex flex-col justify-end p-6 pb-2 sm:p-10 md:pb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-fitx-primary">On-device coach</p>
          <h1 id="home-workout-title" className="mt-3 font-heading text-[44px] font-bold leading-[.95] tracking-[-.045em] sm:text-[60px] lg:text-[72px]">Home workout</h1>
          <p className="mt-4 max-w-sm text-base leading-7 text-fitx-text-secondary">Your camera counts every rep and calls out your form.</p>
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
              <dt className="text-xs text-fitx-text-secondary">Voices</dt>
              <dd className="mt-1 font-heading text-2xl font-bold">2</dd>
            </div>
          </dl>
          <a href="#exercises" className="fitx-button mt-7 hidden w-fit md:inline-flex">
            <ArrowDown size={17} aria-hidden="true" />
            Choose an exercise
          </a>
        </div>
        <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[400px]">
          <div className={styles.floorLines} aria-hidden="true" />
          <div className={styles.grain} aria-hidden="true" />
          {exercise && (
            <div key={exercise.id} className={`${styles.reel} ${styles.reelIn}`}>
              <DemoPlayer exercise={exercise} size="sm" paused={!running} />
            </div>
          )}
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2 sm:right-6 sm:top-6">
            <span className="rounded-full border border-fitx-border bg-fitx-bg/60 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm" aria-live="off">{exercise?.rule.name}</span>
            {!reduced && (
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                aria-label={paused ? "Play the exercise reel" : "Pause the exercise reel"}
                className="grid h-11 w-11 place-items-center rounded-full border border-fitx-border bg-fitx-bg/60 backdrop-blur-sm transition-colors hover:bg-fitx-hover"
              >
                {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
