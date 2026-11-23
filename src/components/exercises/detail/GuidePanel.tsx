import type { ReactNode } from "react";
import { Check, Flag } from "lucide-react";
import { ExerciseDemoPlayer } from "@/components/exercises/ExerciseDemoPlayer";
import { exerciseBenefits } from "@/lib/training/benefits";
import type { CatalogExercise } from "@/lib/training/catalog";
import type { EquipmentState, ExerciseDetail } from "@/lib/training/exercise-detail";
import type { GuideStep } from "@/lib/training/exercise-guide";
import { formatDuration } from "@/lib/training/exercise-progress";
import { reportProblemHref, stepsSourceText, workPerSetText } from "./detail-text";
import { EquipmentPanel } from "./EquipmentPanel";
import { ExerciseSteps } from "./ExerciseSteps";
import { TextLink } from "./TextLink";

type GuidePanelProps = {
  detail: ExerciseDetail;
  steps: readonly GuideStep[];
  equipment: EquipmentState | null;
  signedIn: boolean;
  /** The member's note box (rendered by the page, which keeps its state). */
  note: ReactNode;
  onShowAlternatives: () => void;
};

function Suggested({ exercise }: { exercise: CatalogExercise }) {
  const timed = exercise.prescription_type === "time";
  return (
    <section aria-labelledby="exercise-suggested-heading" className="fitx-panel p-4">
      <h2 id="exercise-suggested-heading" className="text-sm font-semibold text-fitx-text">Suggested sets</h2>
      <dl className="m-0 mt-3 grid grid-cols-3 gap-3">
        <div><dt className="text-[11px] text-fitx-text-secondary">Sets</dt><dd className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-fitx-text">{exercise.recommended_sets}</dd></div>
        <div><dt className="text-[11px] text-fitx-text-secondary">{timed ? "Time per set" : "Reps per set"}</dt><dd className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-fitx-text">{workPerSetText(exercise)}</dd></div>
        <div><dt className="text-[11px] text-fitx-text-secondary">Rest</dt><dd className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-fitx-text">{formatDuration(exercise.rest_seconds)}</dd></div>
      </dl>
      {!exercise.curated && <p className="m-0 mt-3 text-xs leading-5 text-fitx-text-secondary">Category, equipment and these numbers are estimated from older catalogue data until FITX’s exercise catalogue update is applied.</p>}
    </section>
  );
}

/** What the exercise does for you, from the catalogue's own fields (src/lib/training/benefits.ts). */
function Benefits({ exercise }: { exercise: CatalogExercise }) {
  const lines = exerciseBenefits(exercise);
  if (!lines.length) return null;
  return (
    <section aria-labelledby="exercise-benefits-heading">
      <h2 id="exercise-benefits-heading" className="text-base font-semibold text-fitx-text">Benefits</h2>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2.5 rounded-xl border border-fitx-border bg-fitx-surface px-3 py-2.5 text-sm leading-5 text-fitx-text">
            <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-fitx-primary/12 text-fitx-primary-text"><Check size={12} strokeWidth={3} /></span>
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How to do the exercise: the demonstration photos and the steps first, then the note, sets and equipment. */
export function GuidePanel({ detail, steps, equipment, signedIn, note, onShowAlternatives }: GuidePanelProps) {
  const { exercise, media } = detail;
  const source = stepsSourceText(detail.attribution);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-6">
        <div className="min-w-0 space-y-5">
          <ExerciseDemoPlayer key={exercise.id} media={media} name={exercise.name} layout="sequence" exerciseId={exercise.id} />
          <ExerciseSteps steps={steps} />
          <Benefits exercise={exercise} />
        </div>
        <div className="space-y-4">
          {note}
          <Suggested exercise={exercise} />
          <EquipmentPanel required={exercise.required_equipment} equipment={equipment} signedIn={signedIn} onShowAlternatives={onShowAlternatives} />
        </div>
      </div>
      <footer className="flex flex-col gap-1 border-t border-fitx-divider pt-3 text-xs leading-5 text-fitx-text-secondary sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="m-0">{source ?? "The source of these steps isn’t recorded."}{media.stills.length || media.videos.length ? " Photo credits are under the photos." : ""}</p>
        <TextLink href={reportProblemHref(exercise.id)} size="text-xs" className="shrink-0">
          <Flag size={14} aria-hidden="true" />Report a problem with this exercise
        </TextLink>
      </footer>
    </div>
  );
}
