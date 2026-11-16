import type { NutritionTargets } from "./nutrition";

const kcal = (value: number) => Math.round(value).toLocaleString("en-IN");
const kg = (value: number) => Math.abs(value).toFixed(1);

/**
 * One sentence on how the daily calorie target was set, shared by Profile and onboarding so the two
 * never explain the same number differently. It always describes the number actually shown.
 */
export function targetReason(targets: NutritionTargets): string {
  if (targets.youthMaintenance) return "Under 18, FITX keeps you at maintenance rather than setting a calorie deficit.";
  if (targets.maintenanceBelowFloor) {
    return "Your maintenance is already under FITX’s safe minimum for a calorie deficit, so your target stays at maintenance and no weekly loss is planned. Ask a doctor or dietitian before eating less.";
  }
  if (targets.floorApplied) {
    return `Kept at FITX’s safe minimum of ${kcal(targets.floorApplied)} kcal a day: about ${kcal(-targets.adjustment)} kcal under maintenance, roughly ${kg(targets.weeklyChangeKg)} kg a week.`;
  }
  if (targets.rule === "deficit") return `About ${kcal(-targets.adjustment)} kcal under maintenance, roughly ${kg(targets.weeklyChangeKg)} kg a week.`;
  if (targets.rule === "surplus") return `About ${kcal(targets.adjustment)} kcal over maintenance, roughly ${kg(targets.weeklyChangeKg)} kg a week.`;
  return "Set at maintenance, to keep your weight steady.";
}
