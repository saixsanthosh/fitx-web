// Profile > Food saved before the Nutrition setup (bug 26; review home-3). Meals a day saved as 4 there read "Not set"
// afterwards, and an allergies list saved empty too, because only the Nutrition setup (its time, or a stored diet)
// made the food answers count. A Profile > Food save now answers the setup, as a Profile > Training save answers the
// Workouts setup: before the setup it needs the diet, the setup's one required answer, and it records the setup as
// answered (src/app/(dashboard)/profile/profile-answers.ts, src/lib/domain/user-context.ts).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeQueryClient } from "../support/fake-query-client.ts";
import { foodAnswersKnown, foodSaveMarksSetup, foodSaveProblem, listAnswer, mealsText } from "@/app/(dashboard)/profile/profile-answers";
import { loadUserContext, markNutritionSetupAnswered, normalizePreferences, savePreferences, type UserContextData } from "@/lib/domain/user-context";
import { legacyDietaryPreferences } from "@/lib/domain/profile-options";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "new@example.test" };
// user_preferences straight after setup (the hunt's day-one row): no diet, nothing stamped, the column defaults.
const DAY_ONE_ROW = {
  workout_location: "gym", equipment: ["bodyweight"], fitness_level: "beginner", primary_goal: "weight_loss", workouts_per_week: 3,
  session_duration_minutes: 45, workout_split: "full_body", activity_level: "moderate", dietary_preferences: [], allergies: [], limitations: [],
  food_dislikes: [], food_rules: [], diet_type: null, workout_setup_at: null, nutrition_setup_at: null, height_unit: "ft_in", weight_unit: "lb",
  meals_per_day: 3, daily_water_goal_ml: 2500,
};

type Food = Pick<UserContextData, "nutritionSetupAt" | "preferences" | "legacy">;
function food(row: Record<string, unknown>): Food {
  const { values, legacy } = normalizePreferences(row);
  return { preferences: values, legacy, nutritionSetupAt: typeof row.nutrition_setup_at === "string" ? row.nutrition_setup_at : null };
}

describe("what a Profile > Food save needs and records", () => {
  test("before the Nutrition setup, a save needs the diet, with the setup's own message", () => {
    const fresh = food(DAY_ONE_ROW);
    assert.equal(foodSaveProblem(fresh, null), "Choose the option closest to how you eat.");
    assert.equal(foodSaveProblem(fresh, "vegetarian"), null);
    assert.equal(foodSaveMarksSetup(fresh), true, "and it records the setup as answered");
  });

  test("once the setup is done, the diet may be cleared and nothing more is recorded", () => {
    const stamped = food({ ...DAY_ONE_ROW, nutrition_setup_at: "2026-11-25T19:40:00Z", diet_type: "vegan" });
    assert.equal(foodSaveProblem(stamped, null), null);
    assert.equal(foodSaveMarksSetup(stamped), false);
  });

  test("a diet stored without the setup's time: the save needs nothing more, and stamps the time", () => {
    const dieted = food({ ...DAY_ONE_ROW, diet_type: "eggetarian" });
    assert.equal(foodSaveProblem(dieted, null), null, "the answers already count (Nutrition's rule)");
    assert.equal(foodSaveMarksSetup(dieted), true, "so clearing the diet in this save doesn't hide them again");
  });
});

describe("the saved answers show afterwards", () => {
  let fake: FakeQueryClient;
  const client = () => fake as unknown as SupabaseClient;
  const schema = { v2: true, v3: true };
  beforeEach(() => {
    fake = new FakeQueryClient();
    fake.tables = {
      profiles: [{ id: USER.id, name: "Kiran", onboarded: true }],
      user_preferences: [{ user_id: USER.id, ...DAY_ONE_ROW }],
      body_metrics: [],
    };
  });

  // What FoodSection.save sends: the changed answers (with the diet the setup needs), then the setup's time.
  async function saveFood(patch: Record<string, unknown>) {
    const saved = await savePreferences(client(), USER.id, patch, schema);
    assert.equal(saved.error, null);
    const marked = await markNutritionSetupAnswered(client(), USER.id, new Date("2026-11-26T09:00:00Z"));
    assert.equal(marked.error, null);
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    return { data: data!, marked };
  }

  test("a day-one member saves Meals a day 4 with a diet: it reads 4, and an empty allergies list reads None", async () => {
    const { data, marked } = await saveFood({ meals_per_day: 4, diet_type: "vegetarian", dietary_preferences: legacyDietaryPreferences("vegetarian", []) });
    assert.deepEqual(marked, { error: null, stored: true });
    assert.equal(data.nutritionSetupAt, "2026-11-26T09:00:00.000Z");
    assert.equal(foodAnswersKnown(data), true);
    assert.equal(mealsText(data), "4");
    assert.deepEqual(listAnswer([], foodAnswersKnown(data)), { kind: "none" }, "allergies saved empty");
  });

  test("the diet cleared in a later save keeps every other answer shown", async () => {
    await saveFood({ meals_per_day: 4, diet_type: "vegetarian" });
    await savePreferences(client(), USER.id, { diet_type: null, dietary_preferences: [] }, schema);
    const { data } = await loadUserContext(client(), USER);
    assert.equal(data!.preferences.diet_type, null);
    assert.equal(mealsText(data!), "4", "the setup's time still says the member answered");
  });

  test("before migration 20261123100040 nothing is stamped, and the stored diet still makes the answers count", async () => {
    fake.missingColumns.user_preferences = ["nutrition_setup_at"];
    const { data, marked } = await saveFood({ meals_per_day: 5, diet_type: "non_vegetarian" });
    assert.deepEqual(marked, { error: null, stored: false });
    assert.equal(data.nutritionSetupAt, null);
    assert.equal(mealsText(data), "5+");
  });

  test("any other failure to record it is reported, so the form can say the save failed", async () => {
    fake.failures["user_preferences:update"] = { code: "42501", message: "permission denied" };
    const marked = await markNutritionSetupAnswered(client(), USER.id);
    assert.equal(marked.stored, false);
    assert.equal(marked.error?.code, "42501");
  });
});

describe("Profile > Food uses the rules", () => {
  const sections = readFileSync(new URL("../../src/app/(dashboard)/profile/ProfileSections.tsx", import.meta.url), "utf8");
  const save = sections.slice(sections.indexOf("export function FoodSection"), sections.indexOf("export function LimitsSection"));

  test("the diet is asked for before the first answering save, next to the field, and the setup is recorded after it", () => {
    assert.match(save, /const dietProblem = foodSaveProblem\(data, draft\.diet\);/);
    assert.match(save, /setErrors\(\{ diet: dietProblem \}\);\s*focusFirstInvalid\(formRef\.current\);/);
    assert.match(save, /if \(foodSaveMarksSetup\(data\)\) \{\s*const marked = await markNutritionSetupAnswered\(supabase, data\.userId\);/);
    assert.match(save, /legend="Diet" hint=\{foodKnown \? undefined : "Needed to save your food answers\."\}[^\n]*error=\{errors\.diet\} \/>/);
    // Nothing to save closes the form as before, without asking for the diet.
    assert.ok(save.indexOf("return void onSaved(NO_CHANGES);") < save.indexOf("const dietProblem"));
  });
});
