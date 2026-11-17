import Link from "next/link";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, ScanLine } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
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

/** The exercise's name, what it is (category, level, mechanic, equipment) and what to do with it. */
export function ExerciseHeader({ exercise, summary, cameraRuleId, saved, onToggleSaved }: ExerciseHeaderProps) {
  const equipment = exercise.required_equipment;
  return (
    <header className="space-y-3">
      <Link href="/exercises" className="group -ml-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm">
        <span className="inline-flex items-center gap-2 text-fitx-text-secondary group-hover:text-fitx-text"><ArrowLeft size={15} aria-hidden="true" />Exercise library</span>
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-.03em] text-fitx-text sm:text-[30px]">{exercise.name}</h1>
          {summary && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-fitx-text-secondary">{summary}</p>}
        </div>
        {saved !== null && (
          <button
            type="button"
            onClick={onToggleSaved}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${exercise.name} from saved exercises` : `Save ${exercise.name}`}
            title={saved ? "Remove saved exercise" : "Save exercise on this device"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary transition-colors hover:border-fitx-primary/45 hover:text-fitx-primary motion-reduce:transition-none"
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
      <div className="flex flex-wrap gap-2">
        <Link href={addToWorkoutHref(exercise.id)} className="fitx-button">Add to a workout<ArrowRight size={15} aria-hidden="true" /></Link>
        {cameraRuleId && (
          <Link href={`/form-coach?exercise=${encodeURIComponent(cameraRuleId)}`} className="fitx-button fitx-button-secondary">
            <ScanLine size={15} aria-hidden="true" />Practise with camera
          </Link>
        )}
      </div>
    </header>
  );
}
