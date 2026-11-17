import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogExercise } from "@/lib/training/catalog";
import { slotMinutes } from "@/lib/training/generator";
import {
  contextForLocation, formatDuration, isTimedRow, planEquipment, planEstimateMinutes, planSummary, restLabel, rowMinutes, rowPrescription,
  setsAndWork, targetLoad, type PlanRowInput,
} from "@/lib/training/plan-summary";

const row = (overrides: Partial<PlanRowInput> = {}): PlanRowInput => ({ target_sets: 4, reps_min: 8, reps_max: 10, rest_seconds: 120, target_weight_kg: null, target_duration_seconds: null, ...overrides });
const plank = row({ target_sets: 3, reps_min: 1, reps_max: 1, rest_seconds: 45, target_duration_seconds: 40 });
const needs = (...keys: string[]) => ({ required_equipment: keys }) as Pick<CatalogExercise, "required_equipment">;

test("each row reads as sets × reps or time, with its target load", () => {
  assert.equal(setsAndWork(row()), "4 × 8–10 reps");
  assert.equal(setsAndWork(row({ target_sets: 3, reps_min: 12, reps_max: 12 })), "3 × 12 reps");
  assert.equal(setsAndWork(plank), "3 × 40 s", "a timed row shows its time, never its stored 1–1 reps");
  assert.equal(setsAndWork(row({ target_duration_seconds: 90 })), "4 × 1 min 30 s");
  assert.equal(targetLoad(row({ target_weight_kg: 60 })), "60 kg");
  assert.equal(targetLoad(row({ target_weight_kg: 12.5 })), "12.5 kg");
  assert.equal(targetLoad(row({ target_weight_kg: 0 })), null, "no load set is not 0 kg");
  assert.equal(targetLoad(row()), null);
  assert.equal(rowPrescription(row({ target_weight_kg: 60 })), "4 × 8–10 reps · 60 kg");
  assert.equal(rowPrescription(plank), "3 × 40 s");
  assert.equal(isTimedRow(plank), true);
  assert.equal(isTimedRow(row()), false);
});

test("rest and times read in minutes and seconds", () => {
  assert.equal(formatDuration(45), "45 s");
  assert.equal(formatDuration(90), "1 min 30 s");
  assert.equal(formatDuration(600), "10 min");
  assert.equal(restLabel(150), "Rest 2 min 30 s");
  assert.equal(restLabel(0), null);
  assert.equal(restLabel(null), null);
});

test("the session estimate uses the generator's timing rule and is rounded as an estimate", () => {
  // 4 × (9 reps × 3.5 s + 15 s set-up + 120 s rest) and 3 × (40 s + 45 s rest).
  assert.equal(rowMinutes(row()), slotMinutes({ muscle: "chest", sets: 4, reps: [8, 10], rest: 120 }));
  assert.equal(rowMinutes(plank), slotMinutes({ muscle: "core", sets: 3, reps: [1, 1], rest: 45, seconds: 40 }));
  assert.equal(planEstimateMinutes([row(), plank]), 15, "11.1 + 4.25 minutes, to the nearest 5");
  assert.equal(planEstimateMinutes([row({ target_sets: 1, rest_seconds: 15, target_duration_seconds: 5 })]), 1, "short plans in whole minutes");
  assert.equal(planEstimateMinutes([]), null);
});

test("the summary counts exercises and planned sets", () => {
  assert.deepEqual(planSummary([row(), plank]), { exercises: 2, totalSets: 7, estimateMinutes: 15 });
  assert.deepEqual(planSummary([]), { exercises: 0, totalSets: 0, estimateMinutes: null });
});

test("you'll need: the equipment of every exercise, what is missing from the list, and exercises no longer listed", () => {
  const owned = new Set(["dumbbell", "bench"]);
  const equipment = planEquipment([needs("barbell", "bench"), needs("dumbbell"), needs(), null], owned);
  assert.deepEqual(equipment.keys, ["dumbbell", "barbell", "bench"], "in the catalogue's order, once each");
  assert.deepEqual(equipment.missing, ["barbell"]);
  assert.equal(equipment.unknown, 1);
  assert.equal(equipment.bodyWeightOnly, false);
  assert.equal(planEquipment([needs(), needs()]).bodyWeightOnly, true);
  assert.equal(planEquipment([null]).bodyWeightOnly, false, "unknown equipment is never shown as body weight");
  assert.deepEqual(planEquipment([needs("barbell")]).missing, [], "no list given: nothing is flagged");
});

test("a plan's location picks the equipment list: home and outdoor use the home list", () => {
  assert.equal(contextForLocation("home"), "home");
  assert.equal(contextForLocation("outdoor"), "home");
  assert.equal(contextForLocation("gym"), "gym");
  assert.equal(contextForLocation("both"), "gym");
  assert.equal(contextForLocation(null), "gym");
});
