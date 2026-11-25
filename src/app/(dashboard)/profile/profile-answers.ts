/**
 * What Profile may show as the member's own answers (bug 26).
 *
 * Setup asks only the goal and daily activity. The Workouts setup asks experience, where the member trains, days a
 * week, equipment and injuries; the Nutrition setup asks the diet, meals a day, allergies and foods avoided. Until
 * those are done, user_preferences holds only its column defaults (beginner, 45 min full body, 3 meals a day, no
 * allergies, no injuries), so Profile reads "Not set" for them and leaves them out of the header: a default is never
 * shown as if the member had chosen it. An empty list only reads "None" once the member has been asked.
 *
 * No React here, so node tests cover it (tests/profile/day-one-answers.test.ts).
 */
import { EXPERIENCE_OPTIONS, GOAL_OPTIONS, ACTIVITY_OPTIONS, SPLIT_OPTIONS, optionLabel } from "@/lib/domain/profile-options";
import { trainingAnswersKnown, type UserContextData } from "@/lib/domain/user-context";
import { setupDone } from "@/lib/food/setup";

type TrainingData = Pick<UserContextData, "workoutSetupAt" | "equipmentLists" | "preferences">;
type FoodData = Pick<UserContextData, "nutritionSetupAt" | "preferences" | "legacy">;

/** The Nutrition setup's answers are the member's own: the same rule Nutrition uses to stop asking (setupDone). */
export function foodAnswersKnown(data: FoodData): boolean {
  return setupDone({ nutrition_setup_at: data.nutritionSetupAt, diet_type: data.preferences.diet_type, dietary_preferences: data.legacy.dietaryPreferences });
}

/** The goal and daily activity from setup; null (Not set) while no preferences row exists, when both are defaults. */
export function goalAnswers(data: Pick<UserContextData, "hasPreferences" | "preferences">): { goal: string | null; activity: string | null } {
  if (!data.hasPreferences) return { goal: null, activity: null };
  return { goal: optionLabel(GOAL_OPTIONS, data.preferences.primary_goal), activity: optionLabel(ACTIVITY_OPTIONS, data.preferences.activity_level) };
}

/** The line under the member's name: their goal, then their experience once the Workouts setup has asked it. */
export function profileHeadline(data: TrainingData & Pick<UserContextData, "hasPreferences">): string {
  const experience = trainingAnswersKnown(data) ? optionLabel(EXPERIENCE_OPTIONS, data.preferences.fitness_level) : null;
  return [goalAnswers(data).goal, experience].filter(Boolean).join(" · ");
}

/** "45 min · Full body" once the training answers are the member's own; null (Not set) before. */
export function sessionText(data: TrainingData): string | null {
  if (!trainingAnswersKnown(data)) return null;
  return [`${data.preferences.session_duration_minutes} min`, optionLabel(SPLIT_OPTIONS, data.preferences.workout_split)].filter(Boolean).join(" · ");
}

/** Meals a day ("5+" for five or more) once the Nutrition setup is done; null (Not set) before. */
export function mealsText(data: FoodData): string | null {
  if (!foodAnswersKnown(data)) return null;
  return data.preferences.meals_per_day === 5 ? "5+" : String(data.preferences.meals_per_day);
}

/** Home equipment is the member's own once the Home list is saved, or when their first answer named some. */
export function homeEquipmentKnown(lists: UserContextData["equipmentLists"]): boolean {
  return lists.home.saved || lists.home.keys.length > 0;
}

export type ListAnswer = { kind: "items"; items: string[] } | { kind: "none" } | { kind: "not_set" };

/** A saved list as Profile shows it: its items; "None" once the member was asked; else "Not set". */
export function listAnswer(items: readonly string[], known: boolean): ListAnswer {
  if (items.length) return { kind: "items", items: [...items] };
  return known ? { kind: "none" } : { kind: "not_set" };
}
