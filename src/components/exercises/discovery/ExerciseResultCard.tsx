"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, Plus } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { ExerciseCover } from "@/components/exercises/ExerciseCover";
import { REGIONS, isRegionKey } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import type { RankedExercise } from "@/lib/training/catalog-search";
import { equipmentLabel } from "@/lib/training/equipment";
import { MUSCLE_GROUP_LABELS } from "@/lib/training/taxonomy";
import styles from "./Library.module.css";

const capitalise = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/** "Lats", "Middle back": the exercise's main muscle by its body-map name, else its group. */
export function mainMuscleLabel(exercise: Pick<CatalogExercise, "primary_muscle" | "muscle_group">): string {
  const key = (exercise.primary_muscle ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isRegionKey(key) ? REGIONS[key].label : MUSCLE_GROUP_LABELS[exercise.muscle_group] ?? capitalise(key.replaceAll("_", " "));
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
  /** Position in the grid: sets the entrance delay and loads the first row's photos at once. */
  index?: number;
};

/** Covers are a full grid column: two on phones, three from 640 px, four from 1280 px. */
const COVER_SIZES = "(min-width: 1280px) 280px, (min-width: 640px) 33vw, 50vw";

/**
 * One library result as a grid card: the photo, the name (search words marked), the main muscle and level, and what
 * to do next. An exercise the member lacks equipment for is never offered as ready to do: it says what it needs,
 * offers the best alternative they can do, and keeps an explicit "Add anyway".
 */
export function ExerciseResultCard({ item, thumbnail, highlight, saved, canSave, onToggleSave, alternative, listName, onOpen, index = 0 }: ExerciseResultCardProps) {
  const { exercise, doable, missing } = item;
  const href = `/exercises/${encodeURIComponent(exercise.id)}`;
  const addHref = `/workouts?exercise=${encodeURIComponent(exercise.id)}`;
  const equipment = exercise.required_equipment;
  const shownKit = equipment.length ? equipment.slice(0, 3) : ["none"];
  const style = { "--rise-delay": `${Math.min(index % 24, 8) * 40}ms` } as CSSProperties;
  return (
    <article style={style} data-exercise-card={exercise.id} className={`${styles.card} group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface transition-colors hover:border-fitx-primary/40 motion-reduce:transition-none`}>
      <Link href={href} tabIndex={-1} aria-hidden="true" onClick={onOpen} className="block">
        <ExerciseCover exerciseId={exercise.id} name={exercise.name} src={thumbnail || undefined} sourceRef={exercise.source_ref} equipment={equipment}
          sizes={COVER_SIZES} eager={index < 4} className={styles.cover} imageClassName={styles.photo} />
      </Link>
      {canSave && (
        <button type="button" onClick={onToggleSave} aria-pressed={saved} aria-label={saved ? `Remove ${exercise.name} from saved exercises` : `Save ${exercise.name}`}
          className={`${styles.save} absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-full text-fitx-text hover:text-fitx-primary`}>
          {saved ? <BookmarkCheck size={18} aria-hidden="true" className="text-fitx-primary" /> : <Bookmark size={18} aria-hidden="true" />}
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-3.5">
        <h3 className="m-0 text-[14px] font-semibold leading-snug tracking-tight sm:text-[15px]">
          {/* The whole card opens the exercise (the link's ::after covers it); the title row itself is a 44 px target too. */}
          <Link href={href} onClick={onOpen} className="flex min-h-11 items-center after:absolute after:inset-0 after:content-[''] hover:text-fitx-primary-text focus-visible:outline-none">
            <span className="line-clamp-2"><HighlightedName name={exercise.name} ranges={highlight} /></span>
          </Link>
        </h3>
        <p className="m-0 truncate text-xs text-fitx-text-secondary">{mainMuscleLabel(exercise)} · {capitalise(exercise.difficulty)}</p>
        {doable === false ? (
          <div className="relative z-10 mt-auto grid gap-0.5 pt-2 text-xs">
            <p className="m-0 truncate leading-5 text-fitx-warning"><span className="font-semibold">Needs: {needsText(missing)}</span><span className="sr-only">. Not in {listName}.</span></p>
            {alternative ? (
              <Link href={`/exercises/${encodeURIComponent(alternative.id)}`} className="inline-flex min-h-11 min-w-0 items-center gap-1 font-semibold text-fitx-primary-text">
                <span className="truncate">Try instead: {alternative.name}</span><ArrowRight size={13} aria-hidden="true" className="shrink-0" />
              </Link>
            ) : (
              <span className="inline-flex min-h-11 items-center text-fitx-text-secondary">No close swap yet</span>
            )}
            <Link href={addHref} className="-mt-2 inline-flex min-h-11 items-center self-start font-medium text-fitx-text-secondary underline underline-offset-4 hover:text-fitx-text">
              Add anyway<span className="sr-only">: {exercise.name}, which needs equipment you have not listed</span>
            </Link>
          </div>
        ) : (
          <div className="relative z-10 mt-auto flex items-center justify-between gap-2 pt-1">
            <ul className="m-0 flex min-w-0 list-none items-center gap-1 p-0 text-fitx-text-secondary" aria-label="Equipment">
              {shownKit.map((key) => (
                <li key={key} title={key === "none" ? "No equipment" : equipmentLabel(key)} className="grid h-7 w-7 place-items-center rounded-md bg-fitx-surface-variant">
                  <EquipmentIcon name={key} size={18} /><span className="sr-only">{key === "none" ? "No equipment" : equipmentLabel(key)}</span>
                </li>
              ))}
              {equipment.length > 3 && <li className="px-0.5 text-[11px]">+{equipment.length - 3}</li>}
            </ul>
            <Link href={addHref} aria-label={`Add ${exercise.name} to a workout`}
              className="-mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-fitx-primary-text transition-colors hover:bg-fitx-primary/10 motion-reduce:transition-none">
              <Plus size={18} aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}
