import Link from "next/link";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { FormCheckEntry } from "@/components/form-check/FormCheckEntry";
import { exerciseRegions } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentLabel } from "@/lib/training/equipment";
import { CATEGORY_LABELS } from "@/lib/training/taxonomy";
import { addToWorkoutHref } from "./detail-text";

type ExerciseHeaderProps = {
  exercise: CatalogExercise;
  /** The catalogue description when it adds something, else a line built from the catalogue's muscles. */
  summary: string | null;
  /** The camera form coach's id for this movement, when it counts it. */
  cameraRuleId: string | null;
  /** Null until the member is known; the Save button shows only for a signed-in member. */
  saved: boolean | null;
  onToggleSaved: () => void;
};

const MECHANIC_LABELS = { compound: "Compound", isolation: "Isolation" } as const;
const LEVEL_LABELS = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" } as const;

const chip = "inline-flex min-h-7 items-center gap-1.5 rounded-md border border-fitx-border bg-fitx-surface px-2 py-1 text-xs text-fitx-text-secondary";

/** The exercise's name, what it is (category, level, mechanic, equipment), where it works and what to do with it. */
export function ExerciseHeader({ exercise, summary, cameraRuleId, saved, onToggleSaved }: ExerciseHeaderProps) {
  const equipment = exercise.required_equipment;
  const regions = exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);
  const drawn = regions.primary.length > 0 || regions.secondary.length > 0;
  return (
    <header className="space-y-3">
      <Link href="/exercises" className="group -ml-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm">
        <span className="inline-flex items-center gap-2 text-fitx-text-secondary group-hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Exercise library</span>
      </Link>
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading text-[28px] font-bold leading-[1.08] tracking-[-.035em] text-fitx-text sm:text-[34px]">{exercise.name}</h1>
              {summary && <p className="mt-2 max-w-2xl text-sm leading-6 text-fitx-text-secondary">{summary}</p>}
            </div>
            {saved !== null && (
              <button
                type="button"
                onClick={onToggleSaved}
                aria-pressed={saved}
                aria-label={saved ? `Remove ${exercise.name} from saved exercises` : `Save ${exercise.name}`}
                title={saved ? "Remove saved exercise" : "Save exercise"}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-fitx-border text-fitx-text-secondary transition-colors hover:border-fitx-primary/45 hover:text-fitx-primary motion-reduce:transition-none sm:hidden"
              >
                {saved ? <BookmarkCheck size={18} aria-hidden="true" className="text-fitx-primary" /> : <Bookmark size={18} aria-hidden="true" />}
              </button>
            )}
          </div>
          <ul aria-label="About this exercise" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            <li className={chip}>{CATEGORY_LABELS[exercise.category]}</li>
            <li className={chip}>{LEVEL_LABELS[exercise.difficulty]}</li>
            {exercise.mechanic && <li className={chip}>{MECHANIC_LABELS[exercise.mechanic]}</li>}
            {equipment.length
              ? equipment.map((key) => (
                <li key={key} className={chip}><EquipmentIcon name={key} size={16} className="text-fitx-text" />{equipmentLabel(key)}</li>
              ))
              : <li className={chip}><EquipmentIcon name="none" size={16} className="text-fitx-text" />No equipment</li>}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={addToWorkoutHref(exercise.id)} className="fitx-button">Add to a workout<ArrowRight size={15} aria-hidden="true" /></Link>
            {/* The AI Form Check entry (brief 3.5), opened on this exercise's camera rule. */}
            {cameraRuleId && <FormCheckEntry variant="inline" exerciseId={cameraRuleId} />}
            {saved !== null && (
              // The wrapper hides it on phones (the round button by the title saves there): .fitx-button's own
              // display would beat a `hidden` class on the button itself.
              <span className="hidden sm:contents">
                <button
                  type="button"
                  onClick={onToggleSaved}
                  aria-pressed={saved}
                  aria-label={saved ? `Remove ${exercise.name} from saved exercises` : `Save ${exercise.name}`}
                  className="fitx-button fitx-button-secondary"
                >
                  {saved ? <BookmarkCheck size={16} aria-hidden="true" className="text-fitx-primary" /> : <Bookmark size={16} aria-hidden="true" />}{saved ? "Saved" : "Save"}
                </button>
              </span>
            )}
          </div>
        </div>
        {drawn && (
          <div className="hidden rounded-2xl border border-fitx-border bg-fitx-surface px-5 pb-3 pt-4 sm:block">
            <BodyMap title="Main muscles" primary={regions.primary} secondary={regions.secondary} size="sm" reveal />
          </div>
        )}
      </div>
    </header>
  );
}
