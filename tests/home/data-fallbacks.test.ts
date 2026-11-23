// The Home, Goals and To-Do data layer against a database with and without the Phase 3 migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, used, type StubCall, type StubResponse } from "./support/stub-db";
import { loadDashboardLayout, loadTodaySummary, saveDashboardLayout } from "@/lib/data/today";
import { createGoal, loadGoalOptions, loadGoals } from "@/lib/data/goals";
import { insertTodo, loadTodos, saveTodoOrder } from "@/lib/data/todo";
import { FeatureUnavailableError, DataError } from "@/lib/data/missing-schema";
import { defaultLayout, layoutReducer, visibleIds } from "@/lib/domain/dashboard-layout";
import { estimatedTargets } from "@/lib/domain/today";
import { validateGoalDraft, goalDraft } from "@/lib/domain/goals";
import { validateTodoDraft, emptyTodoDraft } from "@/lib/domain/todo";

const USER = "user-1";
const DAY = "2026-11-18";
const MISSING_FUNCTION = { code: "PGRST202", message: "Could not find the function" };
const MISSING_COLUMN = { code: "42703", message: "column planner_events.local_date does not exist" };
const UNKNOWN_COLUMN = { code: "PGRST204", message: "Could not find the 'dashboard_layout' column" };
const db = (stub: StubDb) => stub as unknown as SupabaseClient;

test("the summary comes from one database call (plus the Nutrition targets and today's entries) when fitx_today_summary exists", async () => {
  const stub = new StubDb((call) => (call.name === "fitx_today_summary"
    ? { data: { local_date: DAY, nutrition: { calories: 900, protein: 40 } } }
    : call.name === "meals" ? { data: [{ calories: 500, protein: 40, carbs: 50, fat: 10, nutrition_snapshot: { value_basis: "lab_analysed" } }, { calories: 400, protein: null, carbs: null, fat: 12, nutrition_snapshot: { missing: ["protein", "carbs"], value_basis: "recipe_calculated" } }] } : undefined));
  const result = await loadTodaySummary(db(stub), USER, DAY, "Asia/Kolkata");
  assert.equal(result.source, "database");
  assert.equal(result.summary.nutrition.calories, 900);
  // profiles: the birth date only, so the age follows a birthday (the summary's stored age lags until a save);
  // user_preferences: the nutrition goal and whether the Workouts setup answered the days, which the summary does not
  // carry; user_equipment_profiles: a saved list, the setup's other sign (no workout_setup_at in this stub).
  assert.deepEqual(stub.calls.map((call) => call.name).sort(), ["fitx_today_summary", "meals", "nutrition_targets", "profiles", "user_equipment_profiles", "user_preferences", "user_preferences"]);
  assert.ok(used(stub.callsTo("profiles")[0], "select", "date_of_birth"));
  assert.ok(stub.callsTo("user_preferences").some((call) => used(call, "select", "nutrition_focus")));
  assert.ok(stub.callsTo("user_preferences").some((call) => used(call, "select", "workout_setup_at")));
  assert.deepEqual(stub.calls[0].args, { p_local_date: DAY, p_tz: "Asia/Kolkata" });
  assert.ok(used(stub.callsTo("meals")[0], "eq", "date", DAY));
  assert.deepEqual(result.food?.protein, { sum: 40, known: 1, missing: 1 }, "the unknown protein is counted as missing, not as 0 g");
  assert.equal(result.food?.estimated, 1);
});

test("the age comes from the birth date on the member's day; without one, or before migration #41, the stored age stands", async () => {
  const summary = { local_date: DAY, profile: { age: 17, gender: "female", height: 160, weight: 50 } };
  const withBirthDate = new StubDb((call) => (call.name === "fitx_today_summary" ? { data: summary } : call.name === "profiles" ? { data: { date_of_birth: "2008-11-18" } } : undefined));
  assert.equal((await loadTodaySummary(db(withBirthDate), USER, DAY, null)).summary.profile.age, 18, "an 18th birthday today counts at once");
  const dayBefore = new StubDb((call) => (call.name === "fitx_today_summary" ? { data: summary } : call.name === "profiles" ? { data: { date_of_birth: "2008-11-19" } } : undefined));
  assert.equal((await loadTodaySummary(db(dayBefore), USER, DAY, null)).summary.profile.age, 17);
  const noColumn = new StubDb((call) => (call.name === "fitx_today_summary" ? { data: summary } : call.name === "profiles" ? { error: { code: "42703", message: "column profiles.date_of_birth does not exist" } } : undefined));
  assert.equal((await loadTodaySummary(db(noColumn), USER, DAY, null)).summary.profile.age, 17);
  const noAge = new StubDb((call) => (call.name === "fitx_today_summary" ? { data: { local_date: DAY, profile: {} } } : call.name === "profiles" ? { data: { date_of_birth: null } } : undefined));
  assert.equal((await loadTodaySummary(db(noAge), USER, DAY, null)).summary.profile.age, null, "an unknown age stays unknown, never 0");
});

test("the weekly training days reach Home only once the Workouts setup answered them, never as the column default", async () => {
  const summary = { local_date: DAY, preferences: { workouts_per_week: 3, daily_water_goal_ml: 2500 } };
  const read = async (answer: (call: StubCall) => StubResponse | undefined) => (await loadTodaySummary(db(new StubDb((call) => (call.name === "fitx_today_summary" ? { data: summary } : answer(call)))), USER, DAY, null)).summary;
  const prefs = (data: unknown) => (call: StubCall) => (call.name === "user_preferences" && used(call, "select", "workout_setup_at") ? data as StubResponse : undefined);
  // A new member: the preferences row exists (onboarding made it) with the default 3, no setup, no list.
  const fresh = await read(prefs({ data: { workout_setup_at: null } }));
  assert.equal(fresh.preferences?.workoutsPerWeek, null, "the default 3 is not the member's answer");
  assert.equal(fresh.preferences?.dailyWaterGoalMl, 2500, "the rest of the preferences stand");
  const answered = await read(prefs({ data: { workout_setup_at: "2026-11-18T08:00:00Z" } }));
  assert.equal(answered.preferences?.workoutsPerWeek, 3, "answered in the setup: their own 3");
  // Before migration 20261123100020 (no column) a saved equipment list counts, as in the setup's own rule.
  const listed = await read((call) => (call.name === "user_preferences" && used(call, "select", "workout_setup_at") ? { error: { code: "42703", message: "column user_preferences.workout_setup_at does not exist" } }
    : call.name === "user_equipment_profiles" ? { data: [{ context: "gym" }] } : undefined));
  assert.equal(listed.preferences?.workoutsPerWeek, 3);
  const failed = await read(prefs({ error: { code: "57014", message: "canceling statement due to statement timeout" } }));
  assert.equal(failed.preferences?.workoutsPerWeek, null, "a failed read never shows the default as theirs");
});

test("the nutrition goal reaches Home's targets; without the column (before migration #41) the standard target stands", async () => {
  const summary = { local_date: DAY, profile: { age: 30, gender: "male", height: 178, weight: 82 }, preferences: { activity_level: "moderate", primary_goal: "muscle_gain" } };
  const read = async (prefs: Record<string, unknown>) => (await loadTodaySummary(db(new StubDb((call) => (call.name === "fitx_today_summary" ? { data: summary } : call.name === "user_preferences" ? prefs : undefined))), USER, DAY, null)).summary;
  const high = await read({ data: { nutrition_focus: "high_protein" } });
  assert.equal(high.preferences?.nutritionFocus, "high_protein");
  const standard = await read({ data: { nutrition_focus: "none" } });
  const noColumn = await read({ error: MISSING_COLUMN });
  assert.equal(noColumn.preferences?.nutritionFocus, null);
  assert.ok(estimatedTargets(high)!.protein > estimatedTargets(standard)!.protein, "High protein raises Home's protein target");
  assert.deepEqual(estimatedTargets(noColumn), estimatedTargets(standard));
  const noRow = await loadTodaySummary(db(new StubDb((call) => (call.name === "fitx_today_summary" ? { data: { local_date: DAY } } : call.name === "user_preferences" ? { data: { nutrition_focus: "high_protein" } } : undefined))), USER, DAY, null);
  assert.equal(noRow.summary.preferences, null, "no preferences row is invented for the nutrition goal");
});

test("today's entries failing to load leaves the sums standing and the checks unknown", async () => {
  const stub = new StubDb((call) => (call.name === "fitx_today_summary" ? { data: { local_date: DAY, nutrition: { calories: 900 } } } : call.name === "meals" ? { error: { code: "57014" } } : undefined));
  const result = await loadTodaySummary(db(stub), USER, DAY, null);
  assert.equal(result.summary.nutrition.calories, 900);
  assert.equal(result.food, null);
});

test("without fitx_today_summary the browser adds up every row itself", async () => {
  const rows: Record<string, unknown> = {
    profiles: { name: "Asha", age: 30, gender: "female", height: 165, weight: 82, target_weight: 70 },
    user_preferences: { workouts_per_week: 4, daily_water_goal_ml: 3000, activity_level: "light", primary_goal: "fat_loss" },
    meals: Array.from({ length: 75 }, () => ({ calories: 20, protein: 2, carbs: 1, fat: 1 })),
    water_logs: [{ amount_ml: 500 }],
    workout_sessions: [{ started_at: new Date(2026, 10, 18, 9).toISOString() }],
    body_metrics: [{ weight: 80.2, date: "2026-11-17" }],
    planner_events: [],
  };
  const stub = new StubDb((call) => (call.kind === "rpc" ? { error: MISSING_FUNCTION } : { data: rows[call.name] }));
  const result = await loadTodaySummary(db(stub), USER, DAY, "Asia/Kolkata");
  assert.equal(result.source, "browser");
  assert.equal(result.summary.nutrition.calories, 1500, "all 75 meals count; the old Home stopped at 50");
  assert.equal(result.summary.workouts.today, 1);
  assert.equal(result.summary.weight?.kg, 80.2);
  const meals = stub.callsTo("meals")[0];
  assert.ok(used(meals, "eq", "date", DAY));
  assert.ok(used(meals, "limit", 2000));
});

test("any other summary failure is reported, not hidden behind the fallback", async () => {
  const stub = new StubDb(() => ({ error: { code: "57014", message: "timeout" } }));
  await assert.rejects(loadTodaySummary(db(stub), USER, DAY, null), DataError);
  assert.equal(stub.callsTo("fitx_today_summary").length, 1);
  // The setup read failed too (the same error), so it stops there: no equipment-list read.
  assert.deepEqual(stub.calls.map((call) => call.name).sort(), ["fitx_today_summary", "meals", "nutrition_targets", "profiles", "user_preferences", "user_preferences"], "no fallback queries ran");
  assert.deepEqual(stub.callsTo("user_preferences").map((call) => (used(call, "select", "nutrition_focus") ? "focus" : used(call, "select", "workout_setup_at") ? "setup" : "other")).sort(), ["focus", "setup"], "user_preferences was read only for the nutrition goal and the setup state, not by the fallback");
  assert.deepEqual(stub.callsTo("profiles").map((call) => used(call, "select", "date_of_birth")), [true], "profiles was read only for the birth date, not by the fallback");
});

test("layout: default when none is saved, read-only when the column is missing", async () => {
  const none = await loadDashboardLayout(db(new StubDb(() => ({ data: { dashboard_layout: null } }))), USER);
  assert.deepEqual(none, { items: defaultLayout(), canSave: true, fresh: [] });
  const saved = await loadDashboardLayout(db(new StubDb(() => ({ data: { dashboard_layout: { version: 1, items: [{ id: "weight", visible: true }] } } }))), USER);
  assert.deepEqual(visibleIds(saved.items), ["weight"]);
  const missing = await loadDashboardLayout(db(new StubDb(() => ({ error: MISSING_COLUMN }))), USER);
  assert.deepEqual(missing, { items: defaultLayout(), canSave: false, fresh: [] });
});

test("layout: saved with an update, inserted only when there is no preferences row, honest when unavailable", async () => {
  const items = layoutReducer(defaultLayout(), { type: "move", id: "weight", delta: -3 });
  const updated = new StubDb((call) => (call.name === "user_preferences" && used(call, "update") ? { data: [{ user_id: USER }] } : undefined));
  assert.equal(await saveDashboardLayout(db(updated), USER, items), "saved");
  const update = updated.calls[0];
  assert.deepEqual((update.ops.find((op) => op.method === "update")?.args[0] as { dashboard_layout: { version: number } }).dashboard_layout.version, 1);
  assert.ok(used(update, "eq", "user_id", USER));

  const inserted = new StubDb((call) => (used(call, "update") ? { data: [] } : { data: null }));
  assert.equal(await saveDashboardLayout(db(inserted), USER, items), "saved");
  assert.ok(used(inserted.calls[1], "insert"), "no preferences row: one is created");

  const missing = new StubDb(() => ({ error: UNKNOWN_COLUMN }));
  assert.equal(await saveDashboardLayout(db(missing), USER, items), "unavailable");
});

test("goals: progress from fitx_goal_progress, or plain manual goals on an older database", async () => {
  const v2 = await loadGoals(db(new StubDb(() => ({ data: [{ id: "g", title: "Protein", metric: "protein_g", period: "daily", target_value: 100, current_value: 70 }] }))), USER, DAY, null);
  assert.equal(v2.schema, "v2");
  assert.equal(v2.goals[0].currentValue, 70);
  const legacyStub = new StubDb((call) => (call.kind === "rpc" ? { error: MISSING_FUNCTION } : { data: [{ id: "g", title: "Run", metric: "manual", target_value: 100, current_value: 7 }] }));
  const v1 = await loadGoals(db(legacyStub), USER, DAY, null);
  assert.equal(v1.schema, "v1");
  assert.deepEqual([v1.goals[0].period, v1.goals[0].currentValue], ["long_term", 7]);
  assert.ok(used(legacyStub.callsTo("goals")[0], "neq", "status", "cancelled"));
});

test("goals: an older database accepts custom long-term goals and says automatic ones need the update", async () => {
  const context = { today: DAY, estimate: null, workoutsPerWeek: 3, waterGoalMl: 2500, latestWeight: 80, targetWeight: 72 };
  const protein = validateGoalDraft({ ...goalDraft("protein_day", context), target: "120" });
  assert.ok(protein.ok);
  const stub = new StubDb(() => ({ data: { id: "new" } }));
  if (protein.ok) await assert.rejects(createGoal(db(stub), USER, protein.value, "v1"), FeatureUnavailableError);
  assert.equal(stub.calls.length, 0, "nothing is written");
  const custom = validateGoalDraft({ ...goalDraft("custom", context), title: "Read", target: "12", unit: "books" });
  assert.ok(custom.ok);
  if (custom.ok) assert.equal(await createGoal(db(stub), USER, custom.value, "v1"), "new");
  const row = stub.calls[0].ops.find((op) => op.method === "insert")?.args[0] as Record<string, unknown>;
  assert.equal("period" in row, false, "no v2 columns are sent to a v1 database");
  assert.equal(row.current_value, 0);
});

test("To-Dos: the v2 query, then the Phase 1 week by start time when local_date is missing", async () => {
  const v2Stub = new StubDb(() => ({ data: [{ id: "a", event_type: "task", title: "Stretch", local_date: DAY, status: "scheduled", sort_order: 0 }] }));
  const v2 = await loadTodos(db(v2Stub), USER, DAY, DAY);
  assert.equal(v2.schema, "v2");
  assert.ok(used(v2Stub.calls[0], "gte", "local_date", DAY));

  const calls: StubCall[] = [];
  const legacyStub = new StubDb((call) => {
    calls.push(call);
    return calls.length === 1 ? { error: MISSING_COLUMN } : { data: [{ id: "b", event_type: "workout", title: "Push", starts_at: new Date(2026, 10, 18, 18).toISOString(), status: "scheduled" }] };
  });
  const legacy = await loadTodos(db(legacyStub), USER, DAY, DAY);
  assert.equal(legacy.schema, "legacy");
  assert.equal(legacy.items[0].localDate, DAY);
  assert.ok(used(legacyStub.calls[1], "gte", "starts_at"));
});

test("To-Dos: an older database takes timed events but explains that untimed To-Dos need the update", async () => {
  const stub = new StubDb(() => ({ data: { id: "x", event_type: "workout", title: "Push", starts_at: "2026-11-18T12:30:00Z", status: "scheduled" } }));
  const untimed = validateTodoDraft({ ...emptyTodoDraft(DAY), title: "Buy oats" });
  assert.ok(untimed.ok);
  if (untimed.ok) await assert.rejects(insertTodo(db(stub), USER, untimed.value, 0, "legacy"), FeatureUnavailableError);
  const timed = validateTodoDraft({ ...emptyTodoDraft(DAY), title: "Push", kind: "workout", time: "18:00" });
  assert.ok(timed.ok);
  if (timed.ok) await insertTodo(db(stub), USER, timed.value, 0, "legacy");
  const row = stub.calls[0].ops.find((op) => op.method === "insert")?.args[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(row).sort(), ["description", "ends_at", "event_type", "starts_at", "status", "title", "user_id", "workout_plan_id"]);
});

test("To-Dos: a day's order is saved in one call", async () => {
  const stub = new StubDb(() => ({ data: 2 }));
  await saveTodoOrder(db(stub), DAY, ["b", "a"]);
  assert.deepEqual(stub.calls.map((call) => [call.name, call.args]), [["fitx_reorder_todo", { p_local_date: DAY, p_ids: ["b", "a"] }]]);
  await assert.rejects(saveTodoOrder(db(new StubDb(() => ({ error: MISSING_FUNCTION }))), DAY, ["a"]), FeatureUnavailableError);
});

test("the summary carries the targets set in Nutrition, and works without that table", async () => {
  const withTargets = new StubDb((call) => (call.kind === "rpc" ? { data: { local_date: DAY } } : call.name === "nutrition_targets" ? { data: { calories: 2400, protein_g: 150, carbs_g: 260, fat_g: 70 } } : undefined));
  const loaded = await loadTodaySummary(db(withTargets), USER, DAY, null);
  assert.deepEqual(loaded.summary.targets, { calories: 2400, protein: 150, carbs: 260, fat: 70 });
  assert.ok(used(withTargets.callsTo("nutrition_targets")[0], "eq", "user_id", USER));
  const missing = new StubDb((call) => (call.kind === "rpc" ? { data: { local_date: DAY } } : { error: { code: "PGRST205", message: "Could not find the table" } }));
  assert.equal((await loadTodaySummary(db(missing), USER, DAY, null)).summary.targets, null);
});

test("To-Dos can count toward Checklist goals only, keeping a link that already exists", async () => {
  const stub = new StubDb(() => ({ data: [{ id: "g1", title: "Prep for the 10K", metric: "tasks_completed" }] }));
  const options = await loadGoalOptions(db(stub), USER);
  assert.deepEqual(options, [{ id: "g1", title: "Prep for the 10K", countsTodos: true }]);
  assert.ok(used(stub.calls[0], "eq", "metric", "tasks_completed"));
  const linked = "3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const keep = new StubDb(() => ({ data: [{ id: linked, title: "Read 12 books", metric: "manual" }] }));
  const kept = await loadGoalOptions(db(keep), USER, linked);
  assert.ok(used(keep.calls[0], "or", `metric.eq.tasks_completed,id.eq.${linked}`));
  assert.deepEqual(kept, [{ id: linked, title: "Read 12 books", countsTodos: false }]);
  const odd = new StubDb(() => ({ data: [] }));
  await loadGoalOptions(db(odd), USER, "not-a-uuid),id.neq.x");
  assert.equal(used(odd.calls[0], "or"), false, "a malformed id never reaches the filter");
});
