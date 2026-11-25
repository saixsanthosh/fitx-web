/**
 * Workouts' Home mode (phase 7): the home exercise collection, personalised by the member's home equipment and
 * level. Pure, so the rules are tested without a browser. Everything comes from the catalogue it is given.
 *
 * An exercise is in the collection when the member's home list allows it: the same "you can do at home" as the
 * Exercise library's Home tab (catalog-search.ts), so both screens give the same counts (bug 52). With an area
 * chosen, only exercises that train it as their main muscle (the full-body rule for Full body) are listed, as the
 * library's main-muscle tier. Order: the staples of each muscle group first, then exercises at or below the
 * member's level, then by name.
 */
import type { CatalogExercise } from "./catalog";
import { isDoableWith } from "./equipment";
import { FOCUS_AREAS, exerciseMatchesFocus, type FocusArea } from "./focus";
import { stapleRank } from "./staples";
import { levelRank, type Level } from "./taxonomy";

/** An exercise the member can do at home: everything it needs is on their home list (the library's Home rule). */
export function isHomeExercise(exercise: Pick<CatalogExercise, "required_equipment">, owned: ReadonlySet<string>): boolean {
  return isDoableWith(exercise.required_equipment, owned);
}

export function homeCollection(catalog: readonly CatalogExercise[], options: { owned: ReadonlySet<string>; area?: FocusArea | null; level?: Level | null }): CatalogExercise[] {
  const rank = levelRank(options.level ?? "beginner");
  return catalog
    .filter((exercise) => isHomeExercise(exercise, options.owned) && (!options.area || exerciseMatchesFocus(exercise, options.area)))
    .map((exercise) => ({ exercise, staple: stapleRank(exercise.id), above: levelRank(exercise.difficulty) > rank ? 1 : 0 }))
    .sort((a, b) => (a.staple ?? Number.MAX_SAFE_INTEGER) - (b.staple ?? Number.MAX_SAFE_INTEGER) || a.above - b.above || a.exercise.name.localeCompare(b.exercise.name))
    .map((item) => item.exercise);
}

/** How many home exercises the member can do per area (main muscle), for the area tiles. */
export function homeAreaCounts(catalog: readonly CatalogExercise[], owned: ReadonlySet<string>): Record<FocusArea, number> {
  const counts = Object.fromEntries(FOCUS_AREAS.map((area) => [area, 0])) as Record<FocusArea, number>;
  for (const exercise of catalog) {
    if (!isHomeExercise(exercise, owned)) continue;
    for (const area of FOCUS_AREAS) if (exerciseMatchesFocus(exercise, area)) counts[area] += 1;
  }
  return counts;
}
