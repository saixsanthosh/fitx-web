// A strength session's numbers (contract C10): measured times, logged volume and sets, estimates flagged.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { estimateOneRepMax } from "@/lib/training/one-rep-max";
import { SESSION_STAT_KEYS, formatClock, sessionStatItems, sessionStats, type StatsExercise } from "@/lib/training/session-stats";

const T = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 18, 9, minute, second)).toISOString();
const finished = { status: "completed", started_at: T(0), completed_at: T(45, 30), duration_seconds: 2400 };
const exercises: StatsExercise[] = [
  { name: "Barbell Bench Press", sets: [
    { reps: 8, weight_kg: 80, completed_at: T(5) },
    { reps: 6, weight_kg: "90", completed_at: T(9) },
    { reps: 8, weight_kg: 80, completed_at: null },
    { reps: 0, weight_kg: 80, completed_at: T(12) },
  ] },
  { name: "Push-Up", sets: [{ reps: 15, weight_kg: 0, completed_at: T(20) }, { reps: 12, weight_kg: 0, completed_at: T(22) }] },
  { name: "Front Plank", target_duration_seconds: 45, sets: [{ reps: null, weight_kg: 0, duration_seconds: 45, completed_at: T(30) }, { reps: 1, weight_kg: 10, duration_seconds: 40, completed_at: T(32) }] },
  { name: "Cable Fly", sets: [{ reps: 12, weight_kg: 20, completed_at: null }] },
];

describe("sessionStats", () => {
  test("a finished session: measured times, logged volume, completed sets", () => {
    const stats = sessionStats(finished, exercises);
    assert.equal(stats.elapsedSeconds, 2730);
    assert.equal(stats.activeSeconds, 2400);
    assert.equal(stats.volumeKg, 8 * 80 + 6 * 90, "lifted sets with a weight only; the plank's 10 kg is a timed set");
    assert.equal(stats.completedSets, 6);
    assert.equal(stats.liftSets, 4);
    assert.equal(stats.weightedSets, 2);
    assert.equal(stats.timedSets, 2);
    assert.equal(stats.timedSeconds, 85);
    assert.equal(stats.exercisesDone, 3);
    assert.equal(stats.exercisesPlanned, 4);
    assert.deepEqual(stats.bestOneRepMax, { kg: estimateOneRepMax(90, 6), weightKg: 90, reps: 6, exerciseName: "Barbell Bench Press" });
  });

  test("unknown stays unknown: no finish time, no recorded timer, no weighted sets", () => {
    const bodyweight = sessionStats({ status: "completed", started_at: T(0), completed_at: null, duration_seconds: 0 }, [exercises[1]]);
    assert.equal(bodyweight.elapsedSeconds, null);
    assert.equal(bodyweight.activeSeconds, null, "a timer of 0 was never recorded");
    assert.equal(bodyweight.volumeKg, null, "a body-weight workout has no volume, not 0 kg");
    assert.equal(bodyweight.bestOneRepMax, null);
    const abandoned = sessionStats({ status: "abandoned", started_at: T(0), completed_at: null, duration_seconds: 300 }, exercises);
    assert.deepEqual([abandoned.elapsedSeconds, abandoned.activeSeconds, abandoned.completedSets], [null, 300, 6]);
    const empty = sessionStats({ started_at: "nonsense" }, []);
    assert.deepEqual([empty.elapsedSeconds, empty.activeSeconds, empty.volumeKg, empty.completedSets, empty.exercisesDone], [null, null, null, 0, 0]);
    assert.equal(sessionStats({ status: "completed", started_at: T(10), completed_at: T(5) }, []).elapsedSeconds, null, "an end before the start is not a time");
  });

  test("a session in progress: elapsed to now, training time without pauses", () => {
    const now = new Date(T(30));
    const running = { status: "in_progress", started_at: T(0), active_duration_seconds: 600, resumed_at: T(20), paused_at: null };
    assert.deepEqual([sessionStats(running, [], { now }).elapsedSeconds, sessionStats(running, [], { now }).activeSeconds], [1800, 1200]);
    const paused = { ...running, resumed_at: null, paused_at: T(25) };
    assert.equal(sessionStats(paused, [], { now }).activeSeconds, 600);
    const older = { status: "in_progress", started_at: T(0) };
    assert.equal(sessionStats(older, [], { now }).activeSeconds, 1800, "no pause columns: the timer runs from the start");
    assert.deepEqual([sessionStats(running, []).elapsedSeconds, sessionStats(running, []).activeSeconds], [null, null], "without now, nothing is guessed");
  });
});

describe("stat items for StatStrip", () => {
  test("clock times and the default items", () => {
    assert.deepEqual([0, 45, 2730, 3930, 59.6].map(formatClock), ["0:00", "0:45", "45:30", "1:05:30", "1:00"]);
    const items = sessionStatItems(sessionStats(finished, exercises), undefined, { locale: "en-GB" });
    assert.deepEqual(items.map((item) => [item.key, item.label, item.value, item.unit ?? null, Boolean(item.estimate)]), [
      ["elapsed", "Elapsed time", "45:30", null, false],
      ["active", "Training time", "40:00", null, false],
      ["volume", "Total volume", "1,180", "kg", false],
      ["sets", "Sets", "6", null, false],
    ]);
    assert.equal(items[1].note, "Pauses excluded");
  });

  test("unknown values stay null, the one-rep max is flagged as an estimate", () => {
    const stats = sessionStats({ status: "completed", started_at: T(0), completed_at: null }, [exercises[1], exercises[2]]);
    const items = sessionStatItems(stats, [...SESSION_STAT_KEYS], { locale: "en-GB" });
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    assert.equal(byKey.elapsed.value, null);
    assert.equal(byKey.active.value, null);
    assert.deepEqual([byKey.volume.value, byKey.volume.unit, byKey.volume.note], [null, undefined, "No weighted sets"]);
    assert.deepEqual([byKey.timed.value, byKey.timed.note], ["1:25", "2 timed sets"]);
    assert.deepEqual([byKey.one_rep_max.value, byKey.one_rep_max.estimate], [null, false]);
    const withMax = sessionStatItems(sessionStats(finished, exercises), ["one_rep_max", "exercises"], { locale: "en-GB" });
    assert.deepEqual([withMax[0].value, withMax[0].unit, withMax[0].estimate, withMax[0].note], [String(estimateOneRepMax(90, 6)), "kg", true, "Barbell Bench Press"]);
    assert.deepEqual([withMax[1].value, withMax[1].note], ["3", "of 4 planned"]);
  });
});
