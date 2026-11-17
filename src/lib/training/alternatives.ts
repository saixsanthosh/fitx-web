import type { CatalogExercise } from "./catalog";
import type { Substitute } from "./substitutions";
import { levelRank } from "./taxonomy";

export const ALTERNATIVE_GROUPS = [
  { key: "equipment", title: "With your equipment" },
  { key: "same_muscle", title: "Same muscle" },
  { key: "level", title: "Easier or harder" },
  { key: "home", title: "At home" },
] as const;

export type AlternativeGroupKey = (typeof ALTERNATIVE_GROUPS)[number]["key"];

export type Alternative = {
  exercise: CatalogExercise;
  /** Short reasons to show under the name ("Easier", "Same muscles", "Needs cable machine"). */
  reasons: string[];
  /** "easier" / "harder" against the exercise being replaced, null for the same level. */
  levelNote: "easier" | "harder" | null;
  /** Equipment the member would still need (empty when doable). */
  missing: string[];
};

export type AlternativeGroup = { key: AlternativeGroupKey; title: string; items: Alternative[] };

/** Where one alternative belongs, so it appears once. A different level wins, then what the member can do now. */
export function alternativeGroupFor(target: CatalogExercise, substitute: Substitute): AlternativeGroupKey {
  const { exercise, missing } = substitute;
  if (levelRank(exercise.difficulty) !== levelRank(target.difficulty)) return "level";
  if (missing.length === 0) return exercise.required_equipment.length > 0 ? "equipment" : "home";
  if (exercise.locations.includes("home")) return "home";
  return "same_muscle";
}

/**
 * Groups ranked substitutes (from rankSubstitutes) into the four lists the exercise page shows. Each
 * exercise is listed once, best first within its group, at most `perGroup` per group; empty groups are
 * left out. Fixed group order.
 */
export function groupAlternatives(target: CatalogExercise, substitutes: readonly Substitute[], perGroup = 4): AlternativeGroup[] {
  const buckets = new Map<AlternativeGroupKey, Alternative[]>();
  const seen = new Set<string>();
  for (const substitute of substitutes) {
    if (seen.has(substitute.exercise.id) || substitute.exercise.id === target.id) continue;
    seen.add(substitute.exercise.id);
    const gap = levelRank(substitute.exercise.difficulty) - levelRank(target.difficulty);
    const levelNote = gap < 0 ? "easier" : gap > 0 ? "harder" : null;
    const reasons = [...(levelNote ? [levelNote === "easier" ? "Easier" : "Harder"] : []), ...substitute.reasons];
    const key = alternativeGroupFor(target, substitute);
    const list = buckets.get(key) ?? [];
    if (list.length < perGroup) list.push({ exercise: substitute.exercise, reasons, levelNote, missing: substitute.missing });
    buckets.set(key, list);
  }
  return ALTERNATIVE_GROUPS.flatMap((group) => {
    const items = buckets.get(group.key) ?? [];
    return items.length ? [{ key: group.key, title: group.title, items }] : [];
  });
}
