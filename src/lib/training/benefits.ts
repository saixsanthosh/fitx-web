/**
 * An exercise's benefits (phase 12), stated only from what the catalogue records about it: its category, main and
 * assisting muscles, mechanic, equipment and whether it is timed. Nothing is claimed that those fields do not
 * say (no calories, no medical promises), so every line holds for every exercise it is shown on.
 */
import type { CatalogExercise } from "./catalog";
import { listWords, muscleWords } from "./exercise-guide";
import { equipmentLabel } from "./equipment";
import { EQUIPMENT } from "./taxonomy";

export const MAX_BENEFITS = 4;
const HOME_FRIENDLY = new Set(EQUIPMENT.filter((item) => item.homeFriendly).map((item) => item.key));
const VAGUE = new Set(["cardio", "full body", "full_body", "body"]);

type BenefitInput = Pick<CatalogExercise, "category" | "primary_muscle" | "secondary_muscles" | "mechanic" | "required_equipment" | "prescription_type">;

function named(value: string): string | null {
  const word = muscleWords(value);
  return word && !VAGUE.has(word) ? word : null;
}

export function exerciseBenefits(exercise: BenefitInput): string[] {
  const main = named(exercise.primary_muscle);
  const assisting = [...new Set(exercise.secondary_muscles.map(named).filter((word): word is string => Boolean(word) && word !== main))];
  const lines: string[] = [];
  switch (exercise.category) {
    case "cardio": lines.push("Raises your heart rate for conditioning"); break;
    case "stretching": lines.push(main ? `Stretches your ${main}` : "Improves how far you can move"); break;
    case "plyometrics": lines.push(main ? `Trains explosive power in your ${main}` : "Trains explosive power"); break;
    case "olympic": lines.push("Trains whole-body power and speed"); break;
    case "strongman": lines.push("Builds whole-body strength"); break;
    default: lines.push(main ? `Builds strength in your ${main}` : "Builds strength");
  }
  if (assisting.length && exercise.category !== "stretching") {
    const shown = assisting.length > 3 ? [...assisting.slice(0, 3), `${assisting.length - 3} more`] : assisting;
    lines.push(`Also works your ${listWords(shown)}`);
  }
  if (exercise.mechanic === "compound") lines.push("Works several joints at once, so each set trains more muscle");
  else if (exercise.mechanic === "isolation") lines.push("Targets one muscle directly, good for weak points");
  const equipment = exercise.required_equipment;
  if (!equipment.length) lines.push("Needs no equipment, so you can do it anywhere");
  else if (equipment.every((key) => HOME_FRIENDLY.has(key))) lines.push(`Can be done at home with ${listWords(equipment.map((key) => equipmentLabel(key).toLowerCase()))}`);
  if (exercise.prescription_type === "time" && exercise.category !== "cardio") lines.push("Timed, so it is easy to progress by adding seconds");
  return lines.slice(0, MAX_BENEFITS);
}
