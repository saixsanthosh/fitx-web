import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeQueryClient } from "../support/fake-query-client.ts";
import {
  NUTRITION_SETUP_COLUMN, addTag, firstSetupProblem, initialSetupAnswers, loadSetupState, saveSetup, setupDone, setupPatch, snoozed,
  type NutritionSetupAnswers,
} from "@/lib/food/setup";

const USER = "11111111-1111-4111-8111-111111111111";
const db = (client: FakeQueryClient) => client as unknown as SupabaseClient;
const answers = (change: Partial<NutritionSetupAnswers> = {}): NutritionSetupAnswers => ({
  ...initialSetupAnswers(null), diet: "vegetarian", ...change,
});

test("setup is done once its time is set or a diet is stored, never otherwise", () => {
  assert.equal(setupDone(null), false);
  assert.equal(setupDone({}), false);
  assert.equal(setupDone({ diet_type: null, nutrition_setup_at: null }), false);
  assert.equal(setupDone({ nutrition_setup_at: "2026-11-23T10:00:00Z" }), true);
  assert.equal(setupDone({ diet_type: "vegan" }), true, "the old onboarding required a diet, so it counts");
  assert.equal(setupDone({ dietary_preferences: ["Vegetarian"] }), true, "the first onboarding's label counts too");
  assert.equal(setupDone({ diet_type: "keto" }), false, "an unknown word is not an answer");
});

test("answers start from what is stored, and only the diet is required", () => {
  const start = initialSetupAnswers({
    diet_type: null, allergies: ["peanuts", "kiwi"], food_rules: ["jain"], food_dislikes: ["okra"], meals_per_day: 6,
    food_source: "home", nutrition_focus: "high_protein",
  });
  assert.deepEqual(start.allergies, ["peanuts"]);
  assert.deepEqual(start.customAllergies, ["kiwi"]);
  assert.equal(start.meals, 5, "six meals shows as 5+");
  assert.equal(firstSetupProblem(start)?.step, "diet");
  assert.equal(firstSetupProblem({ ...start, diet: "eggetarian" }), null);
  assert.equal(firstSetupProblem({ ...start, diet: "eggetarian", meals: 9 })?.step, "routine");
});

test("the patch keeps the old diet label in step and writes the time only when given", () => {
  const patch = setupPatch(answers({ allergies: ["dairy"], customAllergies: ["kiwi"], foodRules: ["no_onion_garlic"], dislikes: ["okra"], meals: 4, foodSource: "both", nutritionFocus: "balanced" }), { legacyDiet: ["Non-vegetarian", "Halal"] });
  assert.deepEqual(patch.dietary_preferences, ["Vegetarian", "Halal"]);
  assert.equal(patch.diet_type, "vegetarian");
  assert.deepEqual(patch.allergies, ["dairy", "kiwi"]);
  assert.equal(patch.meals_per_day, 4);
  assert.equal(NUTRITION_SETUP_COLUMN in patch, false);
  assert.equal(setupPatch(answers(), { at: "2026-11-23T10:00:00.000Z" })[NUTRITION_SETUP_COLUMN], "2026-11-23T10:00:00.000Z");
  assert.deepEqual(addTag(["okra"], "  Bitter gourd ", "dislike"), ["okra", "Bitter gourd"]);
});

test("loading reads the time where the column exists and falls back to the diet before the migration", async () => {
  const client = new FakeQueryClient();
  client.tables.user_preferences = [{ user_id: USER, diet_type: null, dietary_preferences: [], nutrition_setup_at: "2026-11-23T09:00:00Z" }];
  assert.deepEqual(await loadSetupState(db(client), USER), { done: true, setupAt: "2026-11-23T09:00:00Z", stamped: true });

  const before = new FakeQueryClient();
  before.missingColumns.user_preferences = [NUTRITION_SETUP_COLUMN];
  before.tables.user_preferences = [{ user_id: USER, diet_type: null, dietary_preferences: [] }];
  assert.deepEqual(await loadSetupState(db(before), USER), { done: false, setupAt: null, stamped: false });
  before.tables.user_preferences[0].diet_type = "vegan";
  assert.equal((await loadSetupState(db(before), USER)).done, true);

  const none = new FakeQueryClient();
  none.tables.user_preferences = [];
  assert.equal((await loadSetupState(db(none), USER)).done, false, "no preferences row: not answered yet");
});

test("saving stamps the time, and saves the answers without it before the migration", async () => {
  const schema = { preferencesV2: true, onboardingV3: true };
  const now = new Date("2026-11-23T10:00:00Z");
  const client = new FakeQueryClient();
  client.tables.user_preferences = [{ user_id: USER }];
  const saved = await saveSetup(db(client), USER, answers({ nutritionFocus: "high_protein" }), { schema, now });
  assert.equal(saved.error, null);
  assert.equal(saved.stamped, true);
  const upsert = client.calls.filter((call) => call.op === "upsert").at(-1)?.payload as Record<string, unknown>;
  assert.equal(upsert[NUTRITION_SETUP_COLUMN], now.toISOString());
  assert.equal(upsert.nutrition_focus, "high_protein");

  const before = new FakeQueryClient();
  before.missingColumns.user_preferences = [NUTRITION_SETUP_COLUMN];
  before.tables.user_preferences = [{ user_id: USER }];
  const fallback = await saveSetup(db(before), USER, answers(), { schema, now });
  assert.equal(fallback.error, null);
  assert.equal(fallback.stamped, false);
  const last = before.calls.filter((call) => call.op === "upsert").at(-1)?.payload as Record<string, unknown>;
  assert.equal(NUTRITION_SETUP_COLUMN in last, false);
  assert.equal(last.diet_type, "vegetarian", "the stored diet then marks setup as done");
});

test("Later holds on this device for three days", () => {
  assert.equal(snoozed(null, "2026-11-23"), false);
  assert.equal(snoozed("2026-11-23", "2026-11-23"), true);
  assert.equal(snoozed("2026-11-21", "2026-11-23"), true);
  assert.equal(snoozed("2026-11-20", "2026-11-23"), false);
  assert.equal(snoozed("2026-11-24", "2026-11-23"), false, "a date in the future is ignored");
});

test("the migration adds the column, backfills from the diet and is safe to re-run", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261123100040_fitx_nutrition_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists nutrition_setup_at timestamptz;/);
  assert.match(sql, /where nutrition_setup_at is null\s+and diet_type is not null/);
  assert.doesNotMatch(sql, /\bdrop\b|\bdefault\b\s+now/i);
});

test("Nutrition asks once, honours Later, offers the edit, and sends the water goal to Progress", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/nutrition/page.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../../src/components/nutrition/NutritionSetup.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!state\.done && !snoozed\(readSnooze\(uid\), localDateKey\(\)\)\) setSetup\(\{ open: true, mode: "first" \}\)/);
  assert.match(page, /writeSnooze\(userId, localDateKey\(\)\)/, "Later is remembered on this device");
  assert.match(page, /writeSnooze\(userId, null\)/, "saving clears it");
  assert.match(page, />Food preferences</);
  assert.match(page, /"\/progress\?panel=goals&new=water_day"/);
  assert.doesNotMatch(page, /homePanel\(/);
  assert.match(sheet, /mode === "first"\s*\n?\s*\? <button type="button" className=\{styles\.back\} onClick=\{onLater\}>Later<\/button>/);
});
