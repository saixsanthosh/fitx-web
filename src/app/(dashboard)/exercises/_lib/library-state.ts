import { catalogSearchQuery, type CatalogSort } from "@/lib/training/catalog-search";
import { equipmentKeyFor } from "@/lib/training/equipment";
import {
  EQUIPMENT_KEYS,
  EXERCISE_CATEGORIES,
  LEVELS,
  MUSCLE_GROUPS,
  muscleGroupOf,
  type ExerciseCategory,
  type Level,
  type MuscleGroup,
  type TrainingContext,
} from "@/lib/training/taxonomy";

/** What the exercise library shows, as kept in its URL (`/exercises?context=home&doable=1&muscle=back`). */
export type LibraryState = {
  /** The search box, as typed. */
  q: string;
  /** Home Workout or Gym Workout (the default, which shows every exercise). */
  context: TrainingContext;
  /** "Doable with my equipment" for that context. */
  doable: boolean;
  muscle: MuscleGroup | null;
  category: ExerciseCategory | null;
  equipment: string | null;
  difficulty: Level | null;
  sort: CatalogSort;
};

export type LibraryParam = "q" | "context" | "doable" | "muscle" | "category" | "equipment" | "difficulty" | "sort";

/** Cleared by "Clear filters"; `location` and `movement` are the older page's keys. The context stays. */
export const LIBRARY_FILTER_PARAMS = ["q", "doable", "muscle", "category", "equipment", "difficulty", "sort", "location", "movement"] as const;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Reads the library state from a query string. Links made by the older page still work: `location`
 * becomes the context, a fine muscle (`muscle=lats`) its group, an equipment word (`equipment=bands`)
 * its key. Unknown values are ignored.
 */
export function readLibraryState(search: string): LibraryState {
  const params = new URLSearchParams(search);
  const context = params.get("context") ?? params.get("location");
  const muscle = params.get("muscle");
  const equipment = params.get("equipment");
  return {
    q: params.get("q") ?? "",
    context: context === "home" ? "home" : "gym",
    doable: params.get("doable") === "1",
    muscle: muscle ? oneOf(MUSCLE_GROUPS, muscle) ?? muscleGroupOf(muscle) : null,
    category: oneOf(EXERCISE_CATEGORIES, params.get("category")),
    equipment: equipment ? oneOf(EQUIPMENT_KEYS, equipment) ?? (equipmentKeyFor(equipment) || null) : null,
    difficulty: oneOf(LEVELS, params.get("difficulty")),
    sort: params.get("sort") === "difficulty" ? "difficulty" : "name",
  };
}

/**
 * `search` with one value changed; default values are removed so URLs stay short. Writing the
 * context or a filter also drops the older page's key it replaces.
 */
export function withLibraryParam(search: string, key: LibraryParam, value: string | boolean | null): string {
  const params = new URLSearchParams(search);
  const text = typeof value === "boolean" ? (value ? "1" : "") : (value ?? "");
  const isDefault = !text.trim() || (key === "context" && text === "gym") || (key === "sort" && text === "name");
  if (isDefault) params.delete(key);
  else params.set(key, text);
  if (key === "context") params.delete("location");
  return params.toString();
}

/** `search` without any filter, keeping the context. */
export function withoutLibraryFilters(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of LIBRARY_FILTER_PARAMS) params.delete(key);
  return params.toString();
}

/** Filters set in the Filters panel (muscle, category, equipment, difficulty, sort). */
export function activeFilterCount(state: LibraryState): number {
  return [state.muscle, state.category, state.equipment, state.difficulty].filter(Boolean).length + Number(state.sort !== "name");
}

/**
 * The GET /api/exercises query for this state, without the page number. `owned` is the user's
 * expanded equipment for the context; null while it loads, and the result is then null when the
 * doable filter needs it. `ids` limits the results to saved exercises.
 */
export function libraryApiQuery(state: LibraryState, owned: readonly string[] | null, ids: readonly string[] | null = null): string | null {
  if (state.doable && !owned) return null;
  return catalogSearchQuery({
    q: state.q,
    location: state.context === "home" ? "home" : null,
    doable: state.doable && owned ? [...owned] : null,
    muscleGroup: state.muscle,
    category: state.category,
    equipment: state.equipment,
    difficulty: state.difficulty,
    sort: state.sort,
    ids: ids ? [...ids] : null,
  }).toString();
}
