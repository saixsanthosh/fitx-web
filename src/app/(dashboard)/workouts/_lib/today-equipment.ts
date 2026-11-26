/**
 * The Today card's equipment check (bug 17): the card used to show a planned day as ready even when its exercises
 * needed equipment the member had removed, which only Details said. The card now says how many of its exercises the
 * list does not allow, and what they need, as Details does ("Needs dumbbells, not on your gym list"). Pure.
 */
import type { CatalogExercise } from "@/lib/training/catalog";
import { missingEquipment, sortEquipmentKeys } from "@/lib/training/equipment";
import { survivingExerciseId } from "@/lib/training/exercise-merges";
import type { TodayStart } from "./today-start";

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

/**
 * What the Today card adds to its equipment warning when it has no "Re-plan this day" (the member's own plan): where
 * the exercises can really be swapped, for the card's start state (today-start.ts). It used to say "Open Details to
 * swap them", but Details has no Swap: Swap is in the builder, reached with Details' Edit plan, which Details does not
 * offer while a workout is in progress (release 3 review). With the card's own workout in progress, the live workout's
 * Swap works (before the exercise's sets are logged); with another one, the swap waits until that one is finished.
 * The words agree with `count`, the number of exercises the warning names: "it" and "its" for one, "them" and "their"
 * for two or more (round 3d re-check: after "1 exercise needs dumbbells", a fixed "them" read as the dumbbells).
 * Nothing when no exercise needs swapping.
 */
export function swapAdvice(input: { canReplan: boolean; start: TodayStart["kind"]; count: number }): string {
  if (input.canReplan || !(input.count > 0)) return "";
  const one = input.count === 1;
  const them = one ? "it" : "them";
  if (input.start === "continue") return `You can swap ${them} in your workout with Swap, before you log ${one ? "its" : "their"} sets.`;
  if (input.start === "other") return `To swap ${them}, finish your workout in progress, then open Details and choose Edit plan.`;
  return `To swap ${them}, open Details and choose Edit plan.`;
}

/**
 * The Today card's "Re-plan this day": the day, whether it runs, how it went (`note`), and whether it left the day
 * fitting the member's list (`fitted`: the day was re-planned and nothing was left that the list could not replace).
 */
export type TodayReplan = { planId: string; busy: boolean; note: string; fitted: boolean };

/**
 * What is left of the card's re-plan result once the day or the list may have changed (a plan saved, the page's lists
 * read again, a list saved in Workouts or in Workout setup): only a re-plan still running. The line describes the day
 * as that re-plan left it, so it goes then (re-check of release 3: "Push was re-planned for your gym list…" stayed
 * on the card after the list and the day had changed again, right under a new "needs dumbbells" warning).
 */
export function replanAfterChange(current: TodayReplan | null): TodayReplan | null {
  return current?.busy ? current : null;
}

/**
 * The card's re-plan line under its equipment warning: never "re-planned for your list" while the card says that
 * exercises need equipment the list lacks (`gapCount`), whatever changed meanwhile. Other outcomes (nothing could be
 * changed, a day nothing on the list fits, a failure) stay beside the warning they explain.
 */
export function replanLine(replan: TodayReplan | null, gapCount: number): string {
  if (!replan || replan.busy) return "";
  return replan.fitted && gapCount > 0 ? "" : replan.note;
}

/**
 * Whether saving `next` changes the list a programme's days were planned with (`before`, the list in use until now,
 * a starting list included). A list left unsaved (null) changes nothing. The setup sheet re-plans only then (bug 17).
 */
export function listChanged(before: readonly string[], next: readonly string[] | null | undefined): boolean {
  return next != null && sortEquipmentKeys(before).join(",") !== sortEquipmentKeys(next).join(",");
}
