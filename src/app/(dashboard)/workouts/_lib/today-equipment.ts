/**
 * The Today card's equipment check (bug 17): the card used to show a planned day as ready even when its exercises
 * needed equipment the member had removed, which only Details said. The card now says how many of its exercises the
 * list does not allow, and what they need, as Details does ("Needs dumbbells, not on your gym list"). Pure.
 */
import type { CatalogExercise } from "@/lib/training/catalog";
import { missingEquipment } from "@/lib/training/equipment";
import { survivingExerciseId } from "@/lib/training/exercise-merges";

export type EquipmentGaps = { count: number; missing: string[] };

/** The exercises the list does not allow (an exercise no longer in the library is not counted) and what they need. */
export function equipmentGaps(rows: readonly { exercise_id: string | null }[], catalog: ReadonlyMap<string, Pick<CatalogExercise, "required_equipment">>, owned: ReadonlySet<string>): EquipmentGaps {
  let count = 0;
  const missing = new Set<string>();
  for (const row of rows) {
    const exercise = row.exercise_id ? catalog.get(survivingExerciseId(row.exercise_id)) : undefined;
    const lacking = exercise ? missingEquipment(exercise.required_equipment, owned) : [];
    if (!lacking.length) continue;
    count += 1;
    lacking.forEach((key) => missing.add(key));
  }
  return { count, missing: [...missing] };
}

/** "2 exercises need dumbbells, not on your gym list." Empty when every exercise fits. */
export function equipmentGapMessage(gaps: EquipmentGaps, listName: string, label: (key: string) => string): string {
  if (!gaps.count) return "";
  const names = gaps.missing.map((key) => label(key).toLowerCase());
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${gaps.count === 1 ? "1 exercise needs" : `${gaps.count} exercises need`} ${list}, not on your ${listName} list.`;
}
