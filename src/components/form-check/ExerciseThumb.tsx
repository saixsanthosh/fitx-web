import Image from "next/image";
import { Dumbbell, Footprints, HeartPulse, PersonStanding } from "lucide-react";
import type { ExerciseId } from "@/lib/form-rules/types";
import type { ExerciseGroup } from "@/lib/home-workout/catalog";
import { homeExercise } from "@/lib/home-workout/catalog";
import { cn } from "@/lib/utils";

const GROUP_ICON: Record<ExerciseGroup, typeof Dumbbell> = { legs: Footprints, upper: Dumbbell, core: PersonStanding, cardio: HeartPulse };

/**
 * A small square of an exercise: its photo, or the icon of its body area when no correct photo exists.
 * Decorative: the exercise's name is always written beside it.
 */
export function ExerciseThumb({ id, size = 40, className }: { id: ExerciseId; size?: number; className?: string }) {
  const exercise = homeExercise(id);
  const Icon = GROUP_ICON[exercise?.group ?? "upper"];
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-fitx-surface-variant text-fitx-text-secondary", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {exercise?.poster ? (
        <Image src={exercise.poster.src} alt="" fill sizes={`${size * 2}px`} className="object-cover object-[50%_35%]" />
      ) : (
        <Icon size={Math.round(size * 0.5)} />
      )}
    </span>
  );
}
