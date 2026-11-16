import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeQueryClient } from "../support/fake-query-client.ts";
import {
  PREFERENCE_COLUMNS_V2,
  changedFields,
  ensureProfileRow,
  loadUserContext,
  logWeighIn,
  normalizePreferences,
  savePreferences,
  updateProfileRow,
} from "@/lib/domain/user-context";
import { localDateKey } from "@/lib/domain/dates";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "me@example.test" };
let fake: FakeQueryClient;
const client = () => fake as unknown as SupabaseClient;

beforeEach(() => {
  fake = new FakeQueryClient();
  fake.tables = {
    profiles: [{ id: USER.id, name: "Asha", age: 30, gender: "female", height: 160, weight: 62, target_weight: 56, avatar: null, onboarded: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    user_preferences: [{
      user_id: USER.id, workout_location: "home", equipment: ["Dumbbells", "bands", "trampoline"], fitness_level: "beginner", primary_goal: "fat_loss",
      workouts_per_week: 4, session_duration_minutes: 45, workout_split: "full_body", activity_level: "moderate", dietary_preferences: ["Vegetarian"],
      allergies: ["Dairy", "Kiwi"], meals_per_day: 3, timezone: "Asia/Kolkata", daily_water_goal_ml: 3000,
      diet_type: null, food_rules: [], cuisines: ["south_indian"], food_dislikes: [], food_budget_level: "tight", monthly_food_budget_inr: 6000,
      limitations: ["knee"], height_unit: "ft_in", weight_unit: "kg",
    }],
    body_metrics: [
      { id: "m1", user_id: USER.id, date: "2026-11-01", weight: 61, created_at: "2026-11-01T08:00:00Z" },
      { id: "m2", user_id: USER.id, date: "2026-11-10", weight: 60, created_at: "2026-11-10T08:00:00Z" },
      { id: "m3", user_id: USER.id, date: "2026-11-10", weight: 59.5, created_at: "2026-11-10T20:00:00Z" },
      { id: "m4", user_id: USER.id, date: "2026-11-12", weight: null, created_at: "2026-11-12T08:00:00Z" },
      { id: "x1", user_id: "someone-else", date: "2026-11-15", weight: 90, created_at: "2026-11-15T08:00:00Z" },
    ],
  };
});

describe("loading", () => {
  test("uses the newest weigh-in (same-day ties broken by time) for weight and targets", async () => {
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    assert.deepEqual(data!.latestWeighIn, { weight: 59.5, date: "2026-11-10" });
    assert.equal(data!.currentWeightKg, 59.5);
    assert.equal(data!.targets!.weightKg, 59.5);
    assert.equal(data!.schema.preferencesV2, true);
    assert.equal(data!.email, USER.email);
  });

  test("normalises stored preferences into the shared vocabulary", async () => {
    const { data } = await loadUserContext(client(), USER);
    const prefs = data!.preferences;
    // The training taxonomy's keys (what Workouts reads); "trampoline" matches no item.
    assert.deepEqual(prefs.equipment, ["dumbbell", "resistance_band"]);
    assert.deepEqual(data!.legacy.unknownEquipment, ["trampoline"]);
    assert.equal(prefs.diet_type, "vegetarian"); // from the old label, since diet_type is still empty
    assert.deepEqual(prefs.allergies, ["dairy", "Kiwi"]);
    assert.deepEqual(prefs.cuisines, ["south_indian"]);
    assert.equal(prefs.height_unit, "ft_in");
    assert.equal(prefs.monthly_food_budget_inr, 6000);
  });

  test("before the v2 migration it reads the original columns and says so", async () => {
    fake.missingColumns.user_preferences = [...PREFERENCE_COLUMNS_V2];
    for (const row of fake.tables.user_preferences) for (const column of PREFERENCE_COLUMNS_V2) delete row[column];
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    assert.equal(data!.schema.preferencesV2, false);
    assert.equal(data!.preferences.height_unit, "cm");
    assert.equal(data!.preferences.food_budget_level, null);
    const selects = fake.calls.filter((call) => call.table === "user_preferences");
    assert.equal(selects.length, 2);
    assert.ok(!selects[1].columns!.includes("diet_type"));
  });

  test("with no weigh-ins the profile weight is used; with no preferences row, defaults", async () => {
    fake.tables.body_metrics = [];
    fake.tables.user_preferences = [];
    const { data } = await loadUserContext(client(), USER);
    assert.equal(data!.currentWeightKg, 62);
    assert.equal(data!.hasPreferences, false);
    assert.equal(data!.preferences.primary_goal, "general_fitness");
    assert.deepEqual(data!.preferences.equipment, []);
  });

  test("a missing profile row is reported as null, not as an error", async () => {
    fake.tables.profiles = [];
    const { data, error } = await loadUserContext(client(), USER);
    assert.equal(error, null);
    assert.equal(data!.profile, null);
    assert.equal(data!.targets, null);
  });

  test("Home and Gym equipment: starting points until the lists exist, then the saved lists", async () => {
    // Before the equipment migration: the Home list comes from the original answer, the gym is a full gym.
    const before = (await loadUserContext(client(), USER)).data!.equipmentLists;
    assert.equal(before.available, false);
    assert.deepEqual(before.home, { keys: ["dumbbell", "resistance_band"], saved: false });
    assert.equal(before.gym.saved, false);
    assert.ok(before.gym.keys.includes("barbell") && before.gym.keys.includes("cable_machine"));

    fake.tables.user_equipment_profiles = [
      { user_id: USER.id, context: "gym", equipment_keys: ["bench", "dumbbell"] },
      { user_id: "someone-else", context: "home", equipment_keys: ["barbell"] },
    ];
    const after = (await loadUserContext(client(), USER)).data!.equipmentLists;
    assert.equal(after.available, true);
    assert.deepEqual(after.gym, { keys: ["dumbbell", "bench"], saved: true });
    assert.deepEqual(after.home, { keys: ["dumbbell", "resistance_band"], saved: false });
  });

  test("a failed equipment read fails the load rather than looking like no lists", async () => {
    fake.tables.user_equipment_profiles = [];
    fake.failures["user_equipment_profiles:select"] = { code: "08006", message: "connection failure" };
    const result = await loadUserContext(client(), USER);
    assert.equal(result.data, null);
    assert.equal(result.error!.part, "equipment");
  });

  test("a failed read names the part that failed", async () => {
    fake.failures["body_metrics:select"] = { code: "08006", message: "connection failure" };
    const result = await loadUserContext(client(), USER);
    assert.equal(result.data, null);
    assert.equal(result.error!.part, "weigh_in");
  });
});

describe("saving", () => {
  test("changedFields sends only what changed (lists compared as sets)", () => {
    const before = { name: "Asha", age: 30, equipment: ["dumbbell", "bands"], allergies: ["dairy"], target_weight: null as number | null };
    const after = { name: "Asha", age: 31, equipment: ["bands", "dumbbell"], allergies: ["dairy", "Kiwi"], target_weight: null as number | null };
    assert.deepEqual(changedFields(before, after), { age: 31, allergies: ["dairy", "Kiwi"] });
    assert.deepEqual(changedFields(before, before), {});
  });

  test("updateProfileRow recreates a missing row through fitx_ensure_profile, then saves", async () => {
    fake.tables.profiles = [];
    fake.functions.fitx_ensure_profile = () => {
      fake.tables.profiles.push({ id: USER.id, name: null });
      return { data: null, error: null };
    };
    const { error } = await updateProfileRow(client(), USER.id, { name: "Asha" });
    assert.equal(error, null);
    assert.deepEqual(fake.rpcCalls, ["fitx_ensure_profile"]);
    assert.equal(fake.tables.profiles[0].name, "Asha");
  });

  test("ensureProfileRow falls back to the old insert before the function exists", async () => {
    fake.tables.profiles = [];
    const { error } = await ensureProfileRow(client(), USER.id);
    assert.equal(error, null);
    assert.deepEqual(fake.tables.profiles, [{ id: USER.id }]);
  });

  test("savePreferences upserts only the given columns and skips v2 columns before the migration", async () => {
    const saved = await savePreferences(client(), USER.id, { primary_goal: "muscle_gain", diet_type: "both" }, { v2: true });
    assert.equal(saved.error, null);
    assert.deepEqual(saved.skipped, []);
    assert.equal(fake.tables.user_preferences[0].diet_type, "both");

    fake.missingColumns.user_preferences = [...PREFERENCE_COLUMNS_V2];
    const fallback = await savePreferences(client(), USER.id, { primary_goal: "strength", cuisines: ["continental"] }, { v2: true });
    assert.equal(fallback.error, null);
    assert.deepEqual(fallback.skipped, ["cuisines"]);
    assert.equal(fake.tables.user_preferences[0].primary_goal, "strength");
    const upserts = fake.calls.filter((call) => call.op === "upsert");
    assert.ok(!("cuisines" in (upserts.at(-1)!.payload as object)));
  });

  test("logWeighIn dates the weigh-in locally and keeps profiles.weight in step", async () => {
    const result = await logWeighIn(client(), USER.id, 58.8, "Profile update");
    assert.deepEqual(result, { error: null, synced: true });
    const added = fake.tables.body_metrics.at(-1)!;
    assert.equal(added.date, localDateKey());
    assert.equal(added.weight, 58.8);
    assert.equal(fake.tables.profiles[0].weight, 58.8);
  });

  test("injury notes up to 60 characters survive a load", () => {
    const long = "Recent knee surgery: no jumping or deep squats until March";
    assert.deepEqual(normalizePreferences({ limitations: ["knee", long] }).values.limitations, ["knee", long]);
  });

  test("normalizePreferences tolerates junk", () => {
    const { values } = normalizePreferences({ workouts_per_week: 40, session_duration_minutes: "abc", primary_goal: "bulk", monthly_food_budget_inr: 10 });
    assert.equal(values.workouts_per_week, 3);
    assert.equal(values.session_duration_minutes, 45);
    assert.equal(values.primary_goal, "general_fitness");
    assert.equal(values.monthly_food_budget_inr, null);
  });
});
