// Release 3 fix round 3c (open item from round 3a, nutrition's bug 4 follow-up): Progress's Daily protein goal read
// "0 of 120 g · 120 g to go" for a day whose foods all lack a protein value, because fitx_goal_progress adds up the
// known values with coalesce(sum(m.protein), 0). Without a migration (D1), the app works it out from the period's food
// entries: when none of them gives the value the total is unknown, said in Nutrition's words; when only some lack it,
// the sum shows with how many foods are left out. A period with nothing logged keeps its true 0. Calorie goals had the
// same mistake (a limit "within limit" with "1,900 kcal left") and get the same rule.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGoals } from "@/lib/data/goals";
import { evaluateView, foodValueNote, foodValueUnknown, parseGoalRow, progressSummary, progressText, remainingLabel, withFoodCheck, type GoalView } from "@/lib/domain/goals";

const USER = "user-1";
const DAY = "2026-11-25"; // a Wednesday
const goalRow = (overrides: Record<string, unknown>) => ({
  id: "g-protein", title: "Eat 120 g of protein a day", category: "nutrition", metric: "protein_g", period: "daily", direction: "increase",
  target_value: 120, unit: "g", starts_on: "2026-11-01", status: "active", created_at: "2026-11-01T00:00:00Z", current_value: 0,
  period_start: DAY, period_end: DAY, ...overrides,
});
const meal = (date: string, values: { calories?: number | null; protein?: number | null }, missing: string[] = []) => ({ date, calories: 300, protein: 20, ...values, missing });

/** A stand-in database: fitx_goal_progress answers `goals`, and the meals table answers `meals` (or fails). */
function db(goals: Record<string, unknown>[], meals: unknown[] | "fails") {
  const answer = (table: string) => {
    if (table !== "meals") return { data: [], error: null };
    return meals === "fails" ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: meals, error: null };
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_target, property) {
        if (property === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve(answer(table)).then(resolve);
        return () => builder;
      },
    });
    return builder;
  };
  return { rpc: async () => ({ data: goals, error: null }), from } as unknown as SupabaseClient;
}

async function load(goals: Record<string, unknown>[], meals: unknown[] | "fails"): Promise<GoalView[]> {
  return (await loadGoals(db(goals, meals), USER, DAY, "Asia/Kolkata")).goals;
}

/** What the goal's row on Progress says: its summary, what is left, the note under it, and the bar's words. */
function row(goal: GoalView) {
  const evaluation = evaluateView(goal);
  const left = remainingLabel(goal, evaluation);
  return { summary: progressSummary(goal), left, note: foodValueNote(goal), bar: progressText(goal, evaluation, left), done: evaluation.achieved };
}

describe("a protein goal whose food has no protein value", () => {
  test("the day's only food lacks protein: unknown, never 0 of 120 g", async () => {
    const [goal] = await load([goalRow({ current_value: 0 })], [meal(DAY, { protein: null }, ["protein"])]);
    assert.equal(goal.currentValue, null);
    assert.equal(foodValueUnknown(goal), true);
    assert.deepEqual(row(goal), {
      summary: "Target 120 g", left: "", note: "Unknown: the food logged has no protein value.",
      bar: "Target 120 g. Unknown: the food logged has no protein value.", done: false,
    });
    for (const text of Object.values(row(goal))) assert.doesNotMatch(String(text), /\b0\b/, "no 0 anywhere");
  });

  test("several foods, none with protein: Nutrition's other sentence", async () => {
    const [goal] = await load([goalRow({})], [meal(DAY, { protein: null }, ["protein"]), meal(DAY, { protein: 0 }, ["protein", "carbs"])]);
    assert.equal(row(goal).note, "Unknown: none of the foods logged has a protein value.");
    assert.equal(goal.currentValue, null);
  });

  test("some foods lack protein: the sum, with how many are left out", async () => {
    const [one] = await load([goalRow({ current_value: 70 })], [meal(DAY, { protein: 70 }), meal(DAY, { protein: null }, ["protein"])]);
    assert.deepEqual(row(one), { summary: "70 of 120 g", left: "50 g to go", note: "1 food without protein is left out.", bar: "70 of 120 g, 50 g to go", done: false });
    const [three] = await load([goalRow({ current_value: 40 })], [meal(DAY, { protein: 20 }), meal(DAY, { protein: 20 }), ...[1, 2, 3].map(() => meal(DAY, { protein: null }, ["protein"]))]);
    assert.equal(row(three).note, "3 foods without protein are left out.");
  });

  test("nothing logged yet is a true 0; food with protein reads as before", async () => {
    const [empty] = await load([goalRow({ current_value: 0 })], []);
    assert.deepEqual(row(empty), { summary: "0 of 120 g", left: "120 g to go", note: null, bar: "0 of 120 g, 120 g to go", done: false });
    const [known] = await load([goalRow({ current_value: 125 })], [meal(DAY, { protein: 125 })]);
    assert.deepEqual([row(known).summary, row(known).left, row(known).note, row(known).done], ["125 of 120 g", "Done today", null, true]);
  });

  test("a weekly goal counts the week's food only", async () => {
    const weekly = goalRow({ id: "g-week", title: "Eat 700 g of protein a week", period: "weekly", target_value: 700, period_start: "2026-11-23", period_end: "2026-11-29" });
    // Last week's food had protein; this week's doesn't.
    const [goal] = await load([weekly], [meal("2026-11-22", { protein: 90 }), meal("2026-11-24", { protein: null }, ["protein"]), meal(DAY, { protein: null }, ["protein"])]);
    assert.equal(goal.foodEntries, 2);
    assert.equal(row(goal).note, "Unknown: none of the foods logged has a protein value.");
  });

  test("the food couldn't be read: the goal keeps the database's total and says nothing it can't know", async () => {
    const [goal] = await load([goalRow({ current_value: 70 })], "fails");
    assert.deepEqual([goal.currentValue, goal.missingEntries, row(goal).note], [70, null, null]);
  });
});

test("a calorie limit whose food has no calorie value is not 'within the limit'", async () => {
  const limit = goalRow({ id: "g-kcal", title: "Stay under 1,900 kcal a day", metric: "calories_kcal", direction: "limit", target_value: 1900, unit: "kcal" });
  const [goal] = await load([limit], [meal(DAY, { calories: null }, ["calories"])]);
  assert.deepEqual(row(goal), {
    summary: "Target 1,900 kcal", left: "", note: "Unknown: the food logged has no calorie value.",
    bar: "Target 1,900 kcal. Unknown: the food logged has no calorie value.", done: false,
  });
  const [partial] = await load([limit], [meal(DAY, { calories: 500 }), meal(DAY, { calories: null }, ["calories"])]);
  assert.equal(row(partial).note, "1 food without calories is left out.");
});

test("withFoodCheck leaves other goals alone; an unmeasured goal's bar never reads 0%", () => {
  const water = parseGoalRow(goalRow({ metric: "water_ml", unit: "ml", target_value: 2500, current_value: 0 }));
  assert.equal(withFoodCheck(water, 2, 2), water);
  const distance = { ...parseGoalRow(goalRow({ metric: "manual", unit: "km (activities)", target_value: 20 })), currentValue: null };
  assert.equal(distance.metric, "activity_distance_km");
  assert.equal(progressText(distance), "Target 20 km", "activities that couldn't be read: no \"0%\"");
});

test("Progress's goal row shows the note and the bar's words from these rules", () => {
  const panel = readFileSync("src/components/home/GoalsPanel.tsx", "utf8");
  assert.match(panel, /const food = foodValueNote\(goal\);/);
  assert.match(panel, /\{food \? <p className=\{styles\.missing\}>\{food\}<\/p> : null\}/);
  assert.match(panel, /aria-valuetext=\{progressText\(goal, evaluation, left\)\}/);
  assert.doesNotMatch(panel, /value, not counted/, "the old wording is gone");
  const data = readFileSync("src/lib/data/goals.ts", "utf8");
  assert.match(data, /return withFoodCheck\(goal, logged\.length, logged\.filter\(\(row\) => macroValue\(row, key\) === null\)\.length\);/);
});
