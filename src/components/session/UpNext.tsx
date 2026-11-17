import { ArrowRight, Flag } from "lucide-react";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";

type UpNextProps = {
  /** What follows, in words (session-progress.ts describeNextStep). */
  title: string;
  detail: string;
  /** Set when the next step is another exercise: its thumbnail. */
  exercise?: { id: string | null; name: string; sourceRef?: string | null } | null;
  finish?: boolean;
};

/** "Up next": the next set, the next exercise (with its photo) or the end of the workout. */
export function UpNext({ title, detail, exercise, finish = false }: UpNextProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-fitx-border bg-fitx-surface-variant px-3 py-3 sm:px-4">
      {exercise?.id
        ? <ExerciseThumb exerciseId={exercise.id} name={exercise.name} sourceRef={exercise.sourceRef ?? null} size="sm" />
        : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fitx-card text-fitx-primary">{finish ? <Flag size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</span>}
      <div className="min-w-0">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">Up next</p>
        <p className="m-0 mt-0.5 truncate text-sm font-semibold text-fitx-text">{title}</p>
        {detail ? <p className="m-0 mt-0.5 text-xs text-fitx-text-secondary">{detail}</p> : null}
      </div>
    </div>
  );
}
