// D8 L1: Admin's member view shows "Not set" for the experience, place and days of a member who has not done the
// Workouts setup (the stored values are only column defaults), as the app's Profile does (trainingAnswersKnown).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { trainingAnswers } = await importTypeScriptModule("src/lib/training-answers.ts");
const defaults = { fitness_level: "beginner", workout_location: "gym", workouts_per_week: 3 };

test("no setup and no equipment list: nothing is shown as the member's own", () => {
  assert.deepEqual(trainingAnswers({ ...defaults, workout_setup_at: null }, false, true), { trainingKnown: false, experience: null, place: null, daysPerWeek: null });
});

test("a finished setup, or a saved equipment list, shows the stored answers", () => {
  const expected = { trainingKnown: true, experience: "beginner", place: "gym", daysPerWeek: 3 };
  assert.deepEqual(trainingAnswers({ ...defaults, workout_setup_at: "2026-11-23T10:00:00Z" }, false, true), expected);
  assert.deepEqual(trainingAnswers({ ...defaults, workout_setup_at: null }, true, true), expected);
  // Before 20261123100020 (no workout_setup_at column) a saved list is the only sign.
  assert.deepEqual(trainingAnswers(defaults, true, false), expected);
  assert.deepEqual(trainingAnswers(defaults, false, false).trainingKnown, false);
});

test("when the setup state cannot be read, it is unknown, never a default", () => {
  assert.deepEqual(trainingAnswers(null, null, false), { trainingKnown: null, experience: null, place: null, daysPerWeek: null });
  assert.equal(trainingAnswers({ ...defaults, workout_setup_at: "2026-11-23T10:00:00Z" }, null, true).trainingKnown, true);
});

test("the member page shows Not set, and reads the setup column with a fallback", async () => {
  const page = await readFile(new URL("../src/app/(control)/users/[id]/page.tsx", import.meta.url), "utf8");
  for (const label of ["Experience", "Trains at", "Days a week"]) assert.match(page, new RegExp(`<Field label="${label}">\\{trainingValue\\(person\\.profile\\.trainingKnown`), label);
  assert.match(page, /if \(known === false\) return <span[^>]*>Not set<\/span>;/);
  const data = await readFile(new URL("../src/lib/data/people.ts", import.meta.url), "utf8");
  assert.match(data, /workout_setup_at/);
  assert.match(data, /from\("user_equipment_profiles"\)/);
});
