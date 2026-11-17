import Link from "next/link";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { groupAlternatives, type Alternative } from "@/lib/training/alternatives";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentLabel } from "@/lib/training/equipment";
import type { Substitute } from "@/lib/training/substitutions";
import { ExerciseThumb } from "./ExerciseThumb";

type ExerciseAlternativesProps = {
  /** The exercise being replaced. */
  target: CatalogExercise;
  /** Ranked substitutes from rankSubstitutes(target, catalog, { owned, level, doableOnly: false }). */
  substitutes: readonly Substitute[];
  perGroup?: number;
  className?: string;
};

function equipmentText(item: Alternative): string {
  const keys = item.exercise.required_equipment;
  return keys.length ? keys.map(equipmentLabel).join(", ") : "No equipment";
}

/**
 * Other exercises that do the same job, grouped: with your equipment, same muscle, easier or harder, at
 * home. Each row has a thumbnail, the name, why it is an alternative, its equipment and a link to its page.
 */
export function ExerciseAlternatives({ target, substitutes, perGroup = 4, className = "" }: ExerciseAlternativesProps) {
  const groups = groupAlternatives(target, substitutes, perGroup);
  if (!groups.length) {
    return <p className={`m-0 text-sm text-fitx-text-secondary ${className}`}>No close alternatives found for {target.name} yet.</p>;
  }
  return (
    <div className={`grid grid-cols-1 gap-5 ${className}`}>
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`alt-${group.key}`}>
          <h3 id={`alt-${group.key}`} className="m-0 text-sm font-bold text-fitx-text">{group.title}</h3>
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0">
            {group.items.map((item) => (
              <li key={item.exercise.id}>
                <Link
                  href={`/exercises/${encodeURIComponent(item.exercise.id)}`}
                  className="flex min-h-11 items-center gap-3 rounded-xl border border-fitx-border bg-fitx-card p-2 pr-3 transition-colors hover:bg-fitx-hover motion-reduce:transition-none"
                >
                  <ExerciseThumb exerciseId={item.exercise.id} name={item.exercise.name} sourceRef={item.exercise.source_ref} equipment={item.exercise.required_equipment} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fitx-text">{item.exercise.name}</span>
                    <span className="mt-0.5 block text-xs text-fitx-text-secondary">{item.reasons.join(" · ")}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-center gap-0.5 text-fitx-text-secondary">
                    <EquipmentIcon name={item.exercise.required_equipment[0] ?? "none"} size={24} title={equipmentText(item)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
