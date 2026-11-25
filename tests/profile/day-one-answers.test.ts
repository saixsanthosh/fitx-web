// Profile on day one (bug 26): setup asks only the goal and daily activity, so the training and food answers a new
// member never gave read "Not set" (src/app/(dashboard)/profile/profile-answers.ts), never the column defaults.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeQueryClient } from "../support/fake-query-client.ts";
import {
  foodAnswersKnown,
  goalAnswers,
  homeEquipmentKnown,
  listAnswer,
  mealsText,
  profileHeadline,
  sessionText,
} from "@/app/(dashboard)/profile/profile-answers";
import { loadUserContext, normalizePreferences, type UserContextData } from "@/lib/domain/user-context";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "new@example.test" };

// user_preferences straight after setup, as the hunt read it from the database (db-after-my-setup-spare.txt).
const DAY_ONE_ROW = {
  workout_location: "gym", equipment: ["bodyweight"], fitness_level: "beginner", primary_goal: "weight_loss", workouts_per_week: 3,
  session_duration_minutes: 45, workout_split: "full_body", activity_level: "moderate", dietary_preferences: [], allergies: [], limitations: [],
  food_dislikes: [], food_rules: [], diet_type: null, workout_setup_at: null, nutrition_setup_at: null, height_unit: "ft_in", weight_unit: "lb",
  meals_per_day: 3, daily_water_goal_ml: 2500,
};

type Member = Pick<UserContextData, "hasPreferences" | "preferences" | "legacy" | "workoutSetupAt" | "nutritionSetupAt" | "equipmentLists">;

function member(row: Record<string, unknown>, extra: Partial<Member> = {}): Member {
  const { values, legacy } = normalizePreferences(row);
  return {
    hasPreferences: true,
    preferences: values,
    legacy,
    workoutSetupAt: typeof row.workout_setup_at === "string" ? row.workout_setup_at : null,
    nutritionSetupAt: typeof row.nutrition_setup_at === "string" ? row.nutrition_setup_at : null,
    equipmentLists: { available: true, home: { keys: [], saved: false }, gym: { keys: ["barbell"], saved: false } },
    ...extra,
  };
}

describe("a brand-new member", () => {
  const fresh = member(DAY_ONE_ROW);

  test("the header names the goal only, never the Beginner default", () => {
    assert.equal(profileHeadline(fresh), "Weight loss");
  });

  test("session length, meals a day and the lists read Not set", () => {
    assert.equal(sessionText(fresh), null);
    assert.equal(mealsText(fresh), null);
    assert.equal(foodAnswersKnown(fresh), false);
    assert.deepEqual(listAnswer([], foodAnswersKnown(fresh)), { kind: "not_set" }, "allergies and foods avoided");
    assert.deepEqual(listAnswer([], false), { kind: "not_set" }, "injuries before the Workouts setup");
    assert.equal(homeEquipmentKnown(fresh), false, "the bodyweight default names no home equipment");
  });

  test("the goal and daily activity from setup are shown", () => {
    assert.deepEqual(goalAnswers(fresh), { goal: "Weight loss", activity: "Moderately active" });
  });
});

describe("once the member has answered", () => {
  test("after the Workouts setup: experience in the header, session length and an empty injuries list as None", () => {
    const trained = member({ ...DAY_ONE_ROW, workout_setup_at: "2026-11-25T19:30:00Z" });
    assert.equal(profileHeadline(trained), "Weight loss · Beginner");
    assert.equal(sessionText(trained), "45 min · Full body");
    assert.deepEqual(listAnswer([], true), { kind: "none" });
  });

  test("a saved equipment list counts as the Workouts setup (before its migration) and as known home equipment", () => {
    const listed = member(DAY_ONE_ROW, { equipmentLists: { available: true, home: { keys: [], saved: true }, gym: { keys: [], saved: false } } });
    assert.equal(profileHeadline(listed), "Weight loss · Beginner");
    assert.equal(homeEquipmentKnown(listed), true, "a saved empty list means no equipment");
  });

  test("the first onboarding's equipment answer counts as known home equipment", () => {
    assert.equal(homeEquipmentKnown(member(DAY_ONE_ROW, { equipmentLists: { available: false, home: { keys: ["dumbbell"], saved: false }, gym: { keys: [], saved: false } } })), true);
  });

  test("after the Workouts setup, a gym member was never asked about home equipment: still Not set", () => {
    const gym = member({ ...DAY_ONE_ROW, workout_setup_at: "2026-11-25T19:30:00Z" });
    assert.equal(homeEquipmentKnown(gym), false);
  });

  test("after the Nutrition setup (or with a diet saved): meals a day and None for empty lists", () => {
    const stamped = member({ ...DAY_ONE_ROW, nutrition_setup_at: "2026-11-25T19:40:00Z", meals_per_day: 5 });
    assert.equal(foodAnswersKnown(stamped), true);
    assert.equal(mealsText(stamped), "5+");
    const dieted = member({ ...DAY_ONE_ROW, diet_type: "vegetarian", meals_per_day: 4 });
    assert.equal(foodAnswersKnown(dieted), true, "a stored diet means the setup is done, as Nutrition decides");
    assert.equal(mealsText(dieted), "4");
    const legacy = member({ ...DAY_ONE_ROW, dietary_preferences: ["Vegetarian"] });
    assert.equal(foodAnswersKnown(legacy), true, "the first onboarding's diet label counts too");
  });

  test("a list with entries is always shown, asked or not", () => {
    assert.deepEqual(listAnswer(["Peanuts"], false), { kind: "items", items: ["Peanuts"] });
  });

  test("with no preferences row at all, the goal and activity are Not set too", () => {
    const none = member({}, { hasPreferences: false });
    assert.deepEqual(goalAnswers(none), { goal: null, activity: null });
    assert.equal(profileHeadline(none), "");
  });
});

describe("the shared context reads when the Nutrition setup was answered", () => {
  let fake: FakeQueryClient;
  const client = () => fake as unknown as SupabaseClient;
  beforeEach(() => {
    fake = new FakeQueryClient();
    fake.tables = {
      profiles: [{ id: USER.id, name: "Kiran", onboarded: true }],
      user_preferences: [{ user_id: USER.id, ...DAY_ONE_ROW, nutrition_setup_at: "2026-11-25T19:40:00Z" }],
      body_metrics: [],
    };
  });

  test("nutrition_setup_at is loaded", async () => {
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    assert.equal(data!.nutritionSetupAt, "2026-11-25T19:40:00Z");
    assert.equal(foodAnswersKnown(data!), true);
  });

  test("before 20261123100040 adds the column, everything else still loads and a stored diet decides", async () => {
    fake.missingColumns.user_preferences = ["nutrition_setup_at"];
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    assert.equal(data!.nutritionSetupAt, null);
    assert.equal(data!.workoutSetupAt, null, "the Workouts setup time is still read");
    assert.deepEqual(data!.schema, { preferencesV2: true, onboardingV3: true });
    assert.equal(foodAnswersKnown(data!), false, "no diet stored, so not answered yet");
  });
});

describe("a member who finished the first onboarding, before equipment lists existed (review home-4)", () => {
  // That onboarding asked "What equipment can you use?" with a Bodyweight choice and stored ["bodyweight"] for no
  // equipment; migration 20261123100020 counted everyone who had finished onboarding as set up. No list was saved.
  let fake: FakeQueryClient;
  const client = () => fake as unknown as SupabaseClient;
  beforeEach(() => {
    fake = new FakeQueryClient();
    fake.tables = {
      profiles: [{ id: USER.id, name: "Meera", onboarded: true }],
      user_preferences: [{ user_id: USER.id, ...DAY_ONE_ROW, workout_location: "home", equipment: ["bodyweight"], workout_setup_at: "2026-11-23T10:00:00Z" }],
      body_metrics: [],
      user_equipment_profiles: [],
    };
  });

  test("their Bodyweight answer reads No equipment, not Not set", async () => {
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    assert.deepEqual(data!.equipmentLists.home, { keys: [], saved: false }, "no saved list, and bodyweight names no equipment");
    assert.equal(homeEquipmentKnown(data!), true);
    assert.deepEqual(listAnswer(data!.equipmentLists.home.keys, homeEquipmentKnown(data!)), { kind: "none" }, "ChipList's No equipment");
  });

  test("the same when they train at both or outdoors; at a gym nothing asked about home equipment", async () => {
    for (const [place, known] of [["both", true], ["outdoor", true], ["gym", false]] as const) {
      fake.tables.user_preferences[0].workout_location = place;
      const { data } = await loadUserContext(client(), USER);
      assert.equal(homeEquipmentKnown(data!), known, place);
    }
  });
});

describe("Profile uses the rules", () => {
  const read = (file: string) => readFileSync(new URL(`../../src/app/(dashboard)/profile/${file}`, import.meta.url), "utf8");
  const sections = read("ProfileSections.tsx");

  test("no default is printed as an answer", () => {
    assert.match(read("ProfileView.tsx"), /const headline = profileHeadline\(data\);/);
    assert.match(sections, /<Detail label="Session length">\{sessionText\(data\) \?\? <NotSet \/>\}<\/Detail>/);
    assert.match(sections, /<Detail label="Meals a day">\{mealsText\(data\) \?\? <NotSet \/>\}<\/Detail>/);
    assert.match(sections, /<ChipList items=\{labelsFor\(ALLERGY_OPTIONS, prefs\.allergies\)\} known=\{foodKnown\} \/>/);
    assert.match(sections, /<ChipList items=\{prefs\.food_dislikes\} known=\{foodKnown\} \/>/);
    assert.match(sections, /<ChipList items=\{labelsFor\(LIMITATION_OPTIONS, prefs\.limitations\)\} known=\{trainingAnswersKnown\(data\)\} \/>/);
    assert.match(sections, /empty="No equipment" known=\{homeEquipmentKnown\(data\)\} \/>/);
  });
});
