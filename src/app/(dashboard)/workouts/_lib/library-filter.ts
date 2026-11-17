/**
 * The workout builder's exercise picker: search by name, muscle or body area ("abs", "legs", "back" find what
 * trains them), an optional body-area filter (the focus vocabulary, focus.ts) and "only what I can do" with the
 * member's equipment. Results are paged, never cut off silently: the picker shows how many match and offers more.
 */
import type { CatalogExercise } from "@/lib/training/catalog";
import { isDoableWith } from "@/lib/training/equipment";
import { exerciseMatchesFocus, focusAreaFor, rankFocusExercises, type FocusArea } from "@/lib/training/focus";

export const LIBRARY_PAGE_SIZE = 30;

export type LibraryFilter = {
  query: string;
  /** Only exercises that train this area as their main muscle (full body: the full-body rule). */
  area: FocusArea | null;
  /** Only exercises the equipment allows. */
  doableOnly: boolean;
};

/** Lower case, "_" and "-" as spaces, single spaces. */
function words(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * True when the query finds the exercise: every word of it appears in the name or the main muscle ("incline
 * press"), or the whole query names a body area the exercise trains ("arms", "belly", "lower body").
 */
export function matchesQuery(exercise: CatalogExercise, query: string): boolean {
  const wanted = words(query);
  if (!wanted) return true;
  const haystack = `${words(exercise.name)} ${words(exercise.primary_muscle)}`;
  if (wanted.split(" ").every((word) => haystack.includes(word))) return true;
  const area = focusAreaFor(wanted);
  return area !== null && exerciseMatchesFocus(exercise, area);
}

/**
 * The exercises the picker lists, in order: with an area, the focus ranking (doable first, then the best fit); else
 * the catalogue's order (by name) with doable ones first when `owned` is given.
 */
export function filterLibrary(catalog: readonly CatalogExercise[], filter: LibraryFilter, owned?: ReadonlySet<string> | null): CatalogExercise[] {
  const doable = (exercise: CatalogExercise) => (owned ? isDoableWith(exercise.required_equipment, owned) : true);
  const base = filter.area
    ? rankFocusExercises(catalog, [filter.area], { owned, doableOnly: filter.doableOnly && Boolean(owned), includeSecondary: false }).map((entry) => entry.exercise)
    : catalog.filter((exercise) => !filter.doableOnly || doable(exercise));
  const found = base.filter((exercise) => matchesQuery(exercise, filter.query));
  if (filter.area || !owned) return found;
  return [...found.filter(doable), ...found.filter((exercise) => !doable(exercise))];
}

/** One page more than shown so far (at least one page), never past the end. */
export function nextVisibleCount(shown: number, total: number, pageSize = LIBRARY_PAGE_SIZE): number {
  return Math.min(total, Math.max(pageSize, shown + pageSize));
}
