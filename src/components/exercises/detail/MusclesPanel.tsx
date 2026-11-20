import Link from "next/link";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { exerciseRegions, regionLabel } from "@/lib/training/anatomy";
import type { CatalogExercise } from "@/lib/training/catalog";
import { listWords, muscleRows, type MuscleRow } from "@/lib/training/exercise-guide";
import type { EquipmentState } from "@/lib/training/exercise-detail";
import { MUSCLE_GROUP_LABELS, type Level, type TrainingContext } from "@/lib/training/taxonomy";
import { AlternativesSection } from "./AlternativesSection";
import { muscleBrowseHref } from "./detail-text";

type MusclesPanelProps = {
  exercise: CatalogExercise;
  equipment: EquipmentState | null;
  level: Level | null;
  preferredContext: TrainingContext | null;
  alternativesFocus: number;
};

const capitalise = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

const regionLink = "inline-flex min-h-11 items-center gap-2 rounded-full border border-fitx-border bg-fitx-card px-3.5 text-sm font-medium text-fitx-text transition-colors hover:border-fitx-primary/45 hover:bg-fitx-hover motion-reduce:transition-none";

function Swatch({ role }: { role: "primary" | "assisting" }) {
  return <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${role === "primary" ? "bg-fitx-primary" : "bg-[var(--fitx-anatomy-secondary)]"}`} />;
}

/** One catalogue muscle: a link to its region, or its name with links to the regions it covers on the map. */
function MuscleItem({ row, role }: { row: MuscleRow; role: "primary" | "assisting" }) {
  if (row.regions.length === 1) {
    const region = row.regions[0];
    const label = row.direct ? regionLabel(region) : `${capitalise(row.name)} (${regionLabel(region).toLowerCase()})`;
    return (
      <li>
        <Link href={muscleBrowseHref(region)} className={regionLink}><Swatch role={role} />{label}</Link>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-fitx-text-secondary">{capitalise(row.name)}:</span>
      {row.regions.map((region) => (
        <Link key={region} href={muscleBrowseHref(region)} className={regionLink}><Swatch role={role} />{regionLabel(region)}</Link>
      ))}
    </li>
  );
}

/** Where the exercise works, on FITX's body map and as lists, then the alternatives. */
export function MusclesPanel({ exercise, equipment, level, preferredContext, alternativesFocus }: MusclesPanelProps) {
  const regions = exerciseRegions(exercise.primary_muscle, exercise.secondary_muscles);
  const rows = muscleRows(exercise.primary_muscle, exercise.secondary_muscles);
  const group = MUSCLE_GROUP_LABELS[exercise.muscle_group];
  return (
    <div className="space-y-6">
      <section aria-labelledby="exercise-muscles-heading" className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div className="fitx-panel grid justify-items-center p-4">
          {regions.primary.length || regions.secondary.length ? (
            <BodyMap title={`Muscles ${exercise.name} works`} primary={regions.primary} secondary={regions.secondary} legend size="lg" reveal />
          ) : (
            <p className="m-0 py-8 text-center text-sm text-fitx-text-secondary">This exercise’s muscles aren’t drawn on the body map.</p>
          )}
        </div>
        <div className="min-w-0">
          <h2 id="exercise-muscles-heading" className="text-base font-semibold text-fitx-text">Muscles worked</h2>
          <p className="mt-1 text-sm text-fitx-text-secondary">{group}</p>
          {rows.primary.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">Primary</h3>
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">{rows.primary.map((row) => <MuscleItem key={row.name} row={row} role="primary" />)}</ul>
            </>
          )}
          {rows.assisting.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">Assisting</h3>
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">{rows.assisting.map((row) => <MuscleItem key={row.name} row={row} role="assisting" />)}</ul>
            </>
          )}
          {rows.notDrawn.length > 0 && (
            <p className="mt-4 text-xs leading-5 text-fitx-text-secondary">Also listed in the catalogue, not drawn on the map: {listWords(rows.notDrawn)}.</p>
          )}
          {!rows.primary.length && !rows.assisting.length && !rows.notDrawn.length && (
            <p className="mt-4 text-sm text-fitx-text-secondary">No muscles are recorded for this exercise.</p>
          )}
        </div>
      </section>
      <AlternativesSection exercise={exercise} equipment={equipment} level={level} preferredContext={preferredContext} focusRequest={alternativesFocus} />
    </div>
  );
}
