// "Last time" in the live workout: the latest completed session's sets for an exercise, written compactly.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatHistorySet, lastTimeForSet, summariseLastTime } from "@/app/(dashboard)/workouts/active/_lib/last-time";
import type { ExerciseSession, HistorySet } from "@/lib/training/exercise-history";

const at = "2026-11-12T09:10:00.000Z";
const lift = (setNumber: number, reps: number, weightKg: number): HistorySet => ({ setNumber, reps, weightKg, durationSeconds: null, completedAt: at });
const hold = (setNumber: number, seconds: number, weightKg = 0): HistorySet => ({ setNumber, reps: null, weightKg, durationSeconds: seconds, completedAt: at });
const session = (sets: HistorySet[], timed = false): Pick<ExerciseSession, "sets" | "timed"> => ({ sets, timed });

describe("one logged set", () => {
  test("lifts, body weight, timed work", () => {
    assert.equal(formatHistorySet(lift(1, 8, 40), false), "40 kg × 8");
    assert.equal(formatHistorySet(lift(1, 8, 42.5), false), "42.5 kg × 8");
    assert.equal(formatHistorySet(lift(1, 12, 0), false), "12 reps");
    assert.equal(formatHistorySet(hold(1, 45), true), "45 s");
    assert.equal(formatHistorySet(hold(1, 45, 20), true), "45 s · 20 kg");
    // A timed movement logged with reps only shows the reps as logged.
    assert.equal(formatHistorySet(lift(1, 20, 0), true), "20 reps");
  });
});

describe("the session in one line", () => {
  test("matching sets: 3 × 8 @ 40 kg", () => {
    assert.equal(summariseLastTime(session([lift(1, 8, 40), lift(2, 8, 40), lift(3, 8, 40)])), "3 × 8 @ 40 kg");
    assert.equal(summariseLastTime(session([lift(1, 12, 0), lift(2, 12, 0)])), "2 × 12 reps");
    assert.equal(summariseLastTime(session([hold(1, 45), hold(2, 45)], true)), "2 × 45 s");
  });

  test("one set as it was; different sets as a count and the best set", () => {
    assert.equal(summariseLastTime(session([lift(1, 6, 80)])), "80 kg × 6");
    assert.equal(summariseLastTime(session([lift(1, 8, 40), lift(2, 6, 42.5), lift(3, 8, 40)])), "3 sets · best 42.5 kg × 6");
    assert.equal(summariseLastTime(session([hold(1, 40), hold(2, 55)], true)), "2 sets · best 55 s");
    assert.equal(summariseLastTime(session([])), "");
  });
});

describe("the matching set", () => {
  test("by set number, else nothing", () => {
    const last = session([lift(1, 8, 40), lift(2, 6, 42.5)]);
    assert.equal(lastTimeForSet(last, 2)?.weightKg, 42.5);
    assert.equal(lastTimeForSet(last, 3), null, "last time had two sets");
    assert.equal(lastTimeForSet(null, 1), null);
    assert.equal(lastTimeForSet(last, 0), null);
  });

  test("sets without numbers match by position", () => {
    const unnumbered = session([{ ...lift(1, 8, 40), setNumber: null }, { ...lift(2, 6, 45), setNumber: null }]);
    assert.equal(lastTimeForSet(unnumbered, 2)?.weightKg, 45);
  });
});
