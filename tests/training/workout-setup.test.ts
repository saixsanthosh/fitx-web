import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  asWorkoutLocation, clampDays, contextsFor, isWorkoutSetupDone, loadWorkoutSetup, modeForLocation, needsDemoModelChoice,
  resolveDemoModel, saveWorkoutSetup, setupFromRows, setupPreferenceRow,
} from "@/lib/training/setup";
import { initialMode, modeDirection, modeForKey, parseMode } from "@/lib/training/workout-mode";

const NOW = new Date("2026-11-23T10:00:00.000Z");
const LISTS = { home: null, gym: null, available: true };

type Call = { table: string; op: string; payload?: unknown; columns?: string };

/**
 * A minimal stand-in for the three tables setup reads and writes. `missing` lists columns the database does not
 * have yet (they fail like PostgREST: 42703 on read, PGRST204 on write).
 */
function fakeDb(options: { missing?: string[]; preferences?: Record<string, unknown> | null; gender?: string | null; lists?: Array<{ context: string; equipment_keys: string[] }>; failTable?: string } = {}) {
  const calls: Call[] = [];
  const missing = new Set(options.missing ?? []);
  const unknownRead = (columns: string) => columns.split(",").find((column) => missing.has(column));
  const db = {
    calls,
    from(table: string) {
      let columns = "";
      const result = () => {
        if (options.failTable === table) return { data: null, error: { code: "08006", message: "connection lost" } };
        const bad = unknownRead(columns);
        if (bad) return { data: null, error: { code: "42703", message: `column ${table}.${bad} does not exist` } };
        if (table === "user_preferences") return { data: options.preferences ?? null, error: null };
        if (table === "profiles") return { data: options.gender === undefined ? null : { gender: options.gender }, error: null };
        return { data: options.lists ?? [], error: null };
      };
      const builder = {
        select(value: string) { columns = value; calls.push({ table, op: "select", columns: value }); return builder; },
        eq() { return builder; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
        upsert(payload: Record<string, unknown>) {
          calls.push({ table, op: "upsert", payload });
          if (options.failTable === table) return Promise.resolve({ error: { code: "08006", message: "connection lost" } });
          const bad = Object.keys(payload).find((key) => missing.has(key));
          return Promise.resolve({ error: bad ? { code: "PGRST204", message: `Could not find the '${bad}' column of '${table}' in the schema cache` } : null });
        },
      };
      return builder;
    },
  };
  return db;
}

describe("workout setup rules", () => {
  test("done once saved, or once any equipment list exists (before the migration or without the backfill)", () => {
    assert.equal(isWorkoutSetupDone({ setupAt: null, hasEquipmentList: false }), false);
    assert.equal(isWorkoutSetupDone({ setupAt: "2026-11-23T10:00:00Z", hasEquipmentList: false }), true);
    assert.equal(isWorkoutSetupDone({ setupAt: null, hasEquipmentList: true }), true);
  });

  test("demonstration model: the member's choice, else male or female from the profile, else a choice is needed", () => {
    assert.equal(resolveDemoModel("female", "male"), "female");
    assert.equal(resolveDemoModel(null, "Male"), "male");
    assert.equal(resolveDemoModel(undefined, "female"), "female");
    assert.equal(resolveDemoModel(null, "non_binary"), null);
    assert.equal(resolveDemoModel("robot", null), null);
    assert.equal(needsDemoModelChoice("prefer_not_to_say"), true);
    assert.equal(needsDemoModelChoice("female"), false);
  });

  test("locations, lists and the mode they open on", () => {
    assert.equal(asWorkoutLocation("outdoor"), "home");
    assert.equal(asWorkoutLocation("both"), "both");
    assert.equal(asWorkoutLocation(undefined), "gym");
    assert.deepEqual(contextsFor("both"), ["home", "gym"]);
    assert.deepEqual(contextsFor("home"), ["home"]);
    assert.equal(modeForLocation("home"), "home");
    assert.equal(modeForLocation("both"), "gym");
    assert.equal(clampDays(9), 7);
    assert.equal(clampDays(0), 1);
    assert.equal(clampDays("x"), 3);
  });

  test("the state built from the rows", () => {
    const setup = setupFromRows({
      preferences: { workout_location: "home", fitness_level: "advanced", workouts_per_week: 5, limitations: ["knee", ""], demo_model: "male", workout_setup_at: null },
      gender: "female", profiles: { ...LISTS, home: ["dumbbell"] }, columnsAvailable: true,
    });
    assert.equal(setup.location, "home");
    assert.equal(setup.level, "advanced");
    assert.equal(setup.daysPerWeek, 5);
    assert.deepEqual(setup.limitations, ["knee"]);
    assert.equal(setup.demoModel, "male");
    assert.equal(setup.done, true, "a saved home list counts as done");
    const fresh = setupFromRows({ preferences: null, gender: null, profiles: LISTS, columnsAvailable: false });
    assert.equal(fresh.done, false);
    assert.equal(fresh.stored, false);
  });

  test("the preferences row: the setup time, clamped days, unique limitations and the home list as legacy words", () => {
    const row = setupPreferenceRow("u1", { location: "both", level: "intermediate", daysPerWeek: 12, limitations: ["knee", "knee", " back "], demoModel: null, home: ["kettlebell", "dumbbell"] }, NOW);
    assert.deepEqual(row, {
      user_id: "u1", workout_location: "both", fitness_level: "intermediate", workouts_per_week: 7, limitations: ["knee", "back"],
      demo_model: null, workout_setup_at: NOW.toISOString(), equipment: ["dumbbell", "kettlebell"],
    });
    assert.equal("equipment" in setupPreferenceRow("u1", { location: "gym", level: "beginner", daysPerWeek: 3, limitations: [], demoModel: "female", gym: ["barbell"] }, NOW), false);
  });
});

describe("loading and saving the setup", () => {
  test("loads with the new columns", async () => {
    const db = fakeDb({ preferences: { workout_location: "gym", fitness_level: "beginner", workouts_per_week: 3, limitations: [], equipment: [], workout_setup_at: "2026-11-20T08:00:00Z", demo_model: "female" }, gender: "male", lists: [] });
    const { error, setup } = await loadWorkoutSetup(db as never, "u1");
    assert.equal(error, null);
    assert.equal(setup?.columnsAvailable, true);
    assert.equal(setup?.done, true);
    assert.equal(setup?.demoModel, "female");
  });

  test("before the migration: reads without the two columns and counts a saved list as done", async () => {
    const db = fakeDb({ missing: ["workout_setup_at", "demo_model"], preferences: { workout_location: "home" }, gender: "female", lists: [{ context: "home", equipment_keys: ["dumbbell"] }] });
    const { error, setup } = await loadWorkoutSetup(db as never, "u1");
    assert.equal(error, null);
    assert.equal(setup?.columnsAvailable, false);
    assert.equal(setup?.done, true);
    assert.deepEqual(setup?.profiles.home, ["dumbbell"]);
  });

  test("a failed read is an error, never an empty setup", async () => {
    const { error, setup } = await loadWorkoutSetup(fakeDb({ failTable: "user_preferences" }) as never, "u1");
    assert.ok(error);
    assert.equal(setup, null);
  });

  test("saves the lists first, then the preferences with the setup time", async () => {
    const db = fakeDb();
    const outcome = await saveWorkoutSetup(db as never, "u1", { location: "both", level: "beginner", daysPerWeek: 3, limitations: [], demoModel: "male", home: ["dumbbell"], gym: ["barbell", "bench"] }, NOW);
    assert.equal(outcome.error, null);
    assert.equal(outcome.storedSetupTime, true);
    assert.deepEqual(db.calls.filter((call) => call.op === "upsert").map((call) => call.table), ["user_equipment_profiles", "user_equipment_profiles", "user_preferences"]);
    const prefs = db.calls.at(-1)?.payload as Record<string, unknown>;
    assert.equal(prefs.workout_setup_at, NOW.toISOString());
    assert.equal(prefs.demo_model, "male");
  });

  test("before the migration the answers still save, without the setup time", async () => {
    const db = fakeDb({ missing: ["workout_setup_at", "demo_model"] });
    const outcome = await saveWorkoutSetup(db as never, "u1", { location: "home", level: "beginner", daysPerWeek: 2, limitations: [], demoModel: null, home: [] }, NOW);
    assert.equal(outcome.error, null);
    assert.equal(outcome.storedSetupTime, false);
    const last = db.calls.at(-1)?.payload as Record<string, unknown>;
    assert.equal("workout_setup_at" in last, false);
    assert.equal(last.workout_location, "home");
  });

  test("a list that fails to save stops before the preferences, so setup is not marked done", async () => {
    const db = fakeDb({ failTable: "user_equipment_profiles" });
    const outcome = await saveWorkoutSetup(db as never, "u1", { location: "gym", level: "beginner", daysPerWeek: 3, limitations: [], demoModel: null, gym: ["barbell"] }, NOW);
    assert.ok(outcome.error);
    assert.equal(db.calls.some((call) => call.table === "user_preferences"), false);
  });
});

describe("Home and Gym modes", () => {
  test("the address wins, then this device, then the training location", () => {
    assert.equal(initialMode({ requested: "home", stored: "gym", location: "gym" }), "home");
    assert.equal(initialMode({ requested: "x", stored: "home", location: "gym" }), "home");
    assert.equal(initialMode({ location: "home" }), "home");
    assert.equal(initialMode({ location: "both" }), "gym");
    assert.equal(parseMode("Gym"), null);
  });

  test("keys move between the two tabs and the panels slide towards the new one", () => {
    assert.equal(modeForKey("ArrowRight", "home"), "gym");
    assert.equal(modeForKey("ArrowLeft", "home"), "gym");
    assert.equal(modeForKey("Home", "gym"), "home");
    assert.equal(modeForKey("Enter", "gym"), null);
    assert.equal(modeDirection("home", "gym"), 1);
    assert.equal(modeDirection("gym", "home"), -1);
    assert.equal(modeDirection("gym", "gym"), 0);
  });
});

describe("migration 20261123100020", () => {
  const sql = readFileSync("supabase/migrations/20261123100020_fitx_workout_setup.sql", "utf8");
  test("is additive, guarded and backfills only members with a saved list", () => {
    assert.match(sql, /add column if not exists workout_setup_at timestamptz/);
    assert.match(sql, /add column if not exists demo_model text/);
    assert.match(sql, /user_preferences_demo_model_check/);
    assert.match(sql, /where up\.workout_setup_at is null\s+and exists \(select 1 from public\.user_equipment_profiles/);
    assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b(?![^\n]*if exists)/i);
    assert.doesNotMatch(sql, /create table/i);
  });
});
