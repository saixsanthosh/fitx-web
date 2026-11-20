import { test } from "node:test";
import assert from "node:assert/strict";
import { getExerciseRule } from "@/lib/form-rules/catalog";
import { createCoachSession } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import { planFrames, superman } from "./figure-poses";
import { cueIds, play } from "./synthetic";

const rule = getExerciseRule("superman") as ExerciseRule;
const run = (depths: number[], chest: number, legs: number, seq = {}) =>
  play(createCoachSession(rule), planFrames("superman", { from: 0, depths, repMs: 2200, restMs: 600 }, (k) => superman(chest * k, legs * k), seq));

test("counts reps when chest and legs lift together", () => {
  const result = run([1, 1, 1, 1, 1], 15, 10, { noise: 0.002, seed: 8 });
  assert.equal(result.last.reps, 5);
  assert.equal(result.last.cleanReps, 5);
  assert.deepEqual(cueIds(result.events), []);
});

test("a small lift is a partial rep, not counted", () => {
  const result = run([1, 0.45, 1], 15, 10);
  assert.equal(result.last.reps, 2);
  assert.equal(result.last.partials, 1);
});

test("lifting only the chest raises the legs-up cue", () => {
  const result = run([1, 1], 24, 0);
  assert.ok(cueIds(result.events).includes("legs_down"));
});

test("lifting only the legs raises the chest-up cue", () => {
  const result = run([1, 1], 0, 17);
  assert.ok(cueIds(result.events).includes("chest_down"));
});
