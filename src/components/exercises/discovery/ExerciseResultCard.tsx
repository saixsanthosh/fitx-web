"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, Plus, TriangleAlert } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import { REGIONS, isRegionKey } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import type { RankedExercise } from "@/lib/training/catalog-search";
import { equipmentLabel } from "@/lib/training/equipment";
import { CATEGORY_LABELS, MUSCLE_GROUP_LABELS } from "@/lib/training/taxonomy";

const capitalise = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/** "Lats", "Middle back": the exercise's main muscle by its body-map name, else its group. */
export function mainMuscleLabel(exercise: Pick<CatalogExercise, "primary_muscle" | "muscle_group">): string {
  const key = (exercise.primary_muscle ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isRegionKey(key) ? REGIONS[key].label : MUSCLE_GROUP_LABELS[exercise.muscle_group] ?? capitalise(key.replaceAll("_", " "));
}

/** The work for one set: a rep range, or a time for holds, stretches and cardio. */
function workPerSet(exercise: CatalogExercise): string {
  if (exercise.prescription_type === "time") {
    const seconds = Math.max(0, Math.round(exercise.default_duration_seconds ?? 30));
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`;
  }
  return exercise.reps_min === exercise.reps_max ? `${exercise.reps_min} reps` : `${exercise.reps_min}–${exercise.reps_max} reps`;
}

/** Short names for "Needs: barbell, bench" (the catalogue labels, such as "Barbell and plates", read badly in a list). */
const NEED_LABELS: Record<string, string> = {
  dumbbell: "dumbbells", kettlebell: "kettlebell", barbell: "barbell", ez_bar: "EZ bar", resistance_band: "resistance band", pull_up_bar: "pull-up bar",
  bench: "bench", box: "box or step", dip_station: "dip bars", squat_rack: "squat rack", cable_machine: "cable machine", machine: "weight machine",
  smith_machine: "Smith machine", cardio_machine: "cardio machine", medicine_ball: "medicine ball", stability_ball: "exercise ball",
  foam_roller: "foam roller", jump_rope: "jump rope", suspension_trainer: "suspension trainer", chair: "sturdy chair", sled: "sled",
  strongman_implements: "strongman kit", specialty: "specialist kit",
};

/** "barbell, bench": what an exercise needs, in short words. */
export function needsText(keys: readonly string[]): string {
  return keys.map((key) => NEED_LABELS[key] ?? equipmentLabel(key).toLowerCase()).join(", ");
}

/** The name with the searched words marked. */
function HighlightedName({ name, ranges }: { name: string; ranges?: ReadonlyArray<readonly [number, number]> }) {
  if (!ranges?.length) return <>{name}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last || end <= start) continue;
    if (start > last) parts.push(name.slice(last, start));
    parts.push(<mark key={start} className="rounded-sm bg-fitx-primary/10 px-0.5 text-fitx-primary-text">{name.slice(start, end)}</mark>);
    last = end;
  }
  parts.push(name.slice(last));
  return <>{parts}</>;
}

export type ExerciseResultCardProps = {
  item: RankedExercise;
  /** The first photo from exercise_media when known; otherwise the pinned photo from the catalogue's source. */
  thumbnail?: string | null;
  /** Marked parts of the name for the current search. */
  highlight?: ReadonlyArray<readonly [number, number]>;
  saved: boolean;
  /** False before the member's saved list is known (the button is hidden). */
  canSave: boolean;
  onToggleSave: () => void;
  /** The best exercise for the same job that the member can do, for exercises they cannot. */
  alternative: CatalogExercise | null;
  /** Where the equipment list comes from, for "not in your Home list". */
  listName: string;
  /** Called when the member opens the exercise (remembers the search). */
  onOpen?: () => void;
};

/**
 * One library result: photo, name (search words marked), main muscle and type, level and equipment, and what to
 * do next. An exercise the member lacks equipment for is never offered as ready to do: it says what it needs,
 * offers the best alternative they can do, and keeps an explicit "Add anyway".
 */
export function ExerciseResultCard({ item, thumbnail, highlight, saved, canSave, onToggleSave, alternative, listName, onOpen }: ExerciseResultCardProps) {
  const { exercise, doable, missing } = item;
  const href = `/exercises/${encodeURIComponent(exercise.id)}`;
  const addHref = `/workouts?exercise=${encodeURIComponent(exercise.id)}`;
  const equipment = exercise.required_equipment;
  return (
    <article className="fitx-panel flex min-w-0 flex-col gap-3 p-3 transition-colors hover:border-fitx-primary/35 motion-reduce:transition-none sm:p-3.5">
      <div className="flex min-w-0 gap-3">
        <Link href={href} tabIndex={-1} aria-hidden="true" onClick={onOpen} className="shrink-0 self-start">
          <ExerciseThumb exerciseId={exercise.id} name={exercise.name} src={thumbnail || undefined} sourceRef={exercise.source_ref} equipment={equipment} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="m-0 min-w-0 flex-1 pt-0.5 text-[15px] font-semibold leading-snug tracking-tight">
              <Link href={href} onClick={onOpen} className="hover:text-fitx-primary-text"><HighlightedName name={exercise.name} ranges={highlight} /></Link>
            </h3>
            {canSave && (
              <button type="button" onClick={onToggleSave} aria-pressed={saved} aria-label={saved ? `Remove ${exercise.name} from saved exercises` : `Save ${exercise.name}`}
                className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-primary motion-reduce:transition-none">
                {saved ? <BookmarkCheck size={18} aria-hidden="true" className="text-fitx-primary" /> : <Bookmark size={18} aria-hidden="true" />}
              </button>
            )}
          </div>
          <p className="m-0 mt-0.5 truncate text-xs text-fitx-text-secondary">{mainMuscleLabel(exercise)} · {CATEGORY_LABELS[exercise.category]}</p>
          <ul className="m-0 mt-2 flex list-none flex-wrap items-center gap-1.5 p-0 text-[11px] text-fitx-text-secondary">
            <li className="rounded-md bg-fitx-surface-variant px-2 py-1">{capitalise(exercise.difficulty)}</li>
            {(equipment.length ? equipment.slice(0, 2) : ["none"]).map((key) => (
              <li key={key} className="inline-flex items-center gap-1 rounded-md border border-fitx-border px-1.5 py-0.5">
                <EquipmentIcon name={key} size={16} />{key === "none" ? "No equipment" : equipmentLabel(key)}
              </li>
            ))}
            {equipment.length > 2 && <li className="px-1">+{equipment.length - 2} more</li>}
          </ul>
        </div>
      </div>

      {doable === false ? (
        <div className="mt-auto grid gap-1 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2 text-xs">
          <p className="m-0 flex items-start gap-1.5 leading-5 text-fitx-warning">
            <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span><span className="font-semibold">Needs: {needsText(missing)}</span>. Not in {listName}.</span>
          </p>
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            {alternative ? (
              <Link href={`/exercises/${encodeURIComponent(alternative.id)}`} className="inline-flex min-h-11 min-w-0 items-center gap-1 font-semibold text-fitx-primary-text">
                <span className="truncate">Try instead: {alternative.name}</span><ArrowRight size={13} aria-hidden="true" className="shrink-0" />
              </Link>
            ) : (
              <span className="inline-flex min-h-11 items-center text-fitx-text-secondary">No close alternative with your equipment yet.</span>
            )}
            <Link href={addHref} className="inline-flex min-h-11 items-center gap-1 font-medium text-fitx-text-secondary underline underline-offset-4 hover:text-fitx-text">
              Add anyway<span className="sr-only">: {exercise.name}, which needs equipment you have not listed</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-fitx-divider pt-1 text-xs text-fitx-text-secondary">
          <span>{exercise.recommended_sets} sets · {workPerSet(exercise)}</span>
          <Link href={addHref} className="inline-flex min-h-11 items-center gap-1 font-semibold text-fitx-primary-text">
            <Plus size={14} aria-hidden="true" />Add to a workout<span className="sr-only">: {exercise.name}</span>
          </Link>
        </div>
      )}
    </article>
  );
}
