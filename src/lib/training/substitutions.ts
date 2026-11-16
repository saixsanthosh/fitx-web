import type { CatalogExercise } from "./catalog";
import { equipmentLabel, missingEquipment } from "./equipment";
import { seededUnit } from "./seeded";
import { stapleRank } from "./staples";
import { MUSCLE_GROUP_LABELS, levelRank, type Level } from "./taxonomy";

export type Substitute = {
  exercise: CatalogExercise;
  score: number;
  /** Short, user-facing reasons, e.g. "Same muscles", "No equipment". */
  reasons: string[];
  /** Equipment the user would still need (empty when doable). */
  missing: string[];
};

export type SubstituteOptions = {
  /** Equipment the user has, expanded. */
  owned: ReadonlySet<string>;
  level: Level;
  /** Ids already in the workout. */
  exclude?: ReadonlySet<string>;
  limit?: number;
  /** Keep only exercises the user can do (default true). */
  doableOnly?: boolean;
};

/**
 * Alternatives for `target`, best first: the same kind of movement for the same muscles, with
 * equipment the user has. Used by Swap in the builder and in the live session.
 */
export function rankSubstitutes(target: CatalogExercise, catalog: readonly CatalogExercise[], options: SubstituteOptions): Substitute[] {
  const doableOnly = options.doableOnly ?? true;
  const results: Substitute[] = [];
  for (const exercise of catalog) {
    if (exercise.id === target.id || options.exclude?.has(exercise.id)) continue;
    if (exercise.category !== target.category || exercise.muscle_group !== target.muscle_group) continue;
    const missing = missingEquipment(exercise.required_equipment, options.owned);
    if (doableOnly && missing.length) continue;
    const levelGap = levelRank(exercise.difficulty) - levelRank(options.level);
    if (levelGap > 1) continue;

    let score = 0;
    const reasons: string[] = [];
    if (exercise.primary_muscle === target.primary_muscle) { score += 30; reasons.push("Same muscles"); }
    else { score += 18; reasons.push(`Also ${MUSCLE_GROUP_LABELS[exercise.muscle_group].toLowerCase()}`); }
    if (exercise.mechanic && exercise.mechanic === target.mechanic) { score += 15; if (exercise.mechanic === "compound") reasons.push("Also compound"); }
    if (exercise.movement_pattern && exercise.movement_pattern === target.movement_pattern) score += 8;
    if (exercise.prescription_type === target.prescription_type) score += 5;
    score += Math.min(9, exercise.secondary_muscles.filter((muscle) => target.secondary_muscles.includes(muscle)).length * 3);
    if (target.alternatives.includes(exercise.id) || exercise.alternatives.includes(target.id)) { score += 25; reasons.unshift("FITX pick"); }
    const staple = stapleRank(exercise.id);
    if (staple !== null) score += Math.max(2, 12 - staple);
    score += levelGap === 0 ? 5 : levelGap === -1 ? 2 : levelGap === 1 ? -6 : -3;
    if (exercise.required_equipment.some((key) => target.required_equipment.includes(key))) score += 3;
    reasons.push(exercise.required_equipment.length ? `Needs ${exercise.required_equipment.map(equipmentLabel).join(", ").toLowerCase()}` : "No equipment");
    if (missing.length) score -= 40;
    results.push({ exercise, score: score + seededUnit(target.id, exercise.id), reasons, missing });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 6);
}

/** True when the user cannot do `exercise` with what they have. */
export function needsSwap(exercise: CatalogExercise, owned: ReadonlySet<string>): boolean {
  return missingEquipment(exercise.required_equipment, owned).length > 0;
}
