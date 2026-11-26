// Review R3-DB-3: the coach's data summary turned unknown carbs and fat into 0. With #56 a member's own food can leave
// protein, carbs and fat blank (bug 4's masala chai, logged with NULL values), and Nutrition says "C unknown · F unknown"
// and "1 without carbs, 1 without fat"; the coach was sent today { carbs_g: 0, fat_g: 0 } and 0 in the 7-day averages,
// with nothing saying the values were unknown. Now every total leaves unknown values out and says how many foods lack
// each one, as Nutrition's day and History do (sumKnown, buildHistory), and a value no food has is never sent at all.
import "./support/hooks.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { buildCoachContext, localDate, UNKNOWN_FOOD_VALUES_NOTE } = await import("@/lib/ai/context");
const { chatSystemPrompt } = await import("@/lib/ai/prompts");

const NOW = new Date("2026-11-16T18:30:00Z"); // 00:00 on 17 November in India
const TODAY = localDate(NOW, "Asia/Kolkata");
const DAY_BEFORE = "2026-11-16";
const TWO_DAYS_BEFORE = "2026-11-15";

type Meal = { date: string; meal: string; food_name: string; calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
const chai = (date: string): Meal => ({ date, meal: "Snack", food_name: "Masala chai (home)", calories: 90, protein: null, carbs: null, fat: null });
const idli = (date: string): Meal => ({ date, meal: "Breakfast", food_name: "Idli", calories: 300, protein: 12, carbs: 55, fat: 3 });

function nutritionOf(meals: Meal[]) {
  const sources = {
    profile: { age: 29, gender: "female", height: 162, weight: 58 },
    preferences: { timezone: "Asia/Kolkata", primary_goal: "maintenance", activity_level: "moderate" },
    weighIns: [], meals, customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [],
  };
  const { summary } = buildCoachContext(sources as never, NOW);
  return summary.nutrition as Record<string, unknown> & { today: Record<string, unknown>; by_day: Array<Record<string, unknown>>; average_per_logged_day: Record<string, unknown> | null };
}

describe("unknown food values in the coach's summary (review R3-DB-3)", () => {
  test("a day whose only food has no protein, carbs or fat sends no 0 g: the values are left out and counted", () => {
    assert.equal(TODAY, "2026-11-17");
    const nutrition = nutritionOf([chai(TODAY)]);
    assert.deepEqual(nutrition.today, { kcal: 90, items_logged: 1, foods_without_protein: 1, foods_without_carbs: 1, foods_without_fat: 1 });
    assert.deepEqual(nutrition.average_per_logged_day, { calories: 90 }, "no protein, carbs or fat average: no day has one");
    assert.deepEqual(nutrition.by_day, [{ date: TODAY, kcal: 90, foods_without_protein: 1 }]);
    assert.equal(nutrition.foods_without_protein, 1);
    assert.equal(nutrition.foods_without_carbs, 1);
    assert.equal(nutrition.foods_without_fat, 1);
    assert.equal(nutrition.foods_without_calories, undefined);
    assert.equal(nutrition.unknown_values, UNKNOWN_FOOD_VALUES_NOTE, "the summary says how to read the totals");
    assert.doesNotMatch(JSON.stringify(nutrition), /"(protein_g|carbs_g|fat_g|protein|carbs|fat)":0\b/, "never 0 for unknown");
  });

  test("on a day with known and unknown values, the known ones are added up and the foods without them counted", () => {
    const nutrition = nutritionOf([chai(TODAY), idli(TODAY)]);
    assert.deepEqual(nutrition.today, {
      kcal: 390, protein_g: 12, carbs_g: 55, fat_g: 3, items_logged: 2,
      foods_without_protein: 1, foods_without_carbs: 1, foods_without_fat: 1,
    });
    assert.deepEqual(nutrition.by_day, [{ date: TODAY, kcal: 390, protein_g: 12, foods_without_protein: 1 }]);
  });

  test("an average counts only the logged days with a value for it, as Nutrition's History does", () => {
    // Fat known on two days (3 g and 21 g); the third day has only the chai, with no fat value: average 12 g, not 8 g.
    const fatty = { ...idli(DAY_BEFORE), fat: 21 };
    const nutrition = nutritionOf([idli(TWO_DAYS_BEFORE), fatty, chai(TODAY)]);
    assert.equal(nutrition.days_logged_last_7, 3);
    assert.deepEqual(nutrition.average_per_logged_day, { calories: 230, protein: 12, carbs: 55, fat: 12 });
    assert.deepEqual(nutrition.by_day.map((day) => day.protein_g ?? null), [12, 12, null], "a day without any protein value has no protein_g");
  });

  test("a food without a calorie value is left out of the calories in the same way", () => {
    const nutrition = nutritionOf([{ ...idli(TODAY), calories: null }]);
    assert.deepEqual(nutrition.today, { protein_g: 12, carbs_g: 55, fat_g: 3, items_logged: 1, foods_without_calories: 1 });
    assert.deepEqual(nutrition.by_day, [{ date: TODAY, protein_g: 12, foods_without_calories: 1 }]);
    assert.deepEqual(nutrition.average_per_logged_day, { protein: 12, carbs: 55, fat: 3 });
    assert.equal(nutrition.foods_without_calories, 1);
  });

  test("with every value known, nothing extra is sent", () => {
    const nutrition = nutritionOf([idli(TWO_DAYS_BEFORE), idli(TODAY)]);
    assert.deepEqual(nutrition.today, { kcal: 300, protein_g: 12, carbs_g: 55, fat_g: 3, items_logged: 1 });
    assert.deepEqual(nutrition.average_per_logged_day, { calories: 300, protein: 12, carbs: 55, fat: 3 });
    for (const key of Object.keys(nutrition)) assert.doesNotMatch(key, /^foods_without_|^unknown_values$/, key);
    assert.deepEqual(nutritionOf([]).today, { items_logged: 0 }, "nothing logged today is not 0 kcal");
  });

  test("the chat prompt carries the counts and the note, and the note has no characters the data block escapes", () => {
    const sources = {
      profile: { age: 29, gender: "female", height: 162, weight: 58 },
      preferences: { timezone: "Asia/Kolkata" },
      weighIns: [], meals: [chai(TODAY)], customFoods: [], sessions: [], recentMuscles: [], records: [], goals: [], planner: [],
    };
    const context = buildCoachContext(sources as never, NOW);
    const prompt = chatSystemPrompt({ context, facts: context.facts, sharesData: true });
    assert.match(prompt, /"foods_without_fat":1/);
    assert.ok(prompt.includes(UNKNOWN_FOOD_VALUES_NOTE), "sent as written");
    assert.doesNotMatch(UNKNOWN_FOOD_VALUES_NOTE, /[<>"\\]/);
    assert.doesNotMatch(prompt, /"fat_g":0\b|"carbs_g":0\b/);
  });
});
