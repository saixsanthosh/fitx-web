"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { FORM_CHECK_PATH } from "@/lib/home-workout/route";
import type { ExerciseGroup } from "@/lib/home-workout/catalog";
import { exerciseFacts, GROUP_LABELS, GROUP_ORDER, HOME_EXERCISES } from "@/lib/home-workout/catalog";
import styles from "./form-check.module.css";

type Filter = ExerciseGroup | "all";

/**
 * Every camera exercise as a card, filterable by body area. Plain links, so the exercise is in the
 * address. A card shows the exercise's photo; an exercise without a correct photo shows its cues instead.
 */
export function ExercisePicker() {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = HOME_EXERCISES.filter((exercise) => filter === "all" || exercise.group === filter);

  return (
    <section id="exercises" aria-labelledby="coach-pick-title" className="scroll-mt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="coach-pick-title" className="font-heading text-2xl font-bold tracking-[-.03em] text-fitx-text">Exercises</h2>
        <ChipGroup label="Show exercises for">
          {(["all", ...GROUP_ORDER] as const).map((value) => (
            <Chip key={value} selected={filter === value} onClick={() => setFilter(value)}>
              {value === "all" ? "All" : GROUP_LABELS[value]}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {shown.map((exercise, index) => {
          const facts = exerciseFacts(exercise.rule);
          return (
            <li key={exercise.id}>
              <Link href={`${FORM_CHECK_PATH}?exercise=${exercise.id}`} className={`${styles.card} fitx-inverse aspect-[4/5] text-fitx-text`} prefetch={false}>
                {exercise.poster ? (
                  <Image
                    src={exercise.poster.src}
                    alt=""
                    fill
                    sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
                    placeholder="blur"
                    blurDataURL={exercise.poster.blurDataURL}
                    priority={index < 2}
                    className="object-cover"
                  />
                ) : (
                  // No photo shows this move correctly yet: its three cues instead of a wrong picture.
                  <span className={styles.cuePoster} aria-hidden="true">
                    <ol className="space-y-1.5">
                      {exercise.cues.map((cue, i) => (
                        <li key={cue} className="flex items-baseline gap-2 text-[13px] font-medium leading-snug text-fitx-text-secondary sm:text-sm">
                          <span className="font-heading text-[11px] font-bold tabular-nums text-fitx-primary">{String(i + 1).padStart(2, "0")}</span>
                          {cue}
                        </li>
                      ))}
                    </ol>
                  </span>
                )}
                <span className={styles.shade} aria-hidden="true" />
                <span className={`${styles.glyph} absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-fitx-bg/70 text-fitx-text backdrop-blur-sm`} aria-hidden="true">
                  <ArrowUpRight size={18} />
                </span>
                <span className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3 sm:p-4">
                  <span className="min-w-0">
                    <span className="block font-heading text-base font-bold leading-tight tracking-tight sm:text-lg">{exercise.rule.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-fitx-text-secondary">
                      {facts.counting} · {exercise.equipment ?? facts.facing}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
